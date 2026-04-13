<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { useTheme } from './composables/useTheme'
import { useEditor } from './composables/useEditor'
import { useToast } from './composables/useToast'
import { useI18n } from './composables/useI18n'
import { load, save } from './utils/storage'
import MdToolbar from './components/MdToolbar.vue'
import SearchBar from './components/SearchBar.vue'
import Workspace from './components/Workspace.vue'
import StatusBar from './components/StatusBar.vue'
import TxtCreator from './components/TxtCreator.vue'
import PdfTools from './components/PdfTools.vue'
import ImageTools from './components/ImageTools.vue'
import ToastNotification from './components/ToastNotification.vue'
import WelcomeDialog from './components/WelcomeDialog.vue'

const { theme, toggleTheme } = useTheme()
const { content, filename, dirty, stats, updateContent, updateFilename, saveNow, newDocument, loadFile } = useEditor()
const { toastMessage, toastVisible, showToast } = useToast()
const { locale, t, toggleLocale } = useI18n()

// Active tab — mobile defaults to TXT for simplicity
const isMobileInit = window.innerWidth <= 768
const activeTab = ref(load('tab', isMobileInit ? 'txt' : 'markdown'))
const tabs = [
  { id: 'markdown', icon: 'edit' },
  { id: 'txt', icon: 'file' },
  { id: 'pdf', icon: 'pdf' },
  { id: 'image', icon: 'image' },
]
function setTab(id) { activeTab.value = id; save('tab', id) }

// Layout
const isMobile = ref(window.innerWidth <= 768)
const viewMode = ref(load('view', isMobile.value ? 'editor' : 'split'))
function setViewMode(m) { viewMode.value = m; save('view', m) }

// Editor ref
const editorRef = ref(null)

// Search
const searchOpen = ref(false)

// Zen
const zenMode = ref(false)
function toggleZen() {
  zenMode.value = !zenMode.value
  if (zenMode.value) { document.documentElement.requestFullscreen?.().catch(() => {}); showToast(t('toast.zenHint')) }
  else if (document.fullscreenElement) document.exitFullscreen?.()
}

// Dropdowns
const exportOpen = ref(false)
const menuOpen = ref(false)
function closeDD() { exportOpen.value = false; menuOpen.value = false }

// File import
function openFilePicker() {
  closeDD()
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = '.txt,.md,.markdown,.html,.htm,.pdf'
  input.onchange = e => { if (e.target.files[0]) importFile(e.target.files[0]) }
  input.click()
}

async function importFile(file) {
  if (/\.pdf$/i.test(file.name)) {
    setTab('markdown')
    await importPDF(file)
  } else {
    setTab('markdown')
    const reader = new FileReader()
    reader.onload = () => { loadFile(reader.result, file.name.replace(/\.\w+$/, '')); showToast(`${t('toast.loaded')} ${file.name}`) }
    reader.readAsText(file)
  }
}

async function importPDF(file) {
  showToast(`${t('pdf.extracting')} ${file.name}...`)
  try {
    await loadScriptUtil('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js')
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'
    const pdf = await window.pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise
    let text = ''
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i)
      const c = await page.getTextContent()
      text += c.items.map(x => x.str).join(' ') + '\n\n'
    }
    loadFile(text.trim(), file.name.replace('.pdf', ''))
    showToast(`${pdf.numPages} ${t('toast.pdfExtracted')}`)
  } catch (e) { console.error(e); showToast(t('toast.pdfFailed')) }
}

async function loadScriptUtil(url) {
  const { loadScript } = await import('./utils/loadScript')
  return loadScript(url)
}

// Drag & drop
const dragging = ref(false)
function onDragOver(e) { e.preventDefault(); dragging.value = true }
function onDragLeave(e) { if (!e.relatedTarget) dragging.value = false }
function onDrop(e) {
  e.preventDefault(); dragging.value = false
  const file = e.dataTransfer?.files?.[0]
  if (file) {
    if (file.type?.startsWith('image/')) { setTab('image') }
    else importFile(file)
  }
}

// Export
async function doExport(fmt) {
  closeDD()
  const { exportTXT, exportMD, exportHTML, exportPDF, exportPNG, copyHTML, copyMarkdown } = await import('./utils/export')
  const fn = filename.value || 'untitled'
  try {
    let result
    switch (fmt) {
      case 'txt': result = exportTXT(content.value, fn); break
      case 'md': result = exportMD(content.value, fn); break
      case 'html': result = exportHTML(content.value, fn); break
      case 'pdf': showToast(t('toast.genPdf')); result = await exportPDF(content.value, fn); break
      case 'png': showToast(t('toast.genImg')); result = await exportPNG(content.value, fn, theme.value === 'dark'); break
      case 'copyHtml': result = await copyHTML(content.value); break
      case 'copyMd': result = await copyMarkdown(content.value); break
    }
    if (result) {
      const msg = result.params ? `${t(result.key)} ${result.params.name || ''}`.trim() : t(result.key)
      showToast(msg)
    }
  } catch (e) { console.error(e); showToast(t('toast.exportFailed')) }
}

// Toolbar
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

// Keyboard
const isMac = navigator.platform.includes('Mac')
const modLabel = isMac ? '⌘' : 'Ctrl+'
function onKeydown(e) {
  const m = isMac ? e.metaKey : e.ctrlKey
  if (activeTab.value !== 'markdown') return
  if (m && e.key === 's') { e.preventDefault(); doExport('md') }
  if (m && e.key === 'b') { e.preventDefault(); insertMarkdown('**', '**', 'bold') }
  if (m && e.key === 'i') { e.preventDefault(); insertMarkdown('*', '*', 'italic') }
  if (m && e.key === 'k') { e.preventDefault(); insertMarkdown('[', '](url)', 'text') }
  if (m && e.key === 'e') { e.preventDefault(); insertMarkdown('`', '`', 'code') }
  if (m && e.key === 'f') { e.preventDefault(); searchOpen.value = !searchOpen.value }
  if (m && e.shiftKey && e.key === 'N') { e.preventDefault(); handleNew() }
  if (m && e.key === 'p') {
    e.preventDefault()
    const modes = isMobile.value ? ['editor', 'preview'] : ['editor', 'split', 'preview']
    setViewMode(modes[(modes.indexOf(viewMode.value) + 1) % modes.length])
  }
  if (e.key === 'Escape') { searchOpen.value = false; closeDD(); if (zenMode.value) { zenMode.value = false; document.fullscreenElement && document.exitFullscreen?.() } }
  if (e.key === 'F11') { e.preventDefault(); toggleZen() }
}

function handleClearAll() {
  closeDD()
  if (!confirm(t('menu.clearAllConfirm'))) return
  // Clear all localStorage data
  const keys = []
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    if (k && k.startsWith('tb-')) keys.push(k)
  }
  keys.forEach(k => localStorage.removeItem(k))
  // Reset state
  newDocument()
  activeTab.value = isMobile.value ? 'txt' : 'markdown'
  viewMode.value = isMobile.value ? 'editor' : 'split'
  showToast(t('menu.clearAllDone'))
}

function handleNew() {
  closeDD()
  if (content.value && !confirm(t('toast.startFresh'))) return
  newDocument(); showToast(t('toast.newDoc'))
}

function handleResize() { isMobile.value = window.innerWidth <= 768 }

onMounted(() => {
  document.addEventListener('keydown', onKeydown)
  window.addEventListener('resize', handleResize)
  document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement) zenMode.value = false })
})
onUnmounted(() => {
  document.removeEventListener('keydown', onKeydown)
  window.removeEventListener('resize', handleResize)
})
</script>

<template>
  <div id="app-shell" :class="{ zen: zenMode }" @dragover="onDragOver" @dragleave="onDragLeave" @drop="onDrop">

    <!-- ===== Top Bar ===== -->
    <header v-show="!zenMode" class="topbar">
      <!-- Logo (B&W, animates with theme) -->
      <div class="topbar-logo">
        <svg class="logo-svg" viewBox="0 0 32 32">
          <rect width="32" height="32" rx="8" class="logo-bg"/>
          <path d="M9.5 11h13M16 11v12" class="logo-t" stroke-width="2.8" stroke-linecap="round" fill="none"/>
        </svg>
        <span v-if="!isMobile" class="logo-name">TypeBox</span>
      </div>

      <!-- Tool Tabs -->
      <nav class="tool-tabs">
        <button v-for="tb in tabs" :key="tb.id" :class="{ active: activeTab === tb.id }" @click="setTab(tb.id)" :title="t('tab.' + tb.id)">
          <!-- Edit icon -->
          <svg v-if="tb.icon==='edit'" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M11.5 1.5l3 3L5 14H2v-3z"/></svg>
          <!-- File icon -->
          <svg v-if="tb.icon==='file'" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M4 1.5h5l4 4V14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V2.5a1 1 0 0 1 1-1z"/><path d="M9 1.5V6h4.5"/></svg>
          <!-- PDF icon -->
          <svg v-if="tb.icon==='pdf'" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="2.5" y="1" width="11" height="14" rx="1.5"/><path d="M5.5 6h2a1 1 0 0 1 0 2h-2m0-2v5"/></svg>
          <!-- Image icon -->
          <svg v-if="tb.icon==='image'" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><rect x="1.5" y="2.5" width="13" height="11" rx="1.5"/><circle cx="5" cy="6" r="1.2"/><path d="M14.5 11l-4-3.5-3 2.5-2-1.5L1.5 11.5"/></svg>
          <span class="tab-text">{{ t('tab.' + tb.id) }}</span>
        </button>
      </nav>

      <div class="topbar-spacer"></div>

      <!-- Markdown-specific controls -->
      <template v-if="activeTab === 'markdown'">
        <!-- Filename -->
        <div class="topbar-file">
          <input :value="filename" @input="updateFilename($event.target.value)" spellcheck="false" :placeholder="t('file.placeholder')">
          <span class="file-ext">.md</span>
        </div>

        <!-- View toggle -->
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

        <!-- Export -->
        <div class="dd-wrap">
          <button class="topbar-btn" @click="exportOpen = !exportOpen; menuOpen = false" :title="t('export')">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M14 10v3.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 13.5V10"/><polyline points="5 7 8 10 11 7"/><line x1="8" y1="10" x2="8" y2="2"/></svg>
          </button>
          <Transition name="dd">
            <div v-if="exportOpen" class="dd-menu">
              <div class="dd-label">{{ t('export.download') }}</div>
              <button @click="doExport('txt')"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M4 1.5h5l4 4V14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V2.5a1 1 0 0 1 1-1z"/><path d="M9 1.5V6h4.5"/></svg>{{ t('export.txt') }}</button>
              <button @click="doExport('md')"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="1" y="2.5" width="14" height="11" rx="1.5"/><path d="M4 10V6l2 2.5L8 6v4M10.5 8.5L12.5 6v4"/></svg>{{ t('export.md') }}<kbd>{{ modLabel }}S</kbd></button>
              <button @click="doExport('html')"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><polyline points="4.5 4.5 1.5 8 4.5 11.5"/><polyline points="11.5 4.5 14.5 8 11.5 11.5"/><line x1="9.5" y1="3" x2="6.5" y2="13"/></svg>{{ t('export.html') }}</button>
              <div class="dd-sep"></div>
              <div class="dd-label">{{ t('export.section') }}</div>
              <button @click="doExport('pdf')"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="2.5" y="1" width="11" height="14" rx="1.5"/><path d="M5.5 6h2a1 1 0 0 1 0 2h-2m0-2v5"/></svg>{{ t('export.pdf') }}</button>
              <button @click="doExport('png')"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="1.5" y="2.5" width="13" height="11" rx="1.5"/><circle cx="5" cy="6" r="1.2"/><path d="M14.5 11l-4-3.5-3 2.5-2-1.5L1.5 11.5"/></svg>{{ t('export.png') }}</button>
              <div class="dd-sep"></div>
              <div class="dd-label">{{ t('export.clipboard') }}</div>
              <button @click="doExport('copyHtml')"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="5" y="5" width="9" height="9" rx="1"/><path d="M3.5 11H3a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1h7a1 1 0 0 1 1 1v.5"/></svg>{{ t('export.copyHtml') }}</button>
              <button @click="doExport('copyMd')"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="5" y="5" width="9" height="9" rx="1"/><path d="M3.5 11H3a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1h7a1 1 0 0 1 1 1v.5"/></svg>{{ t('export.copyMd') }}</button>
            </div>
          </Transition>
        </div>
      </template>

      <!-- Language toggle -->
      <button class="topbar-btn lang-btn" @click="toggleLocale" :title="locale === 'zh' ? 'Switch to English' : '切换到中文'">
        <span>{{ locale === 'zh' ? 'EN' : '中' }}</span>
      </button>

      <!-- Theme -->
      <button class="topbar-btn" @click="toggleTheme" title="Toggle theme">
        <svg v-if="theme==='light'" class="theme-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round">
          <circle cx="8" cy="8" r="3.2"/><line x1="8" y1="1" x2="8" y2="2.5"/><line x1="8" y1="13.5" x2="8" y2="15"/>
          <line x1="2.9" y1="2.9" x2="4" y2="4"/><line x1="12" y1="12" x2="13.1" y2="13.1"/>
          <line x1="1" y1="8" x2="2.5" y2="8"/><line x1="13.5" y1="8" x2="15" y2="8"/>
          <line x1="2.9" y1="13.1" x2="4" y2="12"/><line x1="12" y1="4" x2="13.1" y2="2.9"/>
        </svg>
        <svg v-else class="theme-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round">
          <path d="M14 10.2A6.5 6.5 0 1 1 5.8 2a5 5 0 0 0 8.2 8.2z"/>
        </svg>
      </button>

      <!-- Menu -->
      <div class="dd-wrap">
        <button class="topbar-btn" @click="menuOpen = !menuOpen; exportOpen = false" title="Menu">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round">
            <line x1="2" y1="4" x2="14" y2="4"/><line x1="2" y1="8" x2="14" y2="8"/><line x1="2" y1="12" x2="14" y2="12"/>
          </svg>
        </button>
        <Transition name="dd">
          <div v-if="menuOpen" class="dd-menu">
            <button @click="handleNew()"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M4 1.5h5l4 4V14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V2.5a1 1 0 0 1 1-1z"/><line x1="8" y1="7" x2="8" y2="12"/><line x1="5.5" y1="9.5" x2="10.5" y2="9.5"/></svg>{{ t('menu.new') }} <kbd>{{ modLabel }}⇧N</kbd></button>
            <button @click="openFilePicker()"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M2 13.5V4a1 1 0 0 1 1-1h3.6l1.4 2H13a1 1 0 0 1 1 1v7.5a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z"/></svg>{{ t('menu.open') }} <span class="dd-hint">{{ t('menu.openHint') }}</span></button>
            <div class="dd-sep"></div>
            <button @click="closeDD(); searchOpen = !searchOpen"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><circle cx="7" cy="7" r="4.5"/><line x1="10.2" y1="10.2" x2="14" y2="14"/></svg>{{ t('menu.find') }} <kbd>{{ modLabel }}F</kbd></button>
            <button @click="closeDD(); toggleZen()"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M2.5 5.5V3a.5.5 0 0 1 .5-.5h2.5M10.5 2.5H13a.5.5 0 0 1 .5.5v2.5M13.5 10.5V13a.5.5 0 0 1-.5.5h-2.5M5.5 13.5H3a.5.5 0 0 1-.5-.5v-2.5"/></svg>{{ t('menu.zen') }} <kbd>F11</kbd></button>
            <button @click="closeDD(); window.print()"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="3" y="8.5" width="10" height="5" rx="1"/><path d="M4 8.5V3.5a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v5"/></svg>{{ t('menu.print') }}</button>
            <div class="dd-sep"></div>
            <button class="dd-danger" @click="handleClearAll()"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><polyline points="3 4 4 4 13 4"/><path d="M5.5 4V3a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1"/><path d="M12 4v9a1.5 1.5 0 0 1-1.5 1.5h-5A1.5 1.5 0 0 1 4 13V4"/><line x1="7" y1="7" x2="7" y2="12"/><line x1="9" y1="7" x2="9" y2="12"/></svg>{{ t('menu.clearAll') }}</button>
            <div class="dd-sep"></div>
            <div class="dd-about">
              <strong>{{ t('menu.about.title') }}</strong> — {{ t('menu.about.desc') }}<br>
              {{ t('menu.about.privacy') }}<br>
              <a href="https://github.com/jmr/typebox" target="_blank" rel="noopener">
                <svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z"/></svg>
                GitHub
              </a>
            </div>
          </div>
        </Transition>
      </div>
    </header>

    <!-- Click-away -->
    <div v-if="exportOpen || menuOpen" class="click-away" @click="closeDD"></div>

    <!-- ===== Markdown Tab ===== -->
    <template v-if="activeTab === 'markdown'">
      <MdToolbar v-show="!zenMode" @insert="insertMarkdown" @insert-line="insertLine" />
      <SearchBar v-if="searchOpen" :editor-ref="editorRef" :content="content" @update-content="updateContent" @close="searchOpen = false" />
      <Workspace :content="content" :view-mode="viewMode" :is-mobile="isMobile" :placeholder="t('editor.placeholder')" @update:content="updateContent" @editor-mounted="el => editorRef = el" />
      <StatusBar v-show="!zenMode" :stats="stats" :dirty="dirty" :t="t" />
    </template>

    <!-- ===== TXT Tab ===== -->
    <TxtCreator v-else-if="activeTab === 'txt'" :t="t" />

    <!-- ===== PDF Tab ===== -->
    <PdfTools v-else-if="activeTab === 'pdf'" :t="t" @send-to-editor="(md, name) => { loadFile(md, name); setTab('markdown'); showToast('Loaded into editor') }" />

    <!-- ===== Image Tab ===== -->
    <ImageTools v-else-if="activeTab === 'image'" :t="t" />

    <!-- Welcome dialog (first visit) -->
    <WelcomeDialog @set-locale="l => { const { setLocale } = useI18n(); setLocale(l) }" />

    <!-- Toast -->
    <ToastNotification :message="toastMessage" :visible="toastVisible" />

    <!-- Drag overlay -->
    <Transition name="fade">
      <div v-if="dragging" class="drag-overlay">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
        <span>{{ t('drag.hint') }}</span>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
#app-shell {
  display: flex;
  flex-direction: column;
  height: 100dvh;
  overflow: hidden;
}

/* ===== Top Bar ===== */
.topbar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  background: var(--bar-bg);
  backdrop-filter: saturate(180%) blur(20px);
  -webkit-backdrop-filter: saturate(180%) blur(20px);
  border-bottom: 1px solid var(--border-light);
  z-index: 100;
  flex-shrink: 0;
  height: 46px;
}

/* Logo — B&W, syncs with theme */
.topbar-logo { display: flex; align-items: center; gap: 7px; flex-shrink: 0; }
.logo-svg { width: 26px; height: 26px; }

.logo-bg {
  fill: var(--text);
  transition: fill 0.5s cubic-bezier(0.16, 1, 0.3, 1);
}

.logo-t {
  stroke: var(--bg);
  transition: stroke 0.5s cubic-bezier(0.16, 1, 0.3, 1);
}

.logo-name {
  font-weight: 750; font-size: 14px; letter-spacing: -0.4px;
}

/* Tool Tabs */
.tool-tabs {
  display: flex; gap: 1px;
  background: var(--surface-hover);
  border-radius: 8px; padding: 3px; flex-shrink: 0;
}

.tool-tabs button {
  display: flex; align-items: center; gap: 4px;
  padding: 4px 10px; border: none; border-radius: 6px;
  background: transparent; color: var(--text-tertiary);
  font-size: 12px; font-weight: 500; cursor: pointer;
  transition: all 0.22s cubic-bezier(0.16, 1, 0.3, 1);
  font-family: var(--font-sans); white-space: nowrap;
}

.tool-tabs button:hover { color: var(--text-secondary); }
.tool-tabs button.active { background: var(--surface); color: var(--text); box-shadow: var(--shadow-xs); }
.tool-tabs button svg { width: 13px; height: 13px; }

.topbar-spacer { flex: 1; }

/* Filename */
.topbar-file { display: flex; align-items: center; margin-right: 4px; }
.topbar-file input {
  border: none; background: transparent;
  font-size: 12px; font-family: var(--font-mono);
  color: var(--text-secondary); outline: none;
  width: 80px; padding: 3px 6px; border-radius: 4px;
  transition: all 0.15s;
}
.topbar-file input:hover { background: var(--surface-hover); }
.topbar-file input:focus { background: var(--surface-hover); color: var(--text); width: 120px; }
.file-ext { font-size: 11px; color: var(--text-tertiary); font-family: var(--font-mono); }

/* View segment */
.view-seg {
  display: flex; gap: 1px; background: var(--surface-hover);
  border-radius: 6px; padding: 2px;
}
.view-seg button {
  width: 26px; height: 24px;
  display: flex; align-items: center; justify-content: center;
  border: none; border-radius: 4px;
  background: transparent; color: var(--text-tertiary);
  cursor: pointer; transition: all 0.18s var(--ease-out);
}
.view-seg button:hover { color: var(--text-secondary); }
.view-seg button.on { background: var(--surface); color: var(--text); box-shadow: var(--shadow-xs); }
.view-seg button svg { width: 13px; height: 13px; }

/* Top bar buttons */
.topbar-btn {
  width: 30px; height: 30px;
  display: flex; align-items: center; justify-content: center;
  border: none; border-radius: 6px; background: transparent;
  color: var(--text-secondary); cursor: pointer; transition: all 0.15s;
}
.topbar-btn:hover { background: var(--surface-hover); color: var(--text); }
.topbar-btn:active { transform: scale(0.88); }
.topbar-btn svg { width: 15px; height: 15px; }

/* Theme icon animation */
.theme-icon {
  transition: transform 0.5s cubic-bezier(0.16, 1, 0.3, 1);
}
.topbar-btn:active .theme-icon { transform: rotate(180deg); }

/* Language toggle */
.lang-btn span {
  font-size: 11px; font-weight: 700; letter-spacing: -0.3px;
}

/* ===== Dropdown ===== */
.dd-wrap { position: relative; }
.dd-menu {
  position: absolute; top: calc(100% + 6px); right: 0;
  min-width: 220px; max-height: 80vh; overflow-y: auto;
  background: var(--surface); border: 1px solid var(--border-light);
  border-radius: 12px; box-shadow: var(--shadow-lg);
  padding: 6px; z-index: 200;
}
.dd-menu button {
  display: flex; align-items: center; gap: 9px;
  width: 100%; padding: 7px 10px; border: none; border-radius: 7px;
  background: transparent; color: var(--text);
  font-size: 13px; font-family: var(--font-sans);
  cursor: pointer; text-align: left; transition: background 0.1s; line-height: 1.3;
}
.dd-menu button:hover { background: var(--surface-hover); }
.dd-menu button:active { background: var(--surface-active); }
.dd-menu button.dd-danger { color: #ff453a; }
.dd-menu button.dd-danger:hover { background: rgba(255,69,58,0.08); }
.dd-menu button.dd-danger svg { color: #ff453a; }
.dd-menu button svg { width: 15px; height: 15px; flex-shrink: 0; color: var(--text-secondary); }
.dd-menu button kbd {
  margin-left: auto; font-size: 10px; color: var(--text-tertiary);
  font-family: var(--font-sans); background: var(--surface-hover);
  padding: 1px 5px; border-radius: 3px;
}
.dd-label { font-size: 10px; font-weight: 600; color: var(--text-tertiary); text-transform: uppercase; letter-spacing: 0.5px; padding: 6px 10px 3px; }
.dd-sep { height: 1px; background: var(--border-light); margin: 4px 6px; }
.dd-hint { margin-left: auto; font-size: 10px; color: var(--text-tertiary); }
.dd-about { padding: 10px; font-size: 11px; color: var(--text-tertiary); line-height: 1.6; }
.dd-about strong { color: var(--text-secondary); font-weight: 600; }
.dd-about a { display: inline-flex; align-items: center; gap: 4px; color: var(--accent); text-decoration: none; margin-top: 4px; }
.dd-about a:hover { text-decoration: underline; }
.dd-about a svg { width: 12px; height: 12px; }

.dd-enter-active { transition: all 0.22s cubic-bezier(0.16, 1, 0.3, 1); }
.dd-leave-active { transition: all 0.12s ease; }
.dd-enter-from, .dd-leave-to { opacity: 0; transform: scale(0.95) translateY(-4px); }

.click-away { position: fixed; inset: 0; z-index: 90; }

/* ===== Drag Overlay ===== */
.drag-overlay {
  position: fixed; inset: 8px; z-index: 9999;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px;
  background: var(--accent-bg); border: 2px dashed var(--accent); border-radius: 16px;
  font-size: 14px; font-weight: 500; color: var(--accent);
  backdrop-filter: blur(8px); pointer-events: none;
}
.drag-overlay svg { width: 32px; height: 32px; opacity: 0.7; }

.fade-enter-active { transition: opacity 0.2s; }
.fade-leave-active { transition: opacity 0.15s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }

/* Zen */
.zen .topbar, .zen :deep(.md-toolbar), .zen :deep(.status-bar) { display: none; }

/* Responsive */
@media (max-width: 768px) {
  .topbar { padding: 4px 6px; height: 42px; gap: 3px; }
  .topbar-file input { width: 60px; font-size: 11px; }
  .topbar-file input:focus { width: 80px; }
  .topbar-btn { width: 28px; height: 28px; }
  .topbar-btn svg { width: 14px; height: 14px; }
  .view-seg button { width: 24px; height: 22px; }
  .view-seg button svg { width: 11px; height: 11px; }
  .tab-text { display: none; }
  .tool-tabs button { padding: 5px 8px; }
  .tool-tabs button svg { width: 14px; height: 14px; }
}

@media (max-width: 420px) {
  .logo-name { display: none; }
  .file-ext { display: none; }
}

@media print { .topbar, .click-away { display: none !important; } }
</style>
