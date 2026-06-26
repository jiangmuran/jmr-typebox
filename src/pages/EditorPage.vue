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
import { prerenderMermaid } from '../utils/mermaid'
import { useSettings } from '../composables/useSettings'
import { useHandoff } from '../composables/useHandoff'
import { useFileHandles } from '../composables/useFileHandles'
import { buildThemedHtml, THEMES } from '../themes/registry'
import ThemePicker from '../themes/ThemePicker.vue'
import { load, save } from '../utils/storage'
import ClientOnly from '../components/ClientOnly.vue'
import MdToolbar from '../components/MdToolbar.vue'
import SearchBar from '../components/SearchBar.vue'
import Workspace from '../components/Workspace.vue'
import StatusBar from '../components/StatusBar.vue'
import StartPanel from '../components/StartPanel.vue'
import EditorContextMenu from '../components/EditorContextMenu.vue'
import AiPanel from '../components/AiPanel.vue'
import AiIcon from '../components/AiIcon.vue'
import { useAiActions } from '../composables/useAiActions'
import { useAiComplete } from '../composables/useAiComplete'

const { meta: m } = useRouteHead()
const router = useRouter()
const { docs, activeId, content, filename, dirty, stats, updateContent, updateFilename, newDocument, loadFile, openDoc, closeDoc } = useEditor()
const { showToast } = useToast()
const { t } = useI18n()
const { theme } = useTheme()
const { settings, setSetting } = useSettings()
const handoff = useHandoff()
const fileHandles = useFileHandles()
const writingTheme = computed({ get: () => settings.writingTheme, set: v => setSetting('writingTheme', v) })
const exportTheme = computed({ get: () => settings.exportTheme, set: v => setSetting('exportTheme', v) })
function exportThemeId() {
  // 'follow' (the default) → use the current writing theme; if that's the app default (no themed
  // CSS), fall back to a clean print theme. Otherwise honor the explicitly chosen export theme.
  let id = exportTheme.value
  if (!id || id === 'follow') id = writingTheme.value
  return (id && id !== 'default') ? id : 'inkwell'
}

const editorRef = ref(null)
const searchOpen = ref(false)
const exportOpen = ref(false)
const moreOpen = ref(false)
const viewMode = ref(load('view', 'split'))
const isMobile = ref(false)
const isMac = ref(false)
const modLabel = ref('Ctrl+')
const zenMode = ref(false)
const startDismissed = ref(false)
// Only the fresh/single empty document shows the welcome guide. Switching to an empty tab
// while other documents are open must NOT bounce back to the start screen.
const showStart = computed(() => docs.length <= 1 && !content.value.trim() && !startDismissed.value && !zenMode.value)
function startWriting() { startDismissed.value = true; nextTick(() => editorRef.value?.focus()) }

function setViewMode(mode) { viewMode.value = mode; save('view', mode) }

// ---- Right-click plugins ----
const ctxShow = ref(false)
const ctxX = ref(0)
const ctxY = ref(0)
function onEditorMounted(el) {
  editorRef.value = el
  el.addEventListener('contextmenu', onCtx)
  // Cursor moves / clicks dismiss the inline ghost completion.
  el.addEventListener('mouseup', () => aiComplete.clear())
  el.addEventListener('keyup', e => {
    if (['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End','PageUp','PageDown'].includes(e.key)) aiComplete.clear()
  })
  el.addEventListener('blur', () => aiComplete.clear())
  // On input: drop the pending ghost and (re)schedule an inline ghost after the idle debounce.
  el.addEventListener('input', () => { ghost.value = null; aiComplete.schedule() })
}
function onCtx(e) {
  e.preventDefault()
  ctxX.value = e.clientX
  ctxY.value = e.clientY
  ctxShow.value = true
}
// `apply` fires for both text plugins (payload = plugin) and AI replace-in-place actions
// (no payload — the menu already streamed the result into the textarea, just flush state).
async function applyPlugin(plugin) {
  ctxShow.value = false
  const el = editorRef.value; if (!el) return
  if (!plugin || (!plugin.fn && !plugin.asyncFn)) { updateContent(el.value); return }
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

// ---- AI integration ----
// Selection AI actions (improve/polish/rewrite/translate/explain/…) now live entirely in the
// right-click EditorContextMenu, which snapshots the selection on open and reuses useAiActions.
const ai = useAiActions()
const aiPanelOpen = ref(false)
const aiMenuOpen = ref(false)

// Open the Settings drawer at the AI section (SettingsPanel listens for this global event).
function openAiSettings() {
  aiPanelOpen.value = false
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('tb-open-settings', { detail: { section: 'ai' } }))
}

// Copilot-style inline ghost-text autocomplete (automatic, on idle). Distinct from the manual
// ⌃Space "continue writing" below: this NEVER edits the doc until the user presses Tab.
const aiComplete = useAiComplete({ getEditor: () => editorRef.value })
const inlineGhost = computed(() => aiComplete.suggestion.value)
function acceptInlineGhost() {
  if (aiComplete.accept()) {
    // Reflect the accepted text into the editor/doc state.
    const el = editorRef.value
    if (el) updateContent(el.value)
  }
}

// Inline "continue writing" (⌃Space): stream a continuation at the cursor.
const ghost = ref(null) // { pos, text } pending ghost completion awaiting Tab
async function continueWriting() {
  const el = editorRef.value; if (!el) return
  if (!ai.ready.value) { showToast(t('ai.notConfigured')); aiPanelOpen.value = true; return }
  if (ai.busy.value) { ai.abort(); return }
  const startPos = el.selectionStart
  ghost.value = { pos: startPos, text: '' }
  let inserted = ''
  try {
    const r = await ai.continueWriting(el, {
      onChunk: (full) => {
        // Live-insert as a marked ghost region (we just insert plainly and track length).
        const before = el.value.slice(0, startPos)
        const after = el.value.slice(startPos + inserted.length)
        inserted = full
        updateContent(before + full + after)
        // keep caret before the inserted ghost so user sees it grow ahead
        nextTick(() => { try { el.selectionStart = el.selectionEnd = startPos } catch {} })
      },
    })
    if (r.ok) {
      ghost.value = { pos: startPos, text: r.text }
      // Position caret at end of completion; it stays (already inserted). Tab/Esc handled below.
      nextTick(() => { try { el.focus(); el.selectionStart = el.selectionEnd = startPos + (r.text?.length || 0) } catch {} })
      showToast(t('ai.continueHint'))
    } else if (r.reason === 'empty') {
      showToast(t('ai.continueEmpty'))
      ghost.value = null
    }
  } catch (err) {
    showToast(err?.message || t('ai.error'))
    ghost.value = null
  }
}

// Whole-document AI actions from the AI menu.
async function runDocAi(id) {
  aiMenuOpen.value = false
  if (!ai.ready.value) { showToast(t('ai.notConfigured')); aiPanelOpen.value = true; return }
  const el = editorRef.value
  try {
    if (id === 'generate') {
      const topic = (typeof window !== 'undefined') ? window.prompt(t('ai.generatePrompt')) : ''
      if (!topic) return
      startDismissed.value = true
      await ai.generateDocument(topic, el)
      showToast(t('ai.done'))
      return
    }
    const r = await ai.runDocAction(id, el)
    if (!r.ok && r.reason === 'empty') { showToast(t('ai.docEmpty')); return }
    if (r.replaced) showToast(t('ai.done'))
    else if (r.text) {
      // non-replacing (summarize/outline/title): insert at top as a new section
      const el2 = editorRef.value
      if (el2) {
        const heading = `\n\n---\n\n${r.text}\n`
        updateContent(content.value + heading)
        showToast(t('ai.insertedBelow'))
      }
    }
  } catch (err) { showToast(err?.message || t('ai.error')) }
}

// Theme setter callback for the AI panel's set_theme tool.
function onAiSetTheme({ id, target }) {
  if (target === 'export') setSetting('exportTheme', id)
  else setSetting('writingTheme', id)
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
// Is the active export theme a dark one? (Picks the mermaid diagram theme.)
function exportThemeIsDark() {
  const id = exportThemeId()
  return !!(THEMES.find(th => th.id === id)?.dark)
}
// Render markdown AND pre-render mermaid diagrams to inline SVG, so exports (HTML/
// PNG/PDF — all static, no client JS) include diagrams. KaTeX math is already in
// the HTML (DOMPurify-safe), and buildThemedHtml adds KaTeX CSS when math present.
async function renderExportBody(extra = '') {
  const body = await prerenderMermaid(renderMarkdown(content.value), exportThemeIsDark())
  return body + extra
}

async function printThemed() {
  showToast(t('toast.genPdf'))
  const html = await buildThemedHtml(await renderExportBody(), exportThemeId())
  const iframe = document.createElement('iframe')
  // Render OFF-SCREEN at a real page width (A4 @96dpi). A 1px/opacity:0 frame lays the document
  // out at ~1px wide, so the print preview comes out blank — give it real size instead.
  iframe.setAttribute('aria-hidden', 'true')
  iframe.style.cssText = 'position:fixed;left:-10000px;top:0;width:794px;height:1123px;border:0;'
  iframe.onload = () => {
    const go = () => { try { iframe.contentWindow.focus(); iframe.contentWindow.print() } catch {} ; setTimeout(() => iframe.remove(), 60000) }
    // Wait for the themed doc's fonts/images to settle, else the first paint (and the print) is empty.
    try {
      const fonts = iframe.contentWindow?.document?.fonts?.ready
      if (fonts && typeof fonts.then === 'function') fonts.then(() => setTimeout(go, 120)).catch(() => setTimeout(go, 300))
      else setTimeout(go, 300)
    } catch { setTimeout(go, 300) }
  }
  document.body.appendChild(iframe)
  iframe.srcdoc = html
}

async function doExport(fmt) {
  exportOpen.value = false
  const fn = filename.value || 'untitled'
  try {
    if (fmt === 'docx') {
      const conv = convertersFor('markdown').find(c => c.output === 'docx')
      if (!conv) { showToast(t('toast.exportFailed')); return }
      showToast(t('toast.genDocx'))
      downloadBlob(await conv.run(content.value, {}), `${fn}.docx`)
      showToast(`${t('toast.downloaded')} ${fn}.docx`)
      return
    }
    if (fmt === 'html') {
      const html = await buildThemedHtml(await renderExportBody(), exportThemeId())
      downloadBlob(new Blob([html], { type: 'text/html;charset=utf-8' }), `${fn}.html`)
      showToast(`${t('toast.downloaded')} ${fn}.html`)
      return
    }
    if (fmt === 'pdf') { await printThemed(); return }

    // Image export/clipboard uses the chosen EXPORT THEME (rendered in an isolated iframe), with a
    // box.muran.tech credit footer. Falls back to the plain renderer if the themed/clipboard path fails.
    if (fmt === 'png' || fmt === 'copyImage') {
      showToast(t('toast.genImg'))
      const footer = '<hr style="margin-top:2.4em;border:none;border-top:1px solid currentColor;opacity:.18"><p style="opacity:.5;font-size:.82em;margin-top:.8em">Made with TypeBox · box.muran.tech</p>'
      const themedHtml = await buildThemedHtml(await renderExportBody(footer), exportThemeId())
      const ex = await import('../utils/export')
      try {
        if (fmt === 'copyImage') { await ex.copyThemedPNG(themedHtml); showToast(t('toast.imgCopied')) }
        else { await ex.exportThemedPNG(fn, themedHtml); showToast(t('toast.pngDone')) }
      } catch (err) {
        console.error(err)
        await ex.exportPNG(content.value, fn, theme.value === 'dark')
        showToast(t('toast.pngDone'))
      }
      return
    }

    const { exportTXT, exportMD, copyHTML, copyMarkdown } = await import('../utils/export')
    let result
    switch (fmt) {
      case 'txt': result = exportTXT(content.value, fn); break
      case 'md': result = exportMD(content.value, fn); break
      case 'copyHtml': result = await copyHTML(content.value, theme.value === 'dark'); break
      case 'copyMd': result = await copyMarkdown(content.value); break
    }
    if (result) showToast(result.params ? `${t(result.key)} ${result.params.name || ''}`.trim() : t(result.key))
  } catch (e) { console.error(e); showToast(t('toast.exportFailed')) }
}

// ---- File open / import (PDF → Markdown happens IN the editor, as a new doc) ----
async function openFilePicker() {
  // Prefer the File System Access API so an opened markdown file keeps a handle (→ Ctrl+S saves back).
  if (typeof window !== 'undefined' && window.showOpenFilePicker) {
    try {
      const [handle] = await window.showOpenFilePicker({
        types: [{ description: 'Documents', accept: {
          'text/markdown': ['.md', '.markdown', '.mdown', '.mkd'],
          'text/plain': ['.txt'],
          'text/html': ['.html', '.htm'],
          'application/pdf': ['.pdf'],
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
          'application/vnd.openxmlformats-officedocument.presentationml.presentation': ['.pptx'],
        } }],
      })
      if (handle) await importFile(await handle.getFile(), handle)
      return
    } catch (err) {
      if (err?.name === 'AbortError') return // user cancelled the picker
      // other errors → fall through to the classic input
    }
  }
  const input = document.createElement('input')
  input.type = 'file'; input.accept = '.txt,.md,.markdown,.html,.htm,.pdf,.xlsx,.xls,.csv,.pptx,.ppt'
  input.onchange = e => { if (e.target.files[0]) importFile(e.target.files[0]) }
  input.click()
}
// Office files (.xlsx / .pptx) open in the dedicated viewer (with light spreadsheet editing). We
// stage the File for the viewer (it can't ride in the URL) and route to /office. Returns true if
// the file was handled here.
async function maybeOpenOffice(file) {
  const { isOfficeName } = await import('../features/office/officeHelpers')
  if (!isOfficeName(file.name)) return false
  const { stageOfficeFile } = await import('../features/office/officeStore')
  stageOfficeFile(file)
  router.push('/office')
  return true
}
async function importFile(file) {
  if (await maybeOpenOffice(file)) return
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
  reader.onload = () => {
    loadFile(reader.result, file.name.replace(/\.\w+$/, ''))
    if (handle) fileHandles.set(activeId.value, handle) // back this doc with the file → Ctrl+S saves to it
    startDismissed.value = true
    showToast(`${t('toast.loaded')} ${file.name}`)
  }
  reader.readAsText(file)
}

// Ctrl+S: if the active doc is backed by a file handle (opened via the PWA file handler or the File
// System Access picker), write edits straight back to that file; otherwise download a .md copy.
async function saveActiveDoc() {
  const handle = fileHandles.get(activeId.value)
  if (!handle) { doExport('md'); return }
  try {
    if (handle.queryPermission) {
      let perm = await handle.queryPermission({ mode: 'readwrite' })
      if (perm !== 'granted' && handle.requestPermission) perm = await handle.requestPermission({ mode: 'readwrite' })
      if (perm !== 'granted') { doExport('md'); return }
    }
    const writable = await handle.createWritable()
    await writable.write(content.value)
    await writable.close()
    showToast(`${t('toast.savedFile')} ${handle.name || ''}`.trim())
  } catch (err) { console.error(err); showToast(t('toast.exportFailed')) }
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

// Cross-module handoff: another tool can stage a payload and route here. TEXT/markdown (e.g. an ASR
// transcript) opens as a NEW document; an IMAGE (e.g. a processed picture from the image tools) is
// inserted into the current doc as markdown. One-shot (take() clears the staged payload).
async function receiveHandoff() {
  const h = handoff.take(['text', 'image'])
  if (!h?.payload) return
  const p = h.payload
  const isImage = h.kind === 'image' || (p && typeof p.type === 'string' && /^image\//.test(p.type))
  if (isImage) { await receiveHandoffImage(p, h.name); return }

  // Text / markdown → open as a new document tab.
  let text = null
  let name = h.name || ''
  if (typeof p === 'string') {
    text = p
  } else if (p && typeof p.text === 'function') {
    try { text = await p.text() } catch { text = null }
    name = name || p.name || ''
  }
  if (text == null) return
  const title = (name ? name.replace(/\.\w+$/, '') : '') || 'untitled'
  loadFile(text, title)
  if (h.handle) fileHandles.set(activeId.value, h.handle) // .md opened via the file handler → Ctrl+S saves back
  startDismissed.value = true
  showToast(t('handoff.received'))
  nextTick(() => editorRef.value?.focus())
}

// An image was sent here from an image tool. Upload it through the configured host (same path as
// paste-to-upload) and insert ![](url); if upload is unavailable (backend off / no host), fall back
// to an inline data URL so it always lands. Appends to the current document.
async function receiveHandoffImage(blob, name) {
  if (!blob) return
  const alt = ((name || 'image').replace(/\.\w+$/, '').replace(/[\[\]]/g, '')) || 'image'
  let url = ''
  try {
    const { useImageUpload } = await import('../composables/useImageUpload')
    const file = blob instanceof File ? blob : new File([blob], name || 'image.png', { type: blob.type || 'image/png' })
    url = await useImageUpload().uploadImage(file)
  } catch {
    url = await new Promise((res) => {
      const r = new FileReader()
      r.onload = () => res(String(r.result || '')); r.onerror = () => res('')
      r.readAsDataURL(blob)
    })
  }
  if (!url) { showToast(t('upload.failed')); return }
  startDismissed.value = true
  const base = content.value && content.value.trim() ? content.value.replace(/\s*$/, '') + '\n\n' : ''
  updateContent(`${base}![${alt}](${url})\n`)
  showToast(t('handoff.received'))
  nextTick(() => editorRef.value?.focus())
}

function onKeydown(e) {
  const mod = isMac.value ? e.metaKey : e.ctrlKey
  // Ctrl+Space → continue writing (works on any platform; Ctrl, not Cmd).
  if (e.ctrlKey && (e.code === 'Space' || e.key === ' ') && settings.aiEnabled && settings.aiInlineComplete) {
    const el = editorRef.value
    if (el && document.activeElement === el) { e.preventDefault(); continueWriting(); return }
  }
  // Cmd/Ctrl+Shift+A → toggle AI panel.
  if (mod && e.shiftKey && (e.key === 'A' || e.key === 'a')) { e.preventDefault(); aiPanelOpen.value = !aiPanelOpen.value; return }
  // Accept ghost completion with Tab when one is pending.
  if (e.key === 'Tab' && ghost.value?.text && editorRef.value && document.activeElement === editorRef.value) {
    e.preventDefault(); ghost.value = null; return
  }
  if (mod && e.key === 's') { e.preventDefault(); saveActiveDoc() }
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
    searchOpen.value = false; exportOpen.value = false; ctxShow.value = false; aiMenuOpen.value = false; moreOpen.value = false
    // Esc dismisses the inline ghost-text suggestion (it was never inserted).
    aiComplete.clear()
    // Esc reverts a just-streamed ghost completion (remove the inserted text).
    if (ghost.value?.text && editorRef.value) {
      const el = editorRef.value
      const { pos, text } = ghost.value
      if (el.value.substr(pos, text.length) === text) {
        el.setRangeText('', pos, pos + text.length, 'start')
        updateContent(el.value)
      }
      ghost.value = null
    }
    if (ai.busy.value) ai.abort()
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
  // Pick up a text/markdown payload handed off from another module (e.g. an ASR transcript or a .md
  // the OS opened via the PWA file handler). Re-check on the 'tb-handoff' event for later arrivals.
  receiveHandoff()
  window.addEventListener('tb-handoff', receiveHandoff)
})
onUnmounted(() => {
  window.removeEventListener('resize', handleResize)
  document.removeEventListener('keydown', onKeydown)
  window.removeEventListener('tb-handoff', receiveHandoff)
})
</script>

<template>
  <div class="editor-page" :class="{ zen: zenMode }" @dragover="onDragOver" @dragleave="onDragLeave" @drop="onDrop">
    <h1 class="sr-only">{{ m.h1 }}</h1>

    <ClientOnly>
      <!-- Editor control row — ONE bar: doc tabs (left) + the high-frequency controls
           (view-seg · Export · AI) and a ⋯ overflow (right). Open / Find / Zen and the
           writing-theme picker + filename live in the overflow to keep the bar quiet. -->
      <div v-show="!zenMode" class="editor-controls">
        <div class="doc-tabs">
          <button v-for="d in docs" :key="d.id" class="doc-tab" :class="{ active: d.id === activeId }" @click="openDoc(d.id)">
            <span class="doc-tab-name">{{ d.name || 'untitled' }}</span>
            <span class="doc-tab-x" :title="t('doc.close')" @click.stop="closeDoc(d.id)">×</span>
          </button>
          <button class="doc-tab-new" :title="t('menu.new')" @click="handleNew">+</button>
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

        <!-- Writing theme — a primary control, kept inline (not in the overflow). -->
        <ThemePicker class="ec-theme" v-model="writingTheme" :preview-markdown="content" />

        <!-- AI: whole-document actions menu (hidden entirely until AI is configured) -->
        <div v-if="ai.ready.value" class="dd-wrap">
          <button class="ec-btn ec-ai" :class="{ on: aiMenuOpen }" @click="aiMenuOpen = !aiMenuOpen" :title="t('ai.menu')">
            <AiIcon :size="16" />
          </button>
          <Transition name="dd">
            <div v-if="aiMenuOpen" class="dd-menu ai-menu">
              <div class="dd-label">{{ t('ai.menu') }}</div>
              <button @click="aiPanelOpen = true; aiMenuOpen = false"><span class="ai-mi"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 4.3A1.5 1.5 0 0 1 4 2.8h8a1.5 1.5 0 0 1 1.5 1.5v4.4A1.5 1.5 0 0 1 12 10.2H6.5l-3 2.4v-2.4H4a1.5 1.5 0 0 1-1.5-1.5z"/></svg></span>{{ t('ai.openChat') }}<kbd>{{ modLabel }}⇧A</kbd></button>
              <div class="dd-sep"></div>
              <div class="dd-label">{{ t('ai.wholeDoc') }}</div>
              <button @click="runDocAi('polishDoc')"><span class="ai-mi"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M2.6 13.4l6.2-6.2"/><path d="M11 2.2l.6 1.7 1.7.6-1.7.6-.6 1.7-.6-1.7-1.7-.6 1.7-.6z"/></svg></span>{{ t('ai.doc.polish') }}</button>
              <button @click="runDocAi('summarize')"><span class="ai-mi"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><line x1="2.5" y1="5" x2="13.5" y2="5"/><line x1="2.5" y1="8" x2="13.5" y2="8"/><line x1="2.5" y1="11" x2="9.5" y2="11"/></svg></span>{{ t('ai.doc.summarize') }}</button>
              <button @click="runDocAi('outline')"><span class="ai-mi"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><circle cx="3.3" cy="4.5" r="0.8" fill="currentColor" stroke="none"/><line x1="6" y1="4.5" x2="13.5" y2="4.5"/><circle cx="3.3" cy="8" r="0.8" fill="currentColor" stroke="none"/><line x1="6" y1="8" x2="13.5" y2="8"/><circle cx="3.3" cy="11.5" r="0.8" fill="currentColor" stroke="none"/><line x1="6" y1="11.5" x2="13.5" y2="11.5"/></svg></span>{{ t('ai.doc.outline') }}</button>
              <button @click="runDocAi('title')"><span class="ai-mi"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M3.5 4h9M8 4v9"/></svg></span>{{ t('ai.doc.title') }}</button>
              <button @click="runDocAi('generate')"><span class="ai-mi"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M11.4 2.6l2 2L6 12l-3 1 1-3z"/></svg></span>{{ t('ai.doc.generate') }}</button>
              <template v-if="settings.aiEnabled && settings.aiInlineComplete">
                <div class="dd-sep"></div>
                <button @click="aiMenuOpen = false; continueWriting()"><span class="ai-mi"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><line x1="2.5" y1="8" x2="12" y2="8"/><polyline points="8.5 4.5 12.5 8 8.5 11.5"/></svg></span>{{ t('ai.continue') }}<kbd>Ctrl Space</kbd></button>
              </template>
            </div>
          </Transition>
        </div>

        <div class="dd-wrap">
          <button class="ec-btn ec-export" @click="exportOpen = !exportOpen" :title="t('export')">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M14 10v3.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 13.5V10"/><polyline points="5 7 8 10 11 7"/><line x1="8" y1="10" x2="8" y2="2"/></svg>
            <span class="ec-export-lbl">{{ t('export') }}</span>
          </button>
          <Transition name="dd">
            <div v-if="exportOpen" class="dd-menu">
              <div class="dd-theme">
                <span class="dd-theme-lbl">{{ t('settings.exportTheme') }}</span>
                <ThemePicker v-model="exportTheme" :preview-markdown="content" :allow-follow="true" :follow-label="t('settings.exportFollow')" />
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
              <button @click="doExport('copyImage')">{{ t('export.copyImage') }}</button>
            </div>
          </Transition>
        </div>

        <!-- ⋯ overflow: filename, Open, Find, writing theme, Zen — the lower-frequency actions. -->
        <div class="dd-wrap">
          <button class="ec-btn ec-more" :class="{ on: moreOpen }" @click="moreOpen = !moreOpen" :title="t('menu.more')">
            <svg viewBox="0 0 16 16" fill="currentColor" stroke="none"><circle cx="3.2" cy="8" r="1.3"/><circle cx="8" cy="8" r="1.3"/><circle cx="12.8" cy="8" r="1.3"/></svg>
          </button>
          <Transition name="dd">
            <div v-if="moreOpen" class="dd-menu more-menu">
              <div class="dd-label">{{ t('file.name') }}</div>
              <div class="dd-file">
                <input :value="filename" @input="updateFilename($event.target.value)" spellcheck="false" :placeholder="t('file.placeholder')">
                <span class="file-ext">.md</span>
              </div>
              <div class="dd-sep"></div>
              <button @click="moreOpen = false; openFilePicker()"><span class="ai-mi"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M2 13.5V4a1 1 0 0 1 1-1h3.6l1.4 2H13a1 1 0 0 1 1 1v7.5a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z"/></svg></span>{{ t('menu.open') }}</button>
              <button @click="moreOpen = false; searchOpen = true"><span class="ai-mi"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><circle cx="7" cy="7" r="4.5"/><line x1="10.2" y1="10.2" x2="14" y2="14"/></svg></span>{{ t('menu.find') }}<kbd>{{ modLabel }}F</kbd></button>
              <button @click="moreOpen = false; toggleZen()"><span class="ai-mi"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M2.5 5.5V3a.5.5 0 0 1 .5-.5h2.5M10.5 2.5H13a.5.5 0 0 1 .5.5v2.5M13.5 10.5V13a.5.5 0 0 1-.5.5h-2.5M5.5 13.5H3a.5.5 0 0 1-.5-.5v-2.5"/></svg></span>{{ t('menu.zen') }}<kbd>F11</kbd></button>
            </div>
          </Transition>
        </div>
      </div>

      <div v-if="exportOpen" class="click-away" @click="exportOpen = false"></div>
      <div v-if="aiMenuOpen" class="click-away" @click="aiMenuOpen = false"></div>
      <div v-if="moreOpen" class="click-away" @click="moreOpen = false"></div>

      <div class="editor-body">
        <MdToolbar v-show="!zenMode" @insert="insertMarkdown" @insert-line="insertLine" />
        <SearchBar v-if="searchOpen" :editor-ref="editorRef" :content="content" @update-content="updateContent" @close="searchOpen = false" />
        <Workspace :content="content" :view-mode="viewMode" :is-mobile="isMobile" :placeholder="t('editor.placeholder')" :ghost="inlineGhost" @update:content="updateContent" @editor-mounted="onEditorMounted" @accept-ghost="acceptInlineGhost" @import-file="importFile" />
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

      <EditorContextMenu :show="ctxShow" :x="ctxX" :y="ctxY" :ai-enabled="settings.aiEnabled" :editor-ref="editorRef" @apply="applyPlugin" @close="ctxShow = false" />

      <!-- Streaming progress chip for whole-document AI actions (selection actions show their own
           inline spinner inside the context menu / explain popup). -->
      <Transition name="fade">
        <div v-if="ai.busy.value && !ctxShow" class="ai-progress">
          <span class="ai-progress-spin"></span>
          <span>{{ t('ai.working') }}</span>
          <button @click="ai.abort()">{{ t('ai.stop') }}</button>
        </div>
      </Transition>

      <!-- Agentic AI chat panel -->
      <AiPanel v-model:open="aiPanelOpen" :editor-el="editorRef" :export-fn="doExport" @set-theme="onAiSetTheme" @open-settings="openAiSettings" />
    </ClientOnly>
  </div>
</template>

<style scoped>
.editor-page { position: relative; flex: 1; display: flex; flex-direction: column; min-height: 0; overflow: hidden; }
.editor-body { position: relative; flex: 1; display: flex; flex-direction: column; min-height: 0; }
.start-overlay { position: absolute; inset: 0; z-index: 30; background: var(--bg); display: flex; align-items: flex-start; justify-content: center; overflow-y: auto; }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }

/* Single merged chrome bar: doc tabs (left, scrollable) + controls (right). */
.editor-controls { display: flex; align-items: center; gap: 4px; padding: 6px 10px; border-bottom: 1px solid var(--border-light); flex-shrink: 0; flex-wrap: nowrap; }
.ec-spacer { flex: 1; min-width: 8px; }

/* Document tabs — now live inline in the bar as rounded pills. */
.doc-tabs { display: flex; align-items: center; gap: 2px; min-width: 0; overflow-x: auto; scrollbar-width: none; }
.doc-tabs::-webkit-scrollbar { display: none; }
.doc-tab { display: inline-flex; align-items: center; gap: 6px; max-width: 180px; padding: 6px 8px 6px 11px; border: 1px solid transparent; border-radius: 7px; background: transparent; color: var(--text-tertiary); font-size: 12px; font-family: var(--font-sans); cursor: pointer; white-space: nowrap; }
.doc-tab:hover { color: var(--text-secondary); background: var(--surface-hover); }
.doc-tab.active { color: var(--text); background: var(--surface-hover); }
.doc-tab-name { overflow: hidden; text-overflow: ellipsis; }
.doc-tab-x { display: inline-flex; align-items: center; justify-content: center; width: 15px; height: 15px; border-radius: 4px; font-size: 14px; line-height: 1; color: var(--text-tertiary); }
.doc-tab-x:hover { background: var(--surface-active); color: var(--text); }
.doc-tab-new { width: 26px; height: 26px; flex-shrink: 0; display: inline-flex; align-items: center; justify-content: center; border: none; background: transparent; color: var(--text-tertiary); font-size: 16px; cursor: pointer; border-radius: 6px; }
.doc-tab-new:hover { background: var(--surface-hover); color: var(--text); }

.ec-theme { flex-shrink: 0; }
.ec-theme :deep(.tp-trigger) { height: 30px; }
@media (max-width: 768px) { .ec-theme :deep(.tp-trigger-label) { display: none; } }
/* Filename + writing theme moved into the ⋯ overflow menu. */
.dd-file { display: flex; align-items: center; gap: 4px; padding: 2px 8px 6px; }
.dd-file input { flex: 1; min-width: 0; border: 1px solid var(--border-light); background: var(--surface-hover); font-size: 12px; font-family: var(--font-mono); color: var(--text); outline: none; padding: 6px 8px; border-radius: var(--radius-sm); transition: border-color 0.15s; }
.dd-file input:focus { border-color: var(--accent); }
.file-ext { font-size: 11px; color: var(--text-tertiary); font-family: var(--font-mono); flex-shrink: 0; }

.view-seg { display: flex; gap: 2px; background: var(--surface-hover); border-radius: 8px; padding: 3px; margin-right: 4px; }
.view-seg button { width: 26px; height: 24px; display: flex; align-items: center; justify-content: center; border: none; border-radius: 6px; background: transparent; color: var(--text-tertiary); cursor: pointer; transition: all 0.18s var(--ease-out); }
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
.more-menu { min-width: 230px; }
.more-menu .ai-mi { width: 17px; display: inline-flex; align-items: center; justify-content: center; margin-right: 8px; color: var(--text-secondary); }
.more-menu .ai-mi svg { width: 14px; height: 14px; }
@media (max-width: 768px) {
  .ec-export-lbl { display: none; }
  .ec-btn { width: 38px; height: 38px; }
  .view-seg button { width: 34px; height: 34px; }
  .doc-tab-x { width: 22px; height: 22px; font-size: 16px; }
  .doc-tab-new { width: 38px; height: 38px; }
  .doc-tab { padding-top: 8px; padding-bottom: 8px; }
  /* The controls row wraps on phones, so a button-anchored dropdown (relative to .dd-wrap) can open
     off-screen — to the left when the button wrapped to the left edge, or to the right when it sits
     at the right. Re-parent the menu to the full-width controls row (see the .dd-menu override
     below) so it's always pinned to the screen's right edge, whatever line the trigger wrapped onto. */
  .editor-controls { position: relative; }
  .dd-wrap { position: static; }
}
.dd-menu { position: absolute; top: calc(100% + 6px); right: 0; min-width: 200px; background: var(--surface); border: 1px solid var(--border-light); border-radius: 12px; box-shadow: var(--shadow-lg); padding: 6px; z-index: 200; }
/* Phone override (must follow the base rule to win the cascade): with .dd-wrap made static above,
   this anchors to .editor-controls and keeps the menu inside the viewport. */
@media (max-width: 768px) { .dd-menu { right: 10px; left: auto; width: 240px; max-width: calc(100vw - 20px); } }
.dd-menu button { display: flex; align-items: center; width: 100%; padding: 7px 10px; border: none; border-radius: 7px; background: transparent; color: var(--text); font-size: 13px; font-family: var(--font-sans); cursor: pointer; text-align: left; }
.dd-menu button:hover { background: var(--surface-hover); }
.dd-menu button kbd { margin-left: auto; font-size: 10px; color: var(--text-tertiary); background: var(--surface-hover); padding: 1px 5px; border-radius: 3px; }
.dd-label { font-size: 10px; font-weight: 600; color: var(--text-tertiary); text-transform: uppercase; letter-spacing: 0.5px; padding: 6px 10px 3px; }
.dd-sep { height: 1px; background: var(--border-light); margin: 4px 6px; }
.dd-enter-active { transition: all 0.22s var(--ease-out); }
.dd-leave-active { transition: all 0.12s ease; }
.dd-enter-from, .dd-leave-to { opacity: 0; transform: scale(0.95) translateY(-4px); }
.click-away { position: fixed; inset: 0; z-index: 90; }

.ec-ai.on { background: var(--surface-hover); color: var(--accent); }
.ec-ai:hover { color: var(--accent); }
.ai-menu { min-width: 220px; }
.ai-menu .ai-mi { width: 17px; display: inline-flex; align-items: center; justify-content: center; margin-right: 8px; color: var(--accent); }
.ai-menu .ai-mi svg { width: 14px; height: 14px; }
.ai-progress { position: fixed; bottom: 56px; left: 50%; transform: translateX(-50%); z-index: 300; display: flex; align-items: center; gap: 9px; padding: 8px 12px 8px 14px; background: var(--surface); border: 1px solid var(--border-light); border-radius: 11px; box-shadow: var(--shadow-lg); font-size: 12px; color: var(--text-secondary); }
.ai-progress-spin { width: 13px; height: 13px; border: 2px solid var(--border); border-top-color: var(--accent); border-radius: 50%; animation: aiSpin 0.7s linear infinite; }
.ai-progress button { padding: 4px 10px; border: 1px solid var(--border); border-radius: 7px; background: var(--surface); color: var(--text); font-size: 11px; cursor: pointer; font-family: var(--font-sans); }
.ai-progress button:hover { background: var(--surface-hover); }
@keyframes aiSpin { to { transform: rotate(360deg); } }

.drag-overlay { position: fixed; inset: 8px; z-index: 9999; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; background: var(--accent-bg); border: 2px dashed var(--accent); border-radius: 16px; font-size: 14px; font-weight: 500; color: var(--accent); backdrop-filter: blur(8px); pointer-events: none; }
.drag-overlay svg { width: 32px; height: 32px; opacity: 0.7; }
.fade-enter-active { transition: opacity 0.2s; }
.fade-leave-active { transition: opacity 0.15s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }

.zen .editor-controls { display: none; }
@media print { .editor-controls, .click-away { display: none !important; } }
</style>
