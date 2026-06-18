<script setup>
// Universal media converter body. Rendered only inside <ClientOnly>, so window/Blob/Worker are
// safe here. Pure logic (format catalog, arg building, filenames) lives in ./mediaHelpers; the
// ffmpeg.wasm engine is lazy-loaded from ./audioRunner + ./ffmpegRunner on convert. The first
// convert downloads the ~31MB ffmpeg core from the CDN (needs network once); a progress UI is
// shown while it loads, then again while it transcodes.
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from '../../composables/useI18n'
import { useToast } from '../../composables/useToast'
import { useMediaFile } from './useMediaFile'
import MediaDropZone from './MediaDropZone.vue'
import {
  converterForRoute, buildOutputNameWithSuffix, isLossyFormat, isVideoInput, isMediaInput,
  formatSize, AUDIO_FORMATS, AUDIO_OUTPUT_FORMATS, BITRATE_PRESETS, DEFAULT_BITRATE, audioFormatDef,
} from './mediaHelpers'

const route = useRoute()
const { t } = useI18n()
const { showToast } = useToast()

// Optional per-route preset (e.g. /media/mp4-to-mp3 prefills mp4→mp3); the universal /media/convert
// route just defaults to mp3.
const preset = computed(() => converterForRoute(route.meta?.path || route.path))
const outFmt = ref(preset.value?.output || 'mp3')

const bitrate = ref(DEFAULT_BITRATE)
const sampleRate = ref('') // '' = keep source
const channels = ref('')   // '' = keep source

const busy = ref(false)
const phase = ref('')       // '' | 'loading' | 'converting'
const progress = ref(0)     // 0..1 transcode progress
const dl = ref(null)        // { received, total, ratio } during core download
const result = ref(null)    // { url, name, size, isVideo }

const media = useMediaFile({
  accept: 'audio/*,video/*',
  validate: (f) => {
    if (isMediaInput(f.name, f.type)) return true
    showToast(t('media.unsupported'))
    return false
  },
})

const lossyOut = computed(() => isLossyFormat(outFmt.value))
const inputIsVideo = computed(() => media.file.value && isVideoInput(media.name.value, media.file.value.type))
const extracting = computed(() => inputIsVideo.value) // video input → we extract/strip to audio
const outDef = computed(() => audioFormatDef(outFmt.value) || {})

const outputName = computed(() =>
  buildOutputNameWithSuffix(media.name.value || 'audio', outFmt.value, extracting.value ? '-audio' : '')
)

let unsubEngine = null
onMounted(async () => {
  window.addEventListener('paste', media.onPaste)
  // Subscribe to engine download progress so the "loading runtime…" bar is live even before the
  // first transcode finishes. (No-op import side effects; ffmpeg core itself isn't fetched here.)
  const { onEngineEvent } = await import('./ffmpegRunner')
  unsubEngine = onEngineEvent((e) => {
    if (e.type === 'download') dl.value = { received: e.received, total: e.total, ratio: e.ratio }
  })
})
onBeforeUnmount(() => {
  window.removeEventListener('paste', media.onPaste)
  unsubEngine?.()
  revokeResult()
})

function revokeResult() {
  if (result.value?.url) { try { URL.revokeObjectURL(result.value.url) } catch { /* ignore */ } }
}

function pickNew() {
  revokeResult()
  result.value = null
  progress.value = 0
  media.clear()
}

async function runConvert() {
  if (!media.file.value || busy.value) return
  busy.value = true
  progress.value = 0
  dl.value = null
  revokeResult()
  result.value = null

  try {
    const { isEngineLoaded } = await import('./ffmpegRunner')
    phase.value = isEngineLoaded() ? 'converting' : 'loading'

    const { convertAudio } = await import('./audioRunner')
    const blob = await convertAudio(media.file.value, {
      outputFormat: outFmt.value,
      options: {
        bitrate: lossyOut.value ? bitrate.value : undefined,
        sampleRate: sampleRate.value || undefined,
        channels: channels.value || undefined,
      },
      onProgress: ({ progress: p }) => {
        phase.value = 'converting'
        if (typeof p === 'number' && isFinite(p)) progress.value = Math.max(0, Math.min(1, p))
      },
    })

    result.value = {
      blob,
      url: URL.createObjectURL(blob),
      name: outputName.value,
      size: blob.size,
      isVideo: false, // converter output is always audio
    }
    progress.value = 1
    showToast(t('media.done'))
  } catch (err) {
    console.error('[media] conversion failed:', err)
    showToast(t('media.failed'))
  } finally {
    busy.value = false
    phase.value = ''
  }
}

function download() {
  if (!result.value) return
  import('./mediaDom').then(({ downloadBlob }) => downloadBlob(result.value.blob, result.value.name))
}

const progressPct = computed(() => Math.round(progress.value * 100))
const dlPct = computed(() => dl.value?.total ? Math.round(dl.value.ratio * 100) : null)
</script>

<template>
  <main class="media" @paste="media.onPaste">
    <header class="media-head">
      <h2 class="media-title">{{ t('media.conv.title') }}</h2>
      <p class="media-sub">{{ t('media.conv.sub') }}</p>
    </header>

    <!-- Empty state -->
    <MediaDropZone
      v-if="!media.file.value"
      :title="t('media.drop')"
      :hint="t('media.browse')"
      :drag-over="media.dragOver.value"
      icon="audio"
      @pick="media.openPicker"
      @drop="media.onDrop"
      @dragover="media.onDragOver"
      @dragleave="media.onDragLeave"
    />

    <div v-else class="panel">
      <!-- Input file + preview -->
      <div class="file-card">
        <div class="file-row">
          <div class="file-meta">
            <span class="file-name" :title="media.name.value">{{ media.name.value }}</span>
            <span class="file-size">
              {{ formatSize(media.size.value) }}
              <template v-if="extracting"> · {{ t('media.videoInput') }}</template>
            </span>
          </div>
          <button class="link-btn" :disabled="busy" @click="pickNew">{{ t('media.change') }}</button>
        </div>
        <component
          :is="inputIsVideo ? 'video' : 'audio'"
          class="player"
          :class="{ video: inputIsVideo }"
          :src="media.url.value"
          controls
          preload="metadata"
        />
      </div>

      <!-- Output format -->
      <div class="control">
        <label class="control-label">{{ t('media.to') }}</label>
        <div class="seg">
          <button
            v-for="f in AUDIO_OUTPUT_FORMATS"
            :key="f"
            :class="{ on: outFmt === f }"
            :disabled="busy"
            @click="outFmt = f"
          >{{ AUDIO_FORMATS[f].label.split(' ')[0] }}</button>
        </div>
      </div>
      <p v-if="extracting" class="note">{{ t('media.extractNote') }}</p>

      <!-- Lossy → bitrate -->
      <div v-if="lossyOut" class="control">
        <label class="control-label">{{ t('media.bitrate') }}</label>
        <select v-model="bitrate" class="select" :disabled="busy">
          <option v-for="b in BITRATE_PRESETS" :key="b" :value="b">{{ b.replace('k', '') }} kbps</option>
        </select>
      </div>

      <!-- Advanced: sample rate + channels -->
      <details class="adv">
        <summary>{{ t('media.advanced') }}</summary>
        <div class="adv-body">
          <div class="control">
            <label class="control-label">{{ t('media.sampleRate') }}</label>
            <select v-model="sampleRate" class="select" :disabled="busy">
              <option value="">{{ t('media.keep') }}</option>
              <option value="22050">22.05 kHz</option>
              <option value="44100">44.1 kHz</option>
              <option value="48000">48 kHz</option>
            </select>
          </div>
          <div class="control">
            <label class="control-label">{{ t('media.channels') }}</label>
            <select v-model="channels" class="select" :disabled="busy">
              <option value="">{{ t('media.keep') }}</option>
              <option value="1">{{ t('media.mono') }}</option>
              <option value="2">{{ t('media.stereo') }}</option>
            </select>
          </div>
        </div>
      </details>

      <button class="convert-btn" :disabled="busy" @click="runConvert">
        {{ busy ? (phase === 'loading' ? t('media.loadingRuntime') : t('media.converting')) : t('media.convert') }}
      </button>

      <!-- Core download progress (first run only) -->
      <div v-if="busy && phase === 'loading'" class="progress">
        <div class="bar"><div class="bar-fill indet" :style="dlPct != null ? { width: dlPct + '%' } : {}"></div></div>
        <span class="progress-pct">
          <template v-if="dlPct != null">{{ dlPct }}%</template>
          <template v-else>…</template>
        </span>
      </div>
      <p v-if="busy && phase === 'loading'" class="note small">{{ t('media.runtimeHint') }}</p>

      <!-- Transcode progress -->
      <div v-if="busy && phase === 'converting'" class="progress">
        <div class="bar"><div class="bar-fill" :style="{ width: (progress > 0 ? progressPct : 6) + '%' }"></div></div>
        <span class="progress-pct">{{ progress > 0 ? progressPct + '%' : '' }}</span>
      </div>

      <!-- Result + output preview -->
      <div v-if="result" class="result">
        <div class="result-meta">
          <span class="result-name">{{ result.name }}</span>
          <span class="result-size">{{ formatSize(result.size) }}</span>
        </div>
        <audio class="player" :src="result.url" controls preload="metadata"></audio>
        <button class="download-btn" @click="download">{{ t('media.download') }}</button>
      </div>
    </div>
  </main>
</template>

<style scoped>
.media { flex: 1; overflow-y: auto; padding: 32px 24px 56px; max-width: 640px; margin: 0 auto; width: 100%; animation: tbIn 0.3s var(--ease-out); }
@keyframes tbIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
.media-head { margin-bottom: 20px; }
.media-title { font-size: 24px; font-weight: 750; letter-spacing: -0.5px; }
.media-sub { margin-top: 6px; color: var(--text-secondary); font-size: 13px; line-height: 1.5; }

.panel { display: flex; flex-direction: column; gap: 14px; }
.file-card { display: flex; flex-direction: column; gap: 10px; padding: 14px 16px; border: 1px solid var(--border-light); border-radius: 12px; background: var(--surface); }
.file-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.file-meta { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.file-name { font-size: 14px; font-weight: 600; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.file-size { font-size: 11px; color: var(--text-secondary); }
.link-btn { flex-shrink: 0; border: none; background: var(--surface-hover); color: var(--text-secondary); font-size: 12px; padding: 5px 11px; border-radius: 7px; cursor: pointer; font-family: var(--font-sans); }
.link-btn:hover:not(:disabled) { color: var(--text); }
.link-btn:disabled { opacity: 0.5; cursor: default; }

.control { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.control-label { font-size: 12px; font-weight: 600; color: var(--text-secondary); flex-shrink: 0; }
.seg { display: flex; flex-wrap: wrap; background: var(--surface-hover); border-radius: var(--radius-sm); padding: 2px; gap: 2px; justify-content: flex-end; }
.seg button { padding: 6px 10px; border: none; border-radius: 5px; font-size: 11px; font-weight: 600; background: transparent; color: var(--text-secondary); cursor: pointer; transition: all 0.15s; font-family: var(--font-sans); }
.seg button.on { background: var(--surface); color: var(--text); box-shadow: var(--shadow-xs); }
.seg button:disabled { opacity: 0.5; cursor: default; }
.select { padding: 7px 11px; border: 1px solid var(--border); border-radius: 9px; background: var(--surface); color: var(--text); font-size: 13px; font-family: var(--font-sans); outline: none; cursor: pointer; }
.select:focus { border-color: var(--accent); }
.select:disabled { opacity: 0.5; }

.note { font-size: 12px; color: var(--text-secondary); line-height: 1.5; margin-top: -4px; }
.note.small { font-size: 11px; }

.adv { border: 1px solid var(--border-light); border-radius: 10px; background: var(--surface); padding: 0 14px; }
.adv summary { cursor: pointer; font-size: 12px; font-weight: 600; color: var(--text-secondary); padding: 11px 0; list-style: none; user-select: none; }
.adv summary::-webkit-details-marker { display: none; }
.adv summary::before { content: '⌄'; display: inline-block; margin-right: 6px; transition: transform 0.2s; }
.adv[open] summary::before { transform: rotate(180deg); }
.adv-body { display: flex; flex-direction: column; gap: 12px; padding-bottom: 14px; }

.convert-btn { padding: 11px 16px; border: none; border-radius: 11px; background: var(--text); color: var(--bg); font-size: 14px; font-weight: 650; font-family: var(--font-sans); cursor: pointer; transition: opacity 0.15s, transform 0.1s; }
.convert-btn:hover:not(:disabled) { opacity: 0.9; }
.convert-btn:active:not(:disabled) { transform: scale(0.99); }
.convert-btn:disabled { opacity: 0.6; cursor: default; }

.progress { display: flex; align-items: center; gap: 10px; }
.bar { flex: 1; height: 8px; border-radius: 99px; background: var(--surface-hover); overflow: hidden; }
.bar-fill { height: 100%; background: var(--accent); border-radius: 99px; transition: width 0.2s ease; }
.bar-fill.indet { min-width: 12%; }
.progress-pct { font-size: 12px; color: var(--text-secondary); font-variant-numeric: tabular-nums; min-width: 36px; text-align: right; }

.result { display: flex; flex-direction: column; gap: 10px; padding: 14px 16px; border: 1px solid var(--border-light); border-radius: 12px; background: var(--surface); animation: tbIn 0.25s var(--ease-out); }
.result-meta { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
.result-name { font-size: 13px; font-weight: 600; color: var(--text); word-break: break-all; }
.result-size { font-size: 11px; color: var(--text-secondary); flex-shrink: 0; }
.player { width: 100%; height: 40px; }
.player.video { height: auto; max-height: 320px; border-radius: 8px; background: #000; }
.download-btn { align-self: flex-start; padding: 9px 18px; border: 1px solid var(--accent); border-radius: 9px; background: var(--accent); color: #fff; font-size: 13px; font-weight: 600; font-family: var(--font-sans); cursor: pointer; transition: opacity 0.15s; }
.download-btn:hover { opacity: 0.9; }

@media (max-width: 560px) { .media { padding: 20px 16px 48px; } .control { flex-direction: column; align-items: stretch; gap: 6px; } .seg { justify-content: flex-start; } }
</style>
