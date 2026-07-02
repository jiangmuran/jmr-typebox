<script setup>
// SUBTITLE STUDIO — the audio/video suite's captioning workbench. Workflow:
//   Source     → load an audio OR video file + a subtitle track (handed-off transcript from
//                Transcribe, an imported SRT/VTT/LRC, or start from scratch) → editable segments.
//   Proofread  → a segment list synced to the waveform: edit text, retime (numerically or by
//                dragging on the waveform), add / delete / split / merge, and a global time offset.
//   Style      → 2 presets (Minimal / Lyric) + font size, color, position, background, fade, drawn
//                live on a <canvas> (browser system fonts → CJK renders with no shipped fonts).
//   Export     → RENDER audio → subtitled video: draw the styled captions over the canvas and record
//                canvas.captureStream() + the audio track with MediaRecorder → a WebM (real time).
//                Also export SRT / VTT / LRC, and (for a video source) burn/mux via ffmpeg.
//
// SSG-safety: the sr-only <h1> is outside <ClientOnly>; all canvas / MediaRecorder / ffmpeg / Web
// Audio work happens in the client-only body behind dynamic imports. Pure logic lives in
// ./subtitleStudio (unit-tested); canvas draw + recording in ./subtitleRender.
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { useRouteHead } from '../../composables/useRouteHead'
import { useI18n } from '../../composables/useI18n'
import { useToast } from '../../composables/useToast'
import ClientOnly from '../../components/ClientOnly.vue'
import SendToMenu from '../../components/SendToMenu.vue'
import MediaShell from './MediaShell.vue'
import MediaToolNav from './MediaToolNav.vue'
import MediaDropZone from './MediaDropZone.vue'
import MediaWaveform from './MediaWaveform.vue'
import SubtitleCanvas from './SubtitleCanvas.vue'
import { useMediaFile } from './useMediaFile'
import { useHandoff } from '../../composables/useHandoff'
import { isVideoInput, isMediaInput, isSubtitleInput, formatSize, formatDuration, baseName } from './mediaHelpers'
import {
  parseSubtitles, serializeSubtitles, splitSegment, mergeSegments, addSegmentAfter, deleteSegment,
  updateSegment, applyOffset, activeSegmentIndex, resolveStyle, STYLE_PRESET_IDS, RENDER_SIZES,
  renderSizeById,
} from './subtitleStudio'

const { meta: m } = useRouteHead()
const { t } = useI18n()
const { showToast } = useToast()
const handoff = useHandoff()

// ---- source ----------------------------------------------------------------
const media = useMediaFile({
  accept: 'audio/*,video/*',
  validate: (f) => { if (isMediaInput(f.name, f.type)) return true; showToast(t('media.unsupported')); return false },
})
const isVideo = computed(() => media.file.value && isVideoInput(media.name.value, media.file.value.type))
const previewEl = ref(null)
const srcDuration = ref(0)
function onPreviewMeta() {
  const el = previewEl.value
  if (el && isFinite(el.duration) && el.duration > 0) srcDuration.value = el.duration
}

const peaks = ref(null)
const wfLoading = ref(false)

// ---- segments (each carries a stable UI `id` so list keys survive edits) ----
let _sid = 0
const segments = ref([])
function withIds(segs) { return segs.map((s) => (s.id != null ? s : { ...s, id: ++_sid })) }
function setSegments(segs) { segments.value = withIds(segs) }
const hasSegments = computed(() => segments.value.length > 0)
const selectedId = ref(null)
const selectedIndex = computed(() => segments.value.findIndex((s) => s.id === selectedId.value))

// ---- workflow step ----
const step = ref('source') // 'source' | 'proofread' | 'style' | 'export'
const STEPS = ['source', 'proofread', 'style', 'export']
function goStep(s) { if (s === 'source' || hasSegments.value) step.value = s }

// ---- playback (drives the waveform playhead + live canvas preview) ----
const currentTime = ref(0)
const playing = ref(false)
let rafId = 0
const playRatio = computed(() => (srcDuration.value ? currentTime.value / srcDuration.value : 0))
const activeIdx = computed(() => activeSegmentIndex(segments.value, currentTime.value))

function tick() {
  const el = previewEl.value
  if (el) currentTime.value = el.currentTime || 0
  if (playing.value) rafId = requestAnimationFrame(tick)
}
function onPlay() { playing.value = true; cancelAnimationFrame(rafId); rafId = requestAnimationFrame(tick) }
function onPause() { playing.value = false; cancelAnimationFrame(rafId) }
function togglePlay() {
  const el = previewEl.value
  if (!el) return
  if (el.paused) el.play?.(); else el.pause?.()
}
function seekTo(sec, play = false) {
  const el = previewEl.value
  if (!el || !isFinite(sec)) return
  try { el.currentTime = Math.max(0, sec) } catch { /* ignore */ }
  currentTime.value = Math.max(0, sec)
  if (play) el.play?.()
}

// ---- subtitle import ----
function importSubText(text, name) {
  const segs = parseSubtitles(text, { name })
  if (!segs.length) { showToast(t('media.st.parseEmpty')); return false }
  setSegments(segs)
  selectedId.value = segments.value[0]?.id ?? null
  showToast(t('media.st.imported'))
  return true
}
function pickSub() {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = '.srt,.vtt,.lrc,.txt'
  input.onchange = async (e) => { const f = e.target.files?.[0]; if (f) importSubText(await f.text(), f.name) }
  input.click()
}
const subDragOver = ref(false)
async function onSubDrop(e) {
  subDragOver.value = false
  const f = e.dataTransfer?.files?.[0]
  if (!f) return
  if (!isSubtitleInput(f.name, f.type) && !/\.txt$/i.test(f.name)) { showToast(t('media.st.needSub')); return }
  importSubText(await f.text(), f.name)
}
function startFromScratch() {
  setSegments([{ start: 0, end: 2, text: '' }])
  selectedId.value = segments.value[0]?.id ?? null
  step.value = 'proofread'
}

// ---- segment editing ----
function selectSeg(i) { selectedId.value = segments.value[i]?.id ?? null }
function editText(i, val) { const s = segments.value[i]; if (s) s.text = val }
function editTime(i, field, val) {
  const n = parseFloat(val)
  if (!isFinite(n)) return
  setSegments(updateSegment(segments.value, i, { [field]: n }))
}
function doSplit(i) {
  const s = segments.value[i]
  const at = s && currentTime.value > s.start && currentTime.value < s.end ? currentTime.value : undefined
  setSegments(splitSegment(segments.value, i, at))
  selectedId.value = segments.value[i]?.id ?? null
}
function doMerge(i) {
  setSegments(mergeSegments(segments.value, i))
  selectedId.value = segments.value[i]?.id ?? null
}
function doAdd(i) {
  setSegments(addSegmentAfter(segments.value, i))
  const next = segments.value[i + 1]
  if (next) selectedId.value = next.id
}
function doDelete(i) {
  const wasSel = segments.value[i]?.id === selectedId.value
  setSegments(deleteSegment(segments.value, i))
  if (wasSel) selectedId.value = segments.value[0]?.id ?? null
}
const offset = ref(0)
function nudgeOffset(d) { setSegments(applyOffset(segments.value, d)); showToast(t('media.st.offsetApplied')) }
function applyOffsetInput() { if (offset.value) { nudgeOffset(offset.value); offset.value = 0 } }

// Drag on the waveform retimes the SELECTED segment (fast proofreading).
function onWfSelect({ start, end }) {
  const i = selectedIndex.value
  if (i < 0) return
  setSegments(updateSegment(segments.value, i, { start, end }))
}

// ---- style ----
const preset = ref('minimal')
const ov = ref({ fontSize: undefined, color: undefined, position: undefined, background: undefined, fade: undefined })
const resolvedStyle = computed(() => resolveStyle(preset.value, ov.value))
function choosePreset(p) { preset.value = p; ov.value = { fontSize: undefined, color: undefined, position: undefined, background: undefined, fade: undefined } }
function setOv(key, val) { ov.value = { ...ov.value, [key]: val } }

// cover / background image (blurred-artwork background)
const coverImg = ref(null)
const hasCover = computed(() => !!coverImg.value)
async function loadEmbeddedCover(f) {
  coverImg.value = null
  if (!f || isVideoInput(f.name, f.type)) return
  try {
    const { readTags } = await import('./metadata')
    const tg = await readTags(f)
    if (tg?.coverUrl) {
      const { loadCoverImage } = await import('./subtitleRender')
      const img = await loadCoverImage(tg.coverUrl)
      if (img) coverImg.value = img
      try { URL.revokeObjectURL(tg.coverUrl) } catch { /* ignore */ }
    }
  } catch { /* no cover */ }
}
function pickCover() {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'image/*'
  input.onchange = async (e) => {
    const f = e.target.files?.[0]
    if (!f) return
    const { loadCoverImage } = await import('./subtitleRender')
    const img = await loadCoverImage(f)
    if (img) { coverImg.value = img; setOv('background', 'cover') }
  }
  input.click()
}
// Preview: while playing show the active segment with fade; when paused show the selected one fully.
const previewIndex = computed(() => (playing.value ? activeIdx.value : (selectedIndex.value >= 0 ? selectedIndex.value : 0)))
const previewAlpha = computed(() => (playing.value ? null : 1))
const previewCover = computed(() => (resolvedStyle.value.background === 'cover' ? coverImg.value : null))

// ---- render (canvas + MediaRecorder → webm) ----
const recSupported = ref(true)
const renderSizeId = ref('landscape')
const renderSize = computed(() => renderSizeById(renderSizeId.value))
const recording = ref(false)
const recProgress = ref(0)
const recResult = ref(null) // { url, blob, size, name }
let recAborter = null
const recPct = computed(() => Math.max(0, Math.min(100, Math.round(recProgress.value * 100))))

function revokeRec() { if (recResult.value?.url) { try { URL.revokeObjectURL(recResult.value.url) } catch { /* ignore */ } } }

async function renderVideo() {
  if (!media.file.value || !hasSegments.value || recording.value) return
  recording.value = true
  recProgress.value = 0
  revokeRec(); recResult.value = null
  recAborter = new AbortController()
  try {
    const { renderSubtitledVideo } = await import('./subtitleRender')
    const { width, height } = renderSize.value
    const blob = await renderSubtitledVideo({
      file: media.file.value,
      segments: segments.value,
      style: resolvedStyle.value,
      width, height,
      cover: previewCover.value,
      duration: srcDuration.value,
      onProgress: (p) => { recProgress.value = p },
      signal: recAborter.signal,
    })
    if (!blob || !blob.size) throw new Error('empty')
    const name = `${baseName(media.name.value || 'subtitled')}-subtitled.webm`
    recResult.value = { blob, url: URL.createObjectURL(blob), size: blob.size, name }
    recProgress.value = 1
    showToast(t('media.st.rendered'))
  } catch (err) {
    if (err?.name === 'AbortError') showToast(t('media.st.renderCanceled'))
    else if (err?.message === 'recording-unsupported') { recSupported.value = false; showToast(t('media.st.renderUnsupported')) }
    else { console.error('[studio] render failed:', err); showToast(t('media.st.renderFailed')) }
  } finally {
    recording.value = false
    recAborter = null
  }
}
function cancelRender() { try { recAborter?.abort() } catch { /* ignore */ } }
function downloadRec() { if (recResult.value) import('./mediaDom').then(({ downloadBlob }) => downloadBlob(recResult.value.blob, recResult.value.name)) }

// ---- subtitle-file export ----
const exportFmt = ref('srt')
const outBase = computed(() => baseName(media.name.value || 'subtitles'))
function exportSubs() {
  if (!hasSegments.value) return
  const { text, mime, ext } = serializeSubtitles(segments.value, exportFmt.value)
  const blob = new Blob([text], { type: mime })
  import('./mediaDom').then(({ downloadBlob }) => downloadBlob(blob, `${outBase.value}.${ext}`))
}
function copySubs() {
  const { text } = serializeSubtitles(segments.value, exportFmt.value)
  navigator.clipboard?.writeText(text).then(() => showToast(t('media.st.copied'))).catch(() => {})
}
const handoffFile = computed(() => {
  if (!hasSegments.value) return null
  const { text, mime, ext } = serializeSubtitles(segments.value, 'srt')
  return new File([text], `${outBase.value}.${ext}`, { type: mime })
})

// ---- burn / mux into a video (ffmpeg — preserved from the original tool) ----
const burnMode = ref('burn') // 'burn' | 'mux'
const burnFontSize = ref(24)
const burnCrf = ref(23)
const burnBusy = ref(false)
const burnPhase = ref('')
const burnProgress = ref(0)
const burnResult = ref(null)
const dl = ref(null)
const runtimeCached = ref(false)
const burnPct = computed(() => Math.max(0, Math.min(100, Math.round(burnProgress.value * 100))))
const dlPct = computed(() => (dl.value?.total ? Math.max(0, Math.min(100, Math.round((dl.value.ratio || 0) * 100))) : null))
function revokeBurn() { if (burnResult.value?.url) { try { URL.revokeObjectURL(burnResult.value.url) } catch { /* ignore */ } } }

async function runBurn() {
  if (!isVideo.value || !hasSegments.value || burnBusy.value) return
  burnBusy.value = true; burnProgress.value = 0; dl.value = null; revokeBurn(); burnResult.value = null
  try {
    const { isEngineLoaded } = await import('./ffmpegRunner')
    burnPhase.value = isEngineLoaded() ? 'converting' : 'loading'
    const runner = await import('./audioRunner')
    const { text } = serializeSubtitles(segments.value, 'srt')
    const subFile = new File([text], `${outBase.value}.srt`, { type: 'application/x-subrip' })
    const onProgress = ({ progress: p }) => { burnPhase.value = 'converting'; if (isFinite(p)) burnProgress.value = Math.max(0, Math.min(1, p)) }
    const blob = burnMode.value === 'burn'
      ? await runner.burnSubtitles({ video: media.file.value, subtitle: subFile, options: { fontSize: burnFontSize.value, crf: burnCrf.value, preset: 'veryfast' }, onProgress })
      : await runner.muxSubtitles({ video: media.file.value, subtitle: subFile, options: {}, onProgress })
    const container = burnMode.value === 'mux' && /\.mkv$/i.test(media.name.value) ? 'mkv' : 'mp4'
    const suffix = burnMode.value === 'burn' ? '-hardsub' : '-subbed'
    burnResult.value = { blob, url: URL.createObjectURL(blob), size: blob.size, name: `${outBase.value}${suffix}.${container}` }
    burnProgress.value = 1
    showToast(t('media.done'))
  } catch (err) {
    console.error('[studio] burn/mux failed:', err)
    showToast(t('media.sub.failed'))
  } finally { burnBusy.value = false; burnPhase.value = '' }
}
function downloadBurn() { if (burnResult.value) import('./mediaDom').then(({ downloadBlob }) => downloadBlob(burnResult.value.blob, burnResult.value.name)) }

// ---- lifecycle ----
function onMediaLoaded(f) {
  srcDuration.value = 0; currentTime.value = 0; peaks.value = null
  loadWaveform(f)
  loadEmbeddedCover(f)
}
async function loadWaveform(f) {
  wfLoading.value = true; peaks.value = null
  try {
    const { decodeToPeaks } = await import('./waveform')
    const r = await decodeToPeaks(f, 1200)
    peaks.value = r.peaks
    if (r.duration > 0 && !srcDuration.value) srcDuration.value = r.duration
  } catch { peaks.value = [] } finally { wfLoading.value = false }
}
function pickMedia() { media.openPicker() }
function onMediaDrop(e) { media.onDrop(e) } // the media.file watcher runs onMediaLoaded
function resetMedia() {
  onPause(); revokeRec(); revokeBurn()
  recResult.value = null; burnResult.value = null
  media.clear(); srcDuration.value = 0; currentTime.value = 0; peaks.value = null; coverImg.value = null
}

let unsubEngine = null
onMounted(async () => {
  const { isRecordingSupported } = await import('./subtitleRender')
  recSupported.value = isRecordingSupported()

  const taken = handoff.take(['av', 'video', 'audio', 'subtitle', 'text'])
  if (taken?.payload) {
    const p = taken.payload
    if (taken.kind === 'subtitle' || taken.kind === 'text') {
      const text = typeof p === 'string' ? p : (p instanceof Blob ? await p.text() : '')
      if (text && importSubText(text, taken.name || p?.name || '')) { showToast(t('handoff.received')); step.value = 'proofread' }
    } else {
      const f = p instanceof File ? p : new File([p], taken.name || 'media', { type: p?.type || '' })
      if (media.set(f)) showToast(t('handoff.received')) // the media.file watcher runs onMediaLoaded
    }
  }

  const { onEngineEvent, isRuntimeCached } = await import('./ffmpegRunner')
  unsubEngine = onEngineEvent((e) => { if (e.type === 'download') dl.value = { received: e.received, total: e.total, ratio: e.ratio, fromCache: e.fromCache } })
  try { runtimeCached.value = await isRuntimeCached() } catch { runtimeCached.value = false }
})
onBeforeUnmount(() => { cancelAnimationFrame(rafId); try { recAborter?.abort() } catch { /* ignore */ } unsubEngine?.(); revokeRec(); revokeBurn() })

// If media changes via the picker (not drop), still kick off decode.
watch(() => media.file.value, (f, old) => { if (f && f !== old) onMediaLoaded(f) })

function fmtTime(sec) {
  const s = Math.max(0, Number(sec) || 0)
  const mm = Math.floor(s / 60)
  const ss = s - mm * 60
  return `${mm}:${ss.toFixed(1).padStart(4, '0')}`
}
</script>

<template>
  <MediaShell>
    <div class="route-page">
      <h1 class="sr-only">{{ m.h1 }}</h1>
      <div class="media-navwrap"><MediaToolNav /></div>
      <ClientOnly>
        <main class="media">
          <header class="media-head">
            <h2 class="media-title">{{ t('media.st.title') }}</h2>
            <p class="media-sub">{{ t('media.st.sub') }}</p>
          </header>

          <!-- Step nav -->
          <div class="steps seg">
            <button v-for="(s, i) in STEPS" :key="s" :class="{ on: step === s }" :disabled="s !== 'source' && !hasSegments" @click="goStep(s)">
              <span class="step-n">{{ i + 1 }}</span>{{ t('media.st.step.' + s) }}
            </button>
          </div>

          <!-- ============ SOURCE ============ -->
          <section v-show="step === 'source'" class="panel">
            <!-- Media -->
            <MediaDropZone
              v-if="!media.file.value"
              :title="t('media.st.dropMedia')"
              :hint="t('media.st.browseMedia')"
              :drag-over="media.dragOver.value"
              icon="video"
              @pick="pickMedia" @drop="onMediaDrop" @dragover="media.onDragOver" @dragleave="media.onDragLeave"
            />
            <div v-else class="card file-card">
              <div class="file-row">
                <div class="file-meta">
                  <span class="file-name" :title="media.name.value">{{ media.name.value }}</span>
                  <span class="file-size">{{ formatSize(media.size.value) }}<template v-if="srcDuration"> · {{ formatDuration(srcDuration) }}</template><template v-if="isVideo"> · {{ t('media.st.video') }}</template></span>
                </div>
                <button class="link-btn" @click="resetMedia">{{ t('media.change') }}</button>
              </div>
              <component :is="isVideo ? 'video' : 'audio'" ref="previewEl" class="player" :class="{ video: isVideo }" :src="media.url.value" controls preload="metadata" @loadedmetadata="onPreviewMeta" @play="onPlay" @pause="onPause" @ended="onPause" />
            </div>

            <!-- Subtitle track -->
            <div class="card sub-card">
              <div class="card-head">
                <span class="card-title">{{ t('media.st.subtitleTrack') }}</span>
                <span v-if="hasSegments" class="pill">{{ segments.length }} {{ t('media.st.segments') }}</span>
              </div>
              <div class="sub-drop" :class="{ over: subDragOver, filled: hasSegments }" role="button" tabindex="0"
                @click="pickSub" @keydown.enter.prevent="pickSub" @keydown.space.prevent="pickSub"
                @dragover.prevent="subDragOver = true" @dragleave.prevent="subDragOver = false" @drop.prevent="onSubDrop">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><line x1="6" y1="14" x2="11" y2="14"/><line x1="13" y1="14" x2="18" y2="14"/></svg>
                <span class="sub-name" :class="{ muted: !hasSegments }">{{ hasSegments ? t('media.st.replaceSub') : t('media.st.pickSub') }}</span>
              </div>
              <p class="note">{{ t('media.st.subHint') }}</p>
              <button v-if="!hasSegments" class="link-btn scratch" @click="startFromScratch">{{ t('media.st.scratch') }}</button>
            </div>

            <button class="btn primary" :disabled="!media.file.value || !hasSegments" @click="goStep('proofread')">{{ t('media.st.toProofread') }}</button>
            <p v-if="media.file.value && !hasSegments" class="note">{{ t('media.st.needSubToContinue') }}</p>
          </section>

          <!-- ============ PROOFREAD ============ -->
          <section v-show="step === 'proofread' && hasSegments" class="panel">
            <div class="card">
              <MediaWaveform :peaks="peaks" :duration="srcDuration" :play-ratio="playRatio" :loading="wfLoading"
                :sel-start="selectedIndex >= 0 ? segments[selectedIndex].start : null"
                :sel-end="selectedIndex >= 0 ? segments[selectedIndex].end : null"
                :height="84" @seek="seekTo" @select="onWfSelect" />
              <div class="transport">
                <button class="icon-btn" :title="t('media.st.playPause')" @click="togglePlay">
                  <svg v-if="!playing" viewBox="0 0 16 16" fill="currentColor"><path d="M4 3l9 5-9 5z"/></svg>
                  <svg v-else viewBox="0 0 16 16" fill="currentColor"><rect x="4" y="3" width="3" height="10"/><rect x="9" y="3" width="3" height="10"/></svg>
                </button>
                <span class="time-read">{{ fmtTime(currentTime) }} / {{ fmtTime(srcDuration) }}</span>
                <span class="spacer"></span>
                <div class="offset">
                  <span class="offset-lbl">{{ t('media.st.offset') }}</span>
                  <button class="icon-btn sm" @click="nudgeOffset(-0.5)" title="-0.5s">−</button>
                  <input class="num-input off-in" type="number" step="0.1" v-model.number="offset" @keydown.enter="applyOffsetInput" />
                  <button class="icon-btn sm" @click="nudgeOffset(0.5)" title="+0.5s">+</button>
                  <button class="btn small" @click="applyOffsetInput">{{ t('media.st.apply') }}</button>
                </div>
              </div>
              <p class="note">{{ t('media.st.dragHint') }}</p>
            </div>

            <div class="seg-list">
              <div v-for="(seg, i) in segments" :key="seg.id" class="seg-item" :class="{ sel: seg.id === selectedId, active: i === activeIdx }" @click="selectSeg(i)">
                <div class="seg-top">
                  <button class="icon-btn sm play" :title="t('media.st.playSeg')" @click.stop="seekTo(seg.start, true)">
                    <svg viewBox="0 0 16 16" fill="currentColor"><path d="M4 3l9 5-9 5z"/></svg>
                  </button>
                  <input class="num-input t-in" type="number" step="0.05" min="0" :value="seg.start.toFixed(2)" @change="editTime(i, 'start', $event.target.value)" @click.stop />
                  <span class="t-sep">→</span>
                  <input class="num-input t-in" type="number" step="0.05" min="0" :value="seg.end.toFixed(2)" @change="editTime(i, 'end', $event.target.value)" @click.stop />
                  <span class="spacer"></span>
                  <div class="seg-actions">
                    <button class="icon-btn sm" :title="t('media.st.split')" @click.stop="doSplit(i)"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M8 2v12"/><path d="M4 6L2 8l2 2"/><path d="M12 6l2 2-2 2"/></svg></button>
                    <button class="icon-btn sm" :title="t('media.st.merge')" :disabled="i >= segments.length - 1" @click.stop="doMerge(i)"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M2 6l2 2-2 2"/><path d="M14 6l-2 2 2 2"/><path d="M5 8h6"/></svg></button>
                    <button class="icon-btn sm" :title="t('media.st.addAfter')" @click.stop="doAdd(i)"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M8 3v10M3 8h10"/></svg></button>
                    <button class="icon-btn sm danger" :title="t('media.st.delete')" @click.stop="doDelete(i)"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M3 4h10M6 4V2.5h4V4M5 4l.7 9h4.6L11 4"/></svg></button>
                  </div>
                </div>
                <textarea class="text-input seg-text" rows="1" :value="seg.text" @input="editText(i, $event.target.value)" @click.stop :placeholder="t('media.st.textPlaceholder')"></textarea>
              </div>
            </div>

            <div class="step-actions">
              <button class="btn" @click="goStep('source')">{{ t('media.st.back') }}</button>
              <button class="btn primary" @click="goStep('style')">{{ t('media.st.toStyle') }}</button>
            </div>
          </section>

          <!-- ============ STYLE ============ -->
          <section v-show="step === 'style' && hasSegments" class="panel">
            <SubtitleCanvas :segments="segments" :style="resolvedStyle" :time="currentTime" :cover="previewCover"
              :width="renderSize.width" :height="renderSize.height" :active-index="previewIndex" :force-alpha="previewAlpha" />

            <div class="transport compact">
              <button class="icon-btn" @click="togglePlay">
                <svg v-if="!playing" viewBox="0 0 16 16" fill="currentColor"><path d="M4 3l9 5-9 5z"/></svg>
                <svg v-else viewBox="0 0 16 16" fill="currentColor"><rect x="4" y="3" width="3" height="10"/><rect x="9" y="3" width="3" height="10"/></svg>
              </button>
              <span class="time-read">{{ fmtTime(currentTime) }} / {{ fmtTime(srcDuration) }}</span>
              <span class="spacer"></span>
              <span class="note">{{ t('media.st.previewHint') }}</span>
            </div>

            <div class="card style-controls">
              <div class="ctrl">
                <span class="ctrl-label">{{ t('media.st.preset') }}</span>
                <div class="seg">
                  <button v-for="p in STYLE_PRESET_IDS" :key="p" :class="{ on: preset === p }" @click="choosePreset(p)">{{ t('media.st.preset.' + p) }}</button>
                </div>
              </div>
              <div class="ctrl-row">
                <div class="ctrl">
                  <label class="ctrl-label">{{ t('media.st.fontSize') }} <span class="val">{{ resolvedStyle.fontSize }}</span></label>
                  <input class="range-in" type="range" min="18" max="80" step="1" :value="resolvedStyle.fontSize" @input="setOv('fontSize', +$event.target.value)" />
                </div>
                <div class="ctrl">
                  <label class="ctrl-label">{{ t('media.st.fade') }} <span class="val">{{ resolvedStyle.fade }}s</span></label>
                  <input class="range-in" type="range" min="0" max="1.5" step="0.05" :value="resolvedStyle.fade" @input="setOv('fade', +$event.target.value)" />
                </div>
              </div>
              <div class="ctrl-row color-size">
                <div class="ctrl">
                  <span class="ctrl-label">{{ t('media.st.color') }}</span>
                  <input class="color-input" type="color" :value="resolvedStyle.color" @input="setOv('color', $event.target.value)" />
                </div>
                <div class="ctrl">
                  <span class="ctrl-label">{{ t('media.st.position') }}</span>
                  <div class="seg">
                    <button v-for="pos in ['top', 'center', 'lower']" :key="pos" :class="{ on: resolvedStyle.position === pos }" @click="setOv('position', pos)">{{ t('media.st.pos.' + pos) }}</button>
                  </div>
                </div>
              </div>
              <div class="ctrl">
                <span class="ctrl-label">{{ t('media.st.background') }}</span>
                <div class="bg-row">
                  <div class="seg">
                    <button :class="{ on: resolvedStyle.background !== 'cover' }" @click="setOv('background', 'gradient')">{{ t('media.st.bgGradient') }}</button>
                    <button :class="{ on: resolvedStyle.background === 'cover' }" @click="setOv('background', 'cover')">{{ t('media.st.bgCover') }}</button>
                  </div>
                  <button class="btn small" @click="pickCover">{{ hasCover ? t('media.st.changeImage') : t('media.st.addImage') }}</button>
                </div>
                <p v-if="resolvedStyle.background === 'cover' && !hasCover" class="note">{{ t('media.st.noCover') }}</p>
              </div>
            </div>

            <div class="step-actions">
              <button class="btn" @click="goStep('proofread')">{{ t('media.st.back') }}</button>
              <button class="btn primary" @click="goStep('export')">{{ t('media.st.toExport') }}</button>
            </div>
          </section>

          <!-- ============ EXPORT ============ -->
          <section v-show="step === 'export' && hasSegments" class="panel">
            <!-- Render to video -->
            <div class="card">
              <div class="card-head"><span class="card-title">{{ t('media.st.renderTitle') }}</span></div>
              <p class="note">{{ t('media.st.renderNote') }}</p>

              <template v-if="recSupported">
                <div class="ctrl">
                  <span class="ctrl-label">{{ t('media.st.size') }}</span>
                  <div class="seg">
                    <button v-for="s in RENDER_SIZES" :key="s.id" :class="{ on: renderSizeId === s.id }" :disabled="recording" @click="renderSizeId = s.id">{{ s.label }}</button>
                  </div>
                </div>

                <button v-if="!recording" class="btn primary" :disabled="!media.file.value" @click="renderVideo">
                  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="6"/><circle cx="8" cy="8" r="2.2" fill="currentColor" stroke="none"/></svg>
                  {{ t('media.st.render') }}
                </button>
                <template v-else>
                  <div class="progress">
                    <div class="bar"><div class="bar-fill" :style="{ width: (recProgress > 0 ? recPct : 4) + '%' }"></div></div>
                    <span class="progress-pct">{{ recPct }}%</span>
                    <button class="link-btn" @click="cancelRender">{{ t('media.st.cancel') }}</button>
                  </div>
                  <p class="note small">{{ t('media.st.renderProgressNote') }}</p>
                </template>

                <div v-if="recResult" class="result">
                  <video class="player video" :src="recResult.url" controls preload="metadata"></video>
                  <div class="result-meta"><span class="result-name">{{ recResult.name }}</span><span class="result-size">{{ formatSize(recResult.size) }}</span></div>
                  <button class="btn cta" @click="downloadRec">{{ t('media.st.downloadVideo') }}</button>
                </div>
              </template>
              <div v-else class="err">
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M8 1.5L15 14H1z"/><line x1="8" y1="6" x2="8" y2="9.5"/><circle cx="8" cy="11.6" r="0.6" fill="currentColor" stroke="none"/></svg>
                <span>{{ t('media.st.renderUnsupportedLong') }}</span>
              </div>
            </div>

            <!-- Export subtitle files -->
            <div class="card">
              <div class="card-head"><span class="card-title">{{ t('media.st.exportSubs') }}</span></div>
              <div class="export-row">
                <div class="seg fmt">
                  <button v-for="f in ['srt', 'vtt', 'lrc']" :key="f" :class="{ on: exportFmt === f }" @click="exportFmt = f">{{ f.toUpperCase() }}</button>
                </div>
                <button class="btn" @click="copySubs">{{ t('media.st.copy') }}</button>
                <button class="btn primary" @click="exportSubs">{{ t('media.st.exportFile') }}</button>
                <SendToMenu :payload="handoffFile" kind="subtitle" from="/media/subtitles" />
              </div>
            </div>

            <!-- Burn / mux into the source video (ffmpeg) -->
            <div v-if="isVideo" class="card">
              <div class="card-head"><span class="card-title">{{ t('media.st.burnTitle') }}</span></div>
              <p class="note">{{ t('media.st.burnNote') }}</p>
              <div class="ctrl">
                <span class="ctrl-label">{{ t('media.sub.mode') }}</span>
                <div class="seg">
                  <button :class="{ on: burnMode === 'burn' }" :disabled="burnBusy" @click="burnMode = 'burn'">{{ t('media.sub.burn') }}</button>
                  <button :class="{ on: burnMode === 'mux' }" :disabled="burnBusy" @click="burnMode = 'mux'">{{ t('media.sub.mux') }}</button>
                </div>
              </div>
              <template v-if="burnMode === 'burn'">
                <div class="ctrl-row">
                  <div class="ctrl"><label class="ctrl-label">{{ t('media.sub.fontSize') }} <span class="val">{{ burnFontSize }}</span></label><input class="range-in" type="range" v-model.number="burnFontSize" min="12" max="48" step="1" :disabled="burnBusy" /></div>
                  <div class="ctrl"><label class="ctrl-label">{{ t('media.sub.quality') }} <span class="val">{{ burnCrf }}</span></label><input class="range-in" type="range" v-model.number="burnCrf" min="16" max="32" step="1" :disabled="burnBusy" /></div>
                </div>
              </template>
              <button class="btn primary" :disabled="burnBusy" @click="runBurn">{{ burnBusy ? (burnPhase === 'loading' ? t('media.loadingRuntime') : t('media.converting')) : t('media.sub.run') }}</button>
              <p v-if="!burnBusy && !runtimeCached" class="note small">{{ t('media.runtimeWillDownload') }}</p>
              <div v-if="burnBusy && burnPhase === 'loading'" class="progress"><div class="bar"><div class="bar-fill indet" :style="dlPct != null ? { width: dlPct + '%' } : {}"></div></div><span class="progress-pct"><template v-if="dlPct != null">{{ dlPct }}%</template><template v-else>…</template></span></div>
              <div v-if="burnBusy && burnPhase === 'converting'" class="progress"><div class="bar"><div class="bar-fill" :style="{ width: (burnProgress > 0 ? burnPct : 6) + '%' }"></div></div><span class="progress-pct">{{ burnProgress > 0 ? burnPct + '%' : '' }}</span></div>
              <div v-if="burnResult" class="result">
                <video class="player video" :src="burnResult.url" controls preload="metadata"></video>
                <div class="result-meta"><span class="result-name">{{ burnResult.name }}</span><span class="result-size">{{ formatSize(burnResult.size) }}</span></div>
                <button class="btn primary" @click="downloadBurn">{{ t('media.download') }}</button>
              </div>
            </div>

            <div class="step-actions"><button class="btn" @click="goStep('style')">{{ t('media.st.back') }}</button></div>
          </section>
        </main>
      </ClientOnly>
    </div>
  </MediaShell>
</template>

<style scoped>
.route-page { flex: 1; display: flex; flex-direction: column; min-height: 0; }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }
.media-navwrap { max-width: var(--page-wide); margin: 0 auto; width: 100%; padding: 22px 24px 0; }
@media (max-width: 560px) { .media-navwrap { padding: 16px 16px 0; } }

.media { flex: 1; overflow-y: auto; padding: 20px 24px 48px; max-width: var(--page-wide); margin: 0 auto; width: 100%; animation: tbIn 0.3s var(--ease-out); }
@keyframes tbIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
.media-head { margin-bottom: 16px; }
.media-title { font-size: 24px; font-weight: 750; letter-spacing: -0.5px; }
.media-sub { margin-top: 6px; color: var(--text-secondary); font-size: 13px; line-height: 1.5; max-width: 72ch; }

/* Step nav */
.steps { margin-bottom: 16px; }
.steps button { display: inline-flex; align-items: center; gap: 7px; }
.steps button:disabled { opacity: 0.45; cursor: default; }
.step-n { display: inline-flex; align-items: center; justify-content: center; width: 17px; height: 17px; border-radius: 50%; background: var(--surface-active); color: var(--text-secondary); font-size: 10px; font-weight: 700; flex-shrink: 0; }
.steps button.on .step-n { background: var(--accent); color: var(--accent-text); }

.panel { display: flex; flex-direction: column; gap: 14px; }

/* File card */
.file-card { display: flex; flex-direction: column; gap: 12px; }
.file-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.file-meta { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.file-name { font-size: 14px; font-weight: 600; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.file-size { font-size: 11px; color: var(--text-secondary); font-variant-numeric: tabular-nums; }
.player { width: 100%; height: 40px; }
.player.video { height: auto; max-height: 300px; border-radius: 8px; background: #000; }

/* Subtitle source card */
.card-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 10px; }
.card-title { font-size: 14px; font-weight: 700; }
.pill { font-size: 11px; font-weight: 600; color: var(--accent); background: var(--accent-bg); padding: 2px 9px; border-radius: 20px; }
.sub-card { display: flex; flex-direction: column; }
.sub-drop { display: flex; align-items: center; gap: 10px; padding: 13px 15px; border: 2px dashed var(--border); border-radius: 10px; background: var(--surface-hover); cursor: pointer; transition: all 0.2s; outline: none; }
.sub-drop:hover, .sub-drop:focus-visible, .sub-drop.over { border-color: var(--accent); background: var(--accent-bg); }
.sub-drop.filled { border-style: solid; border-color: var(--border-light); }
.sub-drop svg { width: 20px; height: 20px; color: var(--text-tertiary); flex-shrink: 0; }
.sub-name { font-size: 13px; font-weight: 600; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sub-name.muted { color: var(--text-secondary); font-weight: 500; }
.scratch { align-self: flex-start; margin-top: 8px; }

.note { font-size: 12px; color: var(--text-secondary); line-height: 1.5; }
.note.small { font-size: 11px; }

/* Transport */
.transport { display: flex; align-items: center; gap: 10px; margin-top: 12px; flex-wrap: wrap; }
.transport.compact { margin-top: 0; }
.time-read { font-size: 12px; color: var(--text-secondary); font-variant-numeric: tabular-nums; font-family: var(--font-mono, monospace); }
.spacer { flex: 1; }
.offset { display: flex; align-items: center; gap: 6px; }
.offset-lbl { font-size: 11.5px; font-weight: 600; color: var(--text-secondary); }
.off-in { width: 68px; text-align: center; }
.icon-btn.sm { width: 28px; height: 28px; }
.icon-btn.sm svg { width: 13px; height: 13px; }
.icon-btn svg { fill: currentColor; }

/* Segment list */
.seg-list { display: flex; flex-direction: column; gap: 6px; }
.seg-item { border: 1px solid var(--border-light); border-radius: 10px; background: var(--surface); padding: 8px 10px; cursor: pointer; transition: border-color 0.15s, box-shadow 0.15s; }
.seg-item:hover { border-color: var(--border); }
.seg-item.sel { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
.seg-item.active { background: var(--accent-bg); }
.seg-top { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; }
.t-in { width: 74px; text-align: center; }
.t-sep { color: var(--text-tertiary); font-size: 12px; }
.seg-actions { display: flex; gap: 4px; }
.icon-btn.danger:hover { color: var(--danger, #d23); border-color: var(--danger, #d23); }
.seg-text { resize: vertical; min-height: 34px; line-height: 1.4; font-family: var(--font-sans); }

.step-actions { display: flex; gap: 10px; }
.step-actions .btn { flex: 1; }

/* Style controls */
.style-controls { display: flex; flex-direction: column; gap: 14px; }
.style-controls .ctrl-label { margin-bottom: 6px; }
.bg-row { display: flex; align-items: center; gap: 8px; }
.bg-row .seg { flex: 1; }

/* Progress + result */
.progress { display: flex; align-items: center; gap: 10px; margin-top: 10px; }
.bar { flex: 1; height: 8px; border-radius: 99px; background: var(--surface-hover); overflow: hidden; }
.bar-fill { height: 100%; background: var(--accent); border-radius: 99px; transition: width 0.2s ease; }
.bar-fill.indet { min-width: 12%; }
.progress-pct { font-size: 12px; color: var(--text-secondary); font-variant-numeric: tabular-nums; min-width: 36px; text-align: right; }
.result { display: flex; flex-direction: column; gap: 10px; margin-top: 12px; }
.result-meta { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
.result-name { font-size: 13px; font-weight: 600; word-break: break-all; }
.result-size { font-size: 11px; color: var(--text-secondary); flex-shrink: 0; }

.export-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.export-row .fmt { flex-shrink: 0; }
.export-row .fmt button { padding: 6px 12px; font-weight: 700; }

.err { display: flex; align-items: flex-start; gap: 9px; padding: 12px 14px; border: 1px solid var(--danger, #d23); border-radius: 10px; background: color-mix(in srgb, var(--danger, #d23) 8%, transparent); font-size: 12.5px; }
.err svg { width: 16px; height: 16px; color: var(--danger, #d23); flex-shrink: 0; margin-top: 1px; }

@media (max-width: 560px) {
  .media { padding: 20px 16px 56px; }
  .player.video { max-height: 220px; }
  .transport { gap: 8px; }
  .offset { flex-wrap: wrap; }
  .t-in { width: 64px; }
  .export-row .btn { flex: 1; }
}
</style>
