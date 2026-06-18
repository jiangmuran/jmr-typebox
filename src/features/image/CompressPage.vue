<script setup>
import { ref, computed, watch } from 'vue'
import { useRouteHead } from '../../composables/useRouteHead'
import { useI18n } from '../../composables/useI18n'
import { useToast } from '../../composables/useToast'
import ClientOnly from '../../components/ClientOnly.vue'
import ImageDropZone from './ImageDropZone.vue'
import { useImageSource } from './useImageSource'
import { drawToCanvas, encodeCanvas, downloadBlob } from './canvasUtils'
import {
  formatSize, fitDimensions, withExtension, reductionPercent, isLossy, formatForMime,
} from './imageHelpers'

const { meta: m } = useRouteHead()
const { t } = useI18n()
const { showToast } = useToast()

const src = useImageSource(onLoaded)

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

const saved = computed(() =>
  result.value ? reductionPercent(src.size.value, result.value.size) : 0
)
</script>

<template>
  <div class="route-page">
    <h1 class="sr-only">{{ m.h1 }}</h1>
    <ClientOnly>
      <main class="img-wrap">
        <header class="img-head">
          <h2>{{ t('img2.compress.title') }}</h2>
          <p>{{ t('img2.compress.sub') }}</p>
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
          <div class="preview-card">
            <img :src="src.objectUrl.value" :alt="src.name.value" />
            <div class="preview-meta">
              <span>{{ src.name.value }}</span>
              <button class="link-btn" @click="src.reset()">{{ t('img2.change') }}</button>
            </div>
          </div>

          <div class="card controls">
            <div class="ctrl">
              <label>{{ t('img2.format') }}</label>
              <div class="seg">
                <button :class="{ on: format === 'jpg' }" @click="format = 'jpg'">JPG</button>
                <button :class="{ on: format === 'webp' }" @click="format = 'webp'">WebP</button>
                <button :class="{ on: format === 'png' }" @click="format = 'png'">PNG</button>
              </div>
            </div>

            <div v-if="isLossy(format)" class="ctrl">
              <label>{{ t('img2.quality') }}: {{ quality }}%</label>
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
            <div class="arrow">→</div>
            <div class="stat">
              <span class="stat-label">{{ t('img2.after') }}</span>
              <strong>{{ result ? formatSize(result.size) : '—' }}</strong>
              <em>{{ result ? `${result.width}×${result.height}` : '…' }}</em>
            </div>
            <div class="badge" :class="{ neg: saved < 0 }" v-if="result">
              {{ saved >= 0 ? '−' : '+' }}{{ Math.abs(saved) }}%
            </div>
          </div>

          <button class="btn primary block" :disabled="!result || working" @click="download">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M14 10v3.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 13.5V10"/><polyline points="5 7 8 10 11 7"/><line x1="8" y1="10" x2="8" y2="2"/></svg>
            {{ t('img2.download') }}
          </button>
        </template>
      </main>
    </ClientOnly>
  </div>
</template>

<style scoped>
.route-page { flex: 1; display: flex; flex-direction: column; min-height: 0; overflow: hidden; }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }

.img-wrap { flex: 1; overflow-y: auto; max-width: 560px; width: 100%; margin: 0 auto; padding: 28px 20px 48px; animation: imgIn 0.32s var(--ease-out); }
@keyframes imgIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
.img-head { margin-bottom: 18px; }
.img-head h2 { font-size: 22px; font-weight: 750; letter-spacing: -0.4px; }
.img-head p { margin-top: 5px; color: var(--text-secondary); font-size: 13px; }

.preview-card { background: var(--surface); border: 1px solid var(--border-light); border-radius: var(--radius-lg); overflow: hidden; }
.preview-card img { width: 100%; max-height: 260px; object-fit: contain; background: var(--code-bg); display: block; }
.preview-meta { display: flex; align-items: center; gap: 8px; padding: 8px 12px; font-size: 11px; color: var(--text-secondary); border-top: 1px solid var(--border-light); }
.preview-meta span { flex: 1; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.link-btn { border: none; background: none; color: var(--accent); font-size: 11px; cursor: pointer; font-family: var(--font-sans); }
.link-btn:hover { text-decoration: underline; }

.card { background: var(--surface); border: 1px solid var(--border-light); border-radius: var(--radius-lg); padding: 14px; margin-top: 12px; }
.controls { display: flex; flex-direction: column; gap: 12px; }
.ctrl label { display: block; font-size: 11px; font-weight: 500; color: var(--text-secondary); margin-bottom: 5px; }
.note { font-size: 11px; color: var(--text-tertiary); }

.seg { display: flex; background: var(--surface-hover); border-radius: var(--radius-sm); padding: 2px; gap: 2px; }
.seg button { flex: 1; padding: 6px; border: none; border-radius: 5px; font-size: 11px; font-weight: 500; background: transparent; color: var(--text-secondary); cursor: pointer; transition: all 0.15s; font-family: var(--font-sans); }
.seg button.on { background: var(--surface); color: var(--text); box-shadow: var(--shadow-xs); }

input[type="range"] { width: 100%; accent-color: var(--accent); }
.num-input { width: 100%; padding: 8px 10px; border: 1px solid var(--border-light); border-radius: var(--radius-sm); background: var(--surface-hover); color: var(--text); font-size: 12px; font-family: var(--font-mono); outline: none; }
.num-input:focus { border-color: var(--accent); }

.stats { display: flex; align-items: center; gap: 14px; position: relative; }
.stat { flex: 1; display: flex; flex-direction: column; gap: 2px; }
.stat-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-tertiary); }
.stat strong { font-size: 18px; font-weight: 700; }
.stat em { font-size: 11px; color: var(--text-secondary); font-style: normal; font-family: var(--font-mono); }
.arrow { color: var(--text-tertiary); font-size: 16px; }
.badge { position: absolute; top: 10px; right: 12px; font-size: 11px; font-weight: 700; color: var(--status-ok); background: var(--status-ok-bg); padding: 3px 8px; border-radius: 20px; }
.badge.neg { color: var(--status-warn); background: var(--status-warn-bg); }

.btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; padding: 10px 14px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); color: var(--text); font-size: 13px; font-weight: 500; font-family: var(--font-sans); cursor: pointer; transition: all 0.15s; }
.btn:hover { background: var(--surface-hover); }
.btn:active { transform: scale(0.98); }
.btn svg { width: 15px; height: 15px; }
.btn.primary { background: var(--text); color: var(--bg); border-color: var(--text); }
.btn.primary:hover { opacity: 0.9; }
.btn:disabled { opacity: 0.5; cursor: not-allowed; }
.btn.block { width: 100%; margin-top: 12px; }
</style>
