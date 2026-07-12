<script setup>
import { ref } from 'vue'
import { useToast } from '../composables/useToast'

const props = defineProps({ t: Function })
const emit = defineEmits(['send-to-editor'])
const { showToast } = useToast()

const pdfName = ref('')
const markdown = ref('')
const loading = ref(false)
const progress = ref('')
const pdfStats = ref(null)

function pickFile() {
  const input = document.createElement('input'); input.type = 'file'; input.accept = '.pdf'
  input.onchange = e => { if (e.target.files[0]) handleFile(e.target.files[0]) }; input.click()
}

async function handleFile(file) {
  if (!file?.name.endsWith('.pdf')) return
  pdfName.value = file.name; loading.value = true; markdown.value = ''; pdfStats.value = null

  try {
    const { pdfToMarkdown } = await import('../utils/pdfToMarkdown.js')
    const result = await pdfToMarkdown(file, (current, total) => {
      progress.value = `${current} / ${total}`
    })
    markdown.value = result.markdown
    pdfStats.value = { pages: result.numPages, ...result.stats }
    showToast(`${result.numPages} ${props.t('toast.pdfExtracted')}`)
  } catch (e) {
    console.error(e); showToast(props.t('toast.pdfFailed'))
  } finally { loading.value = false; progress.value = '' }
}

function onDrop(e) { e.preventDefault(); const f = e.dataTransfer?.files?.[0]; if (f) handleFile(f) }

function sendToEditor() {
  emit('send-to-editor', markdown.value, pdfName.value.replace('.pdf', ''))
}

async function copyText() {
  try { await navigator.clipboard.writeText(markdown.value); showToast(props.t('toast.copied')) }
  catch { showToast('Copy failed') }
}

function downloadAs(ext, mime) {
  const name = pdfName.value.replace('.pdf', '') + ext
  const blob = new Blob([markdown.value], { type: mime })
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click()
  URL.revokeObjectURL(a.href); showToast(`Downloaded ${name}`)
}
</script>

<template>
  <div class="pdf-page" @dragover.prevent @drop="onDrop">
    <!-- Empty state: upload -->
    <div v-if="!markdown && !loading" class="upload-state">
      <div class="upload-zone" @click="pickFile">
        <svg viewBox="0 0 56 56" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round">
          <rect x="12" y="4" width="32" height="48" rx="4"/>
          <path d="M22 24h4a3.5 3.5 0 0 1 0 7h-4m0-7v16"/>
          <path d="M34 24h7m-3.5 0v16"/>
          <path d="M12 16h32" stroke-dasharray="2 2" opacity=".4"/>
        </svg>
        <h3>{{ t('pdf.drop') }}</h3>
        <p>{{ t('pdf.browse') }}</p>
        <span class="upload-badge">
          <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.2"><rect x="1" y="1" width="10" height="10" rx="2"/><path d="M4 6h4M6 4v4"/></svg>
          {{ t('pdf.hint') }}
        </span>
      </div>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="loading-state">
      <div class="spinner"></div>
      <p>{{ t('pdf.extracting') }} {{ pdfName }}...</p>
      <p v-if="progress" class="progress-text">{{ progress }}</p>
    </div>

    <!-- Result: split layout -->
    <div v-if="markdown && !loading" class="result-split">
      <!-- Left: info + actions -->
      <aside class="result-sidebar">
        <div class="pdf-info-card">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round">
            <rect x="4" y="2" width="16" height="20" rx="2"/>
            <path d="M8 10h3a2 2 0 0 1 0 4H8m0-4v8"/>
          </svg>
          <div>
            <strong>{{ pdfName }}</strong>
            <span v-if="pdfStats">{{ pdfStats.pages }} {{ t('pdf.pages') }}</span>
          </div>
        </div>

        <button class="sidebar-btn primary" @click="sendToEditor">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M11.5 1.5l3 3L5 14H2v-3z"/></svg>
          {{ t('pdf.openInEditor') }}
        </button>
        <button class="sidebar-btn" @click="copyText">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="5" y="5" width="9" height="9" rx="1"/><path d="M3.5 11H3a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1h7a1 1 0 0 1 1 1v.5"/></svg>
          {{ t('pdf.copyText') }}
        </button>
        <button class="sidebar-btn" @click="downloadAs('.md', 'text/markdown;charset=utf-8')">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="1" y="2.5" width="14" height="11" rx="1.5"/><path d="M4 10V6l2 2.5L8 6v4M10.5 8.5L12.5 6v4"/></svg>
          {{ t('pdf.downloadMd') }}
        </button>
        <button class="sidebar-btn" @click="downloadAs('.txt', 'text/plain;charset=utf-8')">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M4 1.5h5l4 4V14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V2.5a1 1 0 0 1 1-1z"/><path d="M9 1.5V6h4.5"/></svg>
          {{ t('pdf.downloadTxt') }}
        </button>

        <div class="sidebar-divider"></div>
        <button class="sidebar-btn muted" @click="pickFile">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M2 13.5V4a1 1 0 0 1 1-1h3.6l1.4 2H13a1 1 0 0 1 1 1v7.5a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z"/></svg>
          {{ t('pdf.change') }}
        </button>
      </aside>

      <!-- Right: editable markdown output -->
      <div class="result-editor">
        <textarea v-model="markdown" spellcheck="false"></textarea>
      </div>
    </div>
  </div>
</template>

<style scoped>
.pdf-page { flex: 1; display: flex; overflow: hidden; background: var(--bg); min-height: 0; }

/* Upload state */
.upload-state {
  flex: 1; display: flex; align-items: center; justify-content: center;
  padding: 24px; overflow-y: auto;
}

.upload-zone {
  display: flex; flex-direction: column; align-items: center; padding: 48px 40px;
  border: 2px dashed var(--border); border-radius: 16px; background: var(--surface);
  cursor: pointer; text-align: center; transition: all 0.25s;
  max-width: 400px; width: 100%; flex-shrink: 0;
  animation: zoomIn 0.4s cubic-bezier(0.16, 1, 0.3, 1);
}
@keyframes zoomIn { from { opacity: 0; transform: scale(0.96); } to { opacity: 1; transform: scale(1); } }

.upload-zone:hover { border-color: var(--accent); background: var(--accent-bg); transform: translateY(-2px); }
.upload-zone svg { width: 52px; height: 52px; color: var(--text-tertiary); margin-bottom: 16px; }
.upload-zone h3 { font-size: 16px; font-weight: 650; margin-bottom: 4px; }
.upload-zone p { font-size: 13px; color: var(--text-secondary); }

.upload-badge {
  display: inline-flex; align-items: center; gap: 5px;
  margin-top: 20px; padding: 5px 12px; border-radius: 999px;
  background: var(--surface-hover); font-size: 11px; color: var(--text-tertiary);
}
.upload-badge svg { width: 12px; height: 12px; }

/* Loading */
.loading-state { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; }
.spinner { width: 28px; height: 28px; border: 3px solid var(--border); border-top-color: var(--accent); border-radius: 50%; animation: tb-spin 0.7s linear infinite; }
.loading-state p { color: var(--text-secondary); font-size: 13px; }
.progress-text { font-family: var(--font-mono); font-size: 12px; color: var(--text-tertiary); }

/* Result split */
.result-split { flex: 1; display: flex; overflow: hidden; animation: fadeIn 0.35s ease; }
@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }

.result-sidebar {
  width: 220px; flex-shrink: 0; padding: 16px;
  border-right: 1px solid var(--border-light); background: var(--surface);
  display: flex; flex-direction: column; gap: 6px; overflow-y: auto;
}

.pdf-info-card {
  display: flex; align-items: center; gap: 10px;
  padding: 12px; border-radius: 10px; background: var(--surface-hover);
  margin-bottom: 8px;
}
.pdf-info-card svg { width: 24px; height: 24px; color: var(--text-secondary); flex-shrink: 0; }
.pdf-info-card strong { display: block; font-size: 12px; font-weight: 600; word-break: break-all; }
.pdf-info-card span { font-size: 11px; color: var(--text-tertiary); }

.sidebar-btn {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 12px; border: 1px solid var(--border-light); border-radius: 8px;
  background: var(--surface); color: var(--text); font-size: 12px; font-weight: 500;
  font-family: var(--font-sans); cursor: pointer; transition: all 0.15s; width: 100%;
}
.sidebar-btn:hover { background: var(--surface-hover); }
.sidebar-btn:active { transform: scale(0.98); }
.sidebar-btn svg { width: 14px; height: 14px; color: var(--text-secondary); flex-shrink: 0; }
.sidebar-btn.primary { background: var(--text); color: var(--bg); border-color: var(--text); }
.sidebar-btn.primary:hover { opacity: 0.9; }
.sidebar-btn.primary svg { color: var(--bg); }
.sidebar-btn.muted { color: var(--text-secondary); border-style: dashed; }

.sidebar-divider { height: 1px; background: var(--border-light); margin: 6px 0; }

.result-editor { flex: 1; overflow: hidden; display: flex; }
.result-editor textarea {
  flex: 1; width: 100%; border: none; padding: 20px 24px;
  font-family: var(--font-mono); font-size: 13px; line-height: 1.7;
  color: var(--text); background: var(--bg); outline: none; resize: none;
}

@media (max-width: 768px) {
  .upload-state { padding: 16px; }
  .upload-zone { padding: 36px 24px; max-width: 100%; }
  .upload-zone svg { width: 40px; height: 40px; margin-bottom: 12px; }
  .upload-zone h3 { font-size: 15px; }

  .result-split { flex-direction: column; }
  .result-sidebar {
    width: 100%; flex-direction: row; flex-wrap: wrap;
    border-right: none; border-bottom: 1px solid var(--border-light);
    padding: 10px; gap: 6px;
  }
  .pdf-info-card { flex: 1 1 100%; margin-bottom: 0; }
  .sidebar-btn { flex: 1; justify-content: center; }
  .sidebar-divider { display: none; }
}
</style>
