<script setup>
import { ref, computed, watch } from 'vue'
import { useRouteHead } from '../../composables/useRouteHead'
import { useI18n } from '../../composables/useI18n'
import { useToast } from '../../composables/useToast'
import ImageShell from './ImageShell.vue'
import ImageDropZone from './ImageDropZone.vue'
import SendToMenu from '../../components/SendToMenu.vue'
import { useImageSource } from './useImageSource'
import { drawToCanvas, encodeCanvas, downloadBlob, copyImageToClipboard } from './canvasUtils'
import {
  formatSize, fitDimensions, withExtension, reductionPercent, isLossy, formatForMime,
} from './imageHelpers'

const { meta: m } = useRouteHead()
const { t } = useI18n()
const { showToast } = useToast()

const src = useImageSource(onLoaded)
// Toast when an image arrived from another tool's "Send to →" (loaded on mount by useImageSource).
watch(src.received, v => { if (v) showToast(t('handoff.received')) })

const format = ref('jpg')         // output format for the compressed copy
const quality = ref(80)
const maxWidth = ref(0)
const result = ref(null)          // { blob, width, height, size }
const working = ref(false)

// When a file loads, pick a sensible default output format matching the source.
function onLoaded({ file }) {
  const f = formatForMime(file.type)
  format.value = f === 'png' ? 'png' : f
  result.value = null
  scheduleEstimate()
}

const target = computed(() => fitDimensions(src.width.value, src.height.value, maxWidth.value))

// Debounced re-encode so dragging the slider stays smooth.
let timer = null
function scheduleEstimate() {
  clearTimeout(timer)
  timer = setTimeout(runCompress, 180)
}
watch([format, quality, maxWidth], () => { if (src.image.value) scheduleEstimate() })

async function runCompress() {
  if (!src.image.value) return
  working.value = true
  try {
    const { width, height } = target.value
    const bg = format.value === 'jpg' ? '#ffffff' : undefined
    const canvas = drawToCanvas(src.image.value, width, height, { background: bg })
    const enc = await encodeCanvas(canvas, format.value, quality.value)
    if (!enc) { showToast(t('img2.unsupported')); return }
    result.value = { blob: enc.blob, width, height, size: enc.blob.size }
  } finally {
    working.value = false
  }
}

function download() {
  if (!result.value) return
  downloadBlob(result.value.blob, withExtension(src.name.value, format.value))
  showToast(`${formatSize(result.value.size)} · ${format.value.toUpperCase()}`)
}
async function copyResult() {
  if (!result.value) return
  try { await copyImageToClipboard(result.value.blob); showToast(t('img2.copied')) }
  catch { showToast(t('img2.copyUnsupported')) }
}

const saved = computed(() =>
  result.value ? reductionPercent(src.size.value, result.value.size) : 0
)
</script>

<template>
  <ImageShell :h1="m.h1" :title="t('img2.compress.title')" :sub="t('img2.compress.sub')">
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

    <div v-else class="img-body">
      <div class="preview-card">
        <img :src="src.objectUrl.value" :alt="src.name.value" />
        <div class="preview-meta">
          <span class="meta-name">{{ src.name.value }}</span>
          <button class="link-btn" @click="src.reset()">{{ t('img2.change') }}</button>
        </div>
      </div>

      <div class="card card-stack">
        <div class="ctrl">
          <label>{{ t('img2.format') }}</label>
          <div class="seg">
            <button :class="{ on: format === 'jpg' }" @click="format = 'jpg'">JPG</button>
            <button :class="{ on: format === 'webp' }" @click="format = 'webp'">WebP</button>
            <button :class="{ on: format === 'png' }" @click="format = 'png'">PNG</button>
          </div>
        </div>

        <div v-if="isLossy(format)" class="ctrl">
          <div class="ctrl-label"><span>{{ t('img2.quality') }}</span><span class="val">{{ quality }}%</span></div>
          <input type="range" v-model.number="quality" min="10" max="100" step="1" />
        </div>
        <p v-else class="note">{{ t('img2.pngNote') }}</p>

        <div class="ctrl">
          <label>{{ t('img2.maxWidth') }}</label>
          <input type="number" v-model.number="maxWidth" min="0" max="10000" step="100" class="num-input" placeholder="0" />
        </div>
      </div>

      <div class="card stats">
        <div class="stat">
          <span class="stat-label">{{ t('img2.before') }}</span>
          <strong>{{ formatSize(src.size.value) }}</strong>
          <em>{{ src.width.value }}×{{ src.height.value }}</em>
        </div>
        <div class="stat-arrow">→</div>
        <div class="stat">
          <span class="stat-label">{{ t('img2.after') }}</span>
          <strong>{{ result ? formatSize(result.size) : '—' }}</strong>
          <em>{{ result ? `${result.width}×${result.height}` : '…' }}</em>
        </div>
        <div class="badge" :class="{ neg: saved < 0 }" v-if="result">
          {{ saved >= 0 ? '−' : '+' }}{{ Math.abs(saved) }}%
        </div>
      </div>

      <div class="dl-row">
        <button class="btn primary" :disabled="!result || working" @click="download">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M14 10v3.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 13.5V10"/><polyline points="5 7 8 10 11 7"/><line x1="8" y1="10" x2="8" y2="2"/></svg>
          {{ t('img2.download') }}
        </button>
        <button class="btn" :disabled="!result || working" @click="copyResult">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="5" width="9" height="9" rx="1.5"/><path d="M3 11V3.5A1.5 1.5 0 0 1 4.5 2H11"/></svg>
          {{ t('img2.copy') }}
        </button>
        <SendToMenu v-if="result" :payload="result.blob" kind="image" from="/image/compress" />
      </div>
    </div>
  </ImageShell>
</template>
