<script setup>
// Copilot-style "ghost text" overlay for a <textarea>.
//
// Technique: an absolutely-positioned mirror layer is aligned pixel-for-pixel over the textarea
// (same font, size, line-height, padding, wrapping, scroll). It renders the document text up to
// the caret as TRANSPARENT text — so it occupies exactly the same space the textarea does — then a
// dimmed <span> with the suggestion at the caret, followed by the remaining text (also transparent
// to preserve wrapping after the insertion). The overlay never receives pointer events.
//
// SSG-safe: all window/document access is inside onMounted/handlers.
import { ref, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'

const props = defineProps({
  // The textarea element to mirror (may be null before mount).
  editor: { type: Object, default: null },
  // Active suggestion: { pos, text } or null.
  suggestion: { type: Object, default: null },
})

const overlayEl = ref(null)

// Copy of the styles that affect text layout, applied to the mirror so wrapping matches exactly.
const STYLE_PROPS = [
  'boxSizing', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
  'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight', 'letterSpacing',
  'textTransform', 'textIndent', 'whiteSpace', 'wordSpacing', 'tabSize',
]

let raf = 0
function syncStyles() {
  const el = props.editor
  const ov = overlayEl.value
  if (!el || !ov || typeof window === 'undefined') return
  const cs = window.getComputedStyle(el)
  for (const p of STYLE_PROPS) ov.style[p] = cs[p]
  // Wrapping behaviour must match a textarea: wrap long words, preserve whitespace + newlines.
  ov.style.whiteSpace = 'pre-wrap'
  ov.style.overflowWrap = 'break-word'
  ov.style.wordBreak = cs.wordBreak || 'normal'
  // Match the textarea's box exactly (it's the next sibling inside the same positioned parent).
  ov.style.width = el.offsetWidth + 'px'
  ov.style.height = el.offsetHeight + 'px'
  ov.style.left = el.offsetLeft + 'px'
  ov.style.top = el.offsetTop + 'px'
  // Keep the mirror scrolled in lockstep with the textarea.
  ov.scrollTop = el.scrollTop
  ov.scrollLeft = el.scrollLeft
}

function onScroll() {
  const el = props.editor
  const ov = overlayEl.value
  if (!el || !ov) return
  ov.scrollTop = el.scrollTop
  ov.scrollLeft = el.scrollLeft
}

function scheduleSync() {
  if (typeof window === 'undefined') return
  cancelAnimationFrame(raf)
  raf = requestAnimationFrame(syncStyles)
}

let ro = null
function attach(el) {
  if (!el) return
  el.addEventListener('scroll', onScroll, { passive: true })
  if (typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver(scheduleSync)
    ro.observe(el)
  }
}
function detach(el) {
  if (el) el.removeEventListener('scroll', onScroll)
  if (ro) { try { ro.disconnect() } catch {} ro = null }
}

watch(() => props.editor, (el, prev) => {
  detach(prev)
  attach(el)
  nextTick(scheduleSync)
})

// Re-measure whenever a suggestion appears/changes (content/caret moved).
watch(() => props.suggestion, () => nextTick(scheduleSync))

onMounted(() => {
  attach(props.editor)
  if (typeof window !== 'undefined') window.addEventListener('resize', scheduleSync)
  nextTick(scheduleSync)
})
onBeforeUnmount(() => {
  detach(props.editor)
  if (typeof window !== 'undefined') window.removeEventListener('resize', scheduleSync)
  cancelAnimationFrame(raf)
})

// Split the document text around the caret so the ghost lands in the right place.
function head() {
  const el = props.editor
  const s = props.suggestion
  if (!el || !s) return ''
  return el.value.slice(0, s.pos)
}
function tail() {
  const el = props.editor
  const s = props.suggestion
  if (!el || !s) return ''
  return el.value.slice(s.pos)
}
</script>

<template>
  <div
    v-if="suggestion && suggestion.text"
    ref="overlayEl"
    class="ghost-overlay"
    aria-hidden="true"
  >
    <span class="ghost-hidden">{{ head() }}</span><span class="ghost-text">{{ suggestion.text }}</span><span class="ghost-hidden">{{ tail() }}</span>
  </div>
</template>

<style scoped>
.ghost-overlay {
  position: absolute;
  margin: 0;
  overflow: hidden;
  pointer-events: none;
  z-index: 2;
  color: transparent;
  background: transparent;
  /* font/size/line-height/padding are copied from the textarea at runtime */
}
/* The mirrored document text is invisible — it only reserves the correct space so the ghost sits
   exactly where the caret is. */
.ghost-hidden {
  color: transparent;
  white-space: pre-wrap;
  overflow-wrap: break-word;
}
.ghost-text {
  color: var(--text-tertiary);
  opacity: 0.62;
  white-space: pre-wrap;
  overflow-wrap: break-word;
}
</style>
