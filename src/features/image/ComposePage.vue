<script setup>
// Multi-layer image compositor ("合成 / Compose"). Stack images on a configurable stage, move /
// scale / rotate / reorder / fade each layer interactively, then flatten to PNG or JPG. Everything
// is client-side — no upload.
//
// The pure geometry (hit-testing a rotated/scaled layer, corner-handle → new box, rotation, draw
// order) lives in composeMath.js and is unit-tested. This file owns the DOM/canvas + pointer
// interaction and delegates every calculation to those helpers.
//
// SSG-safe: no window/Image/canvas access at <script setup> top level — all of it lives in
// onMounted/handlers, and the interactive body renders inside <ClientOnly> (via ImageShell).
import { ref, computed, watch, onMounted, onBeforeUnmount, markRaw, nextTick } from 'vue'
import { useRouteHead } from '../../composables/useRouteHead'
import { useI18n } from '../../composables/useI18n'
import { useToast } from '../../composables/useToast'
import { useHandoff } from '../../composables/useHandoff'
import ImageShell from './ImageShell.vue'
import ImageDropZone from './ImageDropZone.vue'
import SendToMenu from '../../components/SendToMenu.vue'
import {
  loadImageFromBlob, canvasToBlob, downloadBlob, copyImageToClipboard,
  pickImageFiles, imageFileFromEvent, imageFilesFromEvent, makeCanvas,
} from './canvasUtils'
import { withExtension, formatSize, clamp } from './imageHelpers'
import {
  placeLayer, corners, topLayerAt, handlePositions, hitHandle,
  scaleFromHandle, rotationFromHandle, snapAngle, visibleInDrawOrder, moveLayer,
  radToDeg, degToRad, MIN_SIZE,
} from './composeMath'

const { meta: m } = useRouteHead()
const { t } = useI18n()
const { showToast } = useToast()
const handoff = useHandoff()

// ---- Layer model (front-first: index 0 = topmost). Each layer also carries the decoded image
// (markRaw so Vue never proxies the DOM element), a thumbnail object URL, and its natural size. ----
const layers = ref([])
const activeId = ref(null)
let uid = 0

const activeLayer = computed(() => layers.value.find(l => l.id === activeId.value) || null)
const activeIndex = computed(() => layers.value.findIndex(l => l.id === activeId.value))
const hasLayers = computed(() => layers.value.length > 0)

// ---- Stage ----
const stageW = ref(1080)
const stageH = ref(1080)
const bg = ref('transparent')          // 'transparent' | 'white' | 'black' | 'custom'
const bgColor = ref('#ffffff')
const STAGE_PRESETS = [
  { id: 'fit' }, { id: 'sq', w: 1080, h: 1080 }, { id: 'wide', w: 1920, h: 1080 },
  { id: 'story', w: 1080, h: 1920 }, { id: 'photo', w: 1600, h: 1200 },
]

// ---- Export ----
const format = ref('png')              // 'png' | 'jpg'
const quality = ref(92)
const resultBlob = ref(null)           // debounced PNG of the composite, for "Send to →"

// ---- DOM refs + display scale ----
const canvasRef = ref(null)
const hitRef = ref(null)
const scale = ref(1)                   // displayPx / stagePx (uniform)
const dragOver = ref(false)

// Handle sizing in SCREEN px (converted to stage units via /scale so they stay constant on screen).
const HANDLE_R = 6
const HANDLE_HIT = 16
const ROT_OFFSET = 30
const rotOffsetStage = computed(() => ROT_OFFSET / (scale.value || 1))
const handleRStage = computed(() => HANDLE_R / (scale.value || 1))

// Selection overlay geometry (stage coords) for the active layer.
const selection = computed(() => {
  const L = activeLayer.value
  if (!L) return null
  const cs = corners(L)
  const { top, rotate } = handlePositions(L, rotOffsetStage.value)
  return {
    poly: cs.map(p => `${p.x},${p.y}`).join(' '),
    handles: cs,
    top, rotate,
  }
})

const bgFill = computed(() =>
  bg.value === 'white' ? '#ffffff' : bg.value === 'black' ? '#000000'
    : bg.value === 'custom' ? bgColor.value : null
)

// ============================================================================
// Rendering
// ============================================================================
function paintLayers(ctx) {
  for (const l of visibleInDrawOrder(layers.value)) {
    ctx.save()
    ctx.globalAlpha = clamp(l.opacity, 0, 1)
    ctx.translate(l.cx, l.cy)
    ctx.rotate(l.rotation)
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(l.img, -l.w / 2, -l.h / 2, l.w, l.h)
    ctx.restore()
  }
}

function draw() {
  const c = canvasRef.value
  if (!c) return
  if (c.width !== stageW.value || c.height !== stageH.value) {
    c.width = stageW.value
    c.height = stageH.value
  }
  const ctx = c.getContext('2d')
  ctx.clearRect(0, 0, c.width, c.height)
  if (bgFill.value) { ctx.fillStyle = bgFill.value; ctx.fillRect(0, 0, c.width, c.height) }
  paintLayers(ctx)
  computeScale()
}

let rafId = 0
function scheduleDraw() {
  if (rafId) return
  rafId = requestAnimationFrame(() => { rafId = 0; draw(); scheduleResultBlob() })
}

let blobTimer = null
function scheduleResultBlob() {
  clearTimeout(blobTimer)
  blobTimer = setTimeout(async () => {
    if (!hasLayers.value) { resultBlob.value = null; return }
    try { resultBlob.value = await canvasToBlob(renderExportCanvas('png'), 'image/png') }
    catch { /* keep previous */ }
  }, 220)
}

function computeScale() {
  const c = canvasRef.value
  if (!c) return
  const rect = c.getBoundingClientRect()
  if (rect.width > 0) scale.value = rect.width / c.width || 1
}

// Fresh canvas at stage resolution for export. JPG can't hold alpha, so a transparent stage gets a
// white backing; an explicit background is always painted.
function renderExportCanvas(fmt) {
  const c = makeCanvas(stageW.value, stageH.value)
  const ctx = c.getContext('2d')
  if (bgFill.value) { ctx.fillStyle = bgFill.value; ctx.fillRect(0, 0, c.width, c.height) }
  else if (fmt === 'jpg') { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, c.width, c.height) }
  paintLayers(ctx)
  return c
}

watch(canvasRef, (c) => { if (c) nextTick(() => { computeScale(); draw() }) })
watch([layers, stageW, stageH, bg, bgColor], scheduleDraw, { deep: true })

// ============================================================================
// Adding layers (pick / drop / paste / handoff)
// ============================================================================
async function addFiles(files) {
  let added = 0
  for (const f of files) {
    if (!f || !f.type?.startsWith('image/')) continue
    try {
      const img = await loadImageFromBlob(f)
      addLayerFromImage(img, f)
      added++
    } catch { /* skip undecodable */ }
  }
  return added
}

function addLayerFromImage(img, file) {
  const first = layers.value.length === 0
  const nw = img.naturalWidth || img.width
  const nh = img.naturalHeight || img.height
  if (first) { stageW.value = nw; stageH.value = nh }
  const box = first
    ? { cx: nw / 2, cy: nh / 2, w: nw, h: nh }
    : placeLayer(nw, nh, stageW.value, stageH.value)
  const layer = {
    id: ++uid,
    name: file?.name || `layer-${uid}`,
    img: markRaw(img),
    file: markRaw(file),                 // kept so a duplicate can mint its own thumbnail URL
    url: URL.createObjectURL(file),
    naturalW: nw, naturalH: nh,
    cx: box.cx, cy: box.cy, w: box.w, h: box.h,
    rotation: 0, opacity: 1, visible: true,
  }
  layers.value = [layer, ...layers.value]   // new layer goes to the front
  activeId.value = layer.id
}

async function pickMore() {
  const files = await pickImageFiles({ multiple: true })
  if (files.length) await addFiles(files)
}
function onDrop(e) {
  dragOver.value = false
  const files = imageFilesFromEvent(e)
  if (files.length) addFiles(files)
}
function onDragOver() { dragOver.value = true }
function onDragLeave() { dragOver.value = false }
function onPaste(e) {
  const f = imageFileFromEvent(e)
  if (f) { e.preventDefault(); addFiles([f]) }
}

// ============================================================================
// Layer panel ops
// ============================================================================
function selectLayer(l) { activeId.value = l.id }
function toggleVisible(l) { l.visible = !l.visible }
function setOpacity(l, pct) { l.opacity = clamp(Number(pct) / 100, 0, 1) }
function moveUp(i) { if (i > 0) layers.value = moveLayer(layers.value, i, i - 1) }
function moveDown(i) { if (i < layers.value.length - 1) layers.value = moveLayer(layers.value, i, i + 1) }
function bringToFront() { const i = activeIndex.value; if (i > 0) layers.value = moveLayer(layers.value, i, 0) }
function sendToBack() { const i = activeIndex.value; if (i >= 0 && i < layers.value.length - 1) layers.value = moveLayer(layers.value, i, layers.value.length - 1) }
function removeLayer(i) {
  const l = layers.value[i]
  if (!l) return
  if (l.url) URL.revokeObjectURL(l.url)
  const wasActive = l.id === activeId.value
  const arr = [...layers.value]
  arr.splice(i, 1)
  layers.value = arr
  if (wasActive) activeId.value = arr[Math.min(i, arr.length - 1)]?.id ?? null
}
function duplicateActive() {
  const L = activeLayer.value
  if (!L) return
  // Reuse the decoded image element (cheap) but mint an independent thumbnail URL from the stored
  // source blob so revoking one layer never blanks the other.
  const copy = {
    ...L, id: ++uid,
    img: L.img, file: L.file, url: URL.createObjectURL(L.file),
    cx: L.cx + 24, cy: L.cy + 24,
  }
  layers.value = [copy, ...layers.value]
  activeId.value = copy.id
}

// ---- active-layer transform (sliders) ----
const activeRotationDeg = computed({
  get: () => activeLayer.value ? Math.round(radToDeg(activeLayer.value.rotation)) : 0,
  set: (v) => { if (activeLayer.value) activeLayer.value.rotation = degToRad(v) },
})
const activeSizePct = computed({
  get: () => activeLayer.value ? Math.round((activeLayer.value.w / activeLayer.value.naturalW) * 100) : 100,
  set: (v) => {
    const L = activeLayer.value
    if (!L) return
    const f = clamp(v, 5, 500) / 100
    L.w = Math.max(MIN_SIZE, L.naturalW * f)
    L.h = Math.max(MIN_SIZE, L.naturalH * f)
  },
})
const activeOpacityPct = computed({
  get: () => activeLayer.value ? Math.round(activeLayer.value.opacity * 100) : 100,
  set: (v) => { if (activeLayer.value) activeLayer.value.opacity = clamp(v, 0, 100) / 100 },
})
function resetActive() {
  const L = activeLayer.value
  if (!L) return
  const box = placeLayer(L.naturalW, L.naturalH, stageW.value, stageH.value)
  L.cx = box.cx; L.cy = box.cy; L.w = box.w; L.h = box.h; L.rotation = 0; L.opacity = 1
}

// ============================================================================
// Pointer interaction (mouse + touch via Pointer Events). One-finger drag moves; corner handles
// scale (Shift = free/non-uniform, else aspect-locked); the top handle rotates (Shift = snap 15°);
// two fingers pinch-scale + rotate the active layer about its centre.
// ============================================================================
const activePointers = new Map()       // pointerId → { x, y } in stage coords
const gesture = { mode: 'none', cornerIndex: 0, moveOffset: { x: 0, y: 0 } }
const pinch = { d0: 1, a0: 0, w0: 1, h0: 1, rot0: 0 }
const cursor = ref('default')

function toStage(e) {
  const c = canvasRef.value
  const rect = c.getBoundingClientRect()
  const s = rect.width / c.width || 1
  scale.value = s
  return { x: (e.clientX - rect.left) / s, y: (e.clientY - rect.top) / s }
}
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)
const angle = (a, b) => Math.atan2(b.y - a.y, b.x - a.x)

function onPointerDown(e) {
  const c = canvasRef.value
  if (!c) return
  computeScale()
  const p = toStage(e)
  try { hitRef.value?.setPointerCapture?.(e.pointerId) } catch { /* not a live pointer */ }
  activePointers.set(e.pointerId, p)

  // Second finger on an existing selection → pinch.
  if (activePointers.size === 2 && activeLayer.value) {
    const [p1, p2] = [...activePointers.values()]
    pinch.d0 = Math.max(1e-3, dist(p1, p2))
    pinch.a0 = angle(p1, p2)
    pinch.w0 = activeLayer.value.w
    pinch.h0 = activeLayer.value.h
    pinch.rot0 = activeLayer.value.rotation
    gesture.mode = 'pinch'
    return
  }
  if (activePointers.size > 1) return

  // First finger: handle → body → deselect.
  if (activeLayer.value) {
    const h = hitHandle(activeLayer.value, p, { rotateOffset: rotOffsetStage.value, hitRadius: HANDLE_HIT / scale.value })
    if (h?.type === 'rotate') { gesture.mode = 'rotate'; return }
    if (h?.type === 'corner') { gesture.mode = 'scale'; gesture.cornerIndex = h.index; return }
  }
  const idx = topLayerAt(p, layers.value)
  if (idx >= 0) {
    activeId.value = layers.value[idx].id
    gesture.mode = 'move'
    gesture.moveOffset = { x: layers.value[idx].cx - p.x, y: layers.value[idx].cy - p.y }
  } else {
    activeId.value = null
    gesture.mode = 'none'
  }
}

function onPointerMove(e) {
  if (!activePointers.has(e.pointerId)) return   // only react to a pressed pointer
  const p = toStage(e)
  activePointers.set(e.pointerId, p)
  const L = activeLayer.value
  if (!L) return

  if (gesture.mode === 'pinch') {
    if (activePointers.size < 2) return
    const [p1, p2] = [...activePointers.values()]
    const ratio = dist(p1, p2) / pinch.d0
    L.w = Math.max(MIN_SIZE, pinch.w0 * ratio)
    L.h = Math.max(MIN_SIZE, pinch.h0 * ratio)
    L.rotation = pinch.rot0 + (angle(p1, p2) - pinch.a0)
  } else if (gesture.mode === 'move') {
    L.cx = p.x + gesture.moveOffset.x
    L.cy = p.y + gesture.moveOffset.y
  } else if (gesture.mode === 'scale') {
    Object.assign(L, scaleFromHandle(L, gesture.cornerIndex, p, { keepAspect: !e.shiftKey }))
  } else if (gesture.mode === 'rotate') {
    let r = rotationFromHandle(L, p)
    if (e.shiftKey) r = snapAngle(r, 15, 7)
    L.rotation = r
  }
}

function onPointerUp(e) {
  activePointers.delete(e.pointerId)
  try { hitRef.value?.releasePointerCapture?.(e.pointerId) } catch { /* already released */ }
  if (gesture.mode === 'pinch' && activePointers.size < 2) gesture.mode = 'none'
  if (activePointers.size === 0) { gesture.mode = 'none'; scheduleResultBlob() }
}

// Cursor hint while hovering handles.
function onHover(e) {
  if (gesture.mode !== 'none' || activePointers.size) return
  const L = activeLayer.value
  if (!L || !canvasRef.value) { cursor.value = 'default'; return }
  const p = toStage(e)
  const h = hitHandle(L, p, { rotateOffset: rotOffsetStage.value, hitRadius: HANDLE_HIT / scale.value })
  if (h?.type === 'rotate') cursor.value = 'grab'
  else if (h?.type === 'corner') cursor.value = 'nwse-resize'
  else if (topLayerAt(p, layers.value) >= 0) cursor.value = 'move'
  else cursor.value = 'default'
}

// ============================================================================
// Keyboard: Delete removes, Esc deselects, arrows nudge (Shift = ×10).
// ============================================================================
function onKey(e) {
  const tag = (e.target?.tagName || '').toLowerCase()
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return
  const L = activeLayer.value
  if (e.key === 'Escape') { activeId.value = null; return }
  if (!L) return
  if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeLayer(activeIndex.value); return }
  const step = e.shiftKey ? 10 : 1
  if (e.key === 'ArrowLeft') { e.preventDefault(); L.cx -= step }
  else if (e.key === 'ArrowRight') { e.preventDefault(); L.cx += step }
  else if (e.key === 'ArrowUp') { e.preventDefault(); L.cy -= step }
  else if (e.key === 'ArrowDown') { e.preventDefault(); L.cy += step }
}

// ============================================================================
// Stage settings
// ============================================================================
function applyPreset(id) {
  const preset = STAGE_PRESETS.find(p => p.id === id)
  if (!preset) return
  if (preset.id === 'fit') {
    const L = activeLayer.value || layers.value[layers.value.length - 1]
    if (L) { stageW.value = L.naturalW; stageH.value = L.naturalH }
  } else {
    stageW.value = preset.w
    stageH.value = preset.h
  }
}
function clampStage() {
  stageW.value = clamp(Math.round(stageW.value), 16, 8000)
  stageH.value = clamp(Math.round(stageH.value), 16, 8000)
}

// ============================================================================
// Export
// ============================================================================
async function exportImage() {
  if (!hasLayers.value) return
  const fmt = format.value
  const mime = fmt === 'jpg' ? 'image/jpeg' : 'image/png'
  const q = fmt === 'jpg' ? clamp(quality.value, 1, 100) / 100 : undefined
  const blob = await canvasToBlob(renderExportCanvas(fmt), mime, q)
  if (!blob) { showToast(t('img2.unsupported')); return }
  downloadBlob(blob, withExtension('composite', fmt))
  showToast(`${formatSize(blob.size)} · ${fmt.toUpperCase()} · ${stageW.value}×${stageH.value}`)
}
async function copyResult() {
  if (!hasLayers.value) return
  try { await copyImageToClipboard(await canvasToBlob(renderExportCanvas('png'), 'image/png')); showToast(t('img2.copied')) }
  catch { showToast(t('img2.copyUnsupported')) }
}

function reset() {
  for (const l of layers.value) if (l.url) { try { URL.revokeObjectURL(l.url) } catch { /* shared */ } }
  layers.value = []
  activeId.value = null
  resultBlob.value = null
}

// ============================================================================
// Lifecycle
// ============================================================================
onMounted(async () => {
  window.addEventListener('paste', onPaste)
  window.addEventListener('keydown', onKey)
  window.addEventListener('resize', computeScale)
  // Pick up a cross-module "Send to → Compose" image, if staged.
  const h = handoff.take('image')
  if (h?.payload) {
    let f = h.payload
    if (h.name && !f.name) { try { f = new File([f], h.name, { type: f.type }) } catch { f.name = h.name } }
    if (await addFiles([f])) showToast(t('handoff.received'))
  }
})
onBeforeUnmount(() => {
  window.removeEventListener('paste', onPaste)
  window.removeEventListener('keydown', onKey)
  window.removeEventListener('resize', computeScale)
  clearTimeout(blobTimer)
  if (rafId) cancelAnimationFrame(rafId)
  for (const l of layers.value) if (l.url) { try { URL.revokeObjectURL(l.url) } catch { /* shared */ } }
})
</script>

<template>
  <ImageShell wide :h1="m.h1" :title="t('img2.compose.title')" :sub="t('img2.compose.sub')">
    <!-- Empty state -->
    <ImageDropZone
      v-if="!hasLayers"
      :title="t('img2.compose.drop')"
      :hint="t('img2.browseBatch')"
      :drag-over="dragOver"
      @pick="pickMore"
      @drop="onDrop"
      @dragover="onDragOver"
      @dragleave="onDragLeave"
    />

    <div v-else class="layout" @dragover.prevent="onDragOver" @dragleave="onDragLeave" @drop.prevent="onDrop">
      <!-- LEFT: stage + settings + export -->
      <div class="stage-col">
        <div class="stage-scroll">
          <div class="stage-wrap" :style="{ cursor }">
            <canvas ref="canvasRef" class="stage-canvas"></canvas>
            <svg
              v-if="selection"
              class="stage-overlay"
              :viewBox="`0 0 ${stageW} ${stageH}`"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <polygon :points="selection.poly" class="sel-box" vector-effect="non-scaling-stroke" />
              <line
                :x1="selection.top.x" :y1="selection.top.y"
                :x2="selection.rotate.x" :y2="selection.rotate.y"
                class="sel-line" vector-effect="non-scaling-stroke"
              />
              <circle :cx="selection.rotate.x" :cy="selection.rotate.y" :r="handleRStage" class="sel-rot" vector-effect="non-scaling-stroke" />
              <rect
                v-for="(hd, i) in selection.handles" :key="i"
                :x="hd.x - handleRStage" :y="hd.y - handleRStage"
                :width="handleRStage * 2" :height="handleRStage * 2"
                class="sel-handle" vector-effect="non-scaling-stroke"
              />
            </svg>
            <div
              ref="hitRef"
              class="stage-hit"
              @pointerdown="onPointerDown"
              @pointermove="(e) => { onPointerMove(e); onHover(e) }"
              @pointerup="onPointerUp"
              @pointercancel="onPointerUp"
              @pointerleave="() => (cursor = 'default')"
            ></div>
          </div>
        </div>

        <p class="hint">{{ t('img2.compose.hint') }}</p>

        <!-- Stage settings -->
        <div class="card stage-card">
          <div class="ctrl-row">
            <div class="ctrl">
              <label>{{ t('img2.compose.canvasSize') }}</label>
              <select class="text-input" @change="applyPreset($event.target.value)">
                <option v-for="p in STAGE_PRESETS" :key="p.id" :value="p.id">{{ t('img2.compose.preset.' + p.id) }}</option>
              </select>
            </div>
            <div class="ctrl">
              <label>{{ t('img2.compose.background') }}</label>
              <div class="seg bg-seg">
                <button :class="{ on: bg === 'transparent' }" @click="bg = 'transparent'" :title="t('img2.compose.bgTransparent')">
                  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="2.5" y="2.5" width="11" height="11" rx="1.5"/><path d="M2.5 8h11M8 2.5v11"/></svg>
                </button>
                <button :class="{ on: bg === 'white' }" @click="bg = 'white'" :title="t('img2.compose.bgWhite')" aria-label="white"><span class="sw sw-white"></span></button>
                <button :class="{ on: bg === 'black' }" @click="bg = 'black'" :title="t('img2.compose.bgBlack')" aria-label="black"><span class="sw sw-black"></span></button>
                <button :class="{ on: bg === 'custom' }" @click="bg = 'custom'" :title="t('img2.compose.bgCustom')" aria-label="custom"><span class="sw sw-custom"></span></button>
              </div>
            </div>
          </div>
          <div class="ctrl-row">
            <div class="ctrl">
              <label for="cw">{{ t('img2.compose.width') }}</label>
              <input id="cw" class="num-input" type="number" min="16" max="8000" v-model.number="stageW" @change="clampStage" />
            </div>
            <div class="ctrl">
              <label for="ch">{{ t('img2.compose.height') }}</label>
              <input id="ch" class="num-input" type="number" min="16" max="8000" v-model.number="stageH" @change="clampStage" />
            </div>
          </div>
          <div v-if="bg === 'custom'" class="ctrl-row color-size">
            <input type="color" v-model="bgColor" class="color-input" :title="t('img2.compose.bgCustom')" />
            <span class="note">{{ t('img2.compose.bgCustom') }}</span>
          </div>
        </div>

        <!-- Export -->
        <div class="card export-card">
          <div class="ctrl-row color-size">
            <div class="seg fmt-seg">
              <button :class="{ on: format === 'png' }" @click="format = 'png'">PNG</button>
              <button :class="{ on: format === 'jpg' }" @click="format = 'jpg'">JPG</button>
            </div>
            <div class="ctrl" v-if="format === 'jpg'">
              <div class="ctrl-label">{{ t('img2.quality') }}<span class="val">{{ quality }}</span></div>
              <input type="range" class="range-in" min="10" max="100" step="1" v-model.number="quality" />
            </div>
          </div>
          <div class="dl-row">
            <button class="btn cta" @click="exportImage">
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M14 10v3.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 13.5V10"/><polyline points="5 7 8 10 11 7"/><line x1="8" y1="10" x2="8" y2="2"/></svg>
              {{ t('img2.download') }}
            </button>
            <button class="btn" @click="copyResult">
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="5" width="9" height="9" rx="1.5"/><path d="M3 11V3.5A1.5 1.5 0 0 1 4.5 2H11"/></svg>
              {{ t('img2.copy') }}
            </button>
            <SendToMenu :payload="resultBlob" kind="image" from="/image/compose" />
          </div>
        </div>
      </div>

      <!-- RIGHT: layers + active-layer transform -->
      <div class="panel-col">
        <div class="panel-head">
          <h3 class="sec-title">{{ t('img2.compose.layers') }} · {{ layers.length }}</h3>
          <button class="btn small" @click="pickMore">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M8 3v10M3 8h10"/></svg>
            {{ t('img2.compose.addLayer') }}
          </button>
        </div>

        <!-- Layer list (top = front) -->
        <div class="layer-list">
          <div
            v-for="(l, i) in layers" :key="l.id"
            class="layer-row" :class="{ active: l.id === activeId, hidden: !l.visible }"
            @click="selectLayer(l)"
          >
            <button class="lr-ico" :title="l.visible ? t('img2.compose.hide') : t('img2.compose.show')" @click.stop="toggleVisible(l)">
              <svg v-if="l.visible" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8Z"/><circle cx="8" cy="8" r="2"/></svg>
              <svg v-else viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 4A6.7 6.7 0 0 1 8 3.5C12 3.5 14.5 8 14.5 8a11 11 0 0 1-1.8 2.2M3.4 4.4A11 11 0 0 0 1.5 8S4 12.5 8 12.5a6.4 6.4 0 0 0 2.4-.4M2 2l12 12"/></svg>
            </button>
            <img class="lr-thumb" :src="l.url" :alt="l.name" draggable="false" />
            <div class="lr-main">
              <div class="lr-name" :title="l.name">{{ l.name }}</div>
              <input
                type="range" class="lr-op range-in" min="0" max="100" step="1"
                :value="Math.round(l.opacity * 100)"
                @click.stop
                @input="setOpacity(l, $event.target.value)"
              />
            </div>
            <div class="lr-actions">
              <button class="lr-ico" :disabled="i === 0" :title="t('img2.compose.moveUp')" @click.stop="moveUp(i)">
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 10l4-4 4 4"/></svg>
              </button>
              <button class="lr-ico" :disabled="i === layers.length - 1" :title="t('img2.compose.moveDown')" @click.stop="moveDown(i)">
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6l4 4 4-4"/></svg>
              </button>
              <button class="lr-ico danger" :title="t('img2.remove')" @click.stop="removeLayer(i)">
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3 4h10M6.5 4V2.5h3V4M5 4l.5 9h5L11 4"/></svg>
              </button>
            </div>
          </div>
        </div>

        <!-- Active-layer transform -->
        <div v-if="activeLayer" class="card xf-card">
          <h3 class="sec-title">{{ t('img2.compose.transform') }}</h3>
          <div class="ctrl">
            <div class="ctrl-label">{{ t('img2.compose.size') }}<span class="val">{{ activeSizePct }}%</span></div>
            <input type="range" class="range-in" min="5" max="300" step="1" v-model.number="activeSizePct" />
          </div>
          <div class="ctrl">
            <div class="ctrl-label">{{ t('img2.wmRotation') }}<span class="val">{{ activeRotationDeg }}°</span></div>
            <input type="range" class="range-in" min="-180" max="180" step="1" v-model.number="activeRotationDeg" />
          </div>
          <div class="ctrl">
            <div class="ctrl-label">{{ t('img2.wmOpacity') }}<span class="val">{{ activeOpacityPct }}%</span></div>
            <input type="range" class="range-in" min="0" max="100" step="1" v-model.number="activeOpacityPct" />
          </div>
          <div class="xf-btns">
            <button class="btn small" @click="bringToFront" :title="t('img2.compose.toFront')">
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"><rect x="5.5" y="5.5" width="8" height="8" rx="1"/><path d="M2.5 10.5V3a.5.5 0 0 1 .5-.5h7.5"/></svg>
              {{ t('img2.compose.toFront') }}
            </button>
            <button class="btn small" @click="sendToBack" :title="t('img2.compose.toBack')">
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"><rect x="2.5" y="2.5" width="8" height="8" rx="1"/><path d="M13.5 5.5V13a.5.5 0 0 1-.5.5H5.5"/></svg>
              {{ t('img2.compose.toBack') }}
            </button>
            <button class="btn small" @click="duplicateActive">
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"><rect x="5" y="5" width="9" height="9" rx="1.5"/><path d="M3 11V3.5A1.5 1.5 0 0 1 4.5 2H11"/></svg>
              {{ t('img2.compose.duplicate') }}
            </button>
            <button class="btn small" @click="resetActive">
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8a5 5 0 1 1 1.6 3.7M3 12V8h4"/></svg>
              {{ t('img2.compose.resetLayer') }}
            </button>
          </div>
        </div>

        <div class="panel-foot">
          <button class="link-btn" @click="reset">{{ t('img2.clear') }}</button>
        </div>
      </div>
    </div>
  </ImageShell>
</template>

<style scoped>
.layout { display: grid; grid-template-columns: 1fr 320px; gap: 16px; align-items: start; }

/* ---- Stage ---- */
.stage-col { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.stage-scroll {
  background: var(--code-bg); border: 1px solid var(--border-light); border-radius: 12px;
  padding: 16px; display: flex; align-items: center; justify-content: center; overflow: auto;
}
/* Checkerboard behind transparent stage areas. */
.stage-wrap {
  position: relative; display: inline-block; line-height: 0; max-width: 100%;
  background-color: #fff;
  background-image:
    linear-gradient(45deg, #d8dade 25%, transparent 25%), linear-gradient(-45deg, #d8dade 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, #d8dade 75%), linear-gradient(-45deg, transparent 75%, #d8dade 75%);
  background-size: 18px 18px; background-position: 0 0, 0 9px, 9px -9px, -9px 0;
  box-shadow: var(--shadow-sm); touch-action: none;
}
.stage-canvas { display: block; max-width: 100%; max-height: 62vh; width: auto; height: auto; }
.stage-overlay { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; z-index: 2; }
.stage-hit { position: absolute; inset: 0; z-index: 3; touch-action: none; }

.sel-box { fill: none; stroke: var(--accent); stroke-width: 1.5; }
.sel-line { stroke: var(--accent); stroke-width: 1.5; }
.sel-rot { fill: var(--surface); stroke: var(--accent); stroke-width: 1.5; }
.sel-handle { fill: var(--surface); stroke: var(--accent); stroke-width: 1.5; }

.hint { font-size: 12px; color: var(--text-tertiary); line-height: 1.45; }

.stage-card, .export-card { display: flex; flex-direction: column; gap: 12px; }
.bg-seg { flex: 1; }
.bg-seg button { display: inline-flex; align-items: center; justify-content: center; }
.bg-seg svg { width: 15px; height: 15px; }
.sw { width: 15px; height: 15px; border-radius: 4px; border: 1px solid var(--border); display: inline-block; }
.sw-white { background: #fff; }
.sw-black { background: #000; }
.sw-custom { background: conic-gradient(#f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00); }
.fmt-seg { flex: 0 0 120px; }
.color-size { grid-template-columns: auto 1fr; align-items: end; }

/* ---- Layers panel ---- */
.panel-col { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.panel-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.sec-title { font-size: 12px; font-weight: 700; letter-spacing: 0.2px; text-transform: uppercase; color: var(--text-secondary); }
.panel-head .btn.small { flex: 0 0 auto; }

.layer-list { display: flex; flex-direction: column; gap: 6px; max-height: 46vh; overflow-y: auto; }
.layer-row {
  display: grid; grid-template-columns: auto 40px 1fr auto; align-items: center; gap: 8px;
  padding: 7px 8px; background: var(--surface); border: 1px solid var(--border-light);
  border-radius: var(--radius); cursor: pointer; transition: border-color 0.15s, background 0.15s;
}
.layer-row:hover { background: var(--surface-hover); }
.layer-row.active { border-color: var(--accent); background: var(--accent-bg); }
.layer-row.hidden .lr-thumb, .layer-row.hidden .lr-name { opacity: 0.4; }
.lr-thumb { width: 40px; height: 40px; object-fit: cover; border-radius: var(--radius-sm); background: var(--code-bg); }
.lr-main { min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.lr-name { font-size: 12px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lr-op { height: 18px; }
.lr-actions { display: flex; gap: 2px; }
.lr-ico {
  display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px;
  border: none; background: transparent; color: var(--text-secondary); border-radius: var(--radius-sm);
  cursor: pointer; transition: all 0.15s; flex-shrink: 0;
}
.lr-ico:hover:not(:disabled) { background: var(--surface-hover); color: var(--text); }
.lr-ico:disabled { opacity: 0.3; cursor: default; }
.lr-ico.danger:hover { color: var(--status-warn); background: var(--status-warn-bg); }
.lr-ico svg { width: 16px; height: 16px; }

/* ---- Active-layer transform ---- */
.xf-card { display: flex; flex-direction: column; gap: 12px; }
.xf-btns { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.xf-btns .btn { width: 100%; }
.panel-foot { display: flex; justify-content: flex-end; }

@media (max-width: 768px) {
  /* Single column: stage on top, panel below — matches every other image workbench on phones. */
  .layout { grid-template-columns: 1fr; gap: 12px; }
  .stage-canvas { max-height: 48vh; }
  .layer-list { max-height: none; }
  .stage-scroll { padding: 10px; }
}
</style>
