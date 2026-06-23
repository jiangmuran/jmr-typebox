<script setup>
// Agentic AI chat panel (slide-over). The user converses with TypeBox AI, which can call
// site-level tools (read/edit the document, export, set theme, summarize…) to actually do
// work. Runs a tool-calling loop: model → tool calls → execute against ctx → feed results
// back → repeat until the model answers without further tool calls.
import { ref, computed, nextTick, watch, onMounted, onUnmounted } from 'vue'
import { useI18n } from '../composables/useI18n'
import { useAI } from '../composables/useAI'
import { useEditor } from '../composables/useEditor'
import { useToast } from '../composables/useToast'
import { TOOLS, TOOL_MAP, toolSpecs, dispatchTool } from '../ai/tools'
import { parseToolArguments } from '../ai/stream'
import { agentSystemPrompt } from '../ai/prompts'
import { THEMES, isThemeId } from '../themes/registry'

const props = defineProps({
  editorEl: { type: Object, default: null }, // editor <textarea> (for cursor inserts)
  exportFn: { type: Function, default: null }, // (format) => Promise, from EditorPage
})
const open = defineModel('open', { default: false })

const { t, locale } = useI18n()
const { ready, chat } = useAI()
const { content, filename, stats, updateContent, newDocument } = useEditor()
const { showToast } = useToast()

const MAX_TURNS = 8 // safety cap on the agentic loop

// ---- Chat state ----
// messages: rendered turns. Each: { role:'user'|'assistant'|'tool', content, tools?:[{name,args,result,done}] }
const messages = ref([])
const input = ref('')
const busy = ref(false)
const scrollEl = ref(null)
const inputEl = ref(null)
let controller = null

const canSend = computed(() => ready.value && input.value.trim() && !busy.value)

// ---- Tool context: the site-level capabilities the agent can drive ----
function setTheme(themeId, target) {
  const id = String(themeId || '').trim()
  if (id === 'default') {
    if (target === 'export') return { ok: true, id: 'default' } // export has no 'default'; treat as no-op-ish
    return applyTheme('default', target)
  }
  if (!isThemeId(id)) return { ok: false }
  return applyTheme(id, target)
}
const emit = defineEmits(['set-theme', 'open-settings'])
function applyTheme(id, target) {
  emit('set-theme', { id, target })
  return { ok: true, id }
}

function insertText(text, where = 'end') {
  const el = props.editorEl
  const cur = content.value
  if (where === 'cursor' && el) {
    const pos = el.selectionStart ?? cur.length
    const next = cur.slice(0, pos) + text + cur.slice(pos)
    updateContent(next)
    nextTick(() => { try { el.focus(); el.selectionStart = el.selectionEnd = pos + text.length } catch {} })
    return
  }
  if (where === 'start') { updateContent(text + (cur ? '\n\n' : '') + cur); return }
  updateContent(cur + (cur && !cur.endsWith('\n') ? '\n\n' : '') + text)
}

const ctx = {
  getDocument: () => ({ name: filename.value, content: content.value }),
  getStats: () => ({ chars: stats.value.chars, words: stats.value.words, lines: stats.value.lines }),
  replaceDocument: (text) => updateContent(String(text ?? '')),
  insertText,
  appendText: (text) => insertText(text, 'end'),
  newDocument: (name, content) => {
    const doc = newDocument(name || 'untitled')
    if (content) updateContent(content)
    return { name: doc?.name }
  },
  exportDocument: async (format) => {
    if (!props.exportFn) throw new Error('Export is unavailable here.')
    await props.exportFn(format)
  },
  setTheme,
  listThemes: () => THEMES.map(th => ({ id: th.id, name: th.name, dark: th.dark })),
  // Sub-completion for tools like summarize (no tools, plain text).
  ai: async (msgs, opts = {}) => {
    const m = await chat(msgs, { ...opts })
    return m.content || ''
  },
}

// ---- Agentic loop ----
async function send() {
  if (!canSend.value) return
  const text = input.value.trim()
  input.value = ''
  messages.value.push({ role: 'user', content: text })
  await scrollDown()
  await runAgent()
}

function buildApiMessages() {
  // System prompt + the visible conversation flattened into OpenAI message format.
  const sys = agentSystemPrompt({ docName: filename.value })
  const langNote = locale.value === 'zh' ? ' Reply in Chinese unless asked otherwise.' : ''
  const out = [{ role: 'system', content: sys + langNote }]
  for (const m of messages.value) {
    // Skip the in-progress placeholder bubble (no content, no tool calls yet).
    if (m.streaming && !m.content && !(m.tools && m.tools.length)) continue
    if (m.role === 'user') out.push({ role: 'user', content: m.content })
    else if (m.role === 'assistant') {
      const msg = { role: 'assistant', content: m.content || '' }
      if (m.tool_calls?.length) msg.tool_calls = m.tool_calls
      out.push(msg)
      // Tool results follow each assistant tool turn.
      if (m.tools?.length) {
        for (const tc of m.tools) {
          out.push({ role: 'tool', tool_call_id: tc.id, name: tc.name, content: JSON.stringify(tc.result ?? {}) })
        }
      }
    }
  }
  return out
}

async function runAgent() {
  busy.value = true
  controller = new AbortController()
  try {
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      // Placeholder assistant bubble that streams content live.
      const bubble = { role: 'assistant', content: '', tools: [], streaming: true }
      messages.value.push(bubble)
      await scrollDown()

      let result
      try {
        result = await chat(buildApiMessages(), {
          tools: toolSpecs(),
          signal: controller.signal,
          onToken: (delta) => { bubble.content += delta; scrollDownSoft() },
        })
      } catch (e) {
        bubble.streaming = false
        if (e?.name === 'AbortError') { bubble.content += bubble.content ? '' : t('ai.stopped'); break }
        bubble.error = e?.message || t('ai.error')
        break
      }

      bubble.streaming = false
      bubble.content = result.content || bubble.content
      bubble.tool_calls = result.tool_calls || null

      const calls = result.tool_calls || []
      if (!calls.length) break // model answered — done

      // Execute each tool call, attach results to the bubble, then loop for the model's follow-up.
      bubble.tools = calls.map(c => ({
        id: c.id || `call_${turn}_${Math.random().toString(36).slice(2, 8)}`,
        name: c.function?.name,
        args: parseToolArguments(c.function?.arguments),
        result: null,
        running: true,
      }))
      // Keep tool_calls ids aligned with what we feed back.
      bubble.tool_calls = calls.map((c, i) => ({
        id: bubble.tools[i].id,
        type: 'function',
        function: { name: c.function?.name, arguments: c.function?.arguments || '{}' },
      }))
      await scrollDown()

      for (const tc of bubble.tools) {
        if (!TOOL_MAP[tc.name]) { tc.result = { error: `Unknown tool ${tc.name}` }; tc.running = false; continue }
        tc.result = await dispatchTool(tc.name, tc.args, ctx)
        tc.running = false
        await scrollDown()
      }
      // loop continues: model sees tool results and decides next step
    }
  } finally {
    busy.value = false
    controller = null
    await scrollDown()
    nextTick(() => inputEl.value?.focus())
  }
}

function stop() { if (controller) { try { controller.abort() } catch {} } }
function clearChat() { if (!busy.value) messages.value = [] }

// ---- scrolling ----
async function scrollDown() { await nextTick(); const el = scrollEl.value; if (el) el.scrollTop = el.scrollHeight }
let softTimer = null
function scrollDownSoft() {
  if (softTimer) return
  softTimer = setTimeout(() => { softTimer = null; const el = scrollEl.value; if (el) el.scrollTop = el.scrollHeight }, 80)
}

watch(open, (v) => { if (v) nextTick(() => inputEl.value?.focus()) })

function onKeydown(e) {
  if (e.key === 'Escape' && open.value && !busy.value) { open.value = false }
}
onMounted(() => document.addEventListener('keydown', onKeydown))
onUnmounted(() => document.removeEventListener('keydown', onKeydown))

// Tool display labels
function toolLabel(name) { return t('ai.tool.' + name) !== 'ai.tool.' + name ? t('ai.tool.' + name) : name }
function toolResultSummary(tc) {
  const r = tc.result || {}
  if (r.error) return r.error
  if (r.ok && r.format) return t('ai.tool.exported') + ' ' + r.format
  if (r.ok === true) return t('ai.tool.ok')
  if (r.content !== undefined) return t('ai.tool.read') + ' (' + (r.content?.length || 0) + ')'
  if (r.summary) return r.summary.slice(0, 120)
  if (r.themes) return r.themes.length + ' themes'
  return t('ai.tool.ok')
}

const SUGGESTIONS = ['polishDoc', 'summarize', 'translate', 'continue']
function useSuggestion(id) {
  input.value = t('ai.suggest.' + id)
  nextTick(() => inputEl.value?.focus())
}
</script>

<template>
  <Transition name="aip">
    <div v-if="open" class="aip-root">
      <div class="aip-scrim" @click="open = false"></div>
      <aside class="aip" role="dialog" aria-modal="true" :aria-label="t('ai.panelTitle')">
        <header class="aip-head">
          <div class="aip-title">
            <span class="aip-dot"></span>
            <h2>{{ t('ai.panelTitle') }}</h2>
          </div>
          <div class="aip-head-actions">
            <button v-if="messages.length" class="aip-icon" :title="t('ai.clear')" @click="clearChat" :disabled="busy">
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><path d="M3 4.5h10M6.5 4.5V3a1 1 0 0 1 1-1h1a1 1 0 0 1 1 1v1.5M5 4.5l.5 8a1 1 0 0 0 1 .9h3a1 1 0 0 0 1-.9l.5-8"/></svg>
            </button>
            <button class="aip-icon" :title="t('ai.close')" @click="open = false">
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><line x1="3" y1="3" x2="13" y2="13"/><line x1="13" y1="3" x2="3" y2="13"/></svg>
            </button>
          </div>
        </header>

        <!-- not configured -->
        <div v-if="!ready" class="aip-empty">
          <div class="aip-empty-ic"><svg width="40" height="40" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.5c.4 4.2 1.8 5.6 6 6-4.2.4-5.6 1.8-6 6-.4-4.2-1.8-5.6-6-6 4.2-.4 5.6-1.8 6-6z"/><path d="M19 13.5c.2 2.1.9 2.8 3 3-2.1.2-2.8.9-3 3-.2-2.1-.9-2.8-3-3 2.1-.2 2.8-.9 3-3z"/></svg></div>
          <p class="aip-empty-title">{{ t('ai.empty.title') }}</p>
          <p class="aip-empty-sub">{{ t('ai.empty.sub') }}</p>
          <button class="aip-cta" @click="$emit('open-settings')">{{ t('ai.empty.cta') }}</button>
        </div>

        <template v-else>
          <div ref="scrollEl" class="aip-body">
            <div v-if="!messages.length" class="aip-intro">
              <div class="aip-intro-ic"><svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.5c.4 4.2 1.8 5.6 6 6-4.2.4-5.6 1.8-6 6-.4-4.2-1.8-5.6-6-6 4.2-.4 5.6-1.8 6-6z"/><path d="M19 13.5c.2 2.1.9 2.8 3 3-2.1.2-2.8.9-3 3-.2-2.1-.9-2.8-3-3 2.1-.2 2.8-.9 3-3z"/></svg></div>
              <p class="aip-intro-title">{{ t('ai.intro.title') }}</p>
              <p class="aip-intro-sub">{{ t('ai.intro.sub') }}</p>
              <div class="aip-suggest">
                <button v-for="s in SUGGESTIONS" :key="s" @click="useSuggestion(s)">{{ t('ai.suggest.' + s) }}</button>
              </div>
            </div>

            <div v-for="(m, i) in messages" :key="i" class="aip-msg" :class="'aip-' + m.role">
              <div v-if="m.role === 'user'" class="aip-bubble aip-user-bubble">{{ m.content }}</div>
              <div v-else class="aip-assist">
                <!-- tool activity -->
                <div v-if="m.tools && m.tools.length" class="aip-tools">
                  <div v-for="tc in m.tools" :key="tc.id" class="aip-tool" :class="{ running: tc.running, err: tc.result && tc.result.error }">
                    <span class="aip-tool-ic">
                      <span v-if="tc.running" class="aip-tspin"></span>
                      <svg v-else viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 8.5l3 3 6-7"/></svg>
                    </span>
                    <span class="aip-tool-name">{{ toolLabel(tc.name) }}</span>
                    <span v-if="!tc.running" class="aip-tool-res">{{ toolResultSummary(tc) }}</span>
                  </div>
                </div>
                <div v-if="m.content" class="aip-bubble aip-assist-bubble" v-text="m.content"></div>
                <span v-if="m.streaming && !m.content" class="aip-thinking"><span></span><span></span><span></span></span>
                <div v-if="m.error" class="aip-error">{{ m.error }}</div>
              </div>
            </div>
          </div>

          <div class="aip-input">
            <textarea
              ref="inputEl" v-model="input" rows="1" class="aip-textarea"
              :placeholder="t('ai.inputPlaceholder')"
              @keydown.enter.exact.prevent="send"
              @input="$event.target.style.height = 'auto'; $event.target.style.height = Math.min($event.target.scrollHeight, 140) + 'px'"
            ></textarea>
            <button v-if="busy" class="aip-send aip-stop-btn" :title="t('ai.stop')" @click="stop">
              <svg viewBox="0 0 16 16" fill="currentColor"><rect x="4" y="4" width="8" height="8" rx="1.5"/></svg>
            </button>
            <button v-else class="aip-send" :disabled="!canSend" :title="t('ai.send')" @click="send">
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2L7 9M14 2l-4.5 12-2.5-5-5-2.5L14 2z"/></svg>
            </button>
          </div>
          <p class="aip-foot">{{ t('ai.foot') }}</p>
        </template>
      </aside>
    </div>
  </Transition>
</template>

<style scoped>
.aip-root { position: fixed; inset: 0; z-index: 480; }
.aip-scrim { position: absolute; inset: 0; background: rgba(0,0,0,0.28); backdrop-filter: blur(2px); }
.aip { position: absolute; top: 0; right: 0; height: 100%; width: 400px; max-width: 94vw; background: var(--surface); border-left: 1px solid var(--border-light); box-shadow: var(--shadow-lg); display: flex; flex-direction: column; }

.aip-head { display: flex; align-items: center; justify-content: space-between; padding: 13px 14px; border-bottom: 1px solid var(--border-light); flex-shrink: 0; }
.aip-title { display: flex; align-items: center; gap: 8px; }
.aip-title h2 { font-size: 15px; font-weight: 700; }
.aip-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--accent); box-shadow: 0 0 0 3px var(--accent-bg); }
.aip-head-actions { display: flex; gap: 2px; }
.aip-icon { width: 30px; height: 30px; display: flex; align-items: center; justify-content: center; border: none; border-radius: 8px; background: transparent; color: var(--text-secondary); cursor: pointer; }
.aip-icon:hover { background: var(--surface-hover); color: var(--text); }
.aip-icon:disabled { opacity: 0.4; cursor: default; }
.aip-icon svg { width: 15px; height: 15px; }

.aip-empty { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 30px; gap: 6px; }
.aip-empty-ic { font-size: 30px; margin-bottom: 6px; }
.aip-empty-title { font-size: 15px; font-weight: 600; color: var(--text); }
.aip-empty-sub { font-size: 13px; color: var(--text-secondary); line-height: 1.5; max-width: 260px; }
.aip-cta { margin-top: 12px; padding: 8px 18px; border: none; border-radius: 9px; background: var(--accent); color: var(--accent-text); font-size: 13px; font-weight: 600; cursor: pointer; font-family: var(--font-sans); }

.aip-body { flex: 1; overflow-y: auto; padding: 14px; display: flex; flex-direction: column; gap: 12px; }
.aip-intro { margin: auto; text-align: center; padding: 20px; }
.aip-intro-ic { font-size: 26px; }
.aip-intro-title { font-size: 14px; font-weight: 600; margin-top: 8px; }
.aip-intro-sub { font-size: 12px; color: var(--text-secondary); margin-top: 4px; line-height: 1.5; }
.aip-suggest { display: flex; flex-direction: column; gap: 6px; margin-top: 16px; }
.aip-suggest button { padding: 8px 12px; border: 1px solid var(--border-light); border-radius: 9px; background: var(--surface); color: var(--text); font-size: 12px; cursor: pointer; font-family: var(--font-sans); text-align: left; transition: all 0.15s; }
.aip-suggest button:hover { background: var(--surface-hover); border-color: var(--border); }

.aip-msg { display: flex; flex-direction: column; }
.aip-user { align-items: flex-end; }
.aip-bubble { max-width: 88%; padding: 9px 12px; border-radius: 13px; font-size: 13px; line-height: 1.55; white-space: pre-wrap; word-break: break-word; }
.aip-user-bubble { background: var(--accent); color: var(--accent-text); border-bottom-right-radius: 4px; }
.aip-assist { align-self: stretch; display: flex; flex-direction: column; gap: 7px; }
.aip-assist-bubble { background: var(--surface-hover); color: var(--text); border-bottom-left-radius: 4px; align-self: flex-start; max-width: 100%; }

.aip-tools { display: flex; flex-direction: column; gap: 4px; }
.aip-tool { display: flex; align-items: center; gap: 7px; padding: 5px 9px; border: 1px solid var(--border-light); border-radius: 9px; background: var(--surface); font-size: 11.5px; color: var(--text-secondary); }
.aip-tool.err { border-color: rgba(255,69,58,0.3); }
.aip-tool-ic { width: 14px; height: 14px; display: inline-flex; align-items: center; justify-content: center; color: var(--accent); }
.aip-tool.err .aip-tool-ic { color: #ff453a; }
.aip-tool-ic svg { width: 13px; height: 13px; }
.aip-tool-name { font-weight: 600; color: var(--text); font-family: var(--font-mono); font-size: 11px; }
.aip-tool-res { color: var(--text-tertiary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.aip-tspin { width: 11px; height: 11px; border: 1.5px solid var(--border); border-top-color: var(--accent); border-radius: 50%; animation: aiSpin 0.7s linear infinite; }
@keyframes aiSpin { to { transform: rotate(360deg); } }

.aip-thinking { display: inline-flex; gap: 4px; padding: 10px 12px; }
.aip-thinking span { width: 6px; height: 6px; border-radius: 50%; background: var(--text-tertiary); animation: aiBounce 1.2s infinite; }
.aip-thinking span:nth-child(2) { animation-delay: 0.15s; }
.aip-thinking span:nth-child(3) { animation-delay: 0.3s; }
@keyframes aiBounce { 0%,60%,100% { opacity: 0.3; transform: translateY(0); } 30% { opacity: 1; transform: translateY(-3px); } }
.aip-error { font-size: 12px; color: #ff453a; background: rgba(255,69,58,0.07); border: 1px solid rgba(255,69,58,0.2); border-radius: 9px; padding: 8px 10px; line-height: 1.4; }

.aip-input { display: flex; align-items: flex-end; gap: 7px; padding: 10px 12px 4px; border-top: 1px solid var(--border-light); flex-shrink: 0; }
.aip-textarea { flex: 1; resize: none; border: 1px solid var(--border-light); border-radius: 11px; padding: 9px 12px; font-size: 13px; font-family: var(--font-sans); line-height: 1.5; color: var(--text); background: var(--surface); outline: none; max-height: 140px; transition: border-color 0.15s; }
.aip-textarea:focus { border-color: var(--accent); }
.aip-send { width: 36px; height: 36px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; border: none; border-radius: 10px; background: var(--accent); color: var(--accent-text); cursor: pointer; transition: opacity 0.15s; }
.aip-send:disabled { opacity: 0.4; cursor: default; }
.aip-send svg { width: 16px; height: 16px; }
.aip-stop-btn { background: var(--text); }
.aip-foot { font-size: 10px; color: var(--text-tertiary); text-align: center; padding: 2px 12px 8px; }

.aip-enter-active .aip, .aip-leave-active .aip { transition: transform 0.28s var(--ease-out); }
.aip-enter-active .aip-scrim, .aip-leave-active .aip-scrim { transition: opacity 0.28s ease; }
.aip-enter-from .aip, .aip-leave-to .aip { transform: translateX(100%); }
.aip-enter-from .aip-scrim, .aip-leave-to .aip-scrim { opacity: 0; }

@media (max-width: 480px) { .aip { width: 100vw; max-width: 100vw; } }
</style>
