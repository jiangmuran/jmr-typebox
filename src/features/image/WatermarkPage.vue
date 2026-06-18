<script setup>
import { ref, watch, nextTick } from 'vue'
import { useRouteHead } from '../../composables/useRouteHead'
import { useI18n } from '../../composables/useI18n'
import { useToast } from '../../composables/useToast'
import ClientOnly from '../../components/ClientOnly.vue'
import ImageDropZone from './ImageDropZone.vue'
import { useImageSource } from './useImageSource'
import { loadImageFromBlob, canvasToBlob, downloadBlob, pickImageFiles } from './canvasUtils'
import {
  formatSize, withExtension, anchorPosition, tilePositions, GRID_POSITIONS, clamp,
} from './imageHelpers'

const { meta: m } = useRouteHead()
const { t } = useI18n()
const { showToast } = useToast()

const src = useImageSource(() => nextTick(render))

const mode = ref('text')             // 'text' | 'image'
const text = ref('TypeBox')
const color = ref('#ffffff')
const fontSize = ref(8)              // percent of image width
const wmImage = ref(null)            // HTMLImageElement for image watermark
const wmName = ref('')
const position = ref('bottom-right')
const opacity = ref(50)
const rotation = ref(0)
const scale = ref(20)                // image watermark width as % of base width
const tile = ref(false)
const margin = ref(3)                // percent of min(w,h)

const canvasRef = ref(null)

watch(
  [mode, text, color, fontSize, position, opacity, rotation, scale, tile, margin, wmImage],
  () => nextTick(render)
)

async function pickWatermarkImage() {
  const files = await pickImageFiles({ multiple: false })
  if (!files[0]) return
  try {
    wmImage.value = await loadImageFromBlob(files[0])
    wmName.value = files[0].name
    mode.value = 'image'
  } catch { showToast(t('img2.unsupported')) }
}

// Render the base image + watermark onto the canvas at full resolution.
function render() {
  const base = src.image.value
  const canvas = canvasRef.value
  if (!base || !canvas) return
  const W = base.naturalWidth
  const H = base.naturalHeight
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  ctx.clearRect(0, 0, W, H)
  ctx.drawImage(base, 0, 0, W, H)
  ctx.globalAlpha = clamp(opacity.value, 0, 100) / 100

  if (mode.value === 'text' && text.value) drawTextWatermark(ctx, W, H)
  else if (mode.value === 'image' && wmImage.value) drawImageWatermark(ctx, W, H)

  ctx.globalAlpha = 1
}

function drawOne(ctx, cx, cy, boxW, boxH, paint) {
  ctx.save()
  ctx.translate(cx, cy)
  ctx.rotate((rotation.value * Math.PI) / 180)
  paint(ctx, boxW, boxH)
  ctx.restore()
}

function drawTextWatermark(ctx, W, H) {
  const px = Math.max(8, Math.round((fontSize.value / 100) * W))
  ctx.font = `600 ${px}px ${getComputedFont()}`
  ctx.fillStyle = color.value
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const metrics = ctx.measureText(text.value)
  const boxW = metrics.width
  const boxH = px
  paintPositions(ctx, W, H, boxW, boxH, (c) => { c.fillText(text.value, 0, 0) })
}

function drawImageWatermark(ctx, W, H) {
  const img = wmImage.value
  const boxW = Math.max(1, Math.round((scale.value / 100) * W))
  const boxH = Math.max(1, Math.round(boxW * (img.naturalHeight / img.naturalWidth)))
  paintPositions(ctx, W, H, boxW, boxH, (c) => { c.drawImage(img, -boxW / 2, -boxH / 2, boxW, boxH) })
}

// Place the watermark either tiled across the canvas or at a single 9-grid anchor.
function paintPositions(ctx, W, H, boxW, boxH, paint) {
  if (tile.value) {
    const gapX = boxW + Math.max(boxW * 0.6, 40)
    const gapY = boxH + Math.max(boxH * 1.2, 40)
    for (const p of tilePositions(W, H, gapX, gapY)) {
      drawOne(ctx, p.x, p.y, boxW, boxH, paint)
    }
  } else {
    const mg = (margin.value / 100) * Math.min(W, H)
    const { x, y } = anchorPosition(W, H, boxW, boxH, position.value, mg)
    drawOne(ctx, x + boxW / 2, y + boxH / 2, boxW, boxH, paint)
  }
}

function getComputedFont() {
  return '-apple-system, "Helvetica Neue", "PingFang SC", "Microsoft YaHei", sans-serif'
}

async function download() {
  const canvas = canvasRef.value
  if (!canvas || !src.image.value) return
  const blob = await canvasToBlob(canvas, 'image/png')
  if (!blob) { showToast(t('img2.unsupported')); return }
  downloadBlob(blob, withExtension(src.name.value, 'png'))
  showToast(`${formatSize(blob.size)} · PNG`)
}

function reset() { src.reset() }
</script>

<template>
  <div class="route-page">
    <h1 class="sr-only">{{ m.h1 }}</h1>
    <ClientOnly>
      <main class="img-wrap wide">
        <header class="img-head">
          <h2>{{ t('img2.watermark.title') }}</h2>
          <p>{{ t('img2.watermark.sub') }}</p>
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
        />

        <div v-else class="layout">
          <div class="preview-pane">
            <div class="canvas-frame">
              <canvas ref="canvasRef"></canvas>
            </div>
            <div class="preview-meta">
              <span>{{ src.name.value }} · {{ src.width.value }}×{{ src.height.value }}</span>
              <button class="link-btn" @click="reset">{{ t('img2.change') }}</button>
            </div>
          </div>

          <div class="control-pane">
            <div class="card">
              <div class="ctrl">
                <label>{{ t('img2.wmType') }}</label>
                <div class="seg">
                  <button :class="{ on: mode === 'text' }" @click="mode = 'text'">{{ t('img2.wmText') }}</button>
                  <button :class="{ on: mode === 'image' }" @click="mode = 'image'">{{ t('img2.wmImage') }}</button>
                </div>
              </div>

              <template v-if="mode === 'text'">
                <div class="ctrl">
                  <label>{{ t('img2.wmTextLabel') }}</label>
                  <input type="text" v-model="text" class="text-input" :placeholder="t('img2.wmTextLabel')" />
                </div>
                <div class="ctrl-grid">
                  <div class="ctrl">
                    <label>{{ t('img2.wmColor') }}</label>
                    <input type="color" v-model="color" class="color-input" />
                  </div>
                  <div class="ctrl">
                    <label>{{ t('img2.wmFontSize') }}: {{ fontSize }}%</label>
                    <input type="range" v-model.number="fontSize" min="2" max="30" step="1" />
                  </div>
                </div>
              </template>

              <template v-else>
                <div class="ctrl">
                  <label>{{ t('img2.wmImageLabel') }}</label>
                  <button class="btn small" @click="pickWatermarkImage">
                    {{ wmName || t('img2.wmPick') }}
                  </button>
                </div>
                <div class="ctrl">
                  <label>{{ t('img2.wmScale') }}: {{ scale }}%</label>
                  <input type="range" v-model.number="scale" min="5" max="80" step="1" />
                </div>
              </template>
            </div>

            <div class="card">
              <div class="ctrl">
                <label>{{ t('img2.wmPosition') }}</label>
                <div class="grid9" :class="{ disabled: tile }">
                  <button
                    v-for="p in GRID_POSITIONS" :key="p"
                    :class="{ on: position === p }"
                    :disabled="tile"
                    :aria-label="p"
                    @click="position = p"
                  ><span></span></button>
                </div>
              </div>
              <label class="check">
                <input type="checkbox" v-model="tile" />
                <span>{{ t('img2.wmTile') }}</span>
              </label>
              <div class="ctrl" v-if="!tile">
                <label>{{ t('img2.wmMargin') }}: {{ margin }}%</label>
                <input type="range" v-model.number="margin" min="0" max="20" step="1" />
              </div>
              <div class="ctrl">
                <label>{{ t('img2.wmOpacity') }}: {{ opacity }}%</label>
                <input type="range" v-model.number="opacity" min="0" max="100" step="1" />
              </div>
              <div class="ctrl">
                <label>{{ t('img2.wmRotation') }}: {{ rotation }}°</label>
                <input type="range" v-model.number="rotation" min="-180" max="180" step="1" />
              </div>
            </div>

            <button class="btn primary block" @click="download">
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M14 10v3.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 13.5V10"/><polyline points="5 7 8 10 11 7"/><line x1="8" y1="10" x2="8" y2="2"/></svg>
              {{ t('img2.download') }}
            </button>
          </div>
        </div>
      </main>
    </ClientOnly>
  </div>
</template>

<style scoped>
.route-page { flex: 1; display: flex; flex-direction: column; min-height: 0; overflow: hidden; }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }

.img-wrap { flex: 1; overflow-y: auto; width: 100%; margin: 0 auto; padding: 28px 20px 48px; animation: imgIn 0.32s var(--ease-out); }
.img-wrap.wide { max-width: 960px; }
@keyframes imgIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
.img-head { margin-bottom: 18px; }
.img-head h2 { font-size: 22px; font-weight: 750; letter-spacing: -0.4px; }
.img-head p { margin-top: 5px; color: var(--text-secondary); font-size: 13px; }

.layout { display: grid; grid-template-columns: 1fr 300px; gap: 16px; align-items: start; }
@media (max-width: 760px) { .layout { grid-template-columns: 1fr; } }

.preview-pane { background: var(--surface); border: 1px solid var(--border-light); border-radius: var(--radius-lg); overflow: hidden; position: sticky; top: 0; }
.canvas-frame { background: var(--code-bg); display: flex; align-items: center; justify-content: center; padding: 12px; max-height: 70vh; }
.canvas-frame canvas { max-width: 100%; max-height: calc(70vh - 24px); object-fit: contain; border-radius: var(--radius-sm); box-shadow: var(--shadow-sm); }
.preview-meta { display: flex; align-items: center; gap: 8px; padding: 8px 12px; font-size: 11px; color: var(--text-secondary); border-top: 1px solid var(--border-light); }
.preview-meta span { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--font-mono); }
.link-btn { border: none; background: none; color: var(--accent); font-size: 11px; cursor: pointer; font-family: var(--font-sans); }
.link-btn:hover { text-decoration: underline; }

.control-pane { display: flex; flex-direction: column; gap: 12px; }
.card { background: var(--surface); border: 1px solid var(--border-light); border-radius: var(--radius-lg); padding: 14px; display: flex; flex-direction: column; gap: 12px; }
.ctrl label { display: block; font-size: 11px; font-weight: 500; color: var(--text-secondary); margin-bottom: 5px; }
.ctrl-grid { display: grid; grid-template-columns: auto 1fr; gap: 12px; align-items: end; }

.seg { display: flex; background: var(--surface-hover); border-radius: var(--radius-sm); padding: 2px; gap: 2px; }
.seg button { flex: 1; padding: 6px; border: none; border-radius: 5px; font-size: 11px; font-weight: 500; background: transparent; color: var(--text-secondary); cursor: pointer; transition: all 0.15s; font-family: var(--font-sans); }
.seg button.on { background: var(--surface); color: var(--text); box-shadow: var(--shadow-xs); }

input[type="range"] { width: 100%; accent-color: var(--accent); }
.text-input { width: 100%; padding: 8px 10px; border: 1px solid var(--border-light); border-radius: var(--radius-sm); background: var(--surface-hover); color: var(--text); font-size: 13px; font-family: var(--font-sans); outline: none; }
.text-input:focus { border-color: var(--accent); }
.color-input { width: 44px; height: 34px; padding: 2px; border: 1px solid var(--border-light); border-radius: var(--radius-sm); background: var(--surface-hover); cursor: pointer; }

.grid9 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px; aspect-ratio: 3 / 2; }
.grid9.disabled { opacity: 0.4; pointer-events: none; }
.grid9 button { display: flex; align-items: center; justify-content: center; border: 1px solid var(--border-light); border-radius: var(--radius-sm); background: var(--surface-hover); cursor: pointer; transition: all 0.15s; }
.grid9 button span { width: 7px; height: 7px; border-radius: 50%; background: var(--text-tertiary); transition: all 0.15s; }
.grid9 button:hover { border-color: var(--accent); }
.grid9 button.on { background: var(--accent-bg); border-color: var(--accent); }
.grid9 button.on span { background: var(--accent); }

.check { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--text); cursor: pointer; }
.check input { accent-color: var(--accent); }

.btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; padding: 10px 14px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); color: var(--text); font-size: 13px; font-weight: 500; font-family: var(--font-sans); cursor: pointer; transition: all 0.15s; }
.btn:hover { background: var(--surface-hover); }
.btn:active { transform: scale(0.98); }
.btn.small { padding: 8px 10px; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.btn svg { width: 15px; height: 15px; }
.btn.primary { background: var(--text); color: var(--bg); border-color: var(--text); }
.btn.primary:hover { opacity: 0.9; }
.btn.block { width: 100%; }
</style>
