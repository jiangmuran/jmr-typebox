<script setup>
// Audio WORKBENCH (the body of every /media/* converter route). Rendered only inside <ClientOnly>,
// so window/Blob/Worker/AudioContext are safe here. Pure logic (format catalog, arg building,
// filenames) lives in ./mediaHelpers; the ffmpeg.wasm engine + Web-Audio decode are lazy-loaded on
// demand. The first run downloads the ~31MB ffmpeg core from the CDN (network once); progress UIs
// are shown for both the core download and the transcode.
//
// Layout is responsive & two-mode:
//   • DESKTOP (≥900px): a 2-column workbench — left = source + waveform + player + output/quick
//     actions; right = a panel of tabs (Convert · Edit · Advanced).
//   • MOBILE (<900px): everything stacks; the convert flow stays front-and-center with big targets.
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from '../../composables/useI18n'
import { useToast } from '../../composables/useToast'
import { useMediaFile } from './useMediaFile'
import { useMediaPool } from './useMediaPool'
import { useHandoff } from '../../composables/useHandoff'
import MediaDropZone from './MediaDropZone.vue'
import MediaWaveform from './MediaWaveform.vue'
import SendToMenu from '../../components/SendToMenu.vue'
import {
  converterForRoute, buildOutputNameWithSuffix, isLossyFormat, isVideoInput, isMediaInput,
  formatSize, formatDuration, clampNum, AUDIO_FORMATS, AUDIO_OUTPUT_FORMATS, BITRATE_PRESETS,
  DEFAULT_BITRATE, audioFormatDef, VIDEO_FORMATS, VIDEO_OUTPUT_FORMATS, VIDEO_SCALES, videoFormatDef,
} from './mediaHelpers'

const route = useRoute()
const { t } = useI18n()
const { showToast } = useToast()
const pool = useMediaPool()
const handoff = useHandoff()

// Optional per-route preset (e.g. /media/mp4-to-mp3 prefills mp4→mp3); the universal /media/convert
// route just defaults to mp3.
const preset = computed(() => converterForRoute(route.meta?.path || route.path))
const outFmt = ref(preset.value?.output || 'mp3')

// Output KIND for a video input: 'audio' (extract — the original behavior) or 'video' (transcode to
// another container). Audio inputs are always 'audio'. The format picker swaps catalogs by kind.
const outKind = ref('audio')         // 'audio' | 'video'
const videoFmt = ref('mp4')          // chosen video container when outKind==='video'
const videoScale = ref('')           // '' = keep source; else target height
const videoCrf = ref(23)             // visual quality for video output

const bitrate = ref(DEFAULT_BITRATE)
const sampleRate = ref('') // '' = keep source
const channels = ref('')   // '' = keep source

// Workbench tabs (desktop right panel / mobile sections). The /media/edit route opens on Edit.
const initialTab = (route.meta?.path || route.path) === '/media/edit' ? 'edit' : 'convert'
const tab = ref(initialTab) // 'convert' | 'edit' | 'advanced'

// Editing controls.
const gainDb = ref(0)        // -30..+30 dB
const fadeIn = ref(0)        // seconds
const fadeOut = ref(0)       // seconds
const normalize = ref(false)
const trimStart = ref(null)  // seconds or null
const trimEnd = ref(null)    // seconds or null

// Advanced (custom command).
const customCmd = ref('')
const acknowledgedAdvanced = ref(false)

const busy = ref(false)
const phase = ref('')       // '' | 'loading' | 'converting'
const progress = ref(0)     // 0..1 transcode progress
const dl = ref(null)        // { received, total, ratio, fromCache } during core load
const runtimeCached = ref(false) // is the ~31MB core already in the Cache API? (drives the hint)
const result = ref(null)    // { url, name, size, isVideo }

// Waveform / playback state.
const peaks = ref(null)
const wfDuration = ref(0)
const wfLoading = ref(false)
const playRatio = ref(0)
const inputPlayer = ref(null) // <audio>/<video> ref

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
// Video → audio extraction happens only when the chosen output kind is audio.
const extracting = computed(() => inputIsVideo.value && (tab.value !== 'convert' || outKind.value === 'audio'))
// Are we producing a VIDEO file? (only possible from a video input, on the Convert tab, kind=video)
const videoOut = computed(() => inputIsVideo.value && tab.value === 'convert' && outKind.value === 'video')
const outDef = computed(() => audioFormatDef(outFmt.value) || {})
const videoOutHasAudio = computed(() => !!videoFormatDef(videoFmt.value)?.hasAudio)

// Effective duration for fade/trim math: prefer the decoded waveform duration, else player metadata.
const effDuration = computed(() => wfDuration.value || 0)

const hasTrim = computed(() =>
  (trimStart.value != null && trimStart.value > 0) ||
  (trimEnd.value != null && effDuration.value && trimEnd.value < effDuration.value - 0.01)
)
const hasEdits = computed(() =>
  hasTrim.value || Math.abs(Number(gainDb.value)) > 0.01 ||
  Number(fadeIn.value) > 0 || Number(fadeOut.value) > 0 || normalize.value
)

const outputName = computed(() => {
  if (videoOut.value) {
    return buildOutputNameWithSuffix(media.name.value || 'video', videoFmt.value, '-converted')
  }
  const suffix = tab.value === 'edit' && hasEdits.value ? '-edited' : (extracting.value ? '-audio' : '')
  return buildOutputNameWithSuffix(media.name.value || 'audio', outFmt.value, suffix)
})

let unsubEngine = null
onMounted(async () => {
  window.addEventListener('paste', media.onPaste)
  // Pick up a file handed off from the player ("Send to Edit/Convert"). The player sets tab='edit'
  // or leaves it blank for convert; we honor it and load the file into the workbench.
  const pending = pool.peekPending()
  if (pending && pending.file && pending.tab !== 'player') {
    pool.takePending()
    media.set(pending.file)
    if (pending.tab === 'edit') tab.value = 'edit'
  }
  // Cross-module handoff (Send to → Convert from compress/transcribe/etc).
  const taken = handoff.take(['av', 'audio', 'video'])
  if (taken?.payload) {
    const f = taken.payload instanceof File ? taken.payload : new File([taken.payload], taken.name || 'media', { type: taken.payload?.type || '' })
    media.set(f)
    showToast(t('handoff.received'))
  }
  const { onEngineEvent, isRuntimeCached } = await import('./ffmpegRunner')
  unsubEngine = onEngineEvent((e) => {
    if (e.type === 'download') dl.value = { received: e.received, total: e.total, ratio: e.ratio, fromCache: e.fromCache }
  })
  // Decide the pre-run hint: is the heavy core already durably cached from a previous visit?
  try { runtimeCached.value = await isRuntimeCached() } catch { runtimeCached.value = false }
})

// "Add to player": push the loaded SOURCE file (or the converted RESULT) into the player library.
async function addToPlayer(which) {
  const file = which === 'result' && result.value?.blob
    ? new File([result.value.blob], result.value.name, { type: result.value.blob.type })
    : (media.file.value || null)
  if (!file) return
  const taken = await pool.addToPlayer(file, { source: 'convert' })
  showToast(t(taken ? 'media.addedToPlayer' : 'media.addToPlayer'))
}
onBeforeUnmount(() => {
  window.removeEventListener('paste', media.onPaste)
  unsubEngine?.()
  revokeResult()
})

// When a new file is chosen, decode its waveform (best-effort) + reset edits.
watch(() => media.file.value, async (f) => {
  resetEditsForNewFile()
  peaks.value = null
  wfDuration.value = 0
  playRatio.value = 0
  // A video defaults to video→video conversion (most expected); audio stays audio.
  outKind.value = (f && isVideoInput(f.name, f.type)) ? 'video' : 'audio'
  if (!f) return
  wfLoading.value = true
  try {
    const { decodeToPeaks } = await import('./waveform')
    const res = await decodeToPeaks(f, 1400)
    peaks.value = res.peaks
    wfDuration.value = res.duration
  } catch (err) {
    // Browser couldn't decode this container — waveform unavailable, but ffmpeg convert/edit still
    // works. Fall back to player metadata for duration.
    console.warn('[media] waveform decode failed (non-fatal):', err)
    peaks.value = null
  } finally {
    wfLoading.value = false
  }
})

function resetEditsForNewFile() {
  gainDb.value = 0; fadeIn.value = 0; fadeOut.value = 0; normalize.value = false
  trimStart.value = null; trimEnd.value = null
}

function revokeResult() {
  if (result.value?.url) { try { URL.revokeObjectURL(result.value.url) } catch { /* ignore */ } }
}

function pickNew() {
  revokeResult()
  result.value = null
  progress.value = 0
  media.clear()
}

// --- player <-> waveform sync ---
function onPlayerTime() {
  const el = inputPlayer.value
  if (!el || !el.duration || !isFinite(el.duration)) return
  if (!wfDuration.value) wfDuration.value = el.duration
  playRatio.value = el.currentTime / el.duration
}
function onPlayerLoaded() {
  const el = inputPlayer.value
  if (el && isFinite(el.duration) && el.duration > 0 && !wfDuration.value) wfDuration.value = el.duration
}
function seekTo(sec) {
  const el = inputPlayer.value
  if (el && isFinite(sec)) { try { el.currentTime = sec } catch { /* ignore */ } }
}
function onSelect({ start, end }) {
  trimStart.value = Math.max(0, start)
  trimEnd.value = end
  if (tab.value !== 'edit') tab.value = 'edit'
}
function clearTrim() { trimStart.value = null; trimEnd.value = null }

// Common progress handler.
function onProgress({ progress: p }) {
  phase.value = 'converting'
  if (typeof p === 'number' && isFinite(p)) progress.value = Math.max(0, Math.min(1, p))
}

async function beforeRun() {
  busy.value = true
  progress.value = 0
  dl.value = null
  revokeResult()
  result.value = null
  const { isEngineLoaded } = await import('./ffmpegRunner')
  phase.value = isEngineLoaded() ? 'converting' : 'loading'
}
function afterRun() { busy.value = false; phase.value = '' }

function setResult(blob, name, isVideo = false) {
  result.value = { blob, url: URL.createObjectURL(blob), name, size: blob.size, isVideo }
  progress.value = 1
  showToast(t('media.done'))
}

async function runConvert() {
  if (!media.file.value || busy.value) return
  // VIDEO → VIDEO transcode path.
  if (videoOut.value) return runVideoConvert()
  await beforeRun()
  try {
    const { convertAudio } = await import('./audioRunner')
    const blob = await convertAudio(media.file.value, {
      outputFormat: outFmt.value,
      options: {
        bitrate: lossyOut.value ? bitrate.value : undefined,
        sampleRate: sampleRate.value || undefined,
        channels: channels.value || undefined,
        durationSec: effDuration.value || undefined,
      },
      onProgress,
    })
    setResult(blob, outputName.value)
  } catch (err) {
    console.error('[media] conversion failed:', err)
    showToast(t('media.failed'))
  } finally { afterRun() }
}

async function runVideoConvert() {
  await beforeRun()
  try {
    const { convertVideo } = await import('./audioRunner')
    const blob = await convertVideo(media.file.value, {
      outputFormat: videoFmt.value,
      options: {
        height: videoScale.value ? parseInt(videoScale.value, 10) : undefined,
        crf: Number(videoCrf.value),
        audioBitrate: bitrate.value,
        durationSec: effDuration.value || undefined,
      },
      onProgress,
    })
    setResult(blob, outputName.value, videoFmt.value !== 'gif')
  } catch (err) {
    console.error('[media] video conversion failed:', err)
    showToast(t('media.failed'))
  } finally { afterRun() }
}

async function runEdit() {
  if (!media.file.value || busy.value) return
  await beforeRun()
  try {
    const { editAudio } = await import('./audioRunner')
    const blob = await editAudio(media.file.value, {
      outputFormat: outFmt.value,
      edit: {
        trimStart: trimStart.value ?? undefined,
        trimEnd: trimEnd.value ?? undefined,
        gainDb: Number(gainDb.value) || 0,
        fadeIn: Number(fadeIn.value) || 0,
        fadeOut: Number(fadeOut.value) || 0,
        normalize: normalize.value,
        sampleRate: sampleRate.value || undefined,
        channels: channels.value || undefined,
        bitrate: lossyOut.value ? bitrate.value : undefined,
        durationSec: effDuration.value || undefined,
      },
      onProgress,
    })
    setResult(blob, outputName.value)
  } catch (err) {
    console.error('[media] edit failed:', err)
    showToast(t('media.failed'))
  } finally { afterRun() }
}

async function runCustom() {
  if (!media.file.value || busy.value || !customCmd.value.trim()) return
  await beforeRun()
  try {
    const { runCustomCommand } = await import('./audioRunner')
    const { blob, name } = await runCustomCommand(media.file.value, {
      raw: customCmd.value,
      outputFormat: outFmt.value,
      durationSec: effDuration.value || undefined,
      onProgress,
    })
    setResult(blob, name)
  } catch (err) {
    console.error('[media] custom command failed:', err)
    showToast(t('media.adv.failed'))
  } finally { afterRun() }
}

function runActive() {
  if (tab.value === 'convert') return runConvert()
  if (tab.value === 'edit') return runEdit()
  return runCustom()
}

function download() {
  if (!result.value) return
  import('./mediaDom').then(({ downloadBlob }) => downloadBlob(result.value.blob, result.value.name))
}

// "Send to →" handoff for the converted result (video → other media tools; audio → compress/etc).
const resultFile = computed(() => result.value ? new File([result.value.blob], result.value.name, { type: result.value.blob.type }) : null)
const resultKind = computed(() => result.value?.isVideo ? 'video' : 'audio')

// Clamp to 0..100 defensively so a bad ratio from the engine can never render nonsense (the old
// "-604120800%" / ">100%" bug). progress is already 0..1, but we guard the display regardless.
const progressPct = computed(() => Math.max(0, Math.min(100, Math.round(progress.value * 100))))
const dlPct = computed(() => dl.value?.total ? Math.max(0, Math.min(100, Math.round((dl.value.ratio || 0) * 100))) : null)

const runLabel = computed(() => {
  if (busy.value) return phase.value === 'loading' ? t('media.loadingRuntime') : t('media.converting')
  if (tab.value === 'edit') return t('media.edit.apply')
  if (tab.value === 'advanced') return t('media.adv.run')
  return t('media.convert')
})
const runDisabled = computed(() => {
  if (busy.value || !media.file.value) return true
  if (tab.value === 'advanced') return !customCmd.value.trim() || !acknowledgedAdvanced.value
  return false
})

// Trim numeric inputs from the time fields (mobile / precise entry).
function setTrimStart(v) { const n = parseFloat(v); trimStart.value = Number.isFinite(n) ? clampNum(n, 0, effDuration.value || 1e9, 0) : null }
function setTrimEnd(v) { const n = parseFloat(v); trimEnd.value = Number.isFinite(n) ? clampNum(n, 0, effDuration.value || 1e9, 0) : null }
</script>

<template>
  <main class="wb" @paste="media.onPaste">
    <header class="wb-head">
      <h2 class="wb-title">{{ t('media.conv.title') }}</h2>
      <p class="wb-sub">{{ t('media.conv.sub') }}</p>
    </header>

    <!-- Empty state -->
    <MediaDropZone
      v-if="!media.file.value"
      :title="t('media.drop')"
      :hint="t('media.browse')"
      :drag-over="media.dragOver.value"
      icon="video"
      @pick="media.openPicker"
      @drop="media.onDrop"
      @dragover="media.onDragOver"
      @dragleave="media.onDragLeave"
    />

    <div v-else class="grid">
      <!-- ============ LEFT: source, waveform, player, result ============ -->
      <section class="col col-source">
        <div class="card file-card">
          <div class="file-row">
            <div class="file-meta">
              <span class="file-name" :title="media.name.value">{{ media.name.value }}</span>
              <span class="file-size">
                {{ formatSize(media.size.value) }}
                <template v-if="effDuration"> · {{ formatDuration(effDuration) }}</template>
                <template v-if="extracting"> · {{ t('media.videoInput') }}</template>
              </span>
            </div>
            <div class="file-actions">
              <button class="link-btn" :disabled="busy" @click="addToPlayer('source')" :title="t('media.addToPlayer')">
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 12V3.5l7-1.3V10"/><circle cx="4.3" cy="12" r="1.7"/><circle cx="11.3" cy="10" r="1.7"/></svg>
              </button>
              <button class="link-btn" :disabled="busy" @click="pickNew">{{ t('media.change') }}</button>
            </div>
          </div>

          <!-- Waveform (audio path) -->
          <MediaWaveform
            v-if="!inputIsVideo"
            :peaks="peaks"
            :duration="effDuration"
            :play-ratio="playRatio"
            :sel-start="trimStart"
            :sel-end="trimEnd"
            :loading="wfLoading"
            :height="92"
            @seek="seekTo"
            @select="onSelect"
          />
          <p v-if="!inputIsVideo && peaks && hasTrim" class="trim-readout">
            {{ t('media.edit.trim') }}: {{ formatDuration(trimStart || 0) }} – {{ formatDuration(trimEnd || effDuration) }}
            <button class="mini-link" @click="clearTrim">{{ t('media.edit.clearTrim') }}</button>
          </p>
          <p v-else-if="!inputIsVideo && peaks" class="wf-hint">{{ t('media.edit.dragHint') }}</p>

          <!-- Player -->
          <component
            :is="inputIsVideo ? 'video' : 'audio'"
            ref="inputPlayer"
            class="player"
            :class="{ video: inputIsVideo }"
            :src="media.url.value"
            controls
            preload="metadata"
            @timeupdate="onPlayerTime"
            @loadedmetadata="onPlayerLoaded"
          />
        </div>

        <!-- Result + output preview -->
        <div v-if="result" class="card result">
          <div class="result-meta">
            <span class="result-name">{{ result.name }}</span>
            <span class="result-size">{{ formatSize(result.size) }}</span>
          </div>
          <video v-if="result.isVideo" class="player video" :src="result.url" controls preload="metadata"></video>
          <img v-else-if="result.name.endsWith('.gif')" class="player gifimg" :src="result.url" alt="GIF preview" />
          <audio v-else class="player" :src="result.url" controls preload="metadata"></audio>
          <div class="result-actions">
            <button class="btn cta" @click="download">{{ t('media.download') }}</button>
            <button v-if="!result.isVideo && !result.name.endsWith('.gif')" class="add-player-btn" @click="addToPlayer('result')">
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 12V3.5l7-1.3V10"/><circle cx="4.3" cy="12" r="1.7"/><circle cx="11.3" cy="10" r="1.7"/></svg>
              {{ t('media.addToPlayer') }}
            </button>
            <SendToMenu :payload="resultFile" :kind="resultKind" from="/media/convert" />
          </div>
        </div>
      </section>

      <!-- ============ RIGHT: tabs (Convert / Edit / Advanced) ============ -->
      <section class="col col-controls">
        <div class="tabs" role="tablist">
          <button role="tab" :class="{ on: tab === 'convert' }" :disabled="busy" @click="tab = 'convert'">{{ t('media.tab.convert') }}</button>
          <button role="tab" :class="{ on: tab === 'edit' }" :disabled="busy" @click="tab = 'edit'">{{ t('media.tab.edit') }}</button>
          <button role="tab" :class="{ on: tab === 'advanced' }" :disabled="busy" @click="tab = 'advanced'">{{ t('media.tab.advanced') }}</button>
        </div>

        <div class="card panel">
          <!-- Video input on Convert tab: choose to keep it a VIDEO or extract its AUDIO. -->
          <div v-if="tab === 'convert' && inputIsVideo" class="control">
            <label class="control-label">{{ t('media.outputKind') }}</label>
            <div class="seg">
              <button :class="{ on: outKind === 'video' }" :disabled="busy" @click="outKind = 'video'">{{ t('media.kindVideo') }}</button>
              <button :class="{ on: outKind === 'audio' }" :disabled="busy" @click="outKind = 'audio'">{{ t('media.kindAudio') }}</button>
            </div>
          </div>

          <!-- ===== VIDEO output controls (Convert tab, video kind) ===== -->
          <template v-if="videoOut">
            <div class="control">
              <label class="control-label">{{ t('media.to') }}</label>
              <div class="seg seg-wrap">
                <button v-for="f in VIDEO_OUTPUT_FORMATS" :key="f" :class="{ on: videoFmt === f }" :disabled="busy" @click="videoFmt = f">{{ VIDEO_FORMATS[f].label }}</button>
              </div>
            </div>
            <div class="control">
              <label class="control-label">{{ t('media.cmp.resolution') }}</label>
              <select v-model="videoScale" class="select" :disabled="busy">
                <option v-for="s in VIDEO_SCALES" :key="s.id" :value="s.id">{{ s.id === '' ? t('media.keep') : s.label }}</option>
              </select>
            </div>
            <div v-if="videoFmt !== 'gif'" class="field">
              <label class="control-label">{{ t('media.cmp.quality') }} (CRF {{ videoCrf }})</label>
              <input type="range" v-model.number="videoCrf" min="18" max="34" step="1" :disabled="busy" />
            </div>
            <div v-if="videoOutHasAudio" class="control">
              <label class="control-label">{{ t('media.cmp.audioBitrate') }}</label>
              <select v-model="bitrate" class="select" :disabled="busy">
                <option v-for="b in BITRATE_PRESETS" :key="b" :value="b">{{ b.replace('k', '') }} kbps</option>
              </select>
            </div>
            <p v-if="videoFmt === 'gif'" class="note small">{{ t('media.gifNote') }}</p>
          </template>

          <!-- ===== AUDIO output format (shared by convert-audio + edit) ===== -->
          <template v-else>
            <div v-if="tab !== 'advanced'" class="control">
              <label class="control-label">{{ t('media.to') }}</label>
              <div class="seg seg-wrap">
                <button
                  v-for="f in AUDIO_OUTPUT_FORMATS"
                  :key="f"
                  :class="{ on: outFmt === f }"
                  :disabled="busy"
                  @click="outFmt = f"
                >{{ AUDIO_FORMATS[f].label.split(' ')[0] }}</button>
              </div>
            </div>
            <p v-if="tab !== 'advanced' && extracting" class="note">{{ t('media.extractNote') }}</p>

            <!-- Lossy → bitrate (convert + edit) -->
            <div v-if="tab !== 'advanced' && lossyOut" class="control">
              <label class="control-label">{{ t('media.bitrate') }}</label>
              <select v-model="bitrate" class="select" :disabled="busy">
                <option v-for="b in BITRATE_PRESETS" :key="b" :value="b">{{ b.replace('k', '') }} kbps</option>
              </select>
            </div>
          </template>

          <!-- ===== CONVERT tab (audio output): sample rate / channels ===== -->
          <template v-if="tab === 'convert' && !videoOut">
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
          </template>

          <!-- ===== EDIT tab: trim / gain / fades / normalize ===== -->
          <template v-else-if="tab === 'edit'">
            <p class="note">{{ t('media.edit.hint') }}</p>

            <!-- Trim (numeric, mirrors the waveform selection) -->
            <div class="field">
              <label class="control-label">{{ t('media.edit.trim') }} (s)</label>
              <div class="row2">
                <input type="number" class="num" min="0" step="0.1" :placeholder="t('media.edit.start')"
                       :value="trimStart ?? ''" :disabled="busy" @input="setTrimStart($event.target.value)" />
                <input type="number" class="num" min="0" step="0.1" :placeholder="t('media.edit.end')"
                       :value="trimEnd ?? ''" :disabled="busy" @input="setTrimEnd($event.target.value)" />
              </div>
            </div>

            <div class="field">
              <label class="control-label">{{ t('media.edit.gain') }}: {{ gainDb > 0 ? '+' : '' }}{{ gainDb }} dB</label>
              <input type="range" v-model.number="gainDb" min="-30" max="30" step="0.5" :disabled="busy" />
            </div>

            <div class="field">
              <label class="control-label">{{ t('media.edit.fadeIn') }}: {{ fadeIn }}s</label>
              <input type="range" v-model.number="fadeIn" min="0" max="15" step="0.5" :disabled="busy" />
            </div>
            <div class="field">
              <label class="control-label">{{ t('media.edit.fadeOut') }}: {{ fadeOut }}s</label>
              <input type="range" v-model.number="fadeOut" min="0" max="15" step="0.5" :disabled="busy" />
            </div>

            <label class="check">
              <input type="checkbox" v-model="normalize" :disabled="busy" />
              <span>{{ t('media.edit.normalize') }}</span>
            </label>
            <p class="note small">{{ t('media.edit.normalizeHint') }}</p>

            <details class="adv-inline">
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
          </template>

          <!-- ===== ADVANCED tab: raw ffmpeg command ===== -->
          <template v-else>
            <p class="note">{{ t('media.adv.intro') }}</p>
            <label class="control-label cmd-label">{{ t('media.adv.label') }}</label>
            <textarea
              v-model="customCmd"
              class="cmd"
              rows="3"
              spellcheck="false"
              autocapitalize="off"
              autocomplete="off"
              :placeholder="t('media.adv.placeholder')"
              :disabled="busy"
            ></textarea>
            <p class="note small">{{ t('media.adv.tokens') }}</p>
            <div class="examples">
              <button v-for="ex in ['-af loudnorm', '-af \'volume=2.0\'', '-ar 44100 -ac 1', '-af \'atempo=1.25\'']"
                      :key="ex" class="ex-chip" :disabled="busy" @click="customCmd = ex">{{ ex }}</button>
            </div>
            <label class="check warn">
              <input type="checkbox" v-model="acknowledgedAdvanced" :disabled="busy" />
              <span>{{ t('media.adv.ack') }}</span>
            </label>
          </template>

          <!-- Run button (label adapts to active tab) -->
          <button class="btn primary run-btn" :disabled="runDisabled" @click="runActive">{{ runLabel }}</button>

          <!-- Pre-run runtime hint: cached (instant) vs first-run download (~31MB). -->
          <p v-if="!busy && media.file.value" class="note small runtime-hint">
            <svg v-if="runtimeCached" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4 4 10-10"/></svg>
            <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="M7 11l5 5 5-5"/><path d="M5 20h14"/></svg>
            {{ runtimeCached ? t('media.runtimeCached') : t('media.runtimeWillDownload') }}
          </p>

          <!-- Core download progress (first run only) -->
          <div v-if="busy && phase === 'loading'" class="progress">
            <div class="bar"><div class="bar-fill indet" :style="dlPct != null ? { width: dlPct + '%' } : {}"></div></div>
            <span class="progress-pct"><template v-if="dlPct != null">{{ dlPct }}%</template><template v-else>…</template></span>
          </div>
          <p v-if="busy && phase === 'loading'" class="note small">{{ dl?.fromCache ? t('media.runtimeFromCache') : t('media.runtimeHint') }}</p>

          <!-- Transcode progress -->
          <div v-if="busy && phase === 'converting'" class="progress">
            <div class="bar"><div class="bar-fill" :style="{ width: (progress > 0 ? progressPct : 6) + '%' }"></div></div>
            <span class="progress-pct">{{ progress > 0 ? progressPct + '%' : '' }}</span>
          </div>
        </div>
      </section>
    </div>
  </main>
</template>

<style scoped>
.wb { width: 100%; }
@keyframes tbIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
.wb-head { margin-bottom: 18px; }
.wb-title { font-size: 24px; font-weight: 750; letter-spacing: -0.5px; }
.wb-sub { margin-top: 6px; color: var(--text-secondary); font-size: 13px; line-height: 1.5; max-width: 70ch; }

/* Two-column workbench on desktop; stacks on small screens. */
.grid { display: grid; grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr); gap: 18px; align-items: start; }
.col { display: flex; flex-direction: column; gap: 14px; min-width: 0; }

/* .card is provided by the global tool-kit (surface · 12px · border-light · 16px). */
.file-card { display: flex; flex-direction: column; gap: 12px; }
.file-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.file-meta { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.file-name { font-size: 14px; font-weight: 600; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.file-size { font-size: 11px; color: var(--text-secondary); }
.file-actions { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
.link-btn { flex-shrink: 0; display: inline-flex; align-items: center; gap: 5px; border: none; background: var(--surface-hover); color: var(--text-secondary); font-size: 12px; padding: 5px 11px; border-radius: 7px; cursor: pointer; font-family: var(--font-sans); }
.link-btn:hover:not(:disabled) { color: var(--text); }
.link-btn:disabled { opacity: 0.5; cursor: default; }
.link-btn svg { width: 14px; height: 14px; }
.result-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.add-player-btn { display: inline-flex; align-items: center; gap: 6px; padding: 9px 14px; border: 1px solid var(--border-light); border-radius: 9px; background: var(--surface); color: var(--text-secondary); font-size: 12.5px; font-weight: 600; font-family: var(--font-sans); cursor: pointer; transition: all 0.15s; }
.add-player-btn:hover { color: var(--text); border-color: var(--accent); }
.add-player-btn svg { width: 14px; height: 14px; }

.trim-readout { font-size: 12px; color: var(--text-secondary); display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.wf-hint { font-size: 11px; color: var(--text-tertiary); }
.mini-link, .ex-chip, .mini-link:focus { font-family: var(--font-sans); }
.mini-link { border: none; background: none; color: var(--accent); font-size: 12px; cursor: pointer; padding: 0; text-decoration: underline; }

/* Workbench tabs — the shared segbar (container 10px · item 6px · subtle active). */
.tabs { display: flex; gap: 3px; padding: 3px; background: var(--surface-hover); border-radius: 10px; }
.tabs button { flex: 1; min-height: 34px; padding: 6px 8px; border: none; border-radius: 6px; font-size: 12px; font-weight: 600; background: transparent; color: var(--text-secondary); cursor: pointer; transition: all 0.15s; font-family: var(--font-sans); }
.tabs button:hover:not(:disabled) { color: var(--text); }
.tabs button.on { background: var(--surface); color: var(--text); box-shadow: var(--shadow-xs); }
.tabs button:disabled { opacity: 0.5; cursor: default; }

.panel { display: flex; flex-direction: column; gap: 13px; }
.control { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.control-label { font-size: 12px; font-weight: 600; color: var(--text-secondary); flex-shrink: 0; }
.field { display: flex; flex-direction: column; gap: 7px; }
.field input[type="range"] { width: 100%; accent-color: var(--accent); }
.row2 { display: flex; gap: 8px; }
.num { flex: 1; min-width: 0; padding: 8px 10px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); color: var(--text); font-size: 13px; font-family: var(--font-sans); outline: none; }
.num:focus { border-color: var(--accent); }

/* Compact inline segmented pickers (output format / kind) — segbar tokens,
   denser padding because several can sit in one control row and wrap. */
.seg { display: flex; background: var(--surface-hover); border-radius: 10px; padding: 3px; gap: 3px; }
.seg-wrap { flex-wrap: wrap; justify-content: flex-end; }
.seg button { padding: 6px 11px; border: none; border-radius: 6px; font-size: 11.5px; font-weight: 600; background: transparent; color: var(--text-secondary); cursor: pointer; transition: all 0.15s; font-family: var(--font-sans); }
.seg button:hover:not(:disabled) { color: var(--text); }
.seg button.on { background: var(--surface); color: var(--text); box-shadow: var(--shadow-xs); }
.seg button:disabled { opacity: 0.5; cursor: default; }
.select { padding: 7px 11px; border: 1px solid var(--border); border-radius: 9px; background: var(--surface); color: var(--text); font-size: 13px; font-family: var(--font-sans); outline: none; cursor: pointer; }
.select:focus { border-color: var(--accent); }
.select:disabled { opacity: 0.5; }

.check { display: flex; align-items: center; gap: 9px; font-size: 13px; color: var(--text); cursor: pointer; }
.check input { width: 16px; height: 16px; accent-color: var(--accent); }
.check.warn { color: var(--text-secondary); font-size: 12px; }

.note { font-size: 12px; color: var(--text-secondary); line-height: 1.5; }
.note.small { font-size: 11px; margin-top: -4px; }
.runtime-hint { display: flex; align-items: center; gap: 6px; margin-top: 0; }
.runtime-hint svg { width: 14px; height: 14px; flex-shrink: 0; color: var(--text-tertiary); }

.adv-inline { border: 1px solid var(--border-light); border-radius: 10px; background: var(--surface-hover); padding: 0 12px; }
.adv-inline summary { cursor: pointer; font-size: 12px; font-weight: 600; color: var(--text-secondary); padding: 10px 0; list-style: none; user-select: none; }
.adv-inline summary::-webkit-details-marker { display: none; }
.adv-inline summary::before { content: ''; display: inline-block; width: 0; height: 0; border-left: 4px solid transparent; border-right: 4px solid transparent; border-top: 5px solid currentColor; margin-right: 7px; transition: transform 0.2s; }
.adv-inline[open] summary::before { transform: rotate(180deg); }
.adv-body { display: flex; flex-direction: column; gap: 11px; padding-bottom: 12px; }

.cmd-label { margin-bottom: -4px; }
.cmd { width: 100%; resize: vertical; min-height: 64px; padding: 10px 12px; border: 1px solid var(--border); border-radius: 9px; background: var(--bg); color: var(--text); font-size: 13px; font-family: var(--font-mono, ui-monospace, monospace); line-height: 1.5; outline: none; }
.cmd:focus { border-color: var(--accent); }
.examples { display: flex; flex-wrap: wrap; gap: 6px; }
.ex-chip { border: 1px solid var(--border); background: var(--surface-hover); color: var(--text-secondary); font-size: 11px; padding: 4px 9px; border-radius: 7px; cursor: pointer; font-family: var(--font-mono, ui-monospace, monospace); }
.ex-chip:hover:not(:disabled) { color: var(--text); border-color: var(--accent); }

/* Run = shared dark primary button; just a touch of top spacing + full width here. */
.run-btn { width: 100%; margin-top: 2px; }

.progress { display: flex; align-items: center; gap: 10px; }
.bar { flex: 1; height: 8px; border-radius: 99px; background: var(--surface-hover); overflow: hidden; }
.bar-fill { height: 100%; background: var(--accent); border-radius: 99px; transition: width 0.2s ease; }
.bar-fill.indet { min-width: 12%; }
.progress-pct { font-size: 12px; color: var(--text-secondary); font-variant-numeric: tabular-nums; min-width: 36px; text-align: right; }

.result { display: flex; flex-direction: column; gap: 10px; animation: tbIn 0.25s var(--ease-out); }
.result-meta { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
.result-name { font-size: 13px; font-weight: 600; color: var(--text); word-break: break-all; }
.result-size { font-size: 11px; color: var(--text-secondary); flex-shrink: 0; }
.player { width: 100%; height: 40px; }
.player.video { height: auto; max-height: 300px; border-radius: 8px; background: #000; }
.player.gifimg { height: auto; max-height: 300px; border-radius: 8px; object-fit: contain; background: var(--surface-hover); }
/* Download = shared gold CTA (.btn.cta). */

/* ----- MOBILE: stack to a single column, bigger targets, convert flow first ----- */
@media (max-width: 900px) {
  .wb { padding: 20px 16px 48px; }
  .grid { grid-template-columns: 1fr; gap: 16px; }
  /* Controls come first on mobile so the convert flow is front-and-center; source/waveform follow. */
  .col-controls { order: 1; }
  .col-source { order: 2; }
  .tabs button { min-height: 40px; font-size: 13px; }
  .seg-wrap { justify-content: flex-start; }
  .control { flex-direction: column; align-items: stretch; gap: 6px; }
  .player.video { max-height: 240px; }
}
</style>
