<script setup>
// Floating AI toolbar that appears above the current editor selection. Offers selection
// actions (improve, polish, grammar, translate, shorter/longer, rewrite, explain). Replacing
// actions stream straight into the textarea; "explain" shows a result popover instead.
//
// Driven by EditorPage, which owns the textarea ref and watches selection. We keep the
// heavy lifting in useAiActions so the context menu reuses the same logic.
import { ref, computed, watch, nextTick } from 'vue'
import { useI18n } from '../composables/useI18n'
import { useAiActions } from '../composables/useAiActions'
import { useToast } from '../composables/useToast'

const props = defineProps({
  editorRef: { type: Object, default: null }, // the <textarea> element
  // {x, y, text} of the current selection (screen coords of the selection's top), or null
  selection: { type: Object, default: null },
})
const emit = defineEmits(['changed', 'dismiss'])

const { t } = useI18n()
const { showToast } = useToast()
const { ready, busy, streamingText, runSelectionAction, abort } = useAiActions()

const promptFor = ref('')       // action id awaiting free-form input (rewrite/translate)
const promptValue = ref('')
const promptInput = ref(null)
const resultText = ref('')      // non-replacing result (explain) to show in a popover
const showResult = ref(false)
const runningId = ref('')

// Position the toolbar just above the selection's top edge.
const style = computed(() => {
  const s = props.selection
  if (!s) return { display: 'none' }
  const x = Math.max(8, Math.min(s.x, (typeof window !== 'undefined' ? window.innerWidth : 1200) - 8))
  return { left: x + 'px', top: Math.max(8, s.y - 8) + 'px' }
})

const ACTIONS = [
  { id: 'improve', icon: '✦' },
  { id: 'polish', icon: '◇' },
  { id: 'grammar', icon: '✓' },
  { id: 'shorter', icon: '▾' },
  { id: 'longer', icon: '▴' },
  { id: 'translate', icon: '⇄', needsInput: true },
  { id: 'rewrite', icon: '↻', needsInput: true },
  { id: 'explain', icon: '?' },
]

// Reset transient UI whenever the selection changes/clears.
watch(() => props.selection, () => { promptFor.value = ''; showResult.value = false })

async function trigger(action) {
  if (!ready.value) { showToast(t('ai.notConfigured')); return }
  if (busy.value) return
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
  if (!el) return
  runningId.value = actionId
  resultText.value = ''
  showResult.value = false
  try {
    const r = await runSelectionAction(el, actionId, input)
    if (!r.ok) { if (r.reason === 'no-selection') emit('dismiss'); return }
    if (r.replaced) {
      emit('changed')
      showToast(t('ai.done'))
      emit('dismiss')
    } else {
      // explain → show in a popover
      resultText.value = r.text
      showResult.value = true
    }
  } catch (e) {
    showToast(e?.message || t('ai.error'))
  } finally {
    runningId.value = ''
  }
}

function copyResult() {
  if (typeof navigator !== 'undefined' && navigator.clipboard) {
    navigator.clipboard.writeText(resultText.value).then(() => showToast(t('ai.copied'))).catch(() => {})
  }
}
function closeAll() { showResult.value = false; promptFor.value = ''; abort(); emit('dismiss') }
</script>

<template>
  <Teleport to="body">
    <div v-if="selection" class="ai-bar" :style="style" @mousedown.prevent>
      <!-- streaming indicator while a replacing action runs -->
      <template v-if="busy && !showResult">
        <span class="ai-spin"></span>
        <span class="ai-busy-lbl">{{ t('ai.running.' + (runningId || 'improve')) }}</span>
        <button class="ai-stop" @click="abort">{{ t('ai.stop') }}</button>
      </template>

      <!-- free-form prompt (rewrite / translate) -->
      <template v-else-if="promptFor">
        <input
          ref="promptInput" v-model="promptValue" class="ai-prompt-in"
          :placeholder="promptFor === 'translate' ? t('ai.translatePlaceholder') : t('ai.rewritePlaceholder')"
          @keydown.enter.prevent="submitPrompt" @keydown.esc.prevent="promptFor = ''"
        >
        <button class="ai-go" :disabled="!promptValue.trim()" @click="submitPrompt">{{ t('ai.go') }}</button>
      </template>

      <!-- action buttons -->
      <template v-else>
        <span class="ai-spark" aria-hidden="true">✨</span>
        <button v-for="a in ACTIONS" :key="a.id" class="ai-act" :title="t('ai.act.' + a.id)" @click="trigger(a)">
          <span class="ai-act-ic">{{ a.icon }}</span>
          <span class="ai-act-lbl">{{ t('ai.act.' + a.id) }}</span>
        </button>
      </template>
    </div>

    <!-- result popover (explain) -->
    <div v-if="showResult" class="ai-result-scrim" @click="closeAll"></div>
    <div v-if="showResult" class="ai-result" :style="style">
      <div class="ai-result-head">
        <span>{{ t('ai.act.explain') }}</span>
        <button class="ai-x" @click="closeAll">×</button>
      </div>
      <div class="ai-result-body">{{ streamingText || resultText }}<span v-if="busy" class="ai-caret"></span></div>
      <div class="ai-result-foot">
        <button class="ai-ghost" @click="copyResult">{{ t('ai.copy') }}</button>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.ai-bar {
  position: fixed; z-index: 410; transform: translate(-50%, -100%);
  display: flex; align-items: center; gap: 2px; max-width: 92vw;
  background: var(--surface); border: 1px solid var(--border-light); border-radius: 10px;
  box-shadow: var(--shadow-lg); padding: 4px; animation: aiIn 0.14s var(--ease-out);
}
@keyframes aiIn { from { opacity: 0; transform: translate(-50%, -100%) scale(0.96); } to { opacity: 1; transform: translate(-50%, -100%) scale(1); } }
.ai-spark { font-size: 12px; padding: 0 4px 0 2px; opacity: 0.8; }
.ai-act { display: inline-flex; align-items: center; gap: 4px; padding: 5px 8px; border: none; border-radius: 7px; background: transparent; color: var(--text); font-size: 12px; font-family: var(--font-sans); cursor: pointer; white-space: nowrap; }
.ai-act:hover { background: var(--surface-hover); }
.ai-act-ic { font-size: 12px; color: var(--accent); width: 13px; text-align: center; }
.ai-act-lbl { font-size: 12px; }
@media (max-width: 640px) { .ai-act-lbl { display: none; } .ai-act { padding: 6px; } }

.ai-prompt-in { width: 240px; max-width: 60vw; padding: 5px 8px; border: 1px solid var(--border-light); border-radius: 7px; background: var(--surface); color: var(--text); font-size: 12px; font-family: var(--font-sans); outline: none; }
.ai-prompt-in:focus { border-color: var(--accent); }
.ai-go, .ai-stop { padding: 5px 10px; border: none; border-radius: 7px; background: var(--accent); color: #fff; font-size: 12px; font-weight: 600; cursor: pointer; font-family: var(--font-sans); }
.ai-go:disabled { opacity: 0.5; cursor: default; }
.ai-stop { background: var(--surface-hover); color: var(--text); }
.ai-busy-lbl { font-size: 12px; color: var(--text-secondary); padding: 0 4px; }
.ai-spin { width: 13px; height: 13px; margin-left: 4px; border: 2px solid var(--border); border-top-color: var(--accent); border-radius: 50%; animation: aiSpin 0.7s linear infinite; }
@keyframes aiSpin { to { transform: rotate(360deg); } }

.ai-result-scrim { position: fixed; inset: 0; z-index: 408; }
.ai-result {
  position: fixed; z-index: 412; transform: translate(-50%, calc(-100% - 44px));
  width: 360px; max-width: 92vw; background: var(--surface);
  border: 1px solid var(--border-light); border-radius: 12px; box-shadow: var(--shadow-lg);
  display: flex; flex-direction: column; overflow: hidden;
}
.ai-result-head { display: flex; align-items: center; justify-content: space-between; padding: 9px 12px; border-bottom: 1px solid var(--border-light); font-size: 12px; font-weight: 600; color: var(--text-secondary); }
.ai-x { border: none; background: transparent; font-size: 17px; line-height: 1; color: var(--text-tertiary); cursor: pointer; }
.ai-x:hover { color: var(--text); }
.ai-result-body { padding: 12px; font-size: 13px; line-height: 1.6; color: var(--text); max-height: 40vh; overflow-y: auto; white-space: pre-wrap; }
.ai-result-foot { display: flex; justify-content: flex-end; gap: 8px; padding: 8px 12px; border-top: 1px solid var(--border-light); }
.ai-ghost { padding: 6px 12px; border: 1px solid var(--border); border-radius: 7px; background: var(--surface); color: var(--text); font-size: 12px; cursor: pointer; font-family: var(--font-sans); }
.ai-ghost:hover { background: var(--surface-hover); }
.ai-caret { display: inline-block; width: 7px; height: 14px; margin-left: 2px; background: var(--accent); vertical-align: text-bottom; animation: aiBlink 1s steps(2) infinite; }
@keyframes aiBlink { 0%,50% { opacity: 1; } 50.01%,100% { opacity: 0; } }
</style>
