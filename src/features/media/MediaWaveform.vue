<script setup>
// Canvas waveform with an optional draggable trim selection + a live playhead. Client-only
// (rendered inside <ClientOnly>): touches canvas/ResizeObserver only in onMounted/handlers.
// Peaks are computed by the parent (via ./waveform decodeToPeaks) and passed in, so this component
// stays presentational + cheap to re-render.
import { ref, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { drawWaveform } from './waveform'

const props = defineProps({
  peaks: { type: Array, default: null },     // [{min,max}] or null while decoding
  duration: { type: Number, default: 0 },    // seconds (for time<->ratio)
  playRatio: { type: Number, default: 0 },    // 0..1 current playback position
  selStart: { type: Number, default: null },  // seconds, trim selection start (null = none)
  selEnd: { type: Number, default: null },    // seconds, trim selection end
  selectable: { type: Boolean, default: true },
  loading: { type: Boolean, default: false },
  height: { type: Number, default: 96 },
})
const emit = defineEmits(['seek', 'select']) // seek(sec), select({ start, end })

const wrap = ref(null)
const canvas = ref(null)
let ctx = null
let ro = null
let cssW = 0
let cssH = props.height

// Resolve CSS custom properties so the canvas matches the app theme (canvas can't read CSS vars).
function themeColors() {
  if (typeof window === 'undefined' || !wrap.value) return {}
  const cs = getComputedStyle(wrap.value)
  const get = (v, fb) => (cs.getPropertyValue(v).trim() || fb)
  return {
    color: get('--text-tertiary', '#9aa0a6'),
    playedColor: get('--accent', '#6366f1'),
    selColor: 'color-mix(in srgb, var(--accent) 16%, transparent)',
  }
}

function render() {
  if (!ctx || !canvas.value) return
  const t = themeColors()
  const dur = props.duration || 0
  drawWaveform(ctx, props.peaks || [], {
    width: cssW,
    height: cssH,
    color: t.color,
    playedColor: t.playedColor,
    playedRatio: props.playRatio,
    selStart: dur && props.selStart != null ? props.selStart / dur : null,
    selEnd: dur && props.selEnd != null ? props.selEnd / dur : null,
    selColor: t.selColor,
  })
}

function resize() {
  if (!wrap.value || !canvas.value) return
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  cssW = wrap.value.clientWidth || 600
  cssH = props.height
  canvas.value.width = Math.round(cssW * dpr)
  canvas.value.height = Math.round(cssH * dpr)
  canvas.value.style.width = cssW + 'px'
  canvas.value.style.height = cssH + 'px'
  ctx = canvas.value.getContext('2d')
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  render()
}

// ---- pointer interaction: click to seek, drag to select a trim region ----
let dragging = false
let dragStartRatio = 0

function ratioFromEvent(e) {
  const rect = canvas.value.getBoundingClientRect()
  const x = (e.clientX ?? (e.touches?.[0]?.clientX || 0)) - rect.left
  return Math.max(0, Math.min(1, x / (rect.width || 1)))
}

function onPointerDown(e) {
  if (!props.peaks?.length) return
  canvas.value.setPointerCapture?.(e.pointerId)
  dragging = true
  dragStartRatio = ratioFromEvent(e)
}
function onPointerMove(e) {
  if (!dragging || !props.selectable || !props.duration) return
  const r = ratioFromEvent(e)
  const a = Math.min(dragStartRatio, r)
  const b = Math.max(dragStartRatio, r)
  // Only treat as a selection once the drag is meaningful (> ~0.5%).
  if (b - a > 0.005) emit('select', { start: a * props.duration, end: b * props.duration })
}
function onPointerUp(e) {
  if (!dragging) return
  dragging = false
  const r = ratioFromEvent(e)
  if (Math.abs(r - dragStartRatio) <= 0.005) {
    // A click (not a drag): seek there.
    if (props.duration) emit('seek', r * props.duration)
  }
}

watch(() => [props.peaks, props.playRatio, props.selStart, props.selEnd, props.duration], () => {
  // re-render on any visual input change
  nextTick(render)
})
watch(() => props.height, () => resize())

onMounted(() => {
  resize()
  ro = new ResizeObserver(() => resize())
  ro.observe(wrap.value)
})
onBeforeUnmount(() => { ro?.disconnect?.() })
</script>

<template>
  <div ref="wrap" class="wf-wrap" :style="{ height: height + 'px' }">
    <canvas
      ref="canvas"
      class="wf-canvas"
      :class="{ interactive: selectable && peaks?.length }"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
    ></canvas>
    <div v-if="loading" class="wf-loading">
      <span class="wf-spinner"></span>
    </div>
    <div v-else-if="!peaks?.length" class="wf-empty">—</div>
  </div>
</template>

<style scoped>
.wf-wrap { position: relative; width: 100%; border-radius: 10px; background: var(--surface-hover); overflow: hidden; }
.wf-canvas { display: block; width: 100%; }
.wf-canvas.interactive { cursor: text; }
.wf-loading, .wf-empty { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; color: var(--text-tertiary); font-size: 13px; pointer-events: none; }
.wf-spinner { width: 18px; height: 18px; border: 2px solid var(--border); border-top-color: var(--accent); border-radius: 50%; animation: wfspin 0.7s linear infinite; }
@keyframes wfspin { to { transform: rotate(360deg); } }
</style>
