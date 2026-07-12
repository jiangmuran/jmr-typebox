<script setup>
// NCM playlist detail view — shown when the user clicks a playlist card or pastes a NCM
// playlist share link. Lists every track in the playlist with a [▶ play all] and [+ import all]
// CTA at the top, plus per-track play / cache actions.
//
// Import-all runs sequentially in the background (cache each song via ensurePlayable), surfacing
// a live progress bar. Cancellable mid-way.
import { ref, computed, watch } from 'vue'
import { usePlayerStore } from './usePlayerStore'
import { useToast } from '../../composables/useToast'
import { useI18n } from '../../composables/useI18n'
import { playlistDetail, playlistTracks } from './ncmClient'
import { formatTime } from './playerHelpers'

const props = defineProps({
  playlistId: { type: [String, Number], required: true },
})
const emit = defineEmits(['close'])

const store = usePlayerStore()
const { showToast } = useToast()
const { t } = useI18n()

const meta = ref(null)        // playlist metadata (name, creator, cover, trackCount)
const tracks = ref([])        // full track list
const loading = ref(true)
const error = ref('')

// Import progress.
const importing = ref(false)
const importDone = ref(0)
const importTotal = ref(0)
const importCurrent = ref('')
let importCancel = false

async function load() {
  loading.value = true
  error.value = ''
  meta.value = null
  tracks.value = []
  try {
    const id = String(props.playlistId)
    const detail = await playlistDetail(id)
    meta.value = detail
    // The detail endpoint returns up to ~10 tracks inline; the full list comes via /tracks.
    // If trackIds is short enough we can shortcut; otherwise fetch the full list.
    const trackIds = (detail?.trackIds || [])
    if (trackIds.length && trackIds.length <= 1000) {
      const songs = await playlistTracks(id, { limit: 1000, offset: 0 })
      tracks.value = songs || []
    } else if (detail?.tracks?.length) {
      tracks.value = detail.tracks
    }
  } catch (e) {
    error.value = e?.message || t('media.ncm.loadFailed')
  } finally {
    loading.value = false
  }
}

watch(() => props.playlistId, load, { immediate: true })

const totalDuration = computed(() => tracks.value.reduce((s, t) => s + (t.dt || 0), 0))
function totalDurationLabel() {
  const mins = Math.floor(totalDuration.value / 60000)
  if (mins < 60) return `${mins} ${t('media.ncm.unitMin')}`
  const h = Math.floor(mins / 60)
  return `${h} ${t('media.ncm.unitHour')} ${mins % 60} ${t('media.ncm.unitMin')}`
}

// Play the entire playlist: add every track to the library first, then play the first one.
// Context queue = the playlist's library ids.
async function playAll() {
  if (!tracks.value.length) return
  showToast(t('media.ncm.preparingPlaylist'))
  const ids = []
  for (const s of tracks.value) {
    const rec = await store.addNcmTrack(s)
    if (rec) ids.push(rec.id)
  }
  if (ids.length) {
    store.playTrack(ids[0], { contextQueue: ids })
  }
}

// Sequentially cache every track in the playlist. Updates the progress bar; cancellable.
async function importAll() {
  if (!tracks.value.length || importing.value) return
  importing.value = true
  importCancel = false
  importDone.value = 0
  importTotal.value = tracks.value.length
  try {
    for (const s of tracks.value) {
      if (importCancel) break
      importCurrent.value = `${s.name} - ${(s.ar || []).map(a => a.name).join(' / ')}`
      try {
        const rec = await store.addNcmTrack(s)
        if (rec) await store.ensurePlayable(rec.id, { background: true })
      } catch { /* keep going even if one fails */ }
      importDone.value++
    }
    showToast(importCancel ? t('media.ncm.importCancelled') : t('media.ncm.importDone'))
  } finally {
    importing.value = false
    importCurrent.value = ''
  }
}
function cancelImport() { importCancel = true }

const importProgress = computed(() => {
  if (!importTotal.value) return 0
  return Math.round((importDone.value / importTotal.value) * 100)
})

// Per-track play = PREVIEW, same contract as the search panel: playing one song must not
// touch the library. (This used to addNcmTrack EVERY track in the playlist to build a queue —
// clicking a single song in a 500-track playlist silently imported all 500 records.)
// "Play all" / "Import all" remain the explicit bulk actions.
async function playSong(song) {
  const ok = await store.playNcmPreview(song)
  if (!ok) showToast(t('media.ncm.playFailed'))
}
async function cacheSong(song) {
  const rec = await store.addNcmTrack(song)
  if (!rec) return
  await store.ensurePlayable(rec.id, { background: false })
  showToast(t('media.ncm.added'))
}

function artistNames(song) { return (song.ar || []).map(a => a.name).filter(Boolean).join(' / ') || '' }
function coverOf(item) { return item?.al?.picUrl || '' }
</script>

<template>
  <div class="npd">
    <button class="npd-back" @click="emit('close')">‹ {{ t('media.ncm.backToSearch') }}</button>

    <div v-if="loading" class="npd-loading">{{ t('media.ncm.loading') }}</div>
    <div v-else-if="error" class="npd-error">{{ error }}</div>

    <template v-else-if="meta">
      <!-- Playlist hero -->
      <div class="npd-hero">
        <img v-if="meta.picUrl || meta.coverImgUrl" :src="(meta.picUrl || meta.coverImgUrl) + '?param=200x200'" alt="" class="npd-cover" />
        <div class="npd-hero-meta">
          <h3 class="npd-title">{{ meta.name }}</h3>
          <div class="npd-creator">{{ meta.creator?.nickname || '' }}</div>
          <div class="npd-stats">{{ tracks.length }} {{ t('media.ncm.tracksUnit') }} · {{ totalDurationLabel() }}</div>
          <div class="npd-cta">
            <button class="btn primary" @click="playAll">
              <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
              {{ t('media.ncm.playAll') }}
            </button>
            <button class="btn cta" @click="importAll" :disabled="importing">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>
              {{ importing ? t('media.ncm.importing') : t('media.ncm.importAll') }}
            </button>
          </div>
        </div>
      </div>

      <!-- Import progress -->
      <div v-if="importing || importDone > 0" class="npd-progress">
        <div class="npd-progress-bar"><div class="npd-progress-fill" :style="{ width: importProgress + '%' }"></div></div>
        <div class="npd-progress-meta">
          <span>{{ importDone }} / {{ importTotal }} · {{ importCurrent }}</span>
          <button v-if="importing" class="link-btn" @click="cancelImport">{{ t('media.ncm.cancel') }}</button>
        </div>
      </div>

      <!-- Track list -->
      <div class="npd-tracks">
        <div v-for="(song, i) in tracks" :key="song.id" class="npd-track">
          <span class="npd-num">{{ i + 1 }}</span>
          <div class="npd-track-art">
            <img v-if="coverOf(song)" :src="coverOf(song) + '?param=60x60'" alt="" loading="lazy" />
          </div>
          <div class="npd-track-meta">
            <div class="npd-track-title">{{ song.name }}</div>
            <div class="npd-track-sub">{{ artistNames(song) }}</div>
          </div>
          <span class="npd-track-dur">{{ formatTime(Math.floor((song.dt || 0) / 1000)) }}</span>
          <div class="npd-track-actions">
            <button class="row-act" @click="cacheSong(song)" :title="t('media.ncm.addToLibrary')">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>
            </button>
            <button class="row-act primary" @click="playSong(song)" :title="t('media.ncm.playNow')">
              <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
            </button>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.npd { display: flex; flex-direction: column; gap: 12px; }
.npd-back { align-self: flex-start; background: none; border: none; color: var(--text-secondary); font-family: var(--font-sans); font-size: 13px; cursor: pointer; padding: 4px 8px; border-radius: 7px; }
.npd-back:hover { color: var(--text); background: var(--surface-hover); }
.npd-loading, .npd-error { padding: 40px 20px; text-align: center; color: var(--text-tertiary); font-size: 13px; }

.npd-hero { display: flex; gap: 16px; align-items: flex-end; padding: 8px 4px 12px; }
.npd-cover { width: 120px; height: 120px; flex-shrink: 0; border-radius: 12px; object-fit: cover; box-shadow: var(--shadow-sm); }
.npd-hero-meta { flex: 1; min-width: 0; }
.npd-title { font-size: 20px; font-weight: 750; letter-spacing: -0.4px; color: var(--text); margin-bottom: 4px; }
.npd-creator { font-size: 13px; color: var(--text-secondary); }
.npd-stats { font-size: 12px; color: var(--text-tertiary); margin-top: 2px; font-variant-numeric: tabular-nums; }
.npd-cta { display: flex; gap: 8px; margin-top: 12px; flex-wrap: wrap; }
.npd-cta .btn { display: inline-flex; align-items: center; gap: 6px; padding: 9px 16px; font-size: 13px; }
.npd-cta .btn svg { width: 16px; height: 16px; }
.npd-cta .btn:disabled { opacity: 0.55; cursor: not-allowed; }

.npd-progress { padding: 8px 4px; }
.npd-progress-bar { height: 4px; background: var(--surface-hover); border-radius: 2px; overflow: hidden; }
.npd-progress-fill { height: 100%; background: var(--accent); transition: width var(--dur-3) var(--ease-out); }
.npd-progress-meta { display: flex; justify-content: space-between; align-items: center; margin-top: 6px; font-size: 11.5px; color: var(--text-secondary); }
.link-btn { background: none; border: none; color: var(--accent); font-family: var(--font-sans); font-size: 11.5px; cursor: pointer; padding: 0; }

.npd-tracks { display: flex; flex-direction: column; }
.npd-track { display: flex; align-items: center; gap: 10px; padding: 6px 8px; border-radius: 8px; transition: background var(--dur-1); }
.npd-track:hover { background: var(--surface-hover); }
.npd-num { width: 24px; text-align: right; font-size: 12px; color: var(--text-tertiary); font-variant-numeric: tabular-nums; flex-shrink: 0; }
.npd-track-art { width: 36px; height: 36px; flex-shrink: 0; border-radius: 6px; overflow: hidden; background: var(--surface-hover); }
.npd-track-art img { width: 100%; height: 100%; object-fit: cover; display: block; }
.npd-track-meta { flex: 1; min-width: 0; }
.npd-track-title { font-size: 13px; font-weight: 550; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.npd-track-sub { font-size: 11.5px; color: var(--text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.npd-track-dur { font-size: 11px; color: var(--text-tertiary); font-variant-numeric: tabular-nums; flex-shrink: 0; }
.npd-track-actions { display: flex; gap: 2px; opacity: 0; transition: opacity var(--dur-1); }
.npd-track:hover .npd-track-actions { opacity: 1; }
.row-act { width: 30px; height: 30px; display: inline-flex; align-items: center; justify-content: center; border: none; background: none; color: var(--text-secondary); cursor: pointer; border-radius: 7px; transition: all var(--dur-1); }
.row-act:hover { background: var(--surface-active); color: var(--text); }
.row-act.primary { color: var(--accent); }
.row-act svg { width: 16px; height: 16px; }
@media (hover: none) { .npd-track-actions { opacity: 1; } }

@media (max-width: 768px) {
  .npd-hero { flex-direction: column; align-items: flex-start; gap: 10px; }
  .npd-cover { width: 100px; height: 100px; }
}
</style>
