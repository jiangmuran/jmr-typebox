<script setup>
import { ref, watch, onMounted, onUnmounted, nextTick, computed } from 'vue'
import { renderMarkdown } from '../utils/markdown'
import { renderMermaidIn, prerenderMermaid, hasMermaid } from '../utils/mermaid'
import { useSettings } from '../composables/useSettings'
import { useTheme } from '../composables/useTheme'
import { useI18n } from '../composables/useI18n'
import { useToast } from '../composables/useToast'
import { useImageUpload, ImageUploadError } from '../composables/useImageUpload'
import { buildThemedHtml } from '../themes/registry'
import GhostOverlay from './GhostOverlay.vue'
import '../styles/markdown.css'

const props = defineProps({
  content: String,
  viewMode: String,
  isMobile: Boolean,
  placeholder: { type: String, default: 'Start writing Markdown here...' },
  // Active inline AI suggestion to render as ghost text: { pos, text } or null.
  ghost: { type: Object, default: null },
})

const emit = defineEmits(['update:content', 'editor-mounted', 'accept-ghost', 'import-file'])

const editorEl = ref(null)
const previewEl = ref(null)
const previewHTML = ref('')
let renderTimer = null

// On mobile, split view would squish two panes into a narrow screen — collapse to a single
// pane (editor) reactively so the layout is never broken regardless of the stored view.
const effectiveView = computed(() => (props.isMobile && props.viewMode === 'split') ? 'editor' : props.viewMode)

const { t } = useI18n()
const { showToast } = useToast()
const { uploadImage } = useImageUpload()
const { theme } = useTheme()
const isDark = computed(() => theme.value === 'dark')

// Writing theme: when a real Typora theme is chosen, render the preview in an isolated
// iframe so the theme CSS applies faithfully. 'default' keeps the fast app preview.
const { settings } = useSettings()
const themed = computed(() => !!settings.writingTheme && settings.writingTheme !== 'default')
const frameHtml = ref('')
let frameTimer = null
function scheduleFrame() {
  clearTimeout(frameTimer)
  frameTimer = setTimeout(async () => {
    try {
      // Diagrams must be inline SVG inside the iframe (no client JS runs there), so
      // pre-render mermaid to SVG before building the themed doc. KaTeX CSS is added
      // by buildThemedHtml so math styles too.
      let body = renderMarkdown(props.content)
      body = await prerenderMermaid(body, isDark.value)
      frameHtml.value = await buildThemedHtml(body, settings.writingTheme)
    } catch { /* ignore */ }
  }, props.isMobile ? 200 : 100)
}
watch([() => props.content, () => settings.writingTheme, isDark], () => { if (themed.value) scheduleFrame() }, { immediate: true })

// Render mermaid diagrams in the live `.markdown-body` preview after the v-html
// updates. Lazy + idempotent (see utils/mermaid). Re-runs on theme change so dark
// mode restyles diagrams; the helper skips nodes already drawn for the active theme.
async function runMermaid() {
  if (themed.value) return // themed path pre-renders SVG itself
  await nextTick()
  const el = previewEl.value
  if (el && hasMermaid(previewHTML.value)) {
    try { await renderMermaidIn(el, isDark.value) } catch { /* inline error box handled in helper */ }
  }
}

function scheduleRender() {
  clearTimeout(renderTimer)
  const delay = props.isMobile ? 150 : 60
  renderTimer = setTimeout(() => {
    previewHTML.value = renderMarkdown(props.content)
    runMermaid()
  }, delay)
}

watch(() => props.content, scheduleRender, { immediate: true })
// Theme toggle: re-render diagrams in the default preview to restyle them.
watch(isDark, () => { runMermaid() })

function onInput(e) {
  emit('update:content', e.target.value)
}

function onTab(e) {
  if (e.key === 'Tab') {
    // When an inline AI ghost is showing, Tab accepts it instead of indenting.
    if (props.ghost?.text) {
      e.preventDefault()
      emit('accept-ghost')
      return
    }
    e.preventDefault()
    const el = e.target
    const start = el.selectionStart
    const end = el.selectionEnd
    el.setRangeText('  ', start, end, 'end')
    emit('update:content', el.value)
  }
}

// ── Image host (图床): paste / drop an image → upload → insert ![name](url) ──────────────
// Each in-flight upload owns a UNIQUE placeholder in the text so we can replace exactly it
// (by string match) even while the user keeps typing and offsets shift. The visible label
// reflects live progress; the sentinel URL keeps it findable and never collides with real text.
let uploadSeq = 0
const uploads = ref([]) // [{ id, name, progress }] — drives the progress bar overlay

function placeholderFor(id, progress) {
  const pct = Math.round((progress || 0) * 100)
  return `![${t('upload.placeholder')} ${pct}%](typebox-uploading:${id})`
}
// The marker is the same regardless of percentage — used to find/replace the placeholder.
function markerFor(id) { return `](typebox-uploading:${id})` }

// Replace the full placeholder token for `id` with `replacement` in the current content and
// emit the update. Matches on the unique sentinel URL, so caret/length drift is irrelevant.
function replacePlaceholder(id, replacement) {
  const text = props.content || ''
  const marker = markerFor(id)
  const close = text.indexOf(marker)
  if (close === -1) return // user deleted it — nothing to do
  const open = text.lastIndexOf('![', close)
  if (open === -1) return
  const end = close + marker.length
  const next = text.slice(0, open) + replacement + text.slice(end)
  emit('update:content', next)
}

function setUploadProgress(id, progress) {
  const u = uploads.value.find(x => x.id === id)
  if (u) u.progress = progress
  // Reflect the live percentage in the placeholder text too (cheap; debounced by browser paint).
  replacePlaceholder(id, placeholderFor(id, progress))
}

// Insert an initial placeholder at the caret (or end) and return its id.
function insertPlaceholder(id) {
  const el = editorEl.value
  const ph = placeholderFor(id, 0)
  if (el && typeof el.selectionStart === 'number') {
    const start = el.selectionStart
    const end = el.selectionEnd
    el.setRangeText(ph + '\n', start, end, 'end')
    emit('update:content', el.value)
  } else {
    const text = props.content || ''
    emit('update:content', text + (text && !text.endsWith('\n') ? '\n' : '') + ph + '\n')
  }
}

function baseName(file) {
  const n = (file && file.name) || 'image'
  return n.replace(/\.[^./\\]+$/, '') || 'image'
}

// Upload one file end-to-end: placeholder → progress → replace with markdown image (or remove
// the placeholder + toast on failure). Resolves when settled so callers can run sequentially.
async function uploadOne(file) {
  const id = ++uploadSeq
  insertPlaceholder(id)
  uploads.value.push({ id, name: baseName(file), progress: 0 })
  showToast(t('upload.uploading'))
  try {
    const url = await uploadImage(file, { onProgress: p => setUploadProgress(id, p) })
    const alt = baseName(file).replace(/[\[\]]/g, '')
    replacePlaceholder(id, `![${alt}](${url})`)
    showToast(t('upload.done'))
  } catch (e) {
    replacePlaceholder(id, '') // pull the placeholder back out
    if (e instanceof ImageUploadError && e.code === 'size') showToast(t('upload.tooBig'))
    else if (e instanceof ImageUploadError && e.code === 'type') showToast(t('upload.notImage'))
    else if (e instanceof ImageUploadError && e.code === 'backend') showToast(t('upload.backendOff'))
    else showToast(t('upload.failed'))
  } finally {
    uploads.value = uploads.value.filter(x => x.id !== id)
  }
}

// Run uploads one after another so the placeholders stay ordered and we don't hammer the host.
async function uploadFiles(files) {
  for (const f of files) {
    // eslint-disable-next-line no-await-in-loop
    await uploadOne(f)
  }
}

function imageFilesFrom(list) {
  const out = []
  for (const f of list || []) {
    if (f && f.type && f.type.startsWith('image/')) out.push(f)
  }
  return out
}

// First markdown/text FILE in a clipboard/drop list (e.g. a .md copied from the file manager).
function textFileFrom(list) {
  for (const f of list || []) {
    const name = ((f && f.name) || '').toLowerCase()
    if (f && (/^text\//.test(f.type || '') || /\.(md|markdown|mdown|mkd|mdx|txt)$/.test(name))) return f
  }
  return null
}

function onPaste(e) {
  const dt = e.clipboardData
  if (!dt) return
  // Prefer items (covers screenshot paste where there's no File name); fall back to files.
  let files = []
  if (dt.items && dt.items.length) {
    for (const it of dt.items) {
      if (it.kind === 'file' && it.type && it.type.startsWith('image/')) {
        const f = it.getAsFile()
        if (f) files.push(f)
      }
    }
  }
  if (!files.length && dt.files && dt.files.length) files = imageFilesFrom(dt.files)
  if (files.length) { e.preventDefault(); uploadFiles(files); return }
  // A pasted markdown/text FILE (e.g. a .md copied from the file manager) → import it as a new doc.
  const docFile = textFileFrom(dt.files)
  if (docFile) { e.preventDefault(); emit('import-file', docFile); return }
  // else: plain text/HTML paste → let the textarea handle it natively.
}

const dragOver = ref(false)
function onDragOver(e) {
  if (e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files')) {
    e.preventDefault()
    dragOver.value = true
  }
}
function onDragLeave() { dragOver.value = false }
function onDrop(e) {
  dragOver.value = false
  const files = imageFilesFrom(e.dataTransfer?.files)
  if (!files.length) return // non-image drop → leave for the app-level file handler
  e.preventDefault()
  e.stopPropagation()
  uploadFiles(files)
}

// Scroll sync — rAF-throttled + bidirectional. The pane the user is actively scrolling drives
// the other; an "active pane" latch (reset on idle) stops the driven pane's echo scroll event
// from bouncing back, and the rAF coalesces to one update per frame so it stays smooth (the old
// version set scrollTop synchronously on every scroll event → forced reflow + jitter).
const previewPaneEl = ref(null)
let activePane = ''
let activeTimer = null
let syncRaf = 0
function scheduleSync(source, target) {
  if (effectiveView.value !== 'split' || !source || !target || syncRaf) return
  syncRaf = requestAnimationFrame(() => {
    syncRaf = 0
    const denom = source.scrollHeight - source.clientHeight
    const ratio = denom > 0 ? source.scrollTop / denom : 0
    target.scrollTop = ratio * (target.scrollHeight - target.clientHeight)
  })
}
function setActive(pane) {
  activePane = pane
  clearTimeout(activeTimer)
  activeTimer = setTimeout(() => { activePane = '' }, 150)
}
function onEditorScroll() {
  if (activePane === 'preview') return // preview is driving — this is its echo, ignore
  setActive('editor')
  scheduleSync(editorEl.value, previewPaneEl.value)
}
function onPreviewScroll() {
  if (activePane === 'editor') return // editor is driving — ignore the echo
  setActive('preview')
  scheduleSync(previewPaneEl.value, editorEl.value)
}

// Divider resize
const isDragging = ref(false)
const editorFlex = ref(1)
const previewFlex = ref(1)

function onDividerDown(e) {
  if (effectiveView.value !== 'split') return
  isDragging.value = true
  e.preventDefault()
}

function onMouseMove(e) {
  if (!isDragging.value) return
  const workspace = editorEl.value?.closest('.workspace')
  if (!workspace) return
  const rect = workspace.getBoundingClientRect()
  const ratio = Math.max(0.2, Math.min(0.8, (e.clientX - rect.left) / rect.width))
  editorFlex.value = ratio
  previewFlex.value = 1 - ratio
}

function onMouseUp() {
  isDragging.value = false
}

onMounted(async () => {
  await nextTick()
  emit('editor-mounted', editorEl.value)
  document.addEventListener('mousemove', onMouseMove)
  document.addEventListener('mouseup', onMouseUp)
})
</script>

<template>
  <main
    class="workspace"
    :data-view="effectiveView"
    :class="{ dragging: isDragging }"
  >
    <div
      class="pane editor-pane"
      :class="{ 'drag-over': dragOver }"
      :style="effectiveView === 'split' ? { flex: editorFlex } : {}"
    >
      <textarea
        ref="editorEl"
        :value="content"
        :placeholder="placeholder"
        spellcheck="false"
        @input="onInput"
        @keydown="onTab"
        @scroll="onEditorScroll"
        @paste="onPaste"
        @dragover="onDragOver"
        @dragleave="onDragLeave"
        @drop="onDrop"
      ></textarea>
      <GhostOverlay :editor="editorEl" :suggestion="ghost" />
      <Transition name="upload-bar">
        <div v-if="uploads.length" class="upload-bar" role="status" aria-live="polite">
          <svg class="up-ic" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M8 10.5V3"/><path d="M5 6l3-3 3 3"/><path d="M2.5 11v1.5A1.5 1.5 0 0 0 4 14h8a1.5 1.5 0 0 0 1.5-1.5V11"/></svg>
          <div class="up-meta">
            <span class="up-name">{{ uploads[0].name }}<span v-if="uploads.length > 1" class="up-more"> +{{ uploads.length - 1 }}</span></span>
            <div class="up-track"><div class="up-fill" :style="{ width: Math.round(uploads[0].progress * 100) + '%' }"></div></div>
          </div>
          <span class="up-pct">{{ Math.round(uploads[0].progress * 100) }}%</span>
        </div>
      </Transition>
      <Transition name="ghost-hint">
        <div v-if="ghost && ghost.text" class="ghost-hint-chip">
          <kbd>Tab</kbd>
          <span>{{ t('ai.ghostHint') }}</span>
        </div>
      </Transition>
    </div>

    <div
      v-if="effectiveView === 'split'"
      class="divider"
      @mousedown="onDividerDown"
    >
      <div class="divider-line"></div>
    </div>

    <div
      ref="previewPaneEl"
      class="pane preview-pane"
      :style="effectiveView === 'split' ? { flex: previewFlex } : {}"
      @scroll="onPreviewScroll"
    >
      <iframe v-if="themed" class="preview-frame" :srcdoc="frameHtml" sandbox="allow-same-origin" title="Themed preview"></iframe>
      <article v-else ref="previewEl" class="markdown-body" v-html="previewHTML"></article>
    </div>
  </main>
</template>

<style scoped>
.workspace {
  flex: 1;
  display: flex;
  overflow: hidden;
  min-height: 0;
  position: relative;
}

.workspace.dragging {
  cursor: col-resize;
  user-select: none;
}

.pane {
  overflow: hidden;
  display: flex;
  flex-direction: column;
  transition: flex 0.35s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.25s ease;
}

.workspace.dragging .pane { transition: none; }

.editor-pane { flex: 1; min-width: 0; background: var(--surface); position: relative; }
.preview-pane { flex: 1; min-width: 0; overflow-y: auto; background: var(--surface); }
.preview-frame { width: 100%; height: 100%; border: 0; background: #fff; }

/* View modes */
.workspace[data-view="editor"] .preview-pane,
.workspace[data-view="editor"] .divider {
  flex: 0 !important;
  width: 0;
  opacity: 0;
  overflow: hidden;
  pointer-events: none;
}

.workspace[data-view="preview"] .editor-pane,
.workspace[data-view="preview"] .divider {
  flex: 0 !important;
  width: 0;
  opacity: 0;
  overflow: hidden;
  pointer-events: none;
}

/* Editor textarea */
textarea {
  width: 100%;
  height: 100%;
  border: none;
  resize: none;
  padding: 24px;
  font-size: var(--editor-font-size, 14px);
  font-family: var(--editor-font, var(--font-mono));
  line-height: var(--editor-line-height, 1.75);
  color: var(--text);
  background: transparent;
  outline: none;
  tab-size: 2;
  -webkit-tab-size: 2;
}

textarea::placeholder { color: var(--text-tertiary); }

/* "Tab to accept" affordance for inline ghost completion */
.ghost-hint-chip {
  position: absolute;
  right: 14px;
  bottom: 12px;
  z-index: 4;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 9px;
  background: var(--surface);
  border: 1px solid var(--border-light);
  border-radius: 8px;
  box-shadow: var(--shadow-sm);
  font-size: 11px;
  font-family: var(--font-sans);
  color: var(--text-tertiary);
  pointer-events: none;
  user-select: none;
}
.ghost-hint-chip kbd {
  font-family: var(--font-sans);
  font-size: 10px;
  color: var(--text-secondary);
  background: var(--surface-hover);
  border: 1px solid var(--border-light);
  border-radius: 4px;
  padding: 1px 5px;
}
.ghost-hint-enter-active { transition: opacity 0.18s var(--ease-out), transform 0.18s var(--ease-out); }
.ghost-hint-leave-active { transition: opacity 0.12s ease; }
.ghost-hint-enter-from, .ghost-hint-leave-to { opacity: 0; transform: translateY(4px); }

/* Image-upload progress overlay (图床) */
.editor-pane.drag-over::after {
  content: "";
  position: absolute;
  inset: 6px;
  border: 2px dashed var(--accent);
  border-radius: 10px;
  background: var(--accent-bg, rgba(0,0,0,0.03));
  pointer-events: none;
  z-index: 3;
}
.upload-bar {
  position: absolute;
  left: 14px;
  right: 14px;
  bottom: 12px;
  z-index: 6;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  background: var(--surface);
  border: 1px solid var(--border-light);
  border-radius: 10px;
  box-shadow: var(--shadow-md, var(--shadow-sm));
  font-family: var(--font-sans);
  pointer-events: none;
}
.upload-bar .up-ic { color: var(--accent); flex-shrink: 0; }
.up-meta { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 5px; }
.up-name { font-size: 12px; color: var(--text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.up-more { color: var(--text-tertiary); }
.up-track { height: 4px; border-radius: 999px; background: var(--surface-hover); overflow: hidden; }
.up-fill { height: 100%; border-radius: 999px; background: var(--accent); transition: width 0.18s ease; min-width: 2px; }
.up-pct { font-size: 11px; font-variant-numeric: tabular-nums; color: var(--text-tertiary); flex-shrink: 0; }
.upload-bar-enter-active { transition: opacity 0.2s var(--ease-out), transform 0.2s var(--ease-out); }
.upload-bar-leave-active { transition: opacity 0.15s ease, transform 0.15s ease; }
.upload-bar-enter-from, .upload-bar-leave-to { opacity: 0; transform: translateY(6px); }

/* Divider */
.divider {
  width: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  cursor: col-resize;
  position: relative;
  z-index: 5;
  transition: background 0.15s;
}

.divider:hover { background: var(--accent-bg); }

.divider-line {
  width: 1px;
  height: 100%;
  background: var(--border-light);
  transition: background 0.15s, width 0.15s;
}

.divider:hover .divider-line {
  background: var(--accent);
  width: 2px;
}

@media (max-width: 768px) {
  textarea { padding: 16px; font-size: 14px; }
}

/* Print */
@media print {
  .editor-pane, .divider { display: none !important; }
  .preview-pane { flex: 1 !important; opacity: 1 !important; width: 100% !important; overflow: visible !important; }
}
</style>
