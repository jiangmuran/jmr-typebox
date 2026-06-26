<script setup>
// TRANSCRIBE tool — an online ASR (speech-to-text) sub-tool of the Audio/Video workbench. Takes an
// audio OR video file, (if needed) extracts + downsamples the audio with ffmpeg to fit the
// provider's size limit (~25 MB), chunks long media by time, POSTs each chunk to an OpenAI-
// compatible /audio/transcriptions endpoint (via the same-origin /api/asr proxy by default, gated
// on backendEnabled), stitches the segments back with correct offsets, and renders the transcript +
// a timestamped segment list. Exports TXT / SRT / VTT, and offers a "Send to →" (subtitles/editor).
//
// SSG-safety: the sr-only <h1> is outside <ClientOnly>; ffmpeg/DOM/fetch all happen in the
// client-only body behind dynamic imports. The provider call is gated by useAsr's `configured`.
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useRouteHead } from '../../composables/useRouteHead'
import { useI18n } from '../../composables/useI18n'
import { useToast } from '../../composables/useToast'
import ClientOnly from '../../components/ClientOnly.vue'
import SendToMenu from '../../components/SendToMenu.vue'
import MediaShell from './MediaShell.vue'
import MediaToolNav from './MediaToolNav.vue'
import MediaDropZone from './MediaDropZone.vue'
import { useMediaFile } from './useMediaFile'
import { useHandoff } from '../../composables/useHandoff'
import { useAsr } from '../../composables/useAsr'
import { isVideoInput, isMediaInput, formatSize, formatDuration, baseName } from './mediaHelpers'
import {
  extractSegments, stitchChunks, joinChunkText, planChunks, needsExtraction,
  serializeTranscript, secToVttTime,
} from './asrHelpers'

const { meta: m } = useRouteHead()
const { t } = useI18n()
const { showToast } = useToast()
// t() has no parameter interpolation, so do {name} substitution here for the parameterized strings.
function ti(key, params = {}) {
  return String(t(key)).replace(/\{(\w+)\}/g, (whole, k) => (k in params ? String(params[k]) : whole))
}
const handoff = useHandoff()
const asr = useAsr()

// ~10-minute windows for chunking; extract when video or audio over ~24 MB.
const CHUNK_WINDOW_SEC = 600
const EXTRACT_MAX_BYTES = 24 * 1024 * 1024

const media = useMediaFile({
  accept: 'audio/*,video/*',
  validate: (f) => {
    if (isMediaInput(f.name, f.type)) return true
    showToast(t('media.unsupported'))
    return false
  },
})
const isVideo = computed(() => media.file.value && isVideoInput(media.name.value, media.file.value.type))

// ---- source duration (from the preview element) ----
const srcDuration = ref(0)
const previewEl = ref(null)
function onPreviewMeta() {
  const el = previewEl.value
  if (el && isFinite(el.duration) && el.duration > 0) srcDuration.value = el.duration
}

// ---- run state ----
const busy = ref(false)
const stage = ref('')        // '' | 'loading' | 'extract' | 'upload' | 'transcribe' | 'stitch'
const progress = ref(0)      // 0..1 (extraction transcode), or chunk ratio while transcribing
const chunkInfo = ref(null)  // { current, total } while transcribing chunks
const dl = ref(null)
const runtimeCached = ref(false)
const errorMsg = ref('')     // a specific, actionable error
const log = ref([])          // human-readable staged log lines (incl. chunk notices)

// ---- result ----
const segments = ref(null)   // [{ start, end, text }] | null
const plainText = ref('')    // joined transcript (for the text view + TXT export)
const exportFmt = ref('srt')
let aborter = null

const hasResult = computed(() => Array.isArray(segments.value) && segments.value.length > 0)
const wordCount = computed(() => (plainText.value.trim() ? plainText.value.trim().split(/\s+/).length : 0))

let unsubEngine = null
onMounted(async () => {
  window.addEventListener('paste', onPaste)
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
  try { runtimeCached.value = await isRuntimeCached() } catch { runtimeCached.value = false }
})
onBeforeUnmount(() => { window.removeEventListener('paste', onPaste); unsubEngine?.(); try { aborter?.abort() } catch { /* ignore */ } })

function onPaste(e) { media.onPaste(e) }
function onDrop(e) { media.onDrop(e) }
function resetFile() {
  resetResult()
  srcDuration.value = 0
  media.clear()
}
function resetResult() {
  segments.value = null; plainText.value = ''; errorMsg.value = ''; log.value = []
  progress.value = 0; chunkInfo.value = null; stage.value = ''
}
function addLog(line) { log.value.push(line) }

function onExtractProgress({ progress: p }) {
  if (typeof p === 'number' && isFinite(p)) progress.value = Math.max(0, Math.min(1, p))
}

// Transcribe the loaded file. Pipeline: (extract+downsample if needed) → plan chunks → per chunk
// (extract window → upload+transcribe) → stitch. Sets segments + plainText, or errorMsg.
async function run() {
  if (!media.file.value || busy.value) return
  if (!asr.configured.value) { errorMsg.value = t('media.asr.errNotConfigured'); return }
  busy.value = true
  resetResult()
  aborter = new AbortController()

  try {
    const file = media.file.value
    const dur = srcDuration.value || 0
    const mustExtract = needsExtraction({ isVideo: isVideo.value, sizeBytes: media.size.value, maxBytes: EXTRACT_MAX_BYTES })

    // Decide chunking. Only chunk when we KNOW the duration and it exceeds the window.
    const chunks = planChunks({ durationSec: dur, windowSec: CHUNK_WINDOW_SEC })
    const chunked = chunks.length > 1
    if (chunked) addLog(ti('media.asr.logChunking', { n: chunks.length, win: Math.round(CHUNK_WINDOW_SEC / 60) }))

    const { extractAudioForAsr } = await import('./audioRunner')
    const { isEngineLoaded } = await import('./ffmpegRunner')

    const chunkResults = []
    for (const ch of chunks) {
      if (aborter.signal.aborted) throw new DOMException('aborted', 'AbortError')

      // 1) EXTRACT (or pass the file through untouched if it's already a small audio + single chunk).
      let uploadBlob, uploadName
      if (mustExtract || chunked) {
        stage.value = isEngineLoaded() ? 'extract' : 'loading'
        progress.value = 0
        if (chunked) addLog(ti('media.asr.logExtractChunk', { i: ch.index + 1, n: chunks.length }))
        else addLog(t('media.asr.logExtract'))
        uploadBlob = await extractAudioForAsr(file, {
          format: 'mp3',
          startSec: chunked ? ch.start : undefined,
          durSec: chunked ? ch.dur : undefined,
          durationSec: ch.dur || dur,
          onProgress: onExtractProgress,
        })
        uploadName = `${baseName(media.name.value || 'audio')}${chunked ? `-part${ch.index + 1}` : ''}.mp3`
      } else {
        uploadBlob = file
        uploadName = media.name.value || 'audio.mp3'
      }

      // 2) UPLOAD + TRANSCRIBE this chunk.
      stage.value = 'transcribe'
      chunkInfo.value = chunked ? { current: ch.index + 1, total: chunks.length } : null
      progress.value = chunked ? ch.index / chunks.length : 0
      const resp = await asr.transcribe(uploadBlob, { fileName: uploadName, responseFormat: 'verbose_json', signal: aborter.signal })
      const segs = extractSegments(resp)
      chunkResults.push({ offset: ch.start || 0, segments: segs, text: String(resp?.text ?? '') })
      progress.value = chunked ? (ch.index + 1) / chunks.length : 1
    }

    // 3) STITCH chunks into one continuous transcript.
    stage.value = 'stitch'
    const stitched = stitchChunks(chunkResults)
    segments.value = stitched
    plainText.value = stitched.length
      ? stitched.map((s) => s.text).join(' ').replace(/\s+/g, ' ').trim()
      : joinChunkText(chunkResults)
    if (!segments.value.length && plainText.value) {
      // Provider returned text without timing — show it as a single block so export still works.
      segments.value = [{ start: 0, end: srcDuration.value || 0, text: plainText.value }]
    }
    if (!segments.value.length) { errorMsg.value = t('media.asr.errEmpty') }
    else { showToast(t('media.asr.done')) }
  } catch (err) {
    if (err?.name === 'AbortError') { addLog(t('media.asr.canceled')) }
    else {
      console.error('[media] transcription failed:', err)
      errorMsg.value = mapError(err)
    }
  } finally {
    busy.value = false
    stage.value = ''
    chunkInfo.value = null
  }
}

// Map an AsrError kind to a specific, actionable message.
function mapError(err) {
  const kind = err?.kind
  if (kind === 'notConfigured') return t('media.asr.errNotConfigured')
  if (kind === 'tooBig') return t('media.asr.errTooBig')
  if (kind === 'network') return t('media.asr.errNetwork')
  const detail = err?.message ? `: ${err.message}` : ''
  return t('media.asr.errProvider') + detail
}

function cancel() { try { aborter?.abort() } catch { /* ignore */ } }
function retry() { errorMsg.value = ''; run() }

// ---- export ----
const outBase = computed(() => baseName(media.name.value || 'transcript'))
function exportFile() {
  if (!hasResult.value) return
  const { text, mime, ext } = serializeTranscript(segments.value, exportFmt.value)
  const blob = new Blob([text], { type: mime })
  import('./mediaDom').then(({ downloadBlob }) => downloadBlob(blob, `${outBase.value}.${ext}`))
}
function copyTranscript() {
  const txt = exportFmt.value === 'txt' ? plainText.value : serializeTranscript(segments.value, exportFmt.value).text
  navigator.clipboard?.writeText(txt).then(() => showToast(t('media.asr.copied'))).catch(() => {})
}

// File for the "Send to →" handoff: a subtitle file built from the chosen export format (default
// .srt → subtitles tool; .txt also flows to the editor as text).
const handoffFile = computed(() => {
  if (!hasResult.value) return null
  const fmt = exportFmt.value === 'txt' ? 'txt' : exportFmt.value
  const { text, mime, ext } = serializeTranscript(segments.value, fmt)
  return new File([text], `${outBase.value}.${ext}`, { type: mime })
})
const handoffKind = computed(() => (exportFmt.value === 'txt' ? 'text' : 'subtitle'))

function seekTo(sec) {
  const el = previewEl.value
  if (el && isFinite(sec)) { try { el.currentTime = sec; el.play?.() } catch { /* ignore */ } }
}

const progressPct = computed(() => Math.max(0, Math.min(100, Math.round(progress.value * 100))))
const dlPct = computed(() => dl.value?.total ? Math.max(0, Math.min(100, Math.round((dl.value.ratio || 0) * 100))) : null)

const stageLabel = computed(() => {
  if (stage.value === 'loading') return t('media.loadingRuntime')
  if (stage.value === 'extract') return t('media.asr.stageExtract')
  if (stage.value === 'transcribe') return chunkInfo.value
    ? ti('media.asr.stageTranscribeN', { i: chunkInfo.value.current, n: chunkInfo.value.total })
    : t('media.asr.stageTranscribe')
  if (stage.value === 'stitch') return t('media.asr.stageStitch')
  return ''
})

function fmtTs(sec) { return secToVttTime(sec).replace(/\.\d+$/, '') } // HH:MM:SS for the segment list
</script>

<template>
  <MediaShell>
    <div class="route-page">
      <h1 class="sr-only">{{ m.h1 }}</h1>
      <div class="media-navwrap"><MediaToolNav /></div>
      <ClientOnly>
        <main class="media">
          <header class="media-head">
            <h2 class="media-title">{{ t('media.asr.title') }}</h2>
            <p class="media-sub">{{ t('media.asr.sub') }}</p>
          </header>

          <!-- NOT CONFIGURED empty state -->
          <div v-if="!asr.configured.value" class="empty-state">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="2.5" width="6" height="12" rx="3"/><path d="M5.5 11a6.5 6.5 0 0013 0"/><line x1="12" y1="17.5" x2="12" y2="21.5"/><line x1="8" y1="21.5" x2="16" y2="21.5"/></svg>
            <h3>{{ t('media.asr.emptyTitle') }}</h3>
            <p>{{ t('media.asr.emptySub') }}</p>
            <p class="empty-steps">{{ t('media.asr.emptySteps') }}</p>
          </div>

          <template v-else>
            <!-- File input -->
            <MediaDropZone
              v-if="!media.file.value"
              :title="t('media.asr.drop')"
              :hint="t('media.asr.browse')"
              :drag-over="media.dragOver.value"
              icon="video"
              @pick="media.openPicker"
              @drop="onDrop"
              @dragover="media.onDragOver"
              @dragleave="media.onDragLeave"
            />

            <template v-else>
              <!-- Source -->
              <div class="card file-card">
                <div class="file-row">
                  <div class="file-meta">
                    <span class="file-name" :title="media.name.value">{{ media.name.value }}</span>
                    <span class="file-size">
                      {{ formatSize(media.size.value) }}
                      <template v-if="srcDuration"> · {{ formatDuration(srcDuration) }}</template>
                      <template v-if="isVideo"> · {{ t('media.asr.videoNote') }}</template>
                    </span>
                  </div>
                  <button class="link-btn" :disabled="busy" @click="resetFile">{{ t('media.change') }}</button>
                </div>
                <component :is="isVideo ? 'video' : 'audio'" ref="previewEl" class="player" :class="{ video: isVideo }" :src="media.url.value" controls preload="metadata" @loadedmetadata="onPreviewMeta" />
                <p class="model-line">{{ t('media.asr.usingModel') }} <code>{{ asr.model.value }}</code></p>
              </div>

              <!-- Run / progress -->
              <div v-if="!hasResult" class="run-card">
                <button v-if="!busy" class="btn primary run-btn" @click="run">
                  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="1.5" width="4" height="8" rx="2"/><path d="M3.5 7.5a4.5 4.5 0 009 0"/><line x1="8" y1="12" x2="8" y2="14.5"/></svg>
                  {{ t('media.asr.run') }}
                </button>

                <template v-else>
                  <div class="staged">
                    <span class="spinner" aria-hidden="true"></span>
                    <span class="stage-text">{{ stageLabel }}</span>
                    <button class="link-btn" @click="cancel">{{ t('media.asr.cancel') }}</button>
                  </div>
                  <div v-if="stage === 'loading' || stage === 'extract' || (stage === 'transcribe' && chunkInfo)" class="progress">
                    <div class="bar"><div class="bar-fill" :class="{ indet: stage === 'loading' && dlPct == null }" :style="{ width: (stage === 'loading' ? (dlPct ?? 8) : (progress > 0 ? progressPct : 6)) + '%' }"></div></div>
                    <span class="progress-pct">{{ stage === 'loading' ? (dlPct != null ? dlPct + '%' : '…') : (progress > 0 ? progressPct + '%' : '') }}</span>
                  </div>
                  <div v-else-if="stage === 'transcribe'" class="progress indeterminate"><div class="bar"><div class="bar-fill indet pulse"></div></div></div>
                  <p v-if="stage === 'loading'" class="note small">{{ dl?.fromCache ? t('media.runtimeFromCache') : t('media.runtimeHint') }}</p>
                </template>

                <!-- Staged log (chunk notices) -->
                <ul v-if="log.length" class="log">
                  <li v-for="(line, i) in log" :key="i">{{ line }}</li>
                </ul>

                <p v-if="!busy" class="note small runtime-hint">
                  <svg v-if="runtimeCached" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4 4 10-10"/></svg>
                  <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="M7 11l5 5 5-5"/><path d="M5 20h14"/></svg>
                  {{ t('media.asr.runHint') }}
                </p>

                <!-- Error -->
                <div v-if="errorMsg" class="err">
                  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M8 1.5L15 14H1z"/><line x1="8" y1="6" x2="8" y2="9.5"/><circle cx="8" cy="11.6" r="0.6" fill="currentColor" stroke="none"/></svg>
                  <div class="err-body">
                    <span>{{ errorMsg }}</span>
                    <button class="retry-btn" @click="retry">{{ t('media.asr.retry') }}</button>
                  </div>
                </div>
              </div>

              <!-- RESULT -->
              <template v-else>
                <div class="card result-head">
                  <div class="rh-meta">
                    <span class="rh-title">{{ t('media.asr.transcript') }}</span>
                    <span class="rh-stats">{{ segments.length }} {{ t('media.asr.segments') }} · {{ wordCount }} {{ t('media.asr.words') }}</span>
                  </div>
                  <div class="rh-actions">
                    <div class="fmt-seg">
                      <button v-for="f in ['srt', 'vtt', 'txt']" :key="f" :class="{ on: exportFmt === f }" @click="exportFmt = f">{{ f.toUpperCase() }}</button>
                    </div>
                    <button class="ghost-btn" @click="copyTranscript">{{ t('media.asr.copy') }}</button>
                    <button class="btn cta download-btn" @click="exportFile">{{ ti('media.asr.export', { fmt: exportFmt.toUpperCase() }) }}</button>
                    <SendToMenu :payload="handoffFile" :kind="handoffKind" from="/media/transcribe" />
                  </div>
                </div>

                <!-- Segment list -->
                <div class="segs">
                  <button v-for="(seg, i) in segments" :key="i" class="seg-row" @click="seekTo(seg.start)">
                    <span class="seg-ts">{{ fmtTs(seg.start) }}</span>
                    <span class="seg-text">{{ seg.text }}</span>
                  </button>
                </div>

                <button class="link-btn restart" @click="resetResult">{{ t('media.asr.again') }}</button>
              </template>
            </template>
          </template>
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

.media { flex: 1; overflow-y: auto; padding: 20px 24px 48px; max-width: var(--page-wide); margin: 0 auto; width: 100%; animation: tbIn 0.3s var(--ease-out); display: flex; flex-direction: column; gap: 16px; }
@keyframes tbIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
.media-head { margin-bottom: 2px; }
.media-title { font-size: 24px; font-weight: 750; letter-spacing: -0.5px; }
.media-sub { margin-top: 6px; color: var(--text-secondary); font-size: 13px; line-height: 1.5; max-width: 72ch; }

/* .card from global tool-kit */

/* Empty state */
.empty-state { display: flex; flex-direction: column; align-items: center; text-align: center; gap: 8px; padding: 44px 28px; border: 1px solid var(--border-light); border-radius: 14px; background: var(--surface); }
.empty-state svg { width: 40px; height: 40px; color: var(--text-tertiary); margin-bottom: 4px; }
.empty-state h3 { font-size: 16px; font-weight: 650; }
.empty-state p { font-size: 13px; color: var(--text-secondary); max-width: 46ch; line-height: 1.55; }
.empty-steps { margin-top: 6px; font-size: 12.5px; color: var(--text); background: var(--surface-hover); padding: 10px 14px; border-radius: 9px; }

.file-card { display: flex; flex-direction: column; gap: 12px; }
.file-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.file-meta { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.file-name { font-size: 14px; font-weight: 600; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.file-size { font-size: 11px; color: var(--text-secondary); font-variant-numeric: tabular-nums; }
.link-btn { flex-shrink: 0; border: none; background: var(--surface-hover); color: var(--text-secondary); font-size: 12px; padding: 5px 11px; border-radius: 7px; cursor: pointer; font-family: var(--font-sans); }
.link-btn:hover:not(:disabled) { color: var(--text); }
.link-btn:disabled { opacity: 0.5; cursor: default; }
.player { width: 100%; height: 40px; }
.player.video { height: auto; max-height: 280px; border-radius: 8px; background: #000; }
.model-line { font-size: 11px; color: var(--text-tertiary); }
.model-line code { font-family: var(--font-mono, monospace); background: var(--surface-hover); padding: 1px 6px; border-radius: 5px; color: var(--text-secondary); }

/* Run card */
.run-card { display: flex; flex-direction: column; gap: 12px; padding: 16px; border: 1px solid var(--border-light); border-radius: 12px; background: var(--surface); }
.run-btn { align-self: flex-start; }
.run-btn svg { width: 15px; height: 15px; }

.staged { display: flex; align-items: center; gap: 10px; font-size: 13px; color: var(--text); }
.stage-text { flex: 1; font-weight: 600; }
.spinner { width: 16px; height: 16px; border: 2px solid var(--border); border-top-color: var(--accent); border-radius: 50%; animation: spin 0.7s linear infinite; flex-shrink: 0; }
@keyframes spin { to { transform: rotate(360deg); } }

.progress { display: flex; align-items: center; gap: 10px; }
.bar { flex: 1; height: 8px; border-radius: 99px; background: var(--surface-hover); overflow: hidden; }
.bar-fill { height: 100%; background: var(--accent); border-radius: 99px; transition: width 0.2s ease; }
.bar-fill.indet { min-width: 14%; }
.bar-fill.pulse { width: 40%; animation: slide 1.3s ease-in-out infinite; }
@keyframes slide { 0% { margin-left: -40%; } 100% { margin-left: 100%; } }
.progress-pct { font-size: 12px; color: var(--text-secondary); font-variant-numeric: tabular-nums; min-width: 36px; text-align: right; }

.log { list-style: none; display: flex; flex-direction: column; gap: 3px; font-size: 11.5px; color: var(--text-tertiary); font-family: var(--font-mono, monospace); }
.log li::before { content: '› '; color: var(--accent); }

.note { font-size: 12px; color: var(--text-secondary); line-height: 1.5; }
.note.small { font-size: 11.5px; }
.runtime-hint { display: flex; align-items: center; gap: 6px; }
.runtime-hint svg { width: 14px; height: 14px; flex-shrink: 0; color: var(--text-tertiary); }

.err { display: flex; align-items: flex-start; gap: 9px; padding: 12px 14px; border: 1px solid var(--danger, #d23); border-radius: 10px; background: color-mix(in srgb, var(--danger, #d23) 8%, transparent); }
.err > svg { width: 16px; height: 16px; color: var(--danger, #d23); flex-shrink: 0; margin-top: 1px; }
.err-body { display: flex; flex-direction: column; gap: 8px; font-size: 12.5px; color: var(--text); }
.retry-btn { align-self: flex-start; padding: 6px 14px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); color: var(--text); font-size: 12px; font-weight: 600; cursor: pointer; font-family: var(--font-sans); }
.retry-btn:hover { border-color: var(--accent); }

/* Result */
.result-head { display: flex; align-items: center; justify-content: space-between; gap: 14px; flex-wrap: wrap; }
.rh-meta { display: flex; flex-direction: column; gap: 2px; }
.rh-title { font-size: 14px; font-weight: 700; }
.rh-stats { font-size: 11.5px; color: var(--text-secondary); }
.rh-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.fmt-seg { display: flex; background: var(--surface-hover); border-radius: 8px; padding: 2px; gap: 2px; }
.fmt-seg button { padding: 6px 11px; border: none; border-radius: 6px; font-size: 11px; font-weight: 700; background: transparent; color: var(--text-secondary); cursor: pointer; font-family: var(--font-sans); }
.fmt-seg button.on { background: var(--surface); color: var(--text); box-shadow: var(--shadow-xs); }
.ghost-btn { padding: 8px 13px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); color: var(--text); font-size: 12.5px; font-weight: 600; cursor: pointer; font-family: var(--font-sans); }
.ghost-btn:hover { background: var(--surface-hover); }
/* .download-btn → gold fill from .btn.cta */

.segs { display: flex; flex-direction: column; gap: 2px; border: 1px solid var(--border-light); border-radius: 12px; background: var(--surface); padding: 8px; }
.seg-row { display: flex; gap: 12px; align-items: baseline; text-align: left; width: 100%; padding: 8px 10px; border: none; border-radius: 8px; background: transparent; color: var(--text); font-size: 13.5px; line-height: 1.55; cursor: pointer; font-family: var(--font-sans); transition: background 0.12s; }
.seg-row:hover { background: var(--surface-hover); }
.seg-ts { flex-shrink: 0; font-size: 11px; color: var(--accent); font-variant-numeric: tabular-nums; font-family: var(--font-mono, monospace); padding-top: 1px; min-width: 56px; }
.seg-text { flex: 1; }
.restart { align-self: flex-start; }

@media (max-width: 560px) {
  .media { padding: 20px 16px 56px; }
  .player.video { max-height: 220px; }
  .result-head { flex-direction: column; align-items: stretch; }
  .rh-actions { justify-content: space-between; }
  .download-btn, .ghost-btn { flex: 1; text-align: center; }
  .seg-ts { min-width: 50px; }
}
</style>
