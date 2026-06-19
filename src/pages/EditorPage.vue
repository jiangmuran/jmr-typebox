<script setup>
import { ref, computed, nextTick, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { useRouteHead } from '../composables/useRouteHead'
import { useEditor } from '../composables/useEditor'
import { useToast } from '../composables/useToast'
import { useI18n } from '../composables/useI18n'
import { useTheme } from '../composables/useTheme'
import { convertersFor } from '../converters/registry'
import { renderMarkdown } from '../utils/markdown'
import { useSettings } from '../composables/useSettings'
import { buildThemedHtml } from '../themes/registry'
import ThemePicker from '../themes/ThemePicker.vue'
import { load, save } from '../utils/storage'
import ClientOnly from '../components/ClientOnly.vue'
import MdToolbar from '../components/MdToolbar.vue'
import SearchBar from '../components/SearchBar.vue'
import Workspace from '../components/Workspace.vue'
import StatusBar from '../components/StatusBar.vue'
import StartPanel from '../components/StartPanel.vue'
import EditorContextMenu from '../components/EditorContextMenu.vue'

const { meta: m } = useRouteHead()
const router = useRouter()
const { docs, activeId, content, filename, dirty, stats, updateContent, updateFilename, newDocument, loadFile, openDoc, closeDoc } = useEditor()
const { showToast } = useToast()
const { t } = useI18n()
const { theme } = useTheme()
const { settings, setSetting } = useSettings()
const writingTheme = computed({ get: () => settings.writingTheme, set: v => setSetting('writingTheme', v) })
const exportTheme = computed({ get: () => settings.exportTheme, set: v => setSetting('exportTheme', v) })
function exportThemeId() { return (exportTheme.value && exportTheme.value !== 'default') ? exportTheme.value : 'inkwell' }

const editorRef = ref(null)
const searchOpen = ref(false)
const exportOpen = ref(false)
const viewMode = ref(load('view', 'split'))
const isMobile = ref(false)
const isMac = ref(false)
const modLabel = ref('Ctrl+')
const zenMode = ref(false)
const startDismissed = ref(false)
const showStart = computed(() => !content.value.trim() && !startDismissed.value && !zenMode.value)
function startWriting() { startDismissed.value = true; nextTick(() => editorRef.value?.focus()) }

function setViewMode(mode) { viewMode.value = mode; save('view', mode) }

// ---- Right-click plugins ----
const ctxShow = ref(false)
const ctxX = ref(0)
const ctxY = ref(0)
function onEditorMounted(el) {
  editorRef.value = el
  el.addEventListener('contextmenu', onCtx)
}
function onCtx(e) {
  e.preventDefault()
  ctxX.value = e.clientX
  ctxY.value = e.clientY
  ctxShow.value = true
}
async function applyPlugin(plugin) {
  ctxShow.value = false
  const el = editorRef.value; if (!el) return
  let s = el.selectionStart, e = el.selectionEnd
  if (e <= s) { s = 0; e = el.value.length }
  const target = el.value.substring(s, e)
  try {
    const result = plugin.asyncFn ? await plugin.asyncFn(target) : plugin.fn(target)
    el.focus()
    el.setRangeText(result, s, e, 'select')
    updateContent(el.value)
  } catch { showToast(t('tool.invalid')) }
}

function toggleZen() {
  zenMode.value = !zenMode.value
  if (zenMode.value) { document.documentElement.requestFullscreen?.().catch(() => {}); showToast(t('toast.zenHint')) }
  else if (document.fullscreenElement) document.exitFullscreen?.()
}

// ---- Toolbar inserts ----
function insertMarkdown(b, a, p) {
  const el = editorRef.value; if (!el) return
  const s = el.selectionStart, e = el.selectionEnd
  const sel = el.value.substring(s, e) || p || ''
  el.focus(); el.setRangeText(b + sel + a, s, e, 'select')
  el.selectionStart = s + b.length; el.selectionEnd = s + b.length + sel.length
  updateContent(el.value)
}
function insertLine(pre, ph) {
  const el = editorRef.value; if (!el) return
  const s = el.selectionStart
  const p = s === el.value.substring(0, s).lastIndexOf('\n') + 1 ? '' : '\n'
  insertMarkdown(p + pre, '', ph)
}

function downloadBlob(blob, name) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob); a.download = name
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

// ---- Export (conversions live in the editor) ----
async function printThemed() {
  showToast(t('toast.genPdf'))
  const html = await buildThemedHtml(renderMarkdown(content.value), exportThemeId())
  const iframe = document.createElement('iframe')
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:1px;height:1px;border:0;opacity:0;'
  iframe.onload = () => { try { iframe.contentWindow.focus(); iframe.contentWindow.print() } catch {} ; setTimeout(() => iframe.remove(), 2000) }
  document.body.appendChild(iframe)
  iframe.srcdoc = html
}

async function doExport(fmt) {
  exportOpen.value = false
  const fn = filename.value || 'untitled'
  try {
    if (fmt === 'docx') {
      const conv = convertersFor('md').find(c => c.output === 'docx')
      if (!conv) { showToast(t('toast.exportFailed')); return }
      showToast(t('toast.genDocx'))
      downloadBlob(await conv.run(content.value, {}), `${fn}.docx`)
      showToast(`${t('toast.downloaded')} ${fn}.docx`)
      return
    }
    if (fmt === 'html') {
      const html = await buildThemedHtml(renderMarkdown(content.value), exportThemeId())
      downloadBlob(new Blob([html], { type: 'text/html;charset=utf-8' }), `${fn}.html`)
      showToast(`${t('toast.downloaded')} ${fn}.html`)
      return
    }
    if (fmt === 'pdf') { await printThemed(); return }

    const { exportTXT, exportMD, exportPNG, copyHTML, copyMarkdown } = await import('../utils/export')
    let result
    switch (fmt) {
      case 'txt': result = exportTXT(content.value, fn); break
      case 'md': result = exportMD(content.value, fn); break
      case 'png': showToast(t('toast.genImg')); result = await exportPNG(content.value, fn, theme.value === 'dark'); break
      case 'copyHtml': result = await copyHTML(content.value); break
      case 'copyMd': result = await copyMarkdown(content.value); break
    }
    if (result) showToast(result.params ? `${t(result.key)} ${result.params.name || ''}`.trim() : t(result.key))
  } catch (e) { console.error(e); showToast(t('toast.exportFailed')) }
}

// ---- File open / import (PDF → Markdown happens IN the editor, as a new doc) ----
function openFilePicker() {
  const input = document.createElement('input')
  input.type = 'file'; input.accept = '.txt,.md,.markdown,.html,.htm,.pdf'
  input.onchange = e => { if (e.target.files[0]) importFile(e.target.files[0]) }
  input.click()
}
async function importFile(file) {
  if (/\.pdf$/i.test(file.name)) {
    showToast(`${t('pdf.extracting')} ${file.name}...`)
    try {
      const { pdfToMarkdown } = await import('../utils/pdfToMarkdown')
      const r = await pdfToMarkdown(file)
      loadFile(r.markdown, file.name.replace(/\.pdf$/i, ''))
      startDismissed.value = true
      showToast(`${r.numPages} ${t('toast.pdfExtracted')}`)
    } catch (e) { console.error(e); showToast(t('toast.pdfFailed')) }
    return
  }
  const reader = new FileReader()
  reader.onload = () => { loadFile(reader.result, file.name.replace(/\.\w+$/, '')); startDismissed.value = true; showToast(`${t('toast.loaded')} ${file.name}`) }
  reader.readAsText(file)
}

// ---- Drag & drop ----
const dragging = ref(false)
function onDragOver(e) { e.preventDefault(); dragging.value = true }
function onDragLeave(e) { if (!e.relatedTarget) dragging.value = false }
function onDrop(e) {
  e.preventDefault(); dragging.value = false
  const file = e.dataTransfer?.files?.[0]; if (!file) return
  if (file.type?.startsWith('image/')) router.push('/image/compress')
  else importFile(file)
}

function handleNew() {
  newDocument()
  startDismissed.value = false
  nextTick(() => editorRef.value?.focus())
}

function onKeydown(e) {
  const mod = isMac.value ? e.metaKey : e.ctrlKey
  if (mod && e.key === 's') { e.preventDefault(); doExport('md') }
  else if (mod && e.key === 'b') { e.preventDefault(); insertMarkdown('**', '**', 'bold') }
  else if (mod && e.key === 'i') { e.preventDefault(); insertMarkdown('*', '*', 'italic') }
  else if (mod && e.shiftKey && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); insertMarkdown('[', '](url)', 'text') }
  else if (mod && e.key === 'e') { e.preventDefault(); insertMarkdown('`', '`', 'code') }
  else if (mod && e.key === 'f') { e.preventDefault(); searchOpen.value = !searchOpen.value }
  else if (mod && e.shiftKey && (e.key === 'N' || e.key === 'n')) { e.preventDefault(); handleNew() }
  else if (mod && e.key === 'w') { e.preventDefault(); closeDoc(activeId.value) }
  else if (mod && e.key === 'p') {
    e.preventDefault()
    const modes = isMobile.value ? ['editor', 'preview'] : ['editor', 'split', 'preview']
    setViewMode(modes[(modes.indexOf(viewMode.value) + 1) % modes.length])
  } else if (e.key === 'Escape') {
    searchOpen.value = false; exportOpen.value = false; ctxShow.value = false
    if (zenMode.value) { zenMode.value = false; document.fullscreenElement && document.exitFullscreen?.() }
  } else if (e.key === 'F11') { e.preventDefault(); toggleZen() }
}

function handleResize() {
  isMobile.value = window.innerWidth <= 768
  if (isMobile.value && viewMode.value === 'split') viewMode.value = 'editor'
}

onMounted(() => {
  isMac.value = navigator.platform?.includes('Mac')
  modLabel.value = isMac.value ? '⌘' : 'Ctrl+'
  handleResize()
  if (isMobile.value && viewMode.value === 'split') viewMode.value = 'editor'
  window.addEventListener('resize', handleResize)
  document.addEventListener('keydown', onKeydown)
  document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement) zenMode.value = false })
})
onUnmounted(() => {
  window.removeEventListener('resize', handleResize)
  document.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <div class="editor-page" :class="{ zen: zenMode }" @dragover="onDragOver" @dragleave="onDragLeave" @drop="onDrop">
    <h1 class="sr-only">{{ m.h1 }}</h1>

    <ClientOnly>
      <!-- Document tabs -->
      <div v-show="!zenMode" class="doc-tabs">
        <button v-for="d in docs" :key="d.id" class="doc-tab" :class="{ active: d.id === activeId }" @click="openDoc(d.id)">
          <span class="doc-tab-name">{{ d.name || 'untitled' }}</span>
          <span class="doc-tab-x" :title="t('doc.close')" @click.stop="closeDoc(d.id)">×</span>
        </button>
        <button class="doc-tab-new" :title="t('menu.new')" @click="handleNew">+</button>
      </div>

      <!-- Editor control row -->
      <div v-show="!zenMode" class="editor-controls">
        <div class="ec-file">
          <input :value="filename" @input="updateFilename($event.target.value)" spellcheck="false" :placeholder="t('file.placeholder')">
          <span class="file-ext">.md</span>
        </div>
        <div class="ec-spacer"></div>
        <div class="view-seg">
          <button :class="{on: viewMode==='editor'}" @click="setViewMode('editor')" :title="t('view.editor')">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M11.5 1.5l3 3L5 14H2v-3z"/></svg>
          </button>
          <button v-if="!isMobile" :class="{on: viewMode==='split'}" @click="setViewMode('split')" :title="t('view.split')">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><rect x="1" y="1.5" width="14" height="13" rx="2"/><line x1="8" y1="1.5" x2="8" y2="14.5"/></svg>
          </button>
          <button :class="{on: viewMode==='preview'}" @click="setViewMode('preview')" :title="t('view.preview')">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M1 8s3-5.5 7-5.5S15 8 15 8s-3 5.5-7 5.5S1 8 1 8z"/><circle cx="8" cy="8" r="2"/></svg>
          </button>
        </div>
        <ThemePicker v-model="writingTheme" :preview-markdown="content" class="ec-theme" />
        <button class="ec-btn" @click="openFilePicker" :title="t('menu.open')">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M2 13.5V4a1 1 0 0 1 1-1h3.6l1.4 2H13a1 1 0 0 1 1 1v7.5a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z"/></svg>
        </button>
        <button class="ec-btn" @click="searchOpen = !searchOpen" :title="t('menu.find')">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><circle cx="7" cy="7" r="4.5"/><line x1="10.2" y1="10.2" x2="14" y2="14"/></svg>
        </button>
        <div class="dd-wrap">
          <button class="ec-btn ec-export" @click="exportOpen = !exportOpen" :title="t('export')">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M14 10v3.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 13.5V10"/><polyline points="5 7 8 10 11 7"/><line x1="8" y1="10" x2="8" y2="2"/></svg>
            <span class="ec-export-lbl">{{ t('export') }}</span>
          </button>
          <Transition name="dd">
            <div v-if="exportOpen" class="dd-menu">
              <div class="dd-theme">
                <span class="dd-theme-lbl">{{ t('settings.exportTheme') }}</span>
                <ThemePicker v-model="exportTheme" :preview-markdown="content" />
              </div>
              <div class="dd-sep"></div>
              <div class="dd-label">{{ t('export.download') }}</div>
              <button @click="doExport('md')">{{ t('export.md') }}<kbd>{{ modLabel }}S</kbd></button>
              <button @click="doExport('txt')">{{ t('export.txt') }}</button>
              <button @click="doExport('html')">{{ t('export.html') }}</button>
              <button @click="doExport('docx')">{{ t('export.docx') }}</button>
              <button @click="doExport('pdf')">{{ t('export.pdf') }}</button>
              <button @click="doExport('png')">{{ t('export.png') }}</button>
              <div class="dd-sep"></div>
              <div class="dd-label">{{ t('export.clipboard') }}</div>
              <button @click="doExport('copyHtml')">{{ t('export.copyHtml') }}</button>
              <button @click="doExport('copyMd')">{{ t('export.copyMd') }}</button>
            </div>
          </Transition>
        </div>
        <button class="ec-btn" @click="toggleZen" :title="t('menu.zen')">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M2.5 5.5V3a.5.5 0 0 1 .5-.5h2.5M10.5 2.5H13a.5.5 0 0 1 .5.5v2.5M13.5 10.5V13a.5.5 0 0 1-.5.5h-2.5M5.5 13.5H3a.5.5 0 0 1-.5-.5v-2.5"/></svg>
        </button>
      </div>

      <div v-if="exportOpen" class="click-away" @click="exportOpen = false"></div>

      <div class="editor-body">
        <MdToolbar v-show="!zenMode" @insert="insertMarkdown" @insert-line="insertLine" />
        <SearchBar v-if="searchOpen" :editor-ref="editorRef" :content="content" @update-content="updateContent" @close="searchOpen = false" />
        <Workspace :content="content" :view-mode="viewMode" :is-mobile="isMobile" :placeholder="t('editor.placeholder')" @update:content="updateContent" @editor-mounted="onEditorMounted" />
        <StatusBar v-show="!zenMode" :stats="stats" :dirty="dirty" :t="t" />
      </div>

      <!-- Welcome guide: covers the whole editor area (incl. tabs/toolbar) so it reads as a clean start screen -->
      <div v-if="showStart" class="start-overlay">
        <StartPanel @write="startWriting" />
      </div>

      <Transition name="fade">
        <div v-if="dragging" class="drag-overlay">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
          <span>{{ t('drag.hint') }}</span>
        </div>
      </Transition>

      <EditorContextMenu :show="ctxShow" :x="ctxX" :y="ctxY" @apply="applyPlugin" @close="ctxShow = false" />
    </ClientOnly>
  </div>
</template>

<style scoped>
.editor-page { position: relative; flex: 1; display: flex; flex-direction: column; min-height: 0; overflow: hidden; }
.editor-body { position: relative; flex: 1; display: flex; flex-direction: column; min-height: 0; }
.start-overlay { position: absolute; inset: 0; z-index: 30; background: var(--bg); display: flex; align-items: flex-start; justify-content: center; overflow-y: auto; }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }

/* Document tabs */
.doc-tabs { display: flex; align-items: stretch; gap: 2px; padding: 4px 8px 0; border-bottom: 1px solid var(--border-light); overflow-x: auto; flex-shrink: 0; }
.doc-tab { display: inline-flex; align-items: center; gap: 6px; max-width: 180px; padding: 6px 8px 6px 11px; border: 1px solid transparent; border-bottom: none; border-radius: 8px 8px 0 0; background: transparent; color: var(--text-tertiary); font-size: 12px; font-family: var(--font-sans); cursor: pointer; white-space: nowrap; }
.doc-tab:hover { color: var(--text-secondary); background: var(--surface-hover); }
.doc-tab.active { color: var(--text); background: var(--surface); border-color: var(--border-light); }
.doc-tab-name { overflow: hidden; text-overflow: ellipsis; }
.doc-tab-x { display: inline-flex; align-items: center; justify-content: center; width: 15px; height: 15px; border-radius: 4px; font-size: 14px; line-height: 1; color: var(--text-tertiary); }
.doc-tab-x:hover { background: var(--surface-active); color: var(--text); }
.doc-tab-new { width: 26px; flex-shrink: 0; border: none; background: transparent; color: var(--text-tertiary); font-size: 16px; cursor: pointer; border-radius: 6px; }
.doc-tab-new:hover { background: var(--surface-hover); color: var(--text); }

.editor-controls { display: flex; align-items: center; gap: 4px; padding: 5px 10px; border-bottom: 1px solid var(--border-light); flex-shrink: 0; flex-wrap: wrap; }
.ec-theme { flex-shrink: 0; }
.ec-theme :deep(.tp-trigger) { height: 30px; }
@media (max-width: 768px) { .ec-theme :deep(.tp-trigger-label) { display: none; } }
.ec-file { display: flex; align-items: center; }
.ec-file input { border: none; background: transparent; font-size: 12px; font-family: var(--font-mono); color: var(--text-secondary); outline: none; width: 120px; padding: 3px 6px; border-radius: 4px; transition: all 0.15s; }
.ec-file input:hover { background: var(--surface-hover); }
.ec-file input:focus { background: var(--surface-hover); color: var(--text); width: 160px; }
.file-ext { font-size: 11px; color: var(--text-tertiary); font-family: var(--font-mono); }
.ec-spacer { flex: 1; }

.view-seg { display: flex; gap: 1px; background: var(--surface-hover); border-radius: 6px; padding: 2px; margin-right: 4px; }
.view-seg button { width: 26px; height: 24px; display: flex; align-items: center; justify-content: center; border: none; border-radius: 4px; background: transparent; color: var(--text-tertiary); cursor: pointer; transition: all 0.18s var(--ease-out); }
.view-seg button:hover { color: var(--text-secondary); }
.view-seg button.on { background: var(--surface); color: var(--text); box-shadow: var(--shadow-xs); }
.view-seg button svg { width: 13px; height: 13px; }

.ec-btn { width: 30px; height: 30px; display: flex; align-items: center; justify-content: center; border: none; border-radius: 6px; background: transparent; color: var(--text-secondary); cursor: pointer; transition: all 0.15s; }
.ec-btn:hover { background: var(--surface-hover); color: var(--text); }
.ec-btn:active { transform: scale(0.88); }
.ec-btn svg { width: 15px; height: 15px; }

.dd-wrap { position: relative; }
.ec-export { width: auto; gap: 5px; padding: 0 11px; }
.ec-export-lbl { font-size: 12px; font-weight: 500; }
.dd-theme { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 4px 8px 8px; }
.dd-theme-lbl { font-size: 11px; color: var(--text-tertiary); }
@media (max-width: 768px) { .ec-export-lbl { display: none; } }
.dd-menu { position: absolute; top: calc(100% + 6px); right: 0; min-width: 200px; background: var(--surface); border: 1px solid var(--border-light); border-radius: 12px; box-shadow: var(--shadow-lg); padding: 6px; z-index: 200; }
.dd-menu button { display: flex; align-items: center; width: 100%; padding: 7px 10px; border: none; border-radius: 7px; background: transparent; color: var(--text); font-size: 13px; font-family: var(--font-sans); cursor: pointer; text-align: left; }
.dd-menu button:hover { background: var(--surface-hover); }
.dd-menu button kbd { margin-left: auto; font-size: 10px; color: var(--text-tertiary); background: var(--surface-hover); padding: 1px 5px; border-radius: 3px; }
.dd-label { font-size: 10px; font-weight: 600; color: var(--text-tertiary); text-transform: uppercase; letter-spacing: 0.5px; padding: 6px 10px 3px; }
.dd-sep { height: 1px; background: var(--border-light); margin: 4px 6px; }
.dd-enter-active { transition: all 0.22s var(--ease-out); }
.dd-leave-active { transition: all 0.12s ease; }
.dd-enter-from, .dd-leave-to { opacity: 0; transform: scale(0.95) translateY(-4px); }
.click-away { position: fixed; inset: 0; z-index: 90; }

.drag-overlay { position: fixed; inset: 8px; z-index: 9999; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; background: var(--accent-bg); border: 2px dashed var(--accent); border-radius: 16px; font-size: 14px; font-weight: 500; color: var(--accent); backdrop-filter: blur(8px); pointer-events: none; }
.drag-overlay svg { width: 32px; height: 32px; opacity: 0.7; }
.fade-enter-active { transition: opacity 0.2s; }
.fade-leave-active { transition: opacity 0.15s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }

.zen .editor-controls, .zen .doc-tabs { display: none; }
@media (max-width: 768px) { .ec-file input { width: 80px; } .ec-file input:focus { width: 110px; } }
@media print { .editor-controls, .doc-tabs, .click-away { display: none !important; } }
</style>
