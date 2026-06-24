<script setup>
// Subtitle tool: hard-burn subtitles into a video (re-encode) OR soft-mux them as a selectable
// track (no re-encode). SSG-safe: the sr-only <h1> is outside <ClientOnly>; all ffmpeg/DOM work
// happens in the client-only body, behind dynamic imports. The first run downloads the ~31MB
// ffmpeg core from the CDN (needs network once).
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useRouteHead } from '../../composables/useRouteHead'
import { useI18n } from '../../composables/useI18n'
import { useToast } from '../../composables/useToast'
import ClientOnly from '../../components/ClientOnly.vue'
import MediaShell from './MediaShell.vue'
import MediaToolNav from './MediaToolNav.vue'
import { useMediaFile } from './useMediaFile'
import MediaDropZone from './MediaDropZone.vue'
import { isVideoInput, isSubtitleInput, formatSize, buildOutputNameWithSuffix } from './mediaHelpers'

const { meta: m } = useRouteHead()
const { t } = useI18n()
const { showToast } = useToast()

const mode = ref('burn') // 'burn' (hardsub) | 'mux' (softsub)
const fontSize = ref(24)
const crf = ref(23)

const busy = ref(false)
const phase = ref('')   // '' | 'loading' | 'converting'
const progress = ref(0)
const dl = ref(null)
const runtimeCached = ref(false) // is the ~31MB core already in the Cache API? (drives the hint)
const result = ref(null) // { url, name, size }

const video = useMediaFile({
  accept: 'video/*',
  validate: (f) => {
    if (isVideoInput(f.name, f.type)) return true
    showToast(t('media.sub.needVideo'))
    return false
  },
})

// Subtitle file is small text; manage it lightly (no preview URL needed).
const subFile = ref(null)
const subName = ref('')
function pickSub() {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = '.srt,.ass,.ssa,.vtt'
  input.onchange = (e) => setSub(e.target.files?.[0])
  input.click()
}
function setSub(f) {
  if (!f) return
  if (!isSubtitleInput(f.name, f.type)) { showToast(t('media.sub.needSub')); return }
  subFile.value = f
  subName.value = f.name
}
const subDragOver = ref(false)
function onSubDrop(e) { subDragOver.value = false; setSub(e.dataTransfer?.files?.[0]) }

const canRun = computed(() => !!video.file.value && !!subFile.value && !busy.value)
const outputName = computed(() => {
  const n = video.name.value
  if (!n) return 'output.mp4'
  if (mode.value === 'burn') return buildOutputNameWithSuffix(n, 'mp4', '-hardsub')
  // Soft-mux keeps the source container (mkv stays mkv; everything else → mp4).
  const container = n.toLowerCase().endsWith('.mkv') ? 'mkv' : 'mp4'
  return buildOutputNameWithSuffix(n, container, '-subbed')
})

let unsubEngine = null
onMounted(async () => {
  const { onEngineEvent, isRuntimeCached } = await import('./ffmpegRunner')
  unsubEngine = onEngineEvent((e) => {
    if (e.type === 'download') dl.value = { received: e.received, total: e.total, ratio: e.ratio, fromCache: e.fromCache }
  })
  try { runtimeCached.value = await isRuntimeCached() } catch { runtimeCached.value = false }
})
onBeforeUnmount(() => { unsubEngine?.(); revokeResult() })

function revokeResult() {
  if (result.value?.url) { try { URL.revokeObjectURL(result.value.url) } catch { /* ignore */ } }
}
function resetVideo() { revokeResult(); result.value = null; progress.value = 0; video.clear() }

async function run() {
  if (!canRun.value) return
  busy.value = true
  progress.value = 0
  dl.value = null
  revokeResult()
  result.value = null

  try {
    const { isEngineLoaded } = await import('./ffmpegRunner')
    phase.value = isEngineLoaded() ? 'converting' : 'loading'

    const runner = await import('./audioRunner')
    const onProgress = ({ progress: p }) => {
      phase.value = 'converting'
      if (typeof p === 'number' && isFinite(p)) progress.value = Math.max(0, Math.min(1, p))
    }

    const blob = mode.value === 'burn'
      ? await runner.burnSubtitles({
          video: video.file.value,
          subtitle: subFile.value,
          options: { fontSize: fontSize.value, crf: crf.value, preset: 'veryfast' },
          onProgress,
        })
      : await runner.muxSubtitles({
          video: video.file.value,
          subtitle: subFile.value,
          options: {},
          onProgress,
        })

    result.value = { blob, url: URL.createObjectURL(blob), name: outputName.value, size: blob.size }
    progress.value = 1
    showToast(t('media.done'))
  } catch (err) {
    console.error('[media] subtitle op failed:', err)
    showToast(t('media.sub.failed'))
  } finally {
    busy.value = false
    phase.value = ''
  }
}

function download() {
  if (!result.value) return
  import('./mediaDom').then(({ downloadBlob }) => downloadBlob(result.value.blob, result.value.name))
}

// Clamp to 0..100 defensively (matches the converter) so a bad ratio can't render nonsense.
const progressPct = computed(() => Math.max(0, Math.min(100, Math.round(progress.value * 100))))
const dlPct = computed(() => dl.value?.total ? Math.max(0, Math.min(100, Math.round((dl.value.ratio || 0) * 100))) : null)
</script>

<template>
  <MediaShell>
    <div class="route-page">
      <h1 class="sr-only">{{ m.h1 }}</h1>
      <div class="media-navwrap"><MediaToolNav /></div>
      <ClientOnly>
        <main class="media">
          <header class="media-head">
          <h2 class="media-title">{{ t('media.sub.title') }}</h2>
          <p class="media-sub">{{ t('media.sub.sub') }}</p>
        </header>

        <div class="panel">
          <!-- Mode toggle -->
          <div class="control">
            <label class="control-label">{{ t('media.sub.mode') }}</label>
            <div class="seg">
              <button :class="{ on: mode === 'burn' }" :disabled="busy" @click="mode = 'burn'">{{ t('media.sub.burn') }}</button>
              <button :class="{ on: mode === 'mux' }" :disabled="busy" @click="mode = 'mux'">{{ t('media.sub.mux') }}</button>
            </div>
          </div>
          <p class="note">{{ mode === 'burn' ? t('media.sub.burnHint') : t('media.sub.muxHint') }}</p>

          <!-- Video input -->
          <MediaDropZone
            v-if="!video.file.value"
            :title="t('media.sub.dropVideo')"
            :hint="t('media.sub.browseVideo')"
            :drag-over="video.dragOver.value"
            icon="video"
            @pick="video.openPicker"
            @drop="video.onDrop"
            @dragover="video.onDragOver"
            @dragleave="video.onDragLeave"
          />
          <div v-else class="file-card">
            <div class="file-row">
              <div class="file-meta">
                <span class="file-name" :title="video.name.value">{{ video.name.value }}</span>
                <span class="file-size">{{ formatSize(video.size.value) }}</span>
              </div>
              <button class="link-btn" :disabled="busy" @click="resetVideo">{{ t('media.change') }}</button>
            </div>
            <video class="player video" :src="video.url.value" controls preload="metadata"></video>
          </div>

          <!-- Subtitle input -->
          <div
            class="sub-drop"
            :class="{ over: subDragOver, filled: subFile }"
            role="button" tabindex="0"
            @click="pickSub" @keydown.enter.prevent="pickSub" @keydown.space.prevent="pickSub"
            @dragover.prevent="subDragOver = true" @dragleave.prevent="subDragOver = false" @drop.prevent="onSubDrop"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><line x1="6" y1="14" x2="11" y2="14"/><line x1="13" y1="14" x2="18" y2="14"/></svg>
            <span v-if="subFile" class="sub-name">{{ subName }}</span>
            <span v-else class="sub-name muted">{{ t('media.sub.pickSub') }}</span>
          </div>

          <!-- Burn-only styling -->
          <template v-if="mode === 'burn'">
            <div class="control">
              <label class="control-label">{{ t('media.sub.fontSize') }}: {{ fontSize }}</label>
              <input type="range" v-model.number="fontSize" min="12" max="48" step="1" :disabled="busy" />
            </div>
            <div class="control">
              <label class="control-label">{{ t('media.sub.quality') }}: {{ crf }}</label>
              <input type="range" v-model.number="crf" min="16" max="32" step="1" :disabled="busy" />
            </div>
          </template>

          <button class="btn primary convert-btn" :disabled="!canRun" @click="run">
            {{ busy ? (phase === 'loading' ? t('media.loadingRuntime') : t('media.converting')) : t('media.sub.run') }}
          </button>

          <!-- Pre-run runtime hint: cached (instant) vs first-run download (~31MB). -->
          <p v-if="!busy && video.file.value && subFile" class="note small runtime-hint">
            <svg v-if="runtimeCached" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4 4 10-10"/></svg>
            <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="M7 11l5 5 5-5"/><path d="M5 20h14"/></svg>
            {{ runtimeCached ? t('media.runtimeCached') : t('media.runtimeWillDownload') }}
          </p>

          <div v-if="busy && phase === 'loading'" class="progress">
            <div class="bar"><div class="bar-fill indet" :style="dlPct != null ? { width: dlPct + '%' } : {}"></div></div>
            <span class="progress-pct"><template v-if="dlPct != null">{{ dlPct }}%</template><template v-else>…</template></span>
          </div>
          <p v-if="busy && phase === 'loading'" class="note small">{{ dl?.fromCache ? t('media.runtimeFromCache') : t('media.runtimeHint') }}</p>

          <div v-if="busy && phase === 'converting'" class="progress">
            <div class="bar"><div class="bar-fill" :style="{ width: (progress > 0 ? progressPct : 6) + '%' }"></div></div>
            <span class="progress-pct">{{ progress > 0 ? progressPct + '%' : '' }}</span>
          </div>

          <div v-if="result" class="result">
            <div class="result-meta">
              <span class="result-name">{{ result.name }}</span>
              <span class="result-size">{{ formatSize(result.size) }}</span>
            </div>
            <video class="player video" :src="result.url" controls preload="metadata"></video>
            <button class="btn cta download-btn" @click="download">{{ t('media.download') }}</button>
          </div>
        </div>
        </main>
      </ClientOnly>
    </div>
  </MediaShell>
</template>

<style scoped>
.route-page { flex: 1; display: flex; flex-direction: column; min-height: 0; }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }
.media-navwrap { max-width: var(--page-narrow); margin: 0 auto; width: 100%; padding: 22px 24px 0; }
@media (max-width: 560px) { .media-navwrap { padding: 16px 16px 0; } }

.media { flex: 1; overflow-y: auto; padding: 20px 24px 40px; max-width: var(--page-narrow); margin: 0 auto; width: 100%; animation: tbIn 0.3s var(--ease-out); }
@keyframes tbIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
.media-head { margin-bottom: 20px; }
.media-title { font-size: 24px; font-weight: 750; letter-spacing: -0.5px; }
.media-sub { margin-top: 6px; color: var(--text-secondary); font-size: 13px; line-height: 1.5; }

.panel { display: flex; flex-direction: column; gap: 14px; }
.control { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.control-label { font-size: 12px; font-weight: 600; color: var(--text-secondary); flex-shrink: 0; }
.seg { display: flex; background: var(--surface-hover); border-radius: 10px; padding: 3px; gap: 3px; }
.seg button { padding: 6px 12px; border: none; border-radius: 6px; font-size: 12px; font-weight: 600; background: transparent; color: var(--text-secondary); cursor: pointer; transition: all 0.15s; font-family: var(--font-sans); }
.seg button.on { background: var(--surface); color: var(--text); box-shadow: var(--shadow-xs); }
.seg button:disabled { opacity: 0.5; cursor: default; }
input[type="range"] { flex: 1; max-width: 60%; accent-color: var(--accent); }

.note { font-size: 12px; color: var(--text-secondary); line-height: 1.5; margin-top: -4px; }
.note.small { font-size: 11px; }
.runtime-hint { display: flex; align-items: center; gap: 6px; }
.runtime-hint svg { width: 14px; height: 14px; flex-shrink: 0; color: var(--text-tertiary); }

.file-card { display: flex; flex-direction: column; gap: 10px; padding: 16px; border: 1px solid var(--border-light); border-radius: 12px; background: var(--surface); }
.file-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.file-meta { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.file-name { font-size: 14px; font-weight: 600; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.file-size { font-size: 11px; color: var(--text-secondary); }
.link-btn { flex-shrink: 0; border: none; background: var(--surface-hover); color: var(--text-secondary); font-size: 12px; padding: 5px 11px; border-radius: 7px; cursor: pointer; font-family: var(--font-sans); }
.link-btn:hover:not(:disabled) { color: var(--text); }
.link-btn:disabled { opacity: 0.5; cursor: default; }

.sub-drop { display: flex; align-items: center; gap: 10px; padding: 14px 16px; border: 2px dashed var(--border); border-radius: 12px; background: var(--surface); cursor: pointer; transition: all 0.2s; outline: none; }
.sub-drop:hover, .sub-drop:focus-visible, .sub-drop.over { border-color: var(--accent); background: var(--accent-bg); }
.sub-drop.filled { border-style: solid; border-color: var(--border-light); }
.sub-drop svg { width: 22px; height: 22px; color: var(--text-tertiary); flex-shrink: 0; }
.sub-name { font-size: 13px; font-weight: 600; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sub-name.muted { color: var(--text-secondary); font-weight: 500; }

/* .convert-btn → dark fill from .btn.primary */

.progress { display: flex; align-items: center; gap: 10px; }
.bar { flex: 1; height: 8px; border-radius: 99px; background: var(--surface-hover); overflow: hidden; }
.bar-fill { height: 100%; background: var(--accent); border-radius: 99px; transition: width 0.2s ease; }
.bar-fill.indet { min-width: 12%; }
.progress-pct { font-size: 12px; color: var(--text-secondary); font-variant-numeric: tabular-nums; min-width: 36px; text-align: right; }

.result { display: flex; flex-direction: column; gap: 10px; padding: 16px; border: 1px solid var(--border-light); border-radius: 12px; background: var(--surface); animation: tbIn 0.25s var(--ease-out); }
.result-meta { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
.result-name { font-size: 13px; font-weight: 600; color: var(--text); word-break: break-all; }
.result-size { font-size: 11px; color: var(--text-secondary); flex-shrink: 0; }
.player { width: 100%; height: 40px; }
.player.video { height: auto; max-height: 360px; border-radius: 8px; background: #000; }
.download-btn { align-self: flex-start; }

@media (max-width: 560px) { .media { padding: 20px 16px 48px; } .control { flex-direction: column; align-items: stretch; gap: 6px; } input[type="range"] { max-width: 100%; } .seg button { padding: 10px 12px; font-size: 12.5px; } }
</style>
