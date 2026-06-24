<script setup>
import { ref, watch, nextTick } from 'vue'
import { useRouteHead } from '../../composables/useRouteHead'
import { useI18n } from '../../composables/useI18n'
import { useToast } from '../../composables/useToast'
import ImageShell from './ImageShell.vue'
import ImageDropZone from './ImageDropZone.vue'
import { useImageSource } from './useImageSource'
import { loadImageFromBlob, canvasToBlob, downloadBlob, pickImageFiles, copyImageToClipboard } from './canvasUtils'
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
async function copyImg() {
  const canvas = canvasRef.value
  if (!canvas || !src.image.value) return
  const blob = await canvasToBlob(canvas, 'image/png')
  if (!blob) { showToast(t('img2.unsupported')); return }
  try { await copyImageToClipboard(blob); showToast(t('img2.copied')) }
  catch { showToast(t('img2.copyUnsupported')) }
}

function reset() { src.reset() }
</script>

<template>
  <ImageShell wide :h1="m.h1" :title="t('img2.watermark.title')" :sub="t('img2.watermark.sub')">
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
      <div class="canvas-pane preview-pane">
        <div class="canvas-frame">
          <canvas ref="canvasRef"></canvas>
        </div>
        <div class="preview-meta">
          <span class="meta-name mono">{{ src.name.value }} · {{ src.width.value }}×{{ src.height.value }}</span>
          <button class="link-btn" @click="reset">{{ t('img2.change') }}</button>
        </div>
      </div>

      <div class="control-pane">
        <div class="card card-stack">
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
            <div class="ctrl-row color-size">
              <div class="ctrl">
                <label>{{ t('img2.wmColor') }}</label>
                <input type="color" v-model="color" class="color-input" />
              </div>
              <div class="ctrl">
                <div class="ctrl-label"><span>{{ t('img2.wmFontSize') }}</span><span class="val">{{ fontSize }}%</span></div>
                <input type="range" v-model.number="fontSize" min="2" max="30" step="1" />
              </div>
            </div>
          </template>

          <template v-else>
            <div class="ctrl">
              <label>{{ t('img2.wmImageLabel') }}</label>
              <button class="btn small block" @click="pickWatermarkImage">
                {{ wmName || t('img2.wmPick') }}
              </button>
            </div>
            <div class="ctrl">
              <div class="ctrl-label"><span>{{ t('img2.wmScale') }}</span><span class="val">{{ scale }}%</span></div>
              <input type="range" v-model.number="scale" min="5" max="80" step="1" />
            </div>
          </template>
        </div>

        <div class="card card-stack">
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
            <div class="ctrl-label"><span>{{ t('img2.wmMargin') }}</span><span class="val">{{ margin }}%</span></div>
            <input type="range" v-model.number="margin" min="0" max="20" step="1" />
          </div>
          <div class="ctrl">
            <div class="ctrl-label"><span>{{ t('img2.wmOpacity') }}</span><span class="val">{{ opacity }}%</span></div>
            <input type="range" v-model.number="opacity" min="0" max="100" step="1" />
          </div>
          <div class="ctrl">
            <div class="ctrl-label"><span>{{ t('img2.wmRotation') }}</span><span class="val">{{ rotation }}°</span></div>
            <input type="range" v-model.number="rotation" min="-180" max="180" step="1" />
          </div>
        </div>

        <div class="dl-row">
          <button class="btn primary" @click="download">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M14 10v3.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 13.5V10"/><polyline points="5 7 8 10 11 7"/><line x1="8" y1="10" x2="8" y2="2"/></svg>
            {{ t('img2.download') }}
          </button>
          <button class="btn" @click="copyImg">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="5" width="9" height="9" rx="1.5"/><path d="M3 11V3.5A1.5 1.5 0 0 1 4.5 2H11"/></svg>
            {{ t('img2.copy') }}
          </button>
        </div>
      </div>
    </div>
  </ImageShell>
</template>

<style scoped>
/* Two-column workbench on desktop; the shared `.img-ui` rules collapse `.wide`
   to a single column ≤768px, and `.layout` follows suit below. */
.layout { display: grid; grid-template-columns: 1fr 300px; gap: 16px; align-items: start; }

.preview-pane { position: sticky; top: 0; }
.canvas-frame { max-height: 70vh; }
.canvas-frame canvas { max-height: calc(70vh - 28px); }
.preview-meta .mono { font-family: var(--font-mono); }

.control-pane { display: flex; flex-direction: column; gap: 12px; }

@media (max-width: 768px) {
  .layout { grid-template-columns: 1fr; gap: 12px; }
  /* On phones the preview must not stick (it would cover the controls) and is
     capped so the panel below stays within easy reach. */
  .preview-pane { position: static; }
  .canvas-frame { max-height: 46vh; }
  .canvas-frame canvas { max-height: calc(46vh - 28px); }
}
</style>
