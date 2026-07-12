<script setup>
// Audio METADATA editor — the 5th audio sub-tool. View AND edit EVERY format-level tag of an audio
// file: common tags as labeled fields + any custom keys (add / edit / remove), plus cover art
// (view / replace / remove) and read-only stream/technical info. Reading uses ffmpeg's canonical
// ffmetadata dump; exporting writes a tagged copy WITHOUT re-encoding the audio (-c copy). A
// "Strip all metadata" action clears everything. Fully client-side; nothing is uploaded.
//
// SSG-safety: the sr-only <h1> is outside <ClientOnly>; all ffmpeg/DOM work happens in the
// client-only body behind dynamic imports. The ~31MB ffmpeg core loads from the CDN on first use.
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useRouteHead } from '../../composables/useRouteHead'
import { useI18n } from '../../composables/useI18n'
import { useToast } from '../../composables/useToast'
import ClientOnly from '../../components/ClientOnly.vue'
import MediaShell from './MediaShell.vue'
import MediaToolNav from './MediaToolNav.vue'
import MediaDropZone from './MediaDropZone.vue'
import { useMediaFile } from './useMediaFile'
import { useMediaPool } from './useMediaPool'
import { useHandoff } from '../../composables/useHandoff'
import { isAudioInput, isVideoInput, formatSize, formatDuration, extOf, buildOutputNameWithSuffix } from './mediaHelpers'
import { COMMON_TAG_KEYS, canonicalTagKey, buildEntries } from './ffmetadata'

const { meta: m } = useRouteHead()
const { t } = useI18n()
const { showToast } = useToast()
const pool = useMediaPool()
const handoff = useHandoff()

// ---- file ----
const media = useMediaFile({
  accept: 'audio/*,video/*',
  validate: (f) => {
    // Accept audio (and video — it still carries readable container metadata).
    if (isAudioInput(f.name, f.type) || isVideoInput(f.name, f.type)) return true
    showToast(t('media.meta.readFailed'))
    return false
  },
})

// ---- read state ----
const reading = ref(false)
const loaded = ref(false)          // a file has been read
const info = ref(null)             // technical/stream info
const tail = ref('')               // preserved [CHAPTER]/[STREAM] blocks (round-tripped on export)
const limitedTags = ref(false)
const origSize = ref(0)

// Editable model
const common = ref({})             // { canonicalKey: value }
const customTags = ref([])         // [{ key, value }]
const newKey = ref('')
const newValue = ref('')

// Cover art
const coverUrl = ref('')           // current/original cover object URL
const coverMime = ref('')
const newCoverFile = ref(null)     // a replacement image File
const newCoverUrl = ref('')        // its preview URL
const removeCover = ref(false)     // user removed the cover

// ---- export state ----
const busy = ref(false)
const phase = ref('')              // '' | 'loading' | 'working'
const progress = ref(0)
const dl = ref(null)
const runtimeCached = ref(false)
const result = ref(null)           // { blob, url, name, size, stripped }

const fileExt = computed(() => extOf(media.name.value) || 'mp3')
const isVid = computed(() => media.file.value && isVideoInput(media.name.value, media.file.value.type))

// Common fields to render: only the ones present OR the universally-useful core, so the form is
// helpful without being overwhelming. We always show the core few; others appear if they have a value.
const ALWAYS_SHOWN = ['title', 'artist', 'album', 'album_artist', 'genre', 'date', 'track']
const shownCommonKeys = computed(() => {
  const keys = new Set(ALWAYS_SHOWN)
  for (const k of COMMON_TAG_KEYS) if (common.value[k] != null && String(common.value[k]).length) keys.add(k)
  return COMMON_TAG_KEYS.filter((k) => keys.has(k))
})

const hasAnyTag = computed(() =>
  Object.values(common.value).some((v) => v != null && String(v).length) || customTags.value.length > 0,
)

const effectiveCoverUrl = computed(() => {
  if (removeCover.value) return ''
  return newCoverUrl.value || coverUrl.value
})

let unsubEngine = null
onMounted(async () => {
  window.addEventListener('paste', onPaste)
  // Cross-module "Send to →" (useHandoff): load a file sent here from another tool.
  const taken = handoff.take(['av', 'audio', 'video'])
  if (taken?.payload) {
    const f = taken.payload instanceof File ? taken.payload : new File([taken.payload], taken.name || 'media', { type: taken.payload?.type || '' })
    if (media.set(f)) { read(); showToast(t('handoff.received')) }
  }
  // Pick up a file handed off from the player ("Send to …") if one is pending for us.
  const pending = pool.peekPending()
  if (pending && pending.file && pending.tab !== 'player') {
    pool.takePending()
    if (media.set(pending.file)) read()
  }
  const { onEngineEvent, isRuntimeCached } = await import('./ffmpegRunner')
  unsubEngine = onEngineEvent((e) => {
    if (e.type === 'download') dl.value = { received: e.received, total: e.total, ratio: e.ratio, fromCache: e.fromCache }
  })
  try { runtimeCached.value = await isRuntimeCached() } catch { runtimeCached.value = false }
})
onBeforeUnmount(() => {
  window.removeEventListener('paste', onPaste)
  unsubEngine?.()
  revokeCovers()
  revokeResult()
})

function onPaste(e) { if (media.onPaste(e)) read() }

// useMediaFile.set() is synchronous; for picker/drop we read AFTER it resolves. Wrap the handlers.
function onDrop(e) { if (media.onDrop(e)) read() }
function pickFile() {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'audio/*,video/*'
  input.onchange = (ev) => { const f = ev.target.files?.[0]; if (f && media.set(f)) read() }
  input.click()
}

function revokeCovers() {
  if (coverUrl.value) { try { URL.revokeObjectURL(coverUrl.value) } catch { /* ignore */ } coverUrl.value = '' }
  if (newCoverUrl.value) { try { URL.revokeObjectURL(newCoverUrl.value) } catch { /* ignore */ } newCoverUrl.value = '' }
}
function revokeResult() {
  if (result.value?.url) { try { URL.revokeObjectURL(result.value.url) } catch { /* ignore */ } }
}

function resetFile() {
  revokeCovers(); revokeResult()
  result.value = null; loaded.value = false; info.value = null; tail.value = ''
  common.value = {}; customTags.value = []; coverMime.value = ''
  newCoverFile.value = null; removeCover.value = false; progress.value = 0
  media.clear()
}

// Read ALL metadata from the loaded file via ffmpeg + the cover reader.
async function read() {
  if (!media.file.value || reading.value) return
  reading.value = true
  loaded.value = false
  revokeCovers(); revokeResult()
  result.value = null
  common.value = {}; customTags.value = []
  newCoverFile.value = null; removeCover.value = false
  origSize.value = media.size.value

  try {
    const { isEngineLoaded } = await import('./ffmpegRunner')
    if (!isEngineLoaded()) phase.value = 'loading'
    const { readAllMetadata } = await import('./audioRunner')
    const meta = await readAllMetadata(media.file.value)

    // Common fields → keyed model (canonicalized).
    const c = {}
    for (const { key, value } of meta.common) c[canonicalTagKey(key)] = value
    common.value = c
    customTags.value = meta.custom.map((x) => ({ key: x.key, value: x.value }))
    info.value = meta.info || {}
    tail.value = meta.tail || ''
    limitedTags.value = !!meta.limitedTags

    if (meta.coverUrl) { coverUrl.value = meta.coverUrl; coverMime.value = meta.cover?.mime || '' }
    loaded.value = true
  } catch (err) {
    console.error('[media] metadata read failed:', err)
    showToast(t('media.meta.readFailed'))
  } finally {
    reading.value = false
    phase.value = ''
  }
}

// ---- editing helpers ----
function addCustomTag() {
  const key = newKey.value.trim()
  if (!key) { showToast(t('media.meta.needKey')); return }
  const ck = key.toLowerCase()
  const dupCustom = customTags.value.some((x) => x.key.toLowerCase() === ck)
  const dupCommon = COMMON_TAG_KEYS.includes(canonicalTagKey(ck)) && common.value[canonicalTagKey(ck)] != null
  if (dupCustom || dupCommon) { showToast(t('media.meta.dupKey')); return }
  customTags.value.push({ key, value: newValue.value })
  newKey.value = ''; newValue.value = ''
}
function removeCustomTag(i) { customTags.value.splice(i, 1) }

function pickCover() {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'image/*'
  input.onchange = (ev) => {
    const f = ev.target.files?.[0]
    if (!f) return
    if (newCoverUrl.value) { try { URL.revokeObjectURL(newCoverUrl.value) } catch { /* ignore */ } }
    newCoverFile.value = f
    newCoverUrl.value = URL.createObjectURL(f)
    removeCover.value = false
  }
  input.click()
}
function clearCover() {
  removeCover.value = true
  newCoverFile.value = null
  if (newCoverUrl.value) { try { URL.revokeObjectURL(newCoverUrl.value) } catch { /* ignore */ } newCoverUrl.value = '' }
}
function undoRemoveCover() { removeCover.value = false }

// ---- export ----
const outputName = computed(() => buildOutputNameWithSuffix(media.name.value || 'audio', fileExt.value, '-tagged'))

async function exportFile() {
  if (!media.file.value || busy.value) return
  busy.value = true
  progress.value = 0
  dl.value = null
  revokeResult()
  result.value = null
  try {
    const { isEngineLoaded } = await import('./ffmpegRunner')
    phase.value = isEngineLoaded() ? 'working' : 'loading'
    const { writeAllMetadata } = await import('./audioRunner')

    const entries = buildEntries(common.value, customTags.value)
    const blob = await writeAllMetadata(media.file.value, {
      entries,
      tail: tail.value,
      newCover: newCoverFile.value,
      removeCover: removeCover.value && !newCoverFile.value,
    })
    result.value = { blob, url: URL.createObjectURL(blob), name: outputName.value, size: blob.size, stripped: false }
    progress.value = 1
    showToast(t('media.meta.exported'))
  } catch (err) {
    console.error('[media] metadata write failed:', err)
    showToast(t('media.meta.exportFailed'))
  } finally {
    busy.value = false
    phase.value = ''
  }
}

async function stripAll() {
  if (!media.file.value || busy.value) return
  busy.value = true
  progress.value = 0
  dl.value = null
  revokeResult()
  result.value = null
  try {
    const { isEngineLoaded } = await import('./ffmpegRunner')
    phase.value = isEngineLoaded() ? 'working' : 'loading'
    const { stripAllMetadata } = await import('./audioRunner')
    const blob = await stripAllMetadata(media.file.value, { keepCover: false })
    result.value = {
      blob, url: URL.createObjectURL(blob),
      name: buildOutputNameWithSuffix(media.name.value || 'audio', fileExt.value, '-stripped'),
      size: blob.size, stripped: true,
    }
    progress.value = 1
    showToast(t('media.meta.stripped'))
  } catch (err) {
    console.error('[media] strip metadata failed:', err)
    showToast(t('media.meta.exportFailed'))
  } finally {
    busy.value = false
    phase.value = ''
  }
}

function download() {
  if (!result.value) return
  import('./mediaDom').then(({ downloadBlob }) => downloadBlob(result.value.blob, result.value.name))
}

const progressPct = computed(() => Math.max(0, Math.min(100, Math.round(progress.value * 100))))
const dlPct = computed(() => dl.value?.total ? Math.max(0, Math.min(100, Math.round((dl.value.ratio || 0) * 100))) : null)

// Pretty technical-info rows (only non-empty values).
const infoRows = computed(() => {
  const i = info.value || {}
  const rows = []
  rows.push({ label: t('media.meta.format'), value: (fileExt.value || '').toUpperCase() })
  // Video stream info (only present for real video files; audio files skip these).
  if (i.vcodec) rows.push({ label: t('media.meta.videoCodec'), value: i.vcodec.toUpperCase() })
  if (i.width && i.height) rows.push({ label: t('media.meta.resolution'), value: `${i.width}×${i.height}` })
  if (i.fps) rows.push({ label: t('media.meta.fps'), value: `${i.fps} fps` })
  if (i.codec) rows.push({ label: t('media.meta.codec'), value: i.codec.toUpperCase() })
  if (i.durationSec) rows.push({ label: t('media.meta.duration'), value: formatDuration(i.durationSec) })
  if (i.bitrateKbps) rows.push({ label: t('media.meta.bitrate'), value: `${i.bitrateKbps} kb/s` })
  if (i.sampleRate) rows.push({ label: t('media.meta.sampleRate'), value: `${(i.sampleRate / 1000).toFixed(1)} kHz` })
  if (i.channels) rows.push({ label: t('media.meta.channels'), value: i.channelLayout || String(i.channels) })
  rows.push({ label: t('media.meta.size'), value: formatSize(origSize.value) })
  return rows
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
            <h2 class="media-title">{{ t('media.meta.title') }}</h2>
            <p class="media-sub">{{ t('media.meta.sub') }}</p>
          </header>

          <!-- File input -->
          <MediaDropZone
            v-if="!media.file.value"
            :title="t('media.meta.drop')"
            :hint="t('media.meta.browse')"
            :drag-over="media.dragOver.value"
            icon="video"
            @pick="pickFile"
            @drop="onDrop"
            @dragover="media.onDragOver"
            @dragleave="media.onDragLeave"
          />

          <template v-else>
            <!-- File header -->
            <div class="file-card">
              <div class="file-row">
                <div class="file-meta">
                  <span class="file-name" :title="media.name.value">{{ media.name.value }}</span>
                  <span class="file-size">{{ formatSize(media.size.value) }}</span>
                </div>
                <button class="link-btn" :disabled="busy || reading" @click="resetFile">{{ t('media.change') }}</button>
              </div>
              <component :is="isVid ? 'video' : 'audio'" class="player" :class="{ video: isVid }" :src="media.url.value" controls preload="metadata" />
            </div>

            <!-- Reading state -->
            <div v-if="reading" class="reading">
              <span class="spinner" aria-hidden="true"></span>
              {{ phase === 'loading' ? t('media.loadingRuntime') : t('media.meta.reading') }}
            </div>
            <p v-if="reading && phase === 'loading'" class="note small">{{ dl?.fromCache ? t('media.runtimeFromCache') : t('media.runtimeHint') }}</p>

            <template v-if="loaded">
              <!-- Technical info + cover -->
              <section class="grid2">
                <div class="info-card">
                  <h3 class="sec-h"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="6.5"/><line x1="8" y1="7.2" x2="8" y2="11.5"/><circle cx="8" cy="4.8" r="0.6" fill="currentColor" stroke="none"/></svg>{{ t('media.meta.info') }}</h3>
                  <dl class="info-list">
                    <div v-for="row in infoRows" :key="row.label" class="info-item">
                      <dt>{{ row.label }}</dt><dd>{{ row.value }}</dd>
                    </div>
                  </dl>
                </div>

                <div class="cover-card">
                  <h3 class="sec-h"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="12" height="12" rx="1.5"/><circle cx="6" cy="6" r="1.3"/><path d="M2.5 11l3.5-3 3 2.5 2-1.5 2.5 2"/></svg>{{ t('media.meta.cover') }}</h3>
                  <div class="cover-frame">
                    <img v-if="effectiveCoverUrl" :src="effectiveCoverUrl" alt="Cover art" class="cover-img" />
                    <div v-else class="cover-empty">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="2"/><path d="M21 15l-5-5L5 21"/></svg>
                      <span>{{ removeCover ? t('media.meta.removeCover') : t('media.meta.noCover') }}</span>
                    </div>
                  </div>
                  <div class="cover-actions">
                    <button class="mini-btn" @click="pickCover">{{ t('media.meta.replaceCover') }}</button>
                    <button v-if="effectiveCoverUrl" class="mini-btn danger" @click="clearCover">{{ t('media.meta.removeCover') }}</button>
                    <button v-else-if="removeCover && coverUrl" class="mini-btn" @click="undoRemoveCover">↺</button>
                  </div>
                  <p class="note tiny">{{ t('media.meta.coverHint') }}</p>
                </div>
              </section>

              <!-- Common tags -->
              <section class="tag-sec">
                <h3 class="sec-h"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 2H3.5A1.5 1.5 0 002 3.5v5l6 6 6.5-6.5L8.5 2z"/><circle cx="5.2" cy="5.2" r="0.8" fill="currentColor" stroke="none"/></svg>{{ t('media.meta.common') }}</h3>
                <div class="fields">
                  <label v-for="k in shownCommonKeys" :key="k" class="field">
                    <span>{{ t('media.meta.f.' + k) }}</span>
                    <textarea v-if="k === 'lyrics' || k === 'comment'" v-model="common[k]" rows="2" :placeholder="t('media.meta.valuePlaceholder')"></textarea>
                    <input v-else v-model="common[k]" type="text" :placeholder="t('media.meta.valuePlaceholder')" />
                  </label>
                </div>
              </section>

              <!-- Custom / other tags -->
              <section class="tag-sec">
                <h3 class="sec-h"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><line x1="2.5" y1="4" x2="13.5" y2="4"/><line x1="2.5" y1="8" x2="13.5" y2="8"/><line x1="2.5" y1="12" x2="9" y2="12"/></svg>{{ t('media.meta.custom') }}</h3>
                <div v-if="customTags.length" class="kv-list">
                  <div v-for="(tag, i) in customTags" :key="i" class="kv-row">
                    <input class="kv-key" v-model="tag.key" type="text" :placeholder="t('media.meta.keyPlaceholder')" spellcheck="false" />
                    <input class="kv-val" v-model="tag.value" type="text" :placeholder="t('media.meta.valuePlaceholder')" />
                    <button class="kv-del" :title="t('media.meta.removeTag')" :aria-label="t('media.meta.removeTag')" @click="removeCustomTag(i)">
                      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M4 4l8 8M12 4l-8 8"/></svg>
                    </button>
                  </div>
                </div>
                <p v-else class="note small empty-note">{{ t('media.meta.noTags') }}</p>

                <!-- Add a new tag -->
                <div class="kv-add">
                  <input class="kv-key" v-model="newKey" type="text" :placeholder="t('media.meta.keyPlaceholder')" spellcheck="false" @keydown.enter.prevent="addCustomTag" />
                  <input class="kv-val" v-model="newValue" type="text" :placeholder="t('media.meta.valuePlaceholder')" @keydown.enter.prevent="addCustomTag" />
                  <button class="kv-add-btn" @click="addCustomTag">
                    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M8 3v10M3 8h10"/></svg>
                    {{ t('media.meta.addTag') }}
                  </button>
                </div>
              </section>

              <p v-if="limitedTags" class="note small warn">
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M8 1.5L15 14H1z"/><line x1="8" y1="6" x2="8" y2="9.5"/><circle cx="8" cy="11.6" r="0.6" fill="currentColor" stroke="none"/></svg>
                {{ t('media.meta.limitedNote') }}
              </p>

              <!-- Actions -->
              <div class="actions">
                <button class="btn primary convert-btn" :disabled="busy" @click="exportFile">
                  <svg v-if="!busy" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2v8M5 7l3 3 3-3"/><path d="M3 13h10"/></svg>
                  {{ busy ? (phase === 'loading' ? t('media.loadingRuntime') : t('media.meta.exporting')) : t('media.meta.export') }}
                </button>
                <button class="strip-btn" :disabled="busy" @click="stripAll">{{ t('media.meta.strip') }}</button>
              </div>
              <p class="note small">{{ t('media.meta.copyNote') }}</p>

              <p v-if="!busy && (!runtimeCached || dl)" class="note small runtime-hint">
                <svg v-if="runtimeCached" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4 4 10-10"/></svg>
                <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="M7 11l5 5 5-5"/><path d="M5 20h14"/></svg>
                {{ runtimeCached ? t('media.runtimeCached') : t('media.runtimeWillDownload') }}
              </p>

              <!-- Progress -->
              <div v-if="busy && phase === 'loading'" class="progress">
                <div class="bar"><div class="bar-fill indet" :style="dlPct != null ? { width: dlPct + '%' } : {}"></div></div>
                <span class="progress-pct"><template v-if="dlPct != null">{{ dlPct }}%</template><template v-else>…</template></span>
              </div>
              <div v-if="busy && phase === 'working'" class="progress">
                <div class="bar"><div class="bar-fill" :style="{ width: (progress > 0 ? progressPct : 12) + '%' }"></div></div>
                <span class="progress-pct">{{ progress > 0 ? progressPct + '%' : '' }}</span>
              </div>

              <!-- Result -->
              <div v-if="result" class="result">
                <div class="result-meta">
                  <span class="result-name">{{ result.name }}</span>
                  <span class="size-delta">
                    <span class="muted">{{ t('media.meta.before') }} {{ formatSize(origSize) }}</span>
                    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8h9M9 5l3 3-3 3"/></svg>
                    <span>{{ t('media.meta.after') }} {{ formatSize(result.size) }}</span>
                  </span>
                </div>
                <component :is="isVid ? 'video' : 'audio'" class="player" :class="{ video: isVid }" :src="result.url" controls preload="metadata" />
                <button class="btn cta download-btn" @click="download">
                  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2v8M5 7l3 3 3-3"/><path d="M3 13h10"/></svg>
                  {{ t('media.meta.download') }}
                </button>
              </div>
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

.media { flex: 1; overflow-y: auto; padding: 20px 24px 48px; max-width: var(--page-wide); margin: 0 auto; width: 100%; display: flex; flex-direction: column; gap: 16px; }
@keyframes tbIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
.media-head { margin-bottom: 0; }
.media-title { font-size: 24px; font-weight: 750; letter-spacing: -0.5px; }
.media-sub { margin-top: 6px; color: var(--text-secondary); font-size: 13px; line-height: 1.5; }

/* File card */
.file-card { display: flex; flex-direction: column; gap: 10px; padding: 16px; border: 1px solid var(--border-light); border-radius: 12px; background: var(--surface); }
.file-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.file-meta { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.file-name { font-size: 14px; font-weight: 600; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.file-size { font-size: 11px; color: var(--text-secondary); }
.link-btn { flex-shrink: 0; border: none; background: var(--surface-hover); color: var(--text-secondary); font-size: 12px; padding: 5px 11px; border-radius: 7px; cursor: pointer; font-family: var(--font-sans); }
.link-btn:hover:not(:disabled) { color: var(--text); }
.link-btn:disabled { opacity: 0.5; cursor: default; }
.player { width: 100%; height: 40px; }
.player.video { height: auto; max-height: 260px; border-radius: 8px; background: #000; }

/* Reading */
.reading { display: flex; align-items: center; gap: 9px; font-size: 13px; color: var(--text-secondary); padding: 4px 2px; }
.spinner { width: 15px; height: 15px; border: 2px solid var(--border); border-top-color: var(--accent); border-radius: 50%; animation: tb-spin 0.7s linear infinite; }

/* Section heading */
.sec-h { display: flex; align-items: center; gap: 7px; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.4px; color: var(--text-secondary); margin-bottom: 11px; }
.sec-h svg { width: 14px; height: 14px; color: var(--accent); flex-shrink: 0; }

/* Info + cover grid */
.grid2 { display: grid; grid-template-columns: 1fr 200px; gap: 14px; align-items: start; }
.info-card, .cover-card { padding: 16px; border: 1px solid var(--border-light); border-radius: 12px; background: var(--surface); }
.info-list { display: flex; flex-direction: column; gap: 0; }
.info-item { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; padding: 6px 0; border-bottom: 1px solid var(--border-light); }
.info-item:last-child { border-bottom: none; }
.info-item dt { font-size: 12px; color: var(--text-secondary); }
.info-item dd { font-size: 12.5px; font-weight: 600; color: var(--text); font-variant-numeric: tabular-nums; text-align: right; }

.cover-frame { aspect-ratio: 1; border-radius: 9px; overflow: hidden; background: var(--surface-hover); display: flex; align-items: center; justify-content: center; border: 1px solid var(--border-light); }
.cover-img { width: 100%; height: 100%; object-fit: cover; }
.cover-empty { display: flex; flex-direction: column; align-items: center; gap: 8px; color: var(--text-tertiary); padding: 16px; text-align: center; }
.cover-empty svg { width: 32px; height: 32px; }
.cover-empty span { font-size: 11.5px; }
.cover-actions { display: flex; gap: 6px; margin-top: 10px; }
.mini-btn { flex: 1; padding: 6px 8px; border: 1px solid var(--border); border-radius: 7px; background: var(--surface); color: var(--text-secondary); font-size: 11.5px; font-weight: 600; cursor: pointer; font-family: var(--font-sans); transition: all 0.15s; }
.mini-btn:hover { color: var(--text); border-color: var(--accent); }
.mini-btn.danger:hover { color: var(--danger, #d23); border-color: var(--danger, #d23); }

/* Tag sections */
.tag-sec { padding: 16px 18px; border: 1px solid var(--border-light); border-radius: 12px; background: var(--surface); }
.fields { display: grid; grid-template-columns: 1fr 1fr; gap: 12px 14px; }
.field { display: flex; flex-direction: column; gap: 5px; }
.field span { font-size: 11.5px; font-weight: 600; color: var(--text-secondary); }
.field input, .field textarea, .kv-key, .kv-val { padding: 8px 11px; border: 1px solid var(--border); border-radius: 8px; background: var(--bg); color: var(--text); font-size: 13px; font-family: var(--font-sans); outline: none; width: 100%; }
.field textarea { resize: vertical; line-height: 1.45; min-height: 38px; }
.field input:focus, .field textarea:focus, .kv-key:focus, .kv-val:focus { border-color: var(--accent); }
.field:has(textarea) { grid-column: 1 / -1; }

/* Key/value custom list */
.kv-list { display: flex; flex-direction: column; gap: 8px; margin-bottom: 12px; }
.kv-row, .kv-add { display: grid; grid-template-columns: minmax(110px, 0.7fr) 1.3fr auto; gap: 8px; align-items: center; }
.kv-key { font-family: var(--font-mono, monospace); font-size: 12.5px; }
.kv-del { width: 30px; height: 32px; display: inline-flex; align-items: center; justify-content: center; border: 1px solid var(--border); background: var(--surface); color: var(--text-tertiary); border-radius: 8px; cursor: pointer; flex-shrink: 0; }
.kv-del:hover { color: var(--danger, #d23); border-color: var(--danger, #d23); }
.kv-del svg { width: 13px; height: 13px; }
.kv-add { margin-top: 4px; padding-top: 12px; border-top: 1px dashed var(--border); }
.kv-add-btn { display: inline-flex; align-items: center; gap: 5px; padding: 8px 13px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface-hover); color: var(--text); font-size: 12.5px; font-weight: 600; cursor: pointer; font-family: var(--font-sans); white-space: nowrap; transition: all 0.15s; }
.kv-add-btn:hover { border-color: var(--accent); }
.kv-add-btn svg { width: 13px; height: 13px; color: var(--accent); }
.empty-note { margin-bottom: 12px; }

/* Notes */
.note { font-size: 12px; color: var(--text-secondary); line-height: 1.5; }
.note.small { font-size: 11.5px; }
.note.tiny { font-size: 10.5px; color: var(--text-tertiary); margin-top: 8px; }
.runtime-hint { display: flex; align-items: center; gap: 6px; }
.runtime-hint svg { width: 14px; height: 14px; flex-shrink: 0; color: var(--text-tertiary); }
.warn { display: flex; align-items: flex-start; gap: 7px; color: var(--text-secondary); padding: 10px 12px; background: var(--accent-bg); border-radius: 9px; }
.warn svg { width: 15px; height: 15px; flex-shrink: 0; margin-top: 1px; color: var(--accent); }

/* Actions */
.actions { display: flex; gap: 10px; flex-wrap: wrap; }
.convert-btn { flex: 1; min-width: 200px; }
.convert-btn svg { width: 15px; height: 15px; }
.strip-btn { padding: 11px 16px; border: 1px solid var(--border); border-radius: 11px; background: var(--surface); color: var(--text-secondary); font-size: 13px; font-weight: 600; font-family: var(--font-sans); cursor: pointer; transition: all 0.15s; }
.strip-btn:hover:not(:disabled) { color: var(--danger, #d23); border-color: var(--danger, #d23); }
.strip-btn:disabled { opacity: 0.6; cursor: default; }

.progress { display: flex; align-items: center; gap: 10px; }
.bar { flex: 1; height: 8px; border-radius: 99px; background: var(--surface-hover); overflow: hidden; }
.bar-fill { height: 100%; background: var(--accent); border-radius: 99px; transition: width 0.2s ease; }
.bar-fill.indet { min-width: 12%; }
.progress-pct { font-size: 12px; color: var(--text-secondary); font-variant-numeric: tabular-nums; min-width: 36px; text-align: right; }

/* Result */
.result { display: flex; flex-direction: column; gap: 10px; padding: 16px; border: 1px solid var(--accent); border-radius: 12px; background: var(--accent-bg); animation: tbIn 0.25s var(--ease-out); }
.result-meta { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
.result-name { font-size: 13px; font-weight: 650; color: var(--text); word-break: break-all; }
.size-delta { display: inline-flex; align-items: center; gap: 6px; font-size: 11.5px; font-weight: 600; color: var(--text); font-variant-numeric: tabular-nums; }
.size-delta .muted { color: var(--text-secondary); font-weight: 500; }
.size-delta svg { width: 13px; height: 13px; color: var(--accent); }
.download-btn { align-self: flex-start; }
.download-btn svg { width: 14px; height: 14px; }

@media (max-width: 640px) {
  .media { padding: 20px 16px 56px; gap: 14px; }
  .grid2 { grid-template-columns: 1fr; }
  .cover-card { max-width: 280px; }
  .fields { grid-template-columns: 1fr; }
  .kv-row, .kv-add { grid-template-columns: 1fr auto; grid-template-areas: "key del" "val val"; }
  .kv-row .kv-key, .kv-add .kv-key { grid-area: key; }
  .kv-row .kv-val, .kv-add .kv-val { grid-area: val; }
  .kv-del { grid-area: del; }
  .kv-add { grid-template-columns: 1fr; grid-template-areas: "key" "val" "btn"; }
  .kv-add-btn { grid-area: btn; justify-content: center; }
  .actions { flex-direction: column; }
  .convert-btn, .strip-btn { min-width: 0; width: 100%; }
  /* Comfortable tap targets on phones for the small inline controls. */
  .kv-del { height: 40px; }
  .link-btn { padding: 8px 12px; }
  .mini-btn { padding: 9px 8px; }
}
</style>
