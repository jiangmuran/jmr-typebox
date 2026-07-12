<script setup>
// Right-click editor menu. Hosts BOTH the text plugins (Base64, case, JSON…) and the full set of
// AI selection actions (shown only when AI is configured). This is now the single home for AI
// selection actions — the old floating selection toolbar was removed.
//
// Selection snapshot: when the menu opens we capture {start, end, text} from the textarea. Every
// AI action runs against that snapshot, so moving focus into the menu or an inline input never
// loses the target (the core fix for "rewrite input flashes and vanishes"). Replacing actions
// (improve/polish/…) stream into the textarea; non-replacing ones (explain) open a result popup.
import { ref, computed, watch, nextTick } from 'vue'
import { useI18n } from '../composables/useI18n'
import { useAiActions } from '../composables/useAiActions'
import { useToast } from '../composables/useToast'
import { EDITOR_PLUGINS, PLUGIN_GROUPS } from '../tools/text/plugins'
import AiIcon from './AiIcon.vue'

const props = defineProps({
  show: Boolean,
  x: Number,
  y: Number,
  aiEnabled: Boolean,
  editorRef: { type: Object, default: null }, // the <textarea> element
})
const emit = defineEmits(['apply', 'close'])
const { locale, t } = useI18n()
const { showToast } = useToast()
const { ready, busy, streamingText, runSelectionAction, abort } = useAiActions()
const label = o => (locale.value === 'zh' ? o.zh : o.en)

const groups = computed(() => {
  const g = {}
  for (const p of EDITOR_PLUGINS) (g[p.group] ||= []).push(p)
  return Object.entries(g)
})

// AI is offered in the menu only when enabled in Settings AND the endpoint is configured.
const aiReady = computed(() => props.aiEnabled && ready.value)

// Icons are inline SVG (never emoji). `ico()` wraps path markup in a standard 16-box svg.
function ico(inner) {
  return '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">' + inner + '</svg>'
}
// The full selection action set (was split between the floating bar and this menu). `needsInput`
// actions swap the menu body to an inline input row; `explain` returns text shown in a popup.
const AI_ACTIONS = [
  { id: 'improve', svg: '<path d="M8 1.6l1.5 4.3 4.3 1.5-4.3 1.5L8 13.2l-1.5-4.3-4.3-1.5 4.3-1.5z"/>' },
  { id: 'polish', svg: '<path d="M2.6 13.4l6.2-6.2"/><path d="M11 2.2l.6 1.7 1.7.6-1.7.6-.6 1.7-.6-1.7-1.7-.6 1.7-.6z"/>' },
  { id: 'grammar', svg: '<polyline points="2.5 8.5 6.4 12.4 13.5 4"/>' },
  { id: 'shorter', svg: '<path d="M8 2.8v8.4"/><path d="M4.8 8l3.2 3.2L11.2 8"/>' },
  { id: 'longer', svg: '<path d="M8 13.2V4.8"/><path d="M4.8 8L8 4.8 11.2 8"/>' },
  { id: 'translate', svg: '<path d="M2.4 5.8h9.2L8.8 3"/><path d="M13.6 10.2H4.4L7.2 13"/>', needsInput: true },
  { id: 'rewrite', svg: '<path d="M13 8a5 5 0 1 1-1.4-3.5"/><path d="M13 2.8v2.7h-2.7"/>', needsInput: true },
  { id: 'explain', svg: '<circle cx="8" cy="8" r="6.2"/><path d="M6.3 6.2a1.8 1.8 0 1 1 2.5 1.7c-.6.3-.8.7-.8 1.2"/><circle cx="8" cy="11.4" r="0.55" fill="currentColor" stroke="none"/>' },
]

// ---- Menu position: clamp inside the viewport (right + bottom). Measured after render. ----
const menuEl = ref(null)
const menuStyle = ref({})
function clampMenu() {
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1200
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800
  const el = menuEl.value
  const w = el ? el.offsetWidth : 200
  const h = el ? el.offsetHeight : 240
  const left = Math.min(Math.max(8, props.x), Math.max(8, vw - w - 8))
  const top = Math.min(Math.max(8, props.y), Math.max(8, vh - h - 8))
  menuStyle.value = { left: `${Math.round(left)}px`, top: `${Math.round(top)}px` }
}

// ---- Selection snapshot + transient AI UI ----
const snap = ref(null)          // { start, end, text } captured when the menu opened
const promptFor = ref('')       // action id awaiting free-form input (rewrite/translate)
const promptValue = ref('')
const promptInput = ref(null)
const runningId = ref('')
const resultText = ref('')      // non-replacing result (explain)
const showResult = ref(false)
const resultEl = ref(null)
const resultStyle = ref({})

function captureSelection() {
  const el = props.editorRef
  if (!el) { snap.value = null; return }
  const start = el.selectionStart, end = el.selectionEnd
  if (end > start) snap.value = { start, end, text: el.value.substring(start, end) }
  else snap.value = null
}

watch(() => props.show, (open) => {
  if (open) {
    captureSelection()
    promptFor.value = ''
    promptValue.value = ''
    // Paint at the raw position immediately, then measure + clamp.
    clampMenu()
    nextTick(clampMenu)
  } else {
    // Closing the menu also dismisses any in-menu input; keep the result popup if it's showing.
    promptFor.value = ''
  }
})

// ---- Running AI actions against the snapshot ----
async function trigger(action) {
  if (!aiReady.value) { showToast(t('ai.notConfigured')); return }
  if (busy.value) return
  if (!snap.value) { showToast(t('ai.selectFirst')); emit('close'); return }
  if (action.needsInput) {
    promptFor.value = action.id
    promptValue.value = ''
    await nextTick()
    promptInput.value?.focus()
    return
  }
  await run(action.id)
}

async function submitPrompt() {
  const id = promptFor.value
  if (!id) return
  const val = promptValue.value.trim()
  if (!val) return
  promptFor.value = ''
  await run(id, val)
}

async function run(actionId, input) {
  const el = props.editorRef
  const s = snap.value
  if (!el || !s) { emit('close'); return }
  // Restore the snapshot range onto the textarea so the action targets exactly what was selected
  // when the menu opened (runSelectionAction reads el.selectionStart/End).
  try { el.focus(); el.selectionStart = s.start; el.selectionEnd = s.end } catch {}
  runningId.value = actionId
  resultText.value = ''
  try {
    const r = await runSelectionAction(el, actionId, input)
    if (!r.ok) { if (r.reason === 'no-selection') emit('close'); return }
    if (r.replaced) {
      emit('apply') // signal the editor to flush content/state
      showToast(t('ai.done'))
      emit('close')
    } else {
      // explain (or any non-replacing result) → popup
      resultText.value = r.text
      showResult.value = true
      emit('close') // close the menu; the popup stays
      await nextTick()
      placeResult()
    }
  } catch (e) {
    showToast(e?.message || t('ai.error'))
  } finally {
    runningId.value = ''
  }
}

// ---- Result popup: measure then clamp fully inside the viewport on ALL sides ----
function placeResult() {
  if (typeof window === 'undefined') return
  const el = resultEl.value
  const vw = window.innerWidth, vh = window.innerHeight
  const w = el ? el.offsetWidth : 360
  const h = el ? el.offsetHeight : 240
  // Center horizontally on the original click; clamp x AND y inside the viewport.
  const left = Math.min(Math.max(8, props.x - w / 2), Math.max(8, vw - w - 8))
  const top = Math.min(Math.max(8, props.y - h - 12), Math.max(8, vh - h - 8))
  resultStyle.value = { left: `${Math.round(left)}px`, top: `${Math.round(top)}px` }
}
// Re-measure once content streams in (height changes) and on viewport resize while open.
watch(() => streamingText.value, () => { if (showResult.value) nextTick(placeResult) })

function copyResult() {
  if (typeof navigator !== 'undefined' && navigator.clipboard) {
    navigator.clipboard.writeText(streamingText.value || resultText.value).then(() => showToast(t('ai.copied'))).catch(() => {})
  }
}
function closeResult() { showResult.value = false; abort() }

function onPlugin(p) { emit('apply', p); emit('close') }
</script>

<template>
  <!-- Context menu -->
  <template v-if="show">
    <div class="ctx-away" @click="emit('close')" @contextmenu.prevent="emit('close')" @wheel="emit('close')"></div>
    <div ref="menuEl" class="ctx" :style="menuStyle" @mousedown.prevent>
      <template v-if="aiReady">
        <div class="ctx-label ctx-ai-label"><AiIcon :size="12" class="ctx-ai-ic" />{{ t('ai.menu') }}</div>

        <!-- inline free-form input (rewrite / translate) — stays in the menu, autofocused -->
        <div v-if="promptFor" class="ctx-ai-input">
          <input
            ref="promptInput" v-model="promptValue" class="ctx-ai-in"
            :placeholder="promptFor === 'translate' ? t('ai.translatePlaceholder') : t('ai.rewritePlaceholder')"
            @keydown.enter.prevent.stop="submitPrompt" @keydown.esc.prevent.stop="promptFor = ''" @click.stop
          >
          <button class="ctx-ai-go" :disabled="!promptValue.trim()" @click="submitPrompt">{{ t('ai.go') }}</button>
        </div>

        <!-- busy indicator while a replacing action streams -->
        <div v-else-if="busy" class="ctx-ai-busy">
          <span class="ctx-ai-spin"></span>
          <span>{{ t('ai.running.' + (runningId || 'improve')) }}</span>
          <button class="ctx-ai-stop" @click="abort">{{ t('ai.stop') }}</button>
        </div>

        <!-- action list -->
        <template v-else>
          <button v-for="a in AI_ACTIONS" :key="a.id" class="ctx-item ctx-ai-item" @click="trigger(a)">
            <span class="ctx-ai-act-ic" v-html="ico(a.svg)"></span>{{ t('ai.act.' + a.id) }}
          </button>
        </template>
        <div class="ctx-divider"></div>
      </template>

      <template v-for="[gid, plugins] in groups" :key="gid">
        <div class="ctx-label">{{ label(PLUGIN_GROUPS[gid]) }}</div>
        <button v-for="p in plugins" :key="p.id" class="ctx-item" @click="onPlugin(p)">{{ label(p) }}</button>
      </template>
    </div>
  </template>

  <!-- Result popup (explain) — measured + clamped fully on-screen. Lives outside the menu so it -->
  <!-- survives the menu closing. -->
  <Teleport to="body">
    <div v-if="showResult" class="ai-result-scrim" @click="closeResult" @keydown.esc="closeResult"></div>
    <div v-if="showResult" ref="resultEl" class="ai-result" :style="resultStyle">
      <div class="ai-result-head">
        <span class="ai-result-title"><AiIcon :size="13" />{{ t('ai.act.explain') }}</span>
        <button class="ai-x" :title="t('ai.close')" @click="closeResult">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><line x1="3" y1="3" x2="13" y2="13"/><line x1="13" y1="3" x2="3" y2="13"/></svg>
        </button>
      </div>
      <div class="ai-result-body">{{ streamingText || resultText }}<span v-if="busy" class="ai-caret"></span></div>
      <div class="ai-result-foot">
        <button class="ai-ghost" @click="copyResult">{{ t('ai.copy') }}</button>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.ctx-away { position: fixed; inset: 0; z-index: 400; }
.ctx {
  position: fixed; z-index: 401; min-width: 190px; max-width: 92vw; max-height: 80vh; overflow-y: auto;
  background: var(--surface); border: 1px solid var(--border-light); border-radius: 10px;
  box-shadow: var(--shadow-lg); padding: 5px; animation: ctxIn 0.12s var(--ease-out);
}
@keyframes ctxIn { from { opacity: 0; transform: scale(0.96); } to { opacity: 1; transform: scale(1); } }
.ctx-label { font-size: 10px; font-weight: 600; color: var(--text-tertiary); text-transform: uppercase; letter-spacing: 0.5px; padding: 6px 10px 3px; }
.ctx-item { display: flex; align-items: center; width: 100%; text-align: left; padding: 6px 10px; border: none; border-radius: 6px; background: transparent; color: var(--text); font-size: 13px; font-family: var(--font-sans); cursor: pointer; }
.ctx-item:hover { background: var(--surface-hover); }
.ctx-divider { height: 1px; background: var(--border-light); margin: 5px 6px; }

.ctx-ai-label { color: var(--accent); display: flex; align-items: center; gap: 5px; }
.ctx-ai-ic { flex-shrink: 0; }
.ctx-ai-item:hover { background: var(--accent-bg); }
.ctx-ai-act-ic { display: inline-flex; align-items: center; justify-content: center; width: 14px; height: 14px; margin-right: 8px; color: var(--accent); flex-shrink: 0; }
.ctx-ai-act-ic :deep(svg) { width: 14px; height: 14px; display: block; }

.ctx-ai-input { display: flex; align-items: center; gap: 5px; padding: 4px 6px 6px; }
.ctx-ai-in { flex: 1; min-width: 0; padding: 6px 8px; border: 1px solid var(--border-light); border-radius: 7px; background: var(--surface); color: var(--text); font-size: 12px; font-family: var(--font-sans); outline: none; }
.ctx-ai-in:focus { border-color: var(--accent); }
.ctx-ai-go { padding: 6px 11px; border: none; border-radius: 7px; background: var(--accent); color: var(--accent-text); font-size: 12px; font-weight: 600; cursor: pointer; font-family: var(--font-sans); flex-shrink: 0; }
.ctx-ai-go:disabled { opacity: 0.5; cursor: default; }

.ctx-ai-busy { display: flex; align-items: center; gap: 8px; padding: 7px 10px; font-size: 12px; color: var(--text-secondary); }
.ctx-ai-spin { width: 13px; height: 13px; border: 2px solid var(--border); border-top-color: var(--accent); border-radius: 50%; animation: tb-spin 0.7s linear infinite; flex-shrink: 0; }
.ctx-ai-stop { margin-left: auto; padding: 3px 9px; border: 1px solid var(--border); border-radius: 6px; background: var(--surface); color: var(--text); font-size: 11px; cursor: pointer; font-family: var(--font-sans); }
.ctx-ai-stop:hover { background: var(--surface-hover); }

/* Result popup (explain) */
.ai-result-scrim { position: fixed; inset: 0; z-index: 408; }
.ai-result {
  position: fixed; z-index: 412; width: 360px; max-width: 92vw; background: var(--surface);
  border: 1px solid var(--border-light); border-radius: 12px; box-shadow: var(--shadow-lg);
  display: flex; flex-direction: column; overflow: hidden; animation: ctxIn 0.14s var(--ease-out);
}
.ai-result-head { display: flex; align-items: center; justify-content: space-between; padding: 9px 12px; border-bottom: 1px solid var(--border-light); font-size: 12px; font-weight: 600; color: var(--text-secondary); }
.ai-result-title { display: flex; align-items: center; gap: 6px; }
.ai-x { width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; border: none; background: transparent; color: var(--text-tertiary); cursor: pointer; border-radius: 6px; }
.ai-x:hover { color: var(--text); background: var(--surface-hover); }
.ai-x svg { width: 13px; height: 13px; }
.ai-result-body { padding: 12px; font-size: 13px; line-height: 1.6; color: var(--text); max-height: 40vh; overflow-y: auto; white-space: pre-wrap; }
.ai-result-foot { display: flex; justify-content: flex-end; gap: 8px; padding: 8px 12px; border-top: 1px solid var(--border-light); }
.ai-ghost { padding: 6px 12px; border: 1px solid var(--border); border-radius: 7px; background: var(--surface); color: var(--text); font-size: 12px; cursor: pointer; font-family: var(--font-sans); }
.ai-ghost:hover { background: var(--surface-hover); }
.ai-caret { display: inline-block; width: 7px; height: 14px; margin-left: 2px; background: var(--accent); vertical-align: text-bottom; animation: aiBlink 1s steps(2) infinite; }
@keyframes aiBlink { 0%,50% { opacity: 1; } 50.01%,100% { opacity: 0; } }
</style>
