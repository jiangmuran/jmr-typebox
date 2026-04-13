<script setup>
import { ref, computed } from 'vue'
import { useToast } from '../composables/useToast'

const props = defineProps({ t: Function })
const { showToast } = useToast()

const filename = ref('untitled')
const content = ref('')
const dragging = ref(false)

const stats = computed(() => ({
  chars: content.value.length,
  words: content.value.trim() ? content.value.trim().split(/\s+/).length : 0,
  lines: content.value.split('\n').length,
}))

function download() {
  const name = (filename.value.trim() || 'untitled') + '.txt'
  const blob = new Blob([content.value], { type: 'text/plain;charset=utf-8' })
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click()
  URL.revokeObjectURL(a.href)
  showToast(`Downloaded ${name}`)
}

async function copyText() {
  try { await navigator.clipboard.writeText(content.value); showToast(props.t('toast.copied')) }
  catch { showToast('Copy failed') }
}

function onDrop(e) {
  e.preventDefault(); dragging.value = false
  const file = e.dataTransfer?.files?.[0]
  if (file && /\.(txt|text|md)$/i.test(file.name)) {
    const reader = new FileReader()
    reader.onload = () => { content.value = reader.result; filename.value = file.name.replace(/\.\w+$/, ''); showToast(`${props.t('toast.loaded')} ${file.name}`) }
    reader.readAsText(file)
  }
}
</script>

<template>
  <div class="tool-panel" @dragover.prevent="dragging = true" @dragleave="dragging = false" @drop="onDrop">
    <div class="tool-inner">
      <div class="card" :class="{ glow: dragging }">
        <div class="fname-bar">
          <label>{{ t('txt.filename') }}</label>
          <input v-model="filename" spellcheck="false" placeholder="untitled">
          <span class="ext">.txt</span>
        </div>
        <textarea v-model="content" class="editor" :placeholder="t('txt.placeholder')" spellcheck="false"></textarea>
      </div>

      <div class="btn-row">
        <button class="btn primary" @click="download">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M14 10v3.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 13.5V10"/><polyline points="5 7 8 10 11 7"/><line x1="8" y1="10" x2="8" y2="2"/></svg>
          {{ t('txt.download') }}
        </button>
        <button class="btn" @click="copyText">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="5" y="5" width="9" height="9" rx="1"/><path d="M3.5 11H3a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1h7a1 1 0 0 1 1 1v.5"/></svg>
          {{ t('txt.copy') }}
        </button>
      </div>

      <div class="stats-row">
        <span>{{ stats.chars }} {{ t('status.chars') }}</span>
        <span>{{ stats.words }} {{ t('status.words') }}</span>
        <span>{{ stats.lines }} {{ t('status.lines') }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tool-panel { flex: 1; overflow-y: auto; background: var(--bg); }
.tool-inner { max-width: 680px; margin: 0 auto; padding: 24px 20px 40px; animation: toolIn 0.35s cubic-bezier(0.16, 1, 0.3, 1); }
@keyframes toolIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }

.card {
  background: var(--surface); border: 1px solid var(--border-light);
  border-radius: 12px; box-shadow: var(--shadow-sm); overflow: hidden;
  transition: border-color 0.2s, box-shadow 0.2s;
}
.card.glow { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-bg); }

.fname-bar { display: flex; align-items: center; gap: 8px; padding: 10px 16px; border-bottom: 1px solid var(--border-light); }
.fname-bar label { font-size: 10px; font-weight: 600; color: var(--text-tertiary); text-transform: uppercase; letter-spacing: 0.5px; }
.fname-bar input { flex: 1; border: none; background: transparent; font-size: 14px; font-family: var(--font-mono); color: var(--text); outline: none; }
.fname-bar .ext { font-size: 12px; color: var(--text-tertiary); font-family: var(--font-mono); }

.editor { width: 100%; min-height: 360px; border: none; padding: 18px; font-size: 14px; font-family: var(--font-mono); line-height: 1.75; color: var(--text); background: transparent; resize: vertical; outline: none; }
.editor::placeholder { color: var(--text-tertiary); opacity: 0.6; }

.btn-row { display: flex; gap: 10px; margin-top: 14px; }
.btn {
  flex: 1; display: flex; align-items: center; justify-content: center; gap: 7px;
  padding: 11px 18px; border: 1px solid var(--border); border-radius: 10px;
  background: var(--surface); color: var(--text); font-size: 13px; font-weight: 500;
  font-family: var(--font-sans); cursor: pointer; transition: all 0.15s;
}
.btn:hover { box-shadow: var(--shadow-sm); }
.btn:active { transform: scale(0.98); }
.btn svg { width: 15px; height: 15px; }
.btn.primary { background: var(--text); color: var(--bg); border-color: var(--text); }
.btn.primary:hover { opacity: 0.9; }

.stats-row { display: flex; justify-content: center; gap: 16px; margin-top: 12px; font-size: 11px; color: var(--text-tertiary); }

@media (max-width: 480px) { .tool-inner { padding: 16px 12px 32px; } .editor { min-height: 280px; } .btn-row { flex-direction: column; } }
</style>
