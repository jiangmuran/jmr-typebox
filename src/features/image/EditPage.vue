<script setup>
import { ref, reactive, computed, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useRouteHead } from '../../composables/useRouteHead'
import { useI18n } from '../../composables/useI18n'
import { useToast } from '../../composables/useToast'
import ClientOnly from '../../components/ClientOnly.vue'
import ImageDropZone from './ImageDropZone.vue'
import { useImageSource } from './useImageSource'
import { canvasToBlob, downloadBlob } from './canvasUtils'
import { pixelate, boxBlur, normalizeRect } from './redact'
import { withExtension, formatSize, clamp } from './imageHelpers'

const { meta: m } = useRouteHead()
const { t } = useI18n()
const { showToast } = useToast()

const src = useImageSource(onImageLoaded)

const canvasRef = ref(null)       // committed bitmap (base + baked annotations)
const overlayRef = ref(null)      // transient stroke/marquee preview
const wrapRef = ref(null)

const tool = ref('pen')           // 'pen' | 'text' | 'redact'
const penColor = ref('#ff3b30')
const penSize = ref(6)
const textColor = ref('#ff3b30')
const textSize = ref(36)
const redactMode = ref('mosaic')  // 'mosaic' | 'blur'
const redactStrength = ref(14)

// Undo/redo snapshot stacks (dataURLs — robust across resize and simple to restore).
const undoStack = ref([])
const redoStack = ref([])
const canUndo = computed(() => undoStack.value.length > 1)
const canRedo = computed(() => redoStack.value.length > 0)

// Display scale: canvas is at native resolution; CSS scales it down to fit. We map pointer
// coords through this factor so drawing lands on the right pixels.
const scale = ref(1)

// Active text-box editing state (DOM input overlay, baked on commit).
const textBox = reactive({ active: false, x: 0, y: 0, value: '' })

let ctx = null
let drawing = false
let startPt = null
let lastPt = null

onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))

function onImageLoaded({ image }) {
  nextTick(() => {
    const canvas = canvasRef.value
    if (!canvas) return
    canvas.width = image.naturalWidth
    canvas.height = image.naturalHeight
    ctx = canvas.getContext('2d')
    ctx.drawImage(image, 0, 0)
    syncOverlay()
    undoStack.value = []
    redoStack.value = []
    pushSnapshot()             // initial state
    computeScale()
  })
}

function syncOverlay() {
  const o = overlayRef.value
  const c = canvasRef.value
  if (!o || !c) return
  o.width = c.width
  o.height = c.height
}

function computeScale() {
  const c = canvasRef.value
  if (!c) return
  const rect = c.getBoundingClientRect()
  scale.value = rect.width / c.width || 1
}

// ---- Snapshot stack ----
function pushSnapshot() {
  const c = canvasRef.value
  if (!c) return
  undoStack.value.push(c.toDataURL('image/png'))
  if (undoStack.value.length > 40) undoStack.value.shift()
  redoStack.value = []
}

function restore(dataUrl) {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      const c = canvasRef.value
      ctx.clearRect(0, 0, c.width, c.height)
      ctx.drawImage(img, 0, 0)
      resolve()
    }
    img.src = dataUrl
  })
}

async function undo() {
  if (!canUndo.value) return
  redoStack.value.push(undoStack.value.pop())
  await restore(undoStack.value[undoStack.value.length - 1])
}
async function redo() {
  if (!canRedo.value) return
  const snap = redoStack.value.pop()
  undoStack.value.push(snap)
  await restore(snap)
}

function onKey(e) {
  if (textBox.active) return
  const meta = e.metaKey || e.ctrlKey
  if (meta && e.key.toLowerCase() === 'z') {
    e.preventDefault()
    if (e.shiftKey) redo(); else undo()
  } else if (meta && e.key.toLowerCase() === 'y') {
    e.preventDefault(); redo()
  }
}

// ---- Pointer helpers ----
function pointFromEvent(e) {
  const c = canvasRef.value
  const rect = c.getBoundingClientRect()
  const cx = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left
  const cy = (e.touches ? e.touches[0].clientY : e.clientY) - rect.top
  return { x: cx / scale.value, y: cy / scale.value }
}

function onPointerDown(e) {
  if (!ctx) return
  if (tool.value === 'text') { placeTextBox(e); return }
  e.preventDefault()
  computeScale()
  drawing = true
  startPt = lastPt = pointFromEvent(e)
  if (tool.value === 'pen') {
    ctx.strokeStyle = penColor.value
    ctx.lineWidth = penSize.value
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.beginPath()
    ctx.moveTo(startPt.x, startPt.y)
  }
}

function onPointerMove(e) {
  if (!drawing || !ctx) return
  e.preventDefault()
  const p = pointFromEvent(e)
  if (tool.value === 'pen') {
    ctx.lineTo(p.x, p.y)
    ctx.stroke()
  } else if (tool.value === 'redact') {
    drawMarquee(startPt, p)
  }
  lastPt = p
}

function onPointerUp() {
  if (!drawing) return
  drawing = false
  if (tool.value === 'pen') {
    pushSnapshot()
  } else if (tool.value === 'redact') {
    clearOverlay()
    applyRedact(normalizeRect(startPt.x, startPt.y, lastPt.x, lastPt.y))
  }
}

function drawMarquee(a, b) {
  const o = overlayRef.value
  const octx = o.getContext('2d')
  octx.clearRect(0, 0, o.width, o.height)
  const r = normalizeRect(a.x, a.y, b.x, b.y)
  octx.fillStyle = 'rgba(99,102,241,0.18)'
  octx.strokeStyle = 'rgba(99,102,241,0.9)'
  octx.lineWidth = 2 / scale.value
  octx.setLineDash([6 / scale.value, 4 / scale.value])
  octx.fillRect(r.x, r.y, r.w, r.h)
  octx.strokeRect(r.x, r.y, r.w, r.h)
}
function clearOverlay() {
  const o = overlayRef.value
  if (o) o.getContext('2d').clearRect(0, 0, o.width, o.height)
}

function applyRedact(rect) {
  if (rect.w < 3 || rect.h < 3 || !ctx) return
  const c = canvasRef.value
  const x = clamp(rect.x, 0, c.width)
  const y = clamp(rect.y, 0, c.height)
  const w = Math.min(rect.w, c.width - x)
  const h = Math.min(rect.h, c.height - y)
  if (w < 1 || h < 1) return
  const region = ctx.getImageData(x, y, w, h)
  const local = { x: 0, y: 0, w, h }
  if (redactMode.value === 'mosaic') {
    pixelate(region, local, Math.max(2, redactStrength.value))
  } else {
    boxBlur(region, local, Math.max(2, Math.round(redactStrength.value / 2)), 3)
  }
  ctx.putImageData(region, x, y)
  pushSnapshot()
}

// ---- Text box ----
function placeTextBox(e) {
  if (textBox.active) { commitTextBox(); return }
  const p = pointFromEvent(e)
  textBox.x = p.x
  textBox.y = p.y
  textBox.value = ''
  textBox.active = true
  nextTick(() => {
    const el = document.querySelector('.text-edit')
    if (el) el.focus()
  })
}

// Position of the editing overlay in CSS pixels (canvas space * scale).
const textBoxStyle = computed(() => ({
  left: `${textBox.x * scale.value}px`,
  top: `${textBox.y * scale.value}px`,
  color: textColor.value,
  fontSize: `${textSize.value * scale.value}px`,
}))

function commitTextBox() {
  if (!textBox.active) return
  const val = textBox.value
  textBox.active = false
  if (!val.trim() || !ctx) return
  ctx.fillStyle = textColor.value
  ctx.textBaseline = 'top'
  ctx.font = `600 ${textSize.value}px -apple-system, "Helvetica Neue", "PingFang SC", "Microsoft YaHei", sans-serif`
  // Support multi-line text.
  const lines = val.split('\n')
  const lh = textSize.value * 1.25
  lines.forEach((line, i) => ctx.fillText(line, textBox.x, textBox.y + i * lh))
  pushSnapshot()
}
function cancelTextBox() { textBox.active = false; textBox.value = '' }

async function exportPng() {
  if (textBox.active) commitTextBox()
  const c = canvasRef.value
  if (!c) return
  const blob = await canvasToBlob(c, 'image/png')
  if (!blob) { showToast(t('img2.unsupported')); return }
  downloadBlob(blob, withExtension(src.name.value, 'png'))
  showToast(`${formatSize(blob.size)} · PNG`)
}

function reset() {
  cancelTextBox()
  undoStack.value = []
  redoStack.value = []
  src.reset()
}

function onResize() { computeScale() }
onMounted(() => window.addEventListener('resize', onResize))
onBeforeUnmount(() => window.removeEventListener('resize', onResize))
</script>

<template>
  <div class="route-page">
    <h1 class="sr-only">{{ m.h1 }}</h1>
    <ClientOnly>
      <main class="img-wrap wide">
        <header class="img-head">
          <h2>{{ t('img2.edit.title') }}</h2>
          <p>{{ t('img2.edit.sub') }}</p>
        </header>

        <ImageDropZone
          v-if="!src.image.value"
          :title="t('img2.drop')"
          :hint="t('img2.browse')"
          :drag-over="src.dragOver.value"
          @pick="src.openPicker"
          @drop="src.onDrop"
          @dragover="src.onDragOver"
          @dragleave="src.onDragLeave"
          @file="src.setFile"
        />

        <template v-else>
          <!-- Toolbar -->
          <div class="toolbar">
            <div class="tool-group">
              <button class="tool" :class="{ on: tool === 'pen' }" :title="t('img2.toolPen')" @click="tool = 'pen'">
                <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M13 3l4 4L8 16l-5 1 1-5z"/></svg>
              </button>
              <button class="tool" :class="{ on: tool === 'text' }" :title="t('img2.toolText')" @click="tool = 'text'">
                <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M4 5h12M10 5v11M7 16h6"/></svg>
              </button>
              <button class="tool" :class="{ on: tool === 'redact' }" :title="t('img2.toolRedact')" @click="tool = 'redact'">
                <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><rect x="3" y="6" width="14" height="8" rx="1"/><path d="M5 8h2M9 8h2M13 8h2M6 12h2M10 12h2"/></svg>
              </button>
            </div>

            <div class="tool-divider"></div>

            <!-- Contextual options -->
            <div class="tool-options">
              <template v-if="tool === 'pen'">
                <input type="color" v-model="penColor" class="color-input" :title="t('img2.color')" />
                <label class="inline">{{ t('img2.size') }}
                  <input type="range" v-model.number="penSize" min="1" max="40" step="1" />
                </label>
              </template>
              <template v-else-if="tool === 'text'">
                <input type="color" v-model="textColor" class="color-input" :title="t('img2.color')" />
                <label class="inline">{{ t('img2.fontSize') }}
                  <input type="range" v-model.number="textSize" min="12" max="120" step="2" />
                </label>
              </template>
              <template v-else>
                <div class="seg small">
                  <button :class="{ on: redactMode === 'mosaic' }" @click="redactMode = 'mosaic'">{{ t('img2.mosaic') }}</button>
                  <button :class="{ on: redactMode === 'blur' }" @click="redactMode = 'blur'">{{ t('img2.blur') }}</button>
                </div>
                <label class="inline">{{ t('img2.strength') }}
                  <input type="range" v-model.number="redactStrength" min="4" max="40" step="1" />
                </label>
              </template>
            </div>

            <div class="tool-divider"></div>

            <div class="tool-group">
              <button class="tool" :disabled="!canUndo" :title="t('img2.undo')" @click="undo">
                <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M7 7L3 11l4 4"/><path d="M3 11h9a5 5 0 0 1 0 10H8"/></svg>
              </button>
              <button class="tool" :disabled="!canRedo" :title="t('img2.redo')" @click="redo">
                <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M13 7l4 4-4 4"/><path d="M17 11H8a5 5 0 0 0 0 10h4"/></svg>
              </button>
            </div>
          </div>

          <!-- Canvas stage -->
          <div ref="wrapRef" class="stage" :class="`tool-${tool}`">
            <canvas ref="canvasRef" class="base"></canvas>
            <canvas
              ref="overlayRef"
              class="overlay"
              @mousedown="onPointerDown"
              @mousemove="onPointerMove"
              @mouseup="onPointerUp"
              @mouseleave="onPointerUp"
              @touchstart.prevent="onPointerDown"
              @touchmove.prevent="onPointerMove"
              @touchend.prevent="onPointerUp"
            ></canvas>
            <textarea
              v-if="textBox.active"
              v-model="textBox.value"
              class="text-edit"
              :style="textBoxStyle"
              rows="1"
              :placeholder="t('img2.typeHere')"
              @blur="commitTextBox"
              @keydown.esc.prevent="cancelTextBox"
              @keydown.enter.exact.prevent="commitTextBox"
            ></textarea>
          </div>

          <div class="bottom-bar">
            <span class="hint">{{ tool === 'text' ? t('img2.textHint') : tool === 'redact' ? t('img2.redactHint') : t('img2.penHint') }}</span>
            <div class="bottom-actions">
              <button class="btn" @click="reset">{{ t('img2.change') }}</button>
              <button class="btn primary" @click="exportPng">
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M14 10v3.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 13.5V10"/><polyline points="5 7 8 10 11 7"/><line x1="8" y1="10" x2="8" y2="2"/></svg>
                {{ t('img2.download') }}
              </button>
            </div>
          </div>
        </template>
      </main>
    </ClientOnly>
  </div>
</template>

<style scoped>
.route-page { flex: 1; display: flex; flex-direction: column; min-height: 0; overflow: hidden; }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }

.img-wrap { flex: 1; overflow-y: auto; width: 100%; margin: 0 auto; padding: 24px 20px 40px; animation: imgIn 0.32s var(--ease-out); }
.img-wrap.wide { max-width: 960px; }
@keyframes imgIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
.img-head { margin-bottom: 16px; }
.img-head h2 { font-size: 22px; font-weight: 750; letter-spacing: -0.4px; }
.img-head p { margin-top: 5px; color: var(--text-secondary); font-size: 13px; }

.toolbar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding: 8px 10px; background: var(--surface); border: 1px solid var(--border-light); border-radius: var(--radius); margin-bottom: 12px; }
.tool-group { display: flex; gap: 4px; }
.tool { display: inline-flex; align-items: center; justify-content: center; width: 34px; height: 34px; border: 1px solid transparent; border-radius: var(--radius-sm); background: transparent; color: var(--text-secondary); cursor: pointer; transition: all 0.15s; }
.tool:hover { background: var(--surface-hover); color: var(--text); }
.tool.on { background: var(--accent-bg); border-color: var(--accent); color: var(--accent); }
.tool:disabled { opacity: 0.35; cursor: not-allowed; }
.tool svg { width: 18px; height: 18px; }
.tool-divider { width: 1px; align-self: stretch; background: var(--border-light); margin: 2px 0; }
.tool-options { display: flex; align-items: center; gap: 12px; flex: 1; min-width: 180px; }

.color-input { width: 34px; height: 30px; padding: 2px; border: 1px solid var(--border-light); border-radius: var(--radius-sm); background: var(--surface-hover); cursor: pointer; }
.inline { display: flex; align-items: center; gap: 8px; font-size: 11px; color: var(--text-secondary); flex: 1; }
.inline input[type="range"] { flex: 1; accent-color: var(--accent); min-width: 80px; }
.seg.small { display: flex; background: var(--surface-hover); border-radius: var(--radius-sm); padding: 2px; gap: 2px; }
.seg.small button { padding: 5px 12px; border: none; border-radius: 5px; font-size: 11px; font-weight: 500; background: transparent; color: var(--text-secondary); cursor: pointer; font-family: var(--font-sans); }
.seg.small button.on { background: var(--surface); color: var(--text); box-shadow: var(--shadow-xs); }

.stage { position: relative; display: inline-block; max-width: 100%; background: var(--code-bg); border: 1px solid var(--border-light); border-radius: var(--radius); overflow: hidden; line-height: 0; }
.stage.tool-pen .overlay, .stage.tool-redact .overlay { cursor: crosshair; }
.stage.tool-text .overlay { cursor: text; }
.stage .base, .stage .overlay { max-width: 100%; height: auto; display: block; }
.stage .overlay { position: absolute; inset: 0; touch-action: none; }

.text-edit {
  position: absolute; transform: translateY(0); background: transparent; border: 1px dashed var(--accent);
  outline: none; resize: none; overflow: hidden; padding: 0; margin: 0; min-width: 40px;
  font-family: -apple-system, "Helvetica Neue", "PingFang SC", "Microsoft YaHei", sans-serif;
  font-weight: 600; line-height: 1.25; white-space: pre; caret-color: var(--accent);
}

.bottom-bar { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 14px; flex-wrap: wrap; }
.hint { font-size: 12px; color: var(--text-tertiary); }
.bottom-actions { display: flex; gap: 8px; }
.btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; padding: 9px 14px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); color: var(--text); font-size: 13px; font-weight: 500; font-family: var(--font-sans); cursor: pointer; transition: all 0.15s; }
.btn:hover { background: var(--surface-hover); }
.btn:active { transform: scale(0.98); }
.btn svg { width: 15px; height: 15px; }
.btn.primary { background: var(--text); color: var(--bg); border-color: var(--text); }
.btn.primary:hover { opacity: 0.9; }
</style>
