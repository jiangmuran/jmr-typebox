<script setup>
// COMPRESS tool — the size-reduction sub-tool of the Audio/Video workbench. Shrinks a VIDEO
// (resolution/scale, quality CRF, max-bitrate, fps, codec h264/vp9, audio bitrate) or AUDIO
// (bitrate/codec), showing the ORIGINAL size, a LIVE target-size estimate, and the REAL output size
// after the run. ffmpeg-based, detached-buffer-safe on repeat runs (runFFmpeg slices the buffer).
//
// SSG-safety: the sr-only <h1> is outside <ClientOnly>; all ffmpeg/DOM work is in the client-only
// body behind dynamic imports. The ~31MB ffmpeg core loads from the CDN on first use.
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
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
import {
  isVideoInput, isAudioInput, isMediaInput, formatSize, formatDuration, buildOutputNameWithSuffix,
  VIDEO_SCALES, COMPRESS_VCODECS, CRF_RANGE, BITRATE_PRESETS,
  estimateVideoSize, estimateAudioSize, bitrateKbps,
} from './mediaHelpers'

const { meta: m } = useRouteHead()
const { t } = useI18n()
const { showToast } = useToast()
const handoff = useHandoff()

const media = useMediaFile({
  accept: 'video/*,audio/*',
  validate: (f) => {
    if (isMediaInput(f.name, f.type)) return true
    showToast(t('media.unsupported'))
    return false
  },
})

const isVideo = computed(() => media.file.value && isVideoInput(media.name.value, media.file.value.type))
const isAudio = computed(() => media.file.value && !isVideo.value && isAudioInput(media.name.value, media.file.value.type))

// ---- source metadata (duration + video dimensions, read from the preview element) ----
const srcDuration = ref(0)
const srcWidth = ref(0)
const srcHeight = ref(0)
const previewEl = ref(null)
function onPreviewMeta() {
  const el = previewEl.value
  if (!el) return
  if (isFinite(el.duration) && el.duration > 0) srcDuration.value = el.duration
  if (el.videoWidth) { srcWidth.value = el.videoWidth; srcHeight.value = el.videoHeight }
}

// ---- video controls ----
const vcodec = ref('h264')
const crf = ref(CRF_RANGE.default)   // lower = better quality / bigger
const scaleId = ref('')              // '' = keep source; else a target height
const fpsLimit = ref('')             // '' = keep source
const maxBitrate = ref('')           // '' = none; e.g. '2000k'
const vAudioBitrate = ref('128k')

// ---- audio controls ----
const aBitrate = ref('128k')
const aChannels = ref('')            // '' = keep

// ---- run state ----
const busy = ref(false)
const phase = ref('')                // '' | 'loading' | 'working'
const progress = ref(0)
const dl = ref(null)
const runtimeCached = ref(false)
const result = ref(null)             // { blob, url, name, size, isVideo }

// Effective output height for the estimate (source height when "keep source").
const targetHeight = computed(() => {
  const h = parseInt(scaleId.value, 10)
  if (Number.isFinite(h) && h > 0) return Math.min(h, srcHeight.value || h)
  return srcHeight.value || 0
})
// Width scaled in proportion to the chosen height (for the per-pixel estimate).
const targetWidth = computed(() => {
  if (!srcWidth.value || !srcHeight.value) return targetHeight.value ? Math.round(targetHeight.value * 16 / 9) : 0
  const ratio = targetHeight.value && srcHeight.value ? targetHeight.value / srcHeight.value : 1
  return Math.round(srcWidth.value * ratio)
})
const targetFps = computed(() => {
  const f = parseInt(fpsLimit.value, 10)
  return Number.isFinite(f) && f > 0 ? f : 30
})

// LIVE estimate — recomputed reactively from the controls + source metadata.
const estimatedBytes = computed(() => {
  if (!media.file.value) return 0
  if (isVideo.value) {
    return estimateVideoSize({
      durationSec: srcDuration.value,
      crf: Number(crf.value),
      width: targetWidth.value,
      height: targetHeight.value,
      fps: targetFps.value,
      audioBitrateKbps: bitrateKbps(vAudioBitrate.value),
      maxBitrateKbps: maxBitrate.value ? bitrateKbps(maxBitrate.value) : 0,
    })
  }
  return estimateAudioSize({ durationSec: srcDuration.value, bitrateKbps: bitrateKbps(aBitrate.value) })
})
const savingsPct = computed(() => {
  const orig = media.size.value
  if (!orig || !estimatedBytes.value) return null
  return Math.round((1 - estimatedBytes.value / orig) * 100)
})

const outputName = computed(() => {
  const ext = isVideo.value ? 'mp4' : 'mp3'
  return buildOutputNameWithSuffix(media.name.value || (isVideo.value ? 'video' : 'audio'), ext, '-compressed')
})

let unsubEngine = null
onMounted(async () => {
  window.addEventListener('paste', onPaste)
  // Pick up a file handed off from another tool (Send to → Compress).
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
onBeforeUnmount(() => { window.removeEventListener('paste', onPaste); unsubEngine?.(); revokeResult() })

function onPaste(e) { media.onPaste(e) }
function onDrop(e) { media.onDrop(e) }
function revokeResult() { if (result.value?.url) { try { URL.revokeObjectURL(result.value.url) } catch { /* ignore */ } } }
function resetFile() { revokeResult(); result.value = null; progress.value = 0; srcDuration.value = 0; srcWidth.value = 0; srcHeight.value = 0; media.clear() }

// Reset the result when controls change (the estimate moved; the old output is stale).
watch([vcodec, crf, scaleId, fpsLimit, maxBitrate, vAudioBitrate, aBitrate, aChannels], () => {
  if (result.value) { revokeResult(); result.value = null }
})

function onProgress({ progress: p }) {
  phase.value = 'working'
  if (typeof p === 'number' && isFinite(p)) progress.value = Math.max(0, Math.min(1, p))
}

async function run() {
  if (!media.file.value || busy.value) return
  busy.value = true
  progress.value = 0
  dl.value = null
  revokeResult()
  result.value = null
  try {
    const { isEngineLoaded } = await import('./ffmpegRunner')
    phase.value = isEngineLoaded() ? 'working' : 'loading'
    const { compressMedia } = await import('./audioRunner')

    const blob = isVideo.value
      ? await compressMedia(media.file.value, {
          kind: 'video', format: 'mp4',
          options: {
            vcodec: vcodec.value,
            crf: Number(crf.value),
            height: scaleId.value ? parseInt(scaleId.value, 10) : undefined,
            fps: fpsLimit.value ? parseInt(fpsLimit.value, 10) : undefined,
            maxBitrate: maxBitrate.value || undefined,
            audioBitrate: vAudioBitrate.value,
            durationSec: srcDuration.value || undefined,
          },
          onProgress,
        })
      : await compressMedia(media.file.value, {
          kind: 'audio', format: 'mp3',
          options: {
            bitrate: aBitrate.value,
            channels: aChannels.value || undefined,
            durationSec: srcDuration.value || undefined,
          },
          onProgress,
        })

    result.value = { blob, url: URL.createObjectURL(blob), name: outputName.value, size: blob.size, isVideo: isVideo.value }
    progress.value = 1
    showToast(t('media.cmp.done'))
  } catch (err) {
    console.error('[media] compression failed:', err)
    showToast(t('media.cmp.failed'))
  } finally {
    busy.value = false
    phase.value = ''
  }
}

function download() {
  if (!result.value) return
  import('./mediaDom').then(({ downloadBlob }) => downloadBlob(result.value.blob, result.value.name))
}

const resultFile = computed(() => result.value ? new File([result.value.blob], result.value.name, { type: result.value.blob.type }) : null)
const resultKind = computed(() => result.value?.isVideo ? 'video' : 'audio')

const progressPct = computed(() => Math.max(0, Math.min(100, Math.round(progress.value * 100))))
const dlPct = computed(() => dl.value?.total ? Math.max(0, Math.min(100, Math.round((dl.value.ratio || 0) * 100))) : null)

// Quality label for the CRF slider (subjective).
const crfLabel = computed(() => {
  const c = Number(crf.value)
  if (c <= 20) return t('media.cmp.qHigh')
  if (c <= 26) return t('media.cmp.qBalanced')
  if (c <= 30) return t('media.cmp.qSmall')
  return t('media.cmp.qTiny')
})
</script>

<template>
  <MediaShell>
    <div class="route-page">
      <h1 class="sr-only">{{ m.h1 }}</h1>
      <div class="media-navwrap"><MediaToolNav /></div>
      <ClientOnly>
        <main class="media">
          <header class="media-head">
            <h2 class="media-title">{{ t('media.cmp.title') }}</h2>
            <p class="media-sub">{{ t('media.cmp.sub') }}</p>
          </header>

          <!-- File input -->
          <MediaDropZone
            v-if="!media.file.value"
            :title="t('media.cmp.drop')"
            :hint="t('media.cmp.browse')"
            :drag-over="media.dragOver.value"
            icon="video"
            @pick="media.openPicker"
            @drop="onDrop"
            @dragover="media.onDragOver"
            @dragleave="media.onDragLeave"
          />

          <div v-else class="grid">
            <!-- ===== LEFT: source + result ===== -->
            <section class="col col-source">
              <div class="card file-card">
                <div class="file-row">
                  <div class="file-meta">
                    <span class="file-name" :title="media.name.value">{{ media.name.value }}</span>
                    <span class="file-size">
                      {{ formatSize(media.size.value) }}
                      <template v-if="srcDuration"> · {{ formatDuration(srcDuration) }}</template>
                      <template v-if="isVideo && srcWidth"> · {{ srcWidth }}×{{ srcHeight }}</template>
                    </span>
                  </div>
                  <button class="link-btn" :disabled="busy" @click="resetFile">{{ t('media.change') }}</button>
                </div>
                <component
                  :is="isVideo ? 'video' : 'audio'"
                  ref="previewEl"
                  class="player"
                  :class="{ video: isVideo }"
                  :src="media.url.value"
                  controls
                  preload="metadata"
                  @loadedmetadata="onPreviewMeta"
                />
              </div>

              <!-- Result -->
              <div v-if="result" class="card result">
                <div class="result-meta">
                  <span class="result-name">{{ result.name }}</span>
                  <span class="size-delta">
                    <span class="muted">{{ formatSize(media.size.value) }}</span>
                    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8h9M9 5l3 3-3 3"/></svg>
                    <span>{{ formatSize(result.size) }}</span>
                    <span v-if="media.size.value && result.size < media.size.value" class="saved">−{{ Math.round((1 - result.size / media.size.value) * 100) }}%</span>
                  </span>
                </div>
                <component :is="result.isVideo ? 'video' : 'audio'" class="player" :class="{ video: result.isVideo }" :src="result.url" controls preload="metadata" />
                <div class="result-actions">
                  <button class="btn cta download-btn" @click="download">{{ t('media.download') }}</button>
                  <SendToMenu :payload="resultFile" :kind="resultKind" from="/media/compress" />
                </div>
              </div>
            </section>

            <!-- ===== RIGHT: controls ===== -->
            <section class="col col-controls">
              <div class="card panel">
                <!-- ===== VIDEO controls ===== -->
                <template v-if="isVideo">
                  <div class="field">
                    <label class="control-label">{{ t('media.cmp.quality') }} — {{ crfLabel }} (CRF {{ crf }})</label>
                    <input type="range" v-model.number="crf" :min="CRF_RANGE.min" :max="CRF_RANGE.max" step="1" :disabled="busy" />
                    <div class="range-ends"><span>{{ t('media.cmp.better') }}</span><span>{{ t('media.cmp.smaller') }}</span></div>
                  </div>

                  <div class="control">
                    <label class="control-label">{{ t('media.cmp.resolution') }}</label>
                    <select v-model="scaleId" class="select" :disabled="busy">
                      <option v-for="s in VIDEO_SCALES" :key="s.id" :value="s.id">{{ s.id === '' ? t('media.keep') : s.label }}</option>
                    </select>
                  </div>

                  <div class="control">
                    <label class="control-label">{{ t('media.cmp.codec') }}</label>
                    <div class="seg">
                      <button v-for="c in COMPRESS_VCODECS" :key="c.id" :class="{ on: vcodec === c.id }" :disabled="busy" @click="vcodec = c.id">{{ c.label }}</button>
                    </div>
                  </div>

                  <div class="control">
                    <label class="control-label">{{ t('media.cmp.fps') }}</label>
                    <select v-model="fpsLimit" class="select" :disabled="busy">
                      <option value="">{{ t('media.keep') }}</option>
                      <option value="60">60</option>
                      <option value="30">30</option>
                      <option value="24">24</option>
                      <option value="15">15</option>
                    </select>
                  </div>

                  <div class="control">
                    <label class="control-label">{{ t('media.cmp.audioBitrate') }}</label>
                    <select v-model="vAudioBitrate" class="select" :disabled="busy">
                      <option v-for="b in BITRATE_PRESETS" :key="b" :value="b">{{ b.replace('k', '') }} kbps</option>
                    </select>
                  </div>

                  <details class="adv-inline">
                    <summary>{{ t('media.advanced') }}</summary>
                    <div class="adv-body">
                      <div class="control">
                        <label class="control-label">{{ t('media.cmp.maxBitrate') }}</label>
                        <input type="text" class="num wide" inputmode="numeric" :placeholder="t('media.cmp.maxBitratePh')" v-model="maxBitrate" :disabled="busy" />
                      </div>
                      <p class="note tiny">{{ t('media.cmp.maxBitrateHint') }}</p>
                    </div>
                  </details>
                </template>

                <!-- ===== AUDIO controls ===== -->
                <template v-else>
                  <div class="control">
                    <label class="control-label">{{ t('media.bitrate') }}</label>
                    <select v-model="aBitrate" class="select" :disabled="busy">
                      <option v-for="b in BITRATE_PRESETS" :key="b" :value="b">{{ b.replace('k', '') }} kbps</option>
                    </select>
                  </div>
                  <div class="control">
                    <label class="control-label">{{ t('media.channels') }}</label>
                    <select v-model="aChannels" class="select" :disabled="busy">
                      <option value="">{{ t('media.keep') }}</option>
                      <option value="1">{{ t('media.mono') }}</option>
                      <option value="2">{{ t('media.stereo') }}</option>
                    </select>
                  </div>
                  <p class="note small">{{ t('media.cmp.audioHint') }}</p>
                </template>

                <!-- LIVE estimate -->
                <div class="estimate">
                  <div class="est-row">
                    <span class="est-label">{{ t('media.cmp.original') }}</span>
                    <span class="est-val">{{ formatSize(media.size.value) }}</span>
                  </div>
                  <div class="est-row big">
                    <span class="est-label">{{ t('media.cmp.estimate') }}</span>
                    <span class="est-val accent">
                      <template v-if="estimatedBytes">≈ {{ formatSize(estimatedBytes) }}</template>
                      <template v-else>—</template>
                      <span v-if="savingsPct != null && savingsPct > 0" class="est-save">−{{ savingsPct }}%</span>
                    </span>
                  </div>
                  <p v-if="!srcDuration" class="note tiny">{{ t('media.cmp.estimatePending') }}</p>
                  <p v-else class="note tiny">{{ t('media.cmp.estimateNote') }}</p>
                </div>

                <button class="btn primary run-btn" :disabled="busy || !media.file.value" @click="run">
                  {{ busy ? (phase === 'loading' ? t('media.loadingRuntime') : t('media.cmp.working')) : t('media.cmp.run') }}
                </button>

                <p v-if="!busy" class="note small runtime-hint">
                  <svg v-if="runtimeCached" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4 4 10-10"/></svg>
                  <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="M7 11l5 5 5-5"/><path d="M5 20h14"/></svg>
                  {{ runtimeCached ? t('media.runtimeCached') : t('media.runtimeWillDownload') }}
                </p>

                <div v-if="busy && phase === 'loading'" class="progress">
                  <div class="bar"><div class="bar-fill indet" :style="dlPct != null ? { width: dlPct + '%' } : {}"></div></div>
                  <span class="progress-pct"><template v-if="dlPct != null">{{ dlPct }}%</template><template v-else>…</template></span>
                </div>
                <p v-if="busy && phase === 'loading'" class="note small">{{ dl?.fromCache ? t('media.runtimeFromCache') : t('media.runtimeHint') }}</p>

                <div v-if="busy && phase === 'working'" class="progress">
                  <div class="bar"><div class="bar-fill" :style="{ width: (progress > 0 ? progressPct : 8) + '%' }"></div></div>
                  <span class="progress-pct">{{ progress > 0 ? progressPct + '%' : '' }}</span>
                </div>
              </div>
            </section>
          </div>
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

.media { flex: 1; overflow-y: auto; padding: 20px 24px 48px; max-width: var(--page-wide); margin: 0 auto; width: 100%; display: flex; flex-direction: column; gap: 16px; }
@keyframes tbIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
.media-head { margin-bottom: 2px; }
.media-title { font-size: 24px; font-weight: 750; letter-spacing: -0.5px; }
.media-sub { margin-top: 6px; color: var(--text-secondary); font-size: 13px; line-height: 1.5; max-width: 72ch; }

.grid { display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr); gap: 18px; align-items: start; }
.col { display: flex; flex-direction: column; gap: 14px; min-width: 0; }

/* .card from global tool-kit */
.file-card { display: flex; flex-direction: column; gap: 12px; }
.file-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.file-meta { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.file-name { font-size: 14px; font-weight: 600; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.file-size { font-size: 11px; color: var(--text-secondary); font-variant-numeric: tabular-nums; }
.link-btn { flex-shrink: 0; border: none; background: var(--surface-hover); color: var(--text-secondary); font-size: 12px; padding: 5px 11px; border-radius: 7px; cursor: pointer; font-family: var(--font-sans); }
.link-btn:hover:not(:disabled) { color: var(--text); }
.link-btn:disabled { opacity: 0.5; cursor: default; }
.player { width: 100%; height: 40px; }
.player.video { height: auto; max-height: 300px; border-radius: 8px; background: #000; }

.panel { display: flex; flex-direction: column; gap: 14px; }
.control { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.control-label { font-size: 12px; font-weight: 600; color: var(--text-secondary); flex-shrink: 0; }
.field { display: flex; flex-direction: column; gap: 7px; }
.field input[type="range"] { width: 100%; accent-color: var(--accent); }
.range-ends { display: flex; justify-content: space-between; font-size: 10.5px; color: var(--text-tertiary); }
.num { padding: 8px 10px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); color: var(--text); font-size: 13px; font-family: var(--font-sans); outline: none; }
.num.wide { width: 130px; }
.num:focus { border-color: var(--accent); }

.seg { display: flex; background: var(--surface-hover); border-radius: 10px; padding: 3px; gap: 3px; }
.seg button { padding: 6px 14px; border: none; border-radius: 6px; font-size: 12px; font-weight: 600; background: transparent; color: var(--text-secondary); cursor: pointer; transition: all 0.15s; font-family: var(--font-sans); }
.seg button.on { background: var(--surface); color: var(--text); box-shadow: var(--shadow-xs); }
.seg button:disabled { opacity: 0.5; cursor: default; }
.select { padding: 7px 11px; border: 1px solid var(--border); border-radius: 9px; background: var(--surface); color: var(--text); font-size: 13px; font-family: var(--font-sans); outline: none; cursor: pointer; }
.select:focus { border-color: var(--accent); }
.select:disabled { opacity: 0.5; }

.adv-inline { border: 1px solid var(--border-light); border-radius: 10px; background: var(--surface-hover); padding: 0 12px; }
.adv-inline summary { cursor: pointer; font-size: 12px; font-weight: 600; color: var(--text-secondary); padding: 10px 0; list-style: none; user-select: none; }
.adv-inline summary::-webkit-details-marker { display: none; }
.adv-inline summary::before { content: ''; display: inline-block; width: 0; height: 0; border-left: 4px solid transparent; border-right: 4px solid transparent; border-top: 5px solid currentColor; margin-right: 7px; transition: transform 0.2s; }
.adv-inline[open] summary::before { transform: rotate(180deg); }
.adv-body { display: flex; flex-direction: column; gap: 8px; padding-bottom: 12px; }

.estimate { display: flex; flex-direction: column; gap: 6px; padding: 12px 14px; border: 1px solid var(--border-light); border-radius: 10px; background: var(--bg); }
.est-row { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
.est-label { font-size: 12px; color: var(--text-secondary); }
.est-val { font-size: 13px; font-weight: 600; color: var(--text); font-variant-numeric: tabular-nums; }
.est-row.big .est-label { font-weight: 600; color: var(--text); }
.est-row.big .est-val { font-size: 16px; }
.est-val.accent { color: var(--accent); display: inline-flex; align-items: baseline; gap: 8px; }
.est-save { font-size: 11px; font-weight: 700; color: var(--accent); background: var(--accent-bg); padding: 1px 6px; border-radius: 5px; }

.note { font-size: 12px; color: var(--text-secondary); line-height: 1.5; }
.note.small { font-size: 11.5px; }
.note.tiny { font-size: 10.5px; color: var(--text-tertiary); }
.runtime-hint { display: flex; align-items: center; gap: 6px; }
.runtime-hint svg { width: 14px; height: 14px; flex-shrink: 0; color: var(--text-tertiary); }

.run-btn { width: 100%; }

.progress { display: flex; align-items: center; gap: 10px; }
.bar { flex: 1; height: 8px; border-radius: 99px; background: var(--surface-hover); overflow: hidden; }
.bar-fill { height: 100%; background: var(--accent); border-radius: 99px; transition: width var(--dur-2) ease; }
.bar-fill.indet { min-width: 12%; }
.progress-pct { font-size: 12px; color: var(--text-secondary); font-variant-numeric: tabular-nums; min-width: 36px; text-align: right; }

.result { display: flex; flex-direction: column; gap: 10px; border-color: var(--accent); background: var(--accent-bg); animation: tbIn 0.25s var(--ease-out); }
.result-meta { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
.result-name { font-size: 13px; font-weight: 650; color: var(--text); word-break: break-all; }
.size-delta { display: inline-flex; align-items: center; gap: 6px; font-size: 11.5px; font-weight: 600; color: var(--text); font-variant-numeric: tabular-nums; }
.size-delta .muted { color: var(--text-secondary); font-weight: 500; }
.size-delta svg { width: 13px; height: 13px; color: var(--accent); }
.saved { color: var(--accent); font-weight: 700; }
.result-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
/* .download-btn → gold fill from .btn.cta */

@media (max-width: 900px) {
  .grid { grid-template-columns: 1fr; gap: 16px; }
  .col-controls { order: 1; }
  .col-source { order: 2; }
  .player.video { max-height: 240px; }
}
@media (max-width: 560px) {
  .media { padding: 20px 16px 56px; }
  .control { flex-direction: column; align-items: stretch; gap: 6px; }
  .seg button { flex: 1; }
  .num.wide { width: 100%; }
}
</style>
