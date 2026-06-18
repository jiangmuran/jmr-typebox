<script setup>
// Interactive audio converter body. Rendered only inside <ClientOnly>, so window/Blob/audio
// are safe here. Pure logic (formats, filenames, WAV writer) is in ./mediaHelpers; the engine
// (Web Audio decode + WAV + lamejs MP3) is lazy-loaded from ./audioRunner on convert.
import { ref, computed, onBeforeUnmount } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from '../../composables/useI18n'
import { useToast } from '../../composables/useToast'
import {
  converterForRoute, buildOutputName, extForFormat, isLossyFormat, formatSize, BITRATE_PRESETS,
} from './mediaHelpers'
import { convertAudio } from './audioRunner'

const route = useRoute()
const { t } = useI18n()
const { showToast } = useToast()

const conv = computed(() => converterForRoute(route.meta?.path || route.path) || { input: 'mp3', output: 'wav' })
const inFmt = computed(() => conv.value.input)
const outFmt = computed(() => conv.value.output)
const lossyOut = computed(() => isLossyFormat(outFmt.value))

const fileInput = ref(null)
const file = ref(null)
const fileName = ref('')
const fileSize = ref(0)
const dragOver = ref(false)
const bitrate = ref('')
const busy = ref(false)
const progress = ref(0)
const result = ref(null)

function accepts(name) {
  const ext = String(name || '').toLowerCase().split('.').pop()
  if (ext === inFmt.value) return true
  if (inFmt.value === 'mp3' && ext === 'mpga') return true
  if (inFmt.value === 'wav' && ext === 'wave') return true
  return false
}

function setFile(f) {
  if (!f) return
  if (!accepts(f.name) && !(f.type || '').startsWith('audio')) { showToast(t('media.unsupported')); return }
  revokeResult()
  file.value = f; fileName.value = f.name; fileSize.value = f.size
  result.value = null; progress.value = 0
}

function onPick(e) { setFile(e.target.files?.[0]); e.target.value = '' }
function openPicker() { fileInput.value?.click() }
function onDrop(e) { dragOver.value = false; setFile(e.dataTransfer?.files?.[0]) }
function onPaste(e) {
  const f = e.clipboardData?.files?.[0]
  if (f) { setFile(f); return }
  for (const it of e.clipboardData?.items || []) {
    if (it.kind === 'file') { const g = it.getAsFile(); if (g) { setFile(g); return } }
  }
}

const outputName = computed(() => buildOutputName(fileName.value || `audio.${extForFormat(inFmt.value)}`, outFmt.value))

async function runConvert() {
  if (!file.value || busy.value) return
  busy.value = true; progress.value = 0
  try {
    const blob = await convertAudio(file.value, {
      outputFormat: outFmt.value,
      options: { bitrate: lossyOut.value && bitrate.value ? bitrate.value : undefined },
      onProgress: ({ progress: p }) => { if (typeof p === 'number' && isFinite(p)) progress.value = Math.max(0, Math.min(1, p)) },
    })
    revokeResult()
    result.value = { blob, url: URL.createObjectURL(blob), name: outputName.value, size: blob.size }
    progress.value = 1
    showToast(t('media.done'))
  } catch (err) {
    showToast(t('media.failed'))
    console.error('[media] conversion failed:', err)
  } finally {
    busy.value = false
  }
}

function download() {
  if (!result.value) return
  const a = document.createElement('a')
  a.href = result.value.url; a.download = result.value.name
  document.body.appendChild(a); a.click(); a.remove()
}

function reset() {
  revokeResult()
  file.value = null; fileName.value = ''; fileSize.value = 0; result.value = null; progress.value = 0
}
function revokeResult() { if (result.value?.url) { try { URL.revokeObjectURL(result.value.url) } catch {} } }
onBeforeUnmount(revokeResult)

const progressPct = computed(() => Math.round(progress.value * 100))
const acceptAttr = computed(() => `.${inFmt.value},audio/*`)
</script>

<template>
  <main class="media" @paste="onPaste">
    <header class="media-head">
      <h2 class="media-title">{{ inFmt.toUpperCase() }} → {{ outFmt.toUpperCase() }}</h2>
      <p class="media-sub">{{ t('media.hint') }}</p>
    </header>

    <div
      v-if="!file"
      class="dropzone" :class="{ over: dragOver }" tabindex="0" role="button"
      @click="openPicker" @keydown.enter.prevent="openPicker" @keydown.space.prevent="openPicker"
      @dragover.prevent="dragOver = true" @dragleave.prevent="dragOver = false" @drop.prevent="onDrop"
    >
      <div class="dz-icon" aria-hidden="true">♪</div>
      <p class="dz-main">{{ t('media.drop') }}</p>
      <p class="dz-sub">{{ t('media.browse') }}</p>
    </div>

    <div v-else class="panel">
      <div class="file-row">
        <div class="file-meta">
          <span class="file-name" :title="fileName">{{ fileName }}</span>
          <span class="file-size">{{ formatSize(fileSize) }} · {{ t('media.from') }} {{ inFmt.toUpperCase() }} · {{ t('media.to') }} {{ outFmt.toUpperCase() }}</span>
        </div>
        <button class="link-btn" :disabled="busy" @click="reset">{{ t('media.change') }}</button>
      </div>

      <div v-if="lossyOut" class="control">
        <label class="control-label">{{ t('media.bitrate') }}</label>
        <select v-model="bitrate" class="select" :disabled="busy">
          <option value="">{{ t('media.bitrate.auto') }}</option>
          <option v-for="b in BITRATE_PRESETS" :key="b" :value="b">{{ b }}bps</option>
        </select>
      </div>

      <button class="convert-btn" :disabled="busy" @click="runConvert">
        {{ busy ? t('media.converting') : t('media.convert') }}
      </button>

      <div v-if="busy" class="progress">
        <div class="bar"><div class="bar-fill" :style="{ width: (progress > 0 ? progressPct : 8) + '%' }"></div></div>
        <span class="progress-pct">{{ progress > 0 ? progressPct + '%' : '' }}</span>
      </div>

      <div v-if="result" class="result">
        <div class="result-meta">
          <span class="result-name">{{ result.name }}</span>
          <span class="result-size">{{ formatSize(result.size) }}</span>
        </div>
        <audio class="player" :src="result.url" controls preload="metadata"></audio>
        <button class="download-btn" @click="download">{{ t('media.download') }}</button>
      </div>
    </div>

    <input ref="fileInput" type="file" :accept="acceptAttr" hidden @change="onPick" />
  </main>
</template>

<style scoped>
.media { flex: 1; overflow-y: auto; padding: 32px 24px 56px; max-width: 640px; margin: 0 auto; width: 100%; animation: tbIn 0.3s var(--ease-out); }
@keyframes tbIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
.media-head { margin-bottom: 20px; }
.media-title { font-size: 24px; font-weight: 750; letter-spacing: -0.5px; }
.media-sub { margin-top: 6px; color: var(--text-secondary); font-size: 13px; line-height: 1.5; }
.dropzone { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; padding: 48px 24px; border: 2px dashed var(--border); border-radius: 16px; background: var(--surface); cursor: pointer; text-align: center; transition: border-color 0.15s, background 0.15s, transform 0.15s; }
.dropzone:hover, .dropzone:focus-visible { border-color: var(--accent); outline: none; }
.dropzone.over { border-color: var(--accent); background: var(--surface-hover); transform: scale(1.01); }
.dz-icon { font-size: 34px; line-height: 1; color: var(--accent); }
.dz-main { font-size: 15px; font-weight: 600; color: var(--text); }
.dz-sub { font-size: 12px; color: var(--text-secondary); }
.panel { display: flex; flex-direction: column; gap: 14px; }
.file-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 14px 16px; border: 1px solid var(--border-light); border-radius: 12px; background: var(--surface); }
.file-meta { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.file-name { font-size: 14px; font-weight: 600; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.file-size { font-size: 11px; color: var(--text-secondary); }
.link-btn { flex-shrink: 0; border: none; background: var(--surface-hover); color: var(--text-secondary); font-size: 12px; padding: 5px 11px; border-radius: 7px; cursor: pointer; font-family: var(--font-sans); }
.link-btn:hover:not(:disabled) { color: var(--text); }
.link-btn:disabled { opacity: 0.5; cursor: default; }
.control { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.control-label { font-size: 12px; font-weight: 600; color: var(--text-secondary); }
.select { padding: 7px 11px; border: 1px solid var(--border); border-radius: 9px; background: var(--surface); color: var(--text); font-size: 13px; font-family: var(--font-sans); outline: none; cursor: pointer; }
.select:focus { border-color: var(--accent); }
.select:disabled { opacity: 0.5; }
.convert-btn { padding: 11px 16px; border: none; border-radius: 11px; background: var(--text); color: var(--bg); font-size: 14px; font-weight: 650; font-family: var(--font-sans); cursor: pointer; transition: opacity 0.15s, transform 0.1s; }
.convert-btn:hover:not(:disabled) { opacity: 0.9; }
.convert-btn:active:not(:disabled) { transform: scale(0.99); }
.convert-btn:disabled { opacity: 0.6; cursor: default; }
.progress { display: flex; align-items: center; gap: 10px; }
.bar { flex: 1; height: 8px; border-radius: 99px; background: var(--surface-hover); overflow: hidden; }
.bar-fill { height: 100%; background: var(--accent); border-radius: 99px; transition: width 0.2s ease; }
.progress-pct { font-size: 12px; color: var(--text-secondary); font-variant-numeric: tabular-nums; min-width: 36px; text-align: right; }
.result { display: flex; flex-direction: column; gap: 10px; padding: 14px 16px; border: 1px solid var(--border-light); border-radius: 12px; background: var(--surface); animation: tbIn 0.25s var(--ease-out); }
.result-meta { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
.result-name { font-size: 13px; font-weight: 600; color: var(--text); word-break: break-all; }
.result-size { font-size: 11px; color: var(--text-secondary); flex-shrink: 0; }
.player { width: 100%; height: 36px; }
.download-btn { align-self: flex-start; padding: 9px 18px; border: 1px solid var(--accent); border-radius: 9px; background: var(--accent); color: #fff; font-size: 13px; font-weight: 600; font-family: var(--font-sans); cursor: pointer; transition: opacity 0.15s; }
.download-btn:hover { opacity: 0.9; }
@media (max-width: 560px) { .media { padding: 20px 16px 48px; } .control { flex-direction: column; align-items: stretch; gap: 6px; } }
</style>
