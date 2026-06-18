<script setup>
// /convert/pdf-to-word — load PDF -> pdfToMarkdown -> renderMarkdown -> .docx
// (same docx path as markdown-to-docx). Lets the user review/edit the extracted
// markdown before exporting.
import { ref } from 'vue'
import { useRouteHead } from '../../composables/useRouteHead.js'
import { useI18n } from '../../composables/useI18n.js'
import { useToast } from '../../composables/useToast.js'
import { libLoadState } from '../../utils/loadLibrary.js'
import ClientOnly from '../../components/ClientOnly.vue'
import ActionButton from './components/ActionButton.vue'
import { stripExt, withExt, deriveTitle, downloadBlob, fileKind } from './utils/fileHelpers.js'

const { meta: m } = useRouteHead()
const { t } = useI18n()
const { showToast } = useToast()

const pdfName = ref('')
const markdown = ref('')
const extracting = ref(false)
const progress = ref('')
const numPages = ref(0)
const converting = ref(false)
const dragging = ref(false)

function pickPdf() {
  if (typeof document === 'undefined') return
  const input = document.createElement('input')
  input.type = 'file'; input.accept = '.pdf,application/pdf'
  input.onchange = e => { const f = e.target.files?.[0]; if (f) handlePdf(f) }
  input.click()
}

async function handlePdf(file) {
  if (fileKind(file) !== 'pdf') return
  pdfName.value = file.name
  extracting.value = true
  markdown.value = ''
  numPages.value = 0
  try {
    const { pdfToMarkdown } = await import('../../utils/pdfToMarkdown.js')
    const result = await pdfToMarkdown(file, (cur, total) => { progress.value = `${cur} / ${total}` })
    markdown.value = result.markdown
    numPages.value = result.numPages
    showToast(`${result.numPages} ${t('toast.pdfExtracted')}`)
  } catch (e) {
    console.error(e); showToast(t('toast.pdfFailed'))
  } finally {
    extracting.value = false; progress.value = ''
  }
}

function onDrop(e) {
  e.preventDefault(); dragging.value = false
  const f = e.dataTransfer?.files?.[0]; if (f) handlePdf(f)
}

async function toDocx() {
  if (!markdown.value.trim() || converting.value) return
  converting.value = true
  showToast(t('convert.mdToDocx.working'))
  try {
    const { markdownToDocxBlob } = await import('./utils/docx.js')
    const base = stripExt(pdfName.value) || 'document'
    const blob = await markdownToDocxBlob(markdown.value, deriveTitle(markdown.value, base))
    const filename = withExt(base, 'docx')
    downloadBlob(blob, filename)
    showToast(`${t('toast.downloaded')} ${filename}`)
  } catch (e) {
    console.error(e); showToast(t('toast.exportFailed'))
  } finally {
    converting.value = false
  }
}

function reset() { markdown.value = ''; pdfName.value = ''; numPages.value = 0 }
</script>

<template>
  <div class="route-page">
    <h1 class="sr-only">{{ m.h1 }}</h1>
    <ClientOnly>
      <main class="p2w" @dragover.prevent="dragging = true" @dragleave="dragging = false" @drop="onDrop">
        <header class="cv-head">
          <h2>{{ t('convert.pdfToWord.title') }}</h2>
          <p>{{ t('convert.pdfToWord.sub') }}</p>
        </header>

        <!-- Upload -->
        <div v-if="!markdown && !extracting" class="upload-zone" :class="{ dragging }" @click="pickPdf">
          <svg viewBox="0 0 56 56" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round">
            <rect x="12" y="4" width="32" height="48" rx="4"/>
            <path d="M22 24h4a3.5 3.5 0 0 1 0 7h-4m0-7v16"/>
            <path d="M34 24h7m-3.5 0v16"/>
          </svg>
          <h3>{{ t('convert.pdfToWord.drop') }}</h3>
          <p>{{ t('pdf.browse') }}</p>
        </div>

        <!-- Extracting -->
        <div v-else-if="extracting" class="loading">
          <span class="cv-spinner-lg"></span>
          <p>{{ t('pdf.extracting') }} {{ pdfName }}…</p>
          <p v-if="progress" class="prog">{{ progress }}</p>
        </div>

        <!-- Review + convert -->
        <template v-else>
          <div class="file-card">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><rect x="4" y="2" width="16" height="20" rx="2"/><path d="M8 10h3a2 2 0 0 1 0 4H8m0-4v8"/></svg>
            <div><strong>{{ pdfName }}</strong><span v-if="numPages">{{ numPages }} {{ t('pdf.pages') }}</span></div>
            <button class="change" @click="reset">{{ t('pdf.change') }}</button>
          </div>

          <div class="cv-pane">
            <div class="cv-pane-head"><span>{{ t('convert.pdfToWord.review') }}</span></div>
            <textarea v-model="markdown" spellcheck="false"></textarea>
          </div>

          <div class="cv-run">
            <ActionButton variant="primary" :busy="converting" :disabled="!markdown.trim()" @click="toDocx">
              <template #icon><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 1.5h5l4 4V14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V2.5a1 1 0 0 1 1-1z"/><path d="M9 1.5V6h4.5"/><path d="M5.5 9l.8 3 .9-3 .9 3 .8-3"/></svg></template>
              {{ t('convert.pdfToWord.download') }}
            </ActionButton>
          </div>
          <p v-if="libLoadState.docx === 'loading'" class="cv-libhint"><span class="cv-spinner"></span>{{ t('convert.loadingLib') }} · 1.2 MB</p>
          <p class="cv-note">{{ t('convert.pdfToWord.note') }}</p>
        </template>
      </main>
    </ClientOnly>
  </div>
</template>

<style scoped>
.route-page { flex: 1; display: flex; flex-direction: column; min-height: 0; overflow: hidden; }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }
.p2w { flex: 1; overflow-y: auto; padding: 32px 24px 56px; max-width: 760px; margin: 0 auto; width: 100%; animation: cvIn 0.3s var(--ease-out); }
@keyframes cvIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
.cv-head { margin-bottom: 20px; }
.cv-head h2 { font-size: 24px; font-weight: 750; letter-spacing: -0.5px; }
.cv-head p { margin-top: 6px; color: var(--text-secondary); font-size: 13px; line-height: 1.5; }

.upload-zone { display: flex; flex-direction: column; align-items: center; padding: 48px 40px; border: 2px dashed var(--border); border-radius: 16px; background: var(--surface); cursor: pointer; text-align: center; transition: all 0.25s; }
.upload-zone:hover, .upload-zone.dragging { border-color: var(--accent); background: var(--accent-bg); }
.upload-zone svg { width: 52px; height: 52px; color: var(--text-tertiary); margin-bottom: 16px; }
.upload-zone h3 { font-size: 16px; font-weight: 650; margin-bottom: 4px; }
.upload-zone p { font-size: 13px; color: var(--text-secondary); }

.loading { display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 56px 0; }
.cv-spinner-lg { width: 28px; height: 28px; border: 3px solid var(--border); border-top-color: var(--accent); border-radius: 50%; animation: cvSpin 0.7s linear infinite; }
.loading p { color: var(--text-secondary); font-size: 13px; }
.prog { font-family: var(--font-mono); font-size: 12px; color: var(--text-tertiary); }

.file-card { display: flex; align-items: center; gap: 10px; padding: 12px; border-radius: 10px; background: var(--surface-hover); margin-bottom: 16px; }
.file-card svg { width: 24px; height: 24px; color: var(--text-secondary); flex-shrink: 0; }
.file-card strong { display: block; font-size: 13px; font-weight: 600; word-break: break-all; }
.file-card span { font-size: 11px; color: var(--text-tertiary); }
.file-card .change { margin-left: auto; border: none; background: var(--surface); color: var(--text-secondary); font-size: 11px; padding: 5px 11px; border-radius: 6px; cursor: pointer; border: 1px solid var(--border-light); }
.file-card .change:hover { color: var(--text); }

.cv-pane { border: 1px solid var(--border-light); border-radius: 12px; overflow: hidden; background: var(--surface); }
.cv-pane-head { display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; border-bottom: 1px solid var(--border-light); font-size: 11px; font-weight: 600; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.5px; }
.cv-pane textarea { width: 100%; min-height: 280px; border: none; background: transparent; padding: 14px; font-family: var(--font-mono); font-size: 13px; line-height: 1.6; color: var(--text); outline: none; resize: vertical; }

.cv-run { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 18px; }
.cv-libhint { display: flex; align-items: center; gap: 8px; margin-top: 14px; font-size: 12px; color: var(--text-secondary); }
.cv-spinner { width: 13px; height: 13px; border: 2px solid var(--border); border-top-color: var(--accent); border-radius: 50%; animation: cvSpin 0.7s linear infinite; }
@keyframes cvSpin { to { transform: rotate(360deg); } }
.cv-note { margin-top: 16px; font-size: 12px; color: var(--text-tertiary); line-height: 1.5; }
</style>
