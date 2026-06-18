<script setup>
import { ref, watch, onMounted, nextTick, computed } from 'vue'
import { renderMarkdown } from '../utils/markdown'
import { useSettings } from '../composables/useSettings'
import { buildThemedHtml } from '../themes/registry'
import '../styles/markdown.css'

const props = defineProps({
  content: String,
  viewMode: String,
  isMobile: Boolean,
  placeholder: { type: String, default: 'Start writing Markdown here...' },
})

const emit = defineEmits(['update:content', 'editor-mounted'])

const editorEl = ref(null)
const previewHTML = ref('')
let renderTimer = null

// On mobile, split view would squish two panes into a narrow screen — collapse to a single
// pane (editor) reactively so the layout is never broken regardless of the stored view.
const effectiveView = computed(() => (props.isMobile && props.viewMode === 'split') ? 'editor' : props.viewMode)

// Writing theme: when a real Typora theme is chosen, render the preview in an isolated
// iframe so the theme CSS applies faithfully. 'default' keeps the fast app preview.
const { settings } = useSettings()
const themed = computed(() => !!settings.writingTheme && settings.writingTheme !== 'default')
const frameHtml = ref('')
let frameTimer = null
function scheduleFrame() {
  clearTimeout(frameTimer)
  frameTimer = setTimeout(async () => {
    try { frameHtml.value = await buildThemedHtml(renderMarkdown(props.content), settings.writingTheme) } catch { /* ignore */ }
  }, props.isMobile ? 200 : 100)
}
watch([() => props.content, () => settings.writingTheme], () => { if (themed.value) scheduleFrame() }, { immediate: true })

function scheduleRender() {
  clearTimeout(renderTimer)
  const delay = props.isMobile ? 150 : 60
  renderTimer = setTimeout(() => {
    previewHTML.value = renderMarkdown(props.content)
  }, delay)
}

watch(() => props.content, scheduleRender, { immediate: true })

function onInput(e) {
  emit('update:content', e.target.value)
}

function onTab(e) {
  if (e.key === 'Tab') {
    e.preventDefault()
    const el = e.target
    const start = el.selectionStart
    const end = el.selectionEnd
    el.setRangeText('  ', start, end, 'end')
    emit('update:content', el.value)
  }
}

// Scroll sync
function onEditorScroll() {
  if (effectiveView.value !== 'split') return
  const el = editorEl.value
  if (!el) return
  const ratio = el.scrollTop / (el.scrollHeight - el.clientHeight || 1)
  const preview = el.parentElement?.nextElementSibling?.nextElementSibling
  if (preview) {
    preview.scrollTop = ratio * (preview.scrollHeight - preview.clientHeight)
  }
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
      ></textarea>
    </div>

    <div
      v-if="effectiveView === 'split'"
      class="divider"
      @mousedown="onDividerDown"
    >
      <div class="divider-line"></div>
    </div>

    <div
      class="pane preview-pane"
      :style="effectiveView === 'split' ? { flex: previewFlex } : {}"
    >
      <iframe v-if="themed" class="preview-frame" :srcdoc="frameHtml" sandbox="allow-same-origin" title="Themed preview"></iframe>
      <article v-else class="markdown-body" v-html="previewHTML"></article>
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

.editor-pane { flex: 1; min-width: 0; background: var(--surface); }
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
