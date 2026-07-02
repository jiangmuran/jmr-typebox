<script setup>
// Live subtitle preview. Draws the SAME frame the recorder exports (via ./subtitleRender drawFrame)
// so the Style step is WYSIWYG. Client-only: rendered inside <ClientOnly>, touches canvas only in
// onMounted/handlers. The backing store is the real output size (crisp; CSS scales it down); the
// parent drives `time` (and optionally overrides the active segment + alpha for a paused preview).
import { ref, watch, onMounted } from 'vue'

const props = defineProps({
  segments: { type: Array, default: () => [] },
  style: { type: Object, default: () => ({}) },
  time: { type: Number, default: 0 },
  cover: { default: null },              // drawable Image/Canvas or null
  width: { type: Number, default: 1280 },
  height: { type: Number, default: 720 },
  activeIndex: { type: Number, default: null }, // override time→segment lookup (paused preview)
  forceAlpha: { type: Number, default: null },  // override fade (show caption fully when paused)
})

const canvas = ref(null)
let ctx = null
let drawFrameFn = null

async function ensureRenderer() {
  if (!drawFrameFn) { const m = await import('./subtitleRender'); drawFrameFn = m.drawFrame }
  return drawFrameFn
}

function sizeCanvas() {
  const c = canvas.value
  if (!c) return
  if (c.width !== props.width || c.height !== props.height) { c.width = props.width; c.height = props.height }
  ctx = c.getContext('2d')
}

async function render() {
  if (!canvas.value) return
  sizeCanvas()
  const draw = await ensureRenderer()
  if (!ctx) return
  draw(ctx, {
    width: props.width, height: props.height, time: props.time,
    segments: props.segments, style: props.style, cover: props.cover,
    activeIndex: props.activeIndex, forceAlpha: props.forceAlpha,
  })
}

watch(() => [props.segments, props.style, props.time, props.cover, props.width, props.height, props.activeIndex, props.forceAlpha], render, { deep: true })
onMounted(render)
</script>

<template>
  <div class="subcanvas-wrap" :style="{ aspectRatio: width + ' / ' + height }">
    <canvas ref="canvas" class="subcanvas"></canvas>
  </div>
</template>

<style scoped>
.subcanvas-wrap { width: 100%; border-radius: 12px; overflow: hidden; background: #000; box-shadow: var(--shadow-sm); }
.subcanvas { display: block; width: 100%; height: 100%; }
</style>
