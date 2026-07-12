<script setup>
// NCM search panel — the right-hand side of the player's "网易云搜索" tab.
//
// Surfaces: keyword box (also accepts pasted NCM share links → opens playlist detail); type tabs
// (song · playlist · album · artist · lyric); result list with [▶ play] [+] add-to-library actions
// and a ✓ badge for songs already cached locally.
import { ref, computed, watch } from 'vue'
import { usePlayerStore } from './usePlayerStore'
import { useToast } from '../../composables/useToast'
import { useI18n } from '../../composables/useI18n'
import { useRouter } from 'vue-router'
import { useHandoff } from '../../composables/useHandoff'
import { search as ncmSearch, parseNcmLink } from './ncmClient'
import { formatTime } from './playerHelpers'
import { downloadBlob } from './mediaDom'

const store = usePlayerStore()
const { showToast } = useToast()
const { t } = useI18n()
const router = useRouter()
const handoff = useHandoff()

const emit = defineEmits(['open-playlist'])

const keywords = ref('')
const type = ref(1)            // 1 song · 10 album · 100 artist · 1000 playlist · 1006 lyric · 1014 video
const TYPES = [
  { v: 1,    label: 'media.ncm.typeSong' },
  { v: 1000, label: 'media.ncm.typePlaylist' },
  { v: 10,   label: 'media.ncm.typeAlbum' },
  { v: 100,  label: 'media.ncm.typeArtist' },
  { v: 1006, label: 'media.ncm.typeLyric' },
]
const loading = ref(false)
const results = ref([])        // raw NCM result items (song / playlist / album objects)
const error = ref('')

// Per-song loading state: the song id that's currently being streamed/cached. Shows a spinner
// on the action button so the user gets immediate visual feedback ("it's working on it").
const loadingId = ref(null)

let searchSeq = 0
async function runSearch() {
  const kw = keywords.value.trim()
  if (!kw) { results.value = []; error.value = ''; return }
  // If the user pasted an NCM share link, jump straight to the playlist detail.
  const parsed = parseNcmLink(kw)
  if (parsed?.kind === 'playlist') {
    emit('open-playlist', parsed.id)
    keywords.value = ''
    return
  }
  loading.value = true
  error.value = ''
  const mySeq = ++searchSeq
  try {
    const result = await ncmSearch(kw, { type: type.value, limit: 30 })
    if (mySeq !== searchSeq) return // a newer search superseded this one
    // The result shape depends on type: songs / playlists / albums / artists.
    results.value = result?.songs || result?.playlists || result?.albums || result?.artists || []
    if (!results.value.length) error.value = t('media.ncm.noResults')
  } catch (e) {
    error.value = e?.message || t('media.ncm.searchFailed')
    results.value = []
  } finally {
    if (mySeq === searchSeq) loading.value = false
  }
}

// Re-search when the type tab changes (if there's already a query). MUST clear the old results
// first — otherwise the old type's data briefly renders under the new type's template, which is
// the "串台" (cross-wired) visual the user reported (e.g. song objects rendered as playlist cards).
watch(type, () => {
  results.value = []
  cacheFlags.value = {}
  error.value = ''
  if (keywords.value.trim()) runSearch()
})

// 300ms debounce on typing.
let debounce = null
function onInput() {
  if (debounce) clearTimeout(debounce)
  debounce = setTimeout(runSearch, 300)
}

// Is this NCM song already in the local cache? Used to show the ✓ badge.
async function isCached(ncmId) {
  if (!ncmId) return false
  try {
    const db = await import('./mediaDb')
    const rec = await db.getTrackByNcmId(String(ncmId))
    if (!rec) return false
    const blob = await db.getTrackBlob(rec.id)
    return !!blob
  } catch { return false }
}
// Per-row cache state (refreshed when results change).
const cacheFlags = ref({})
watch(results, async (items) => {
  cacheFlags.value = {}
  await Promise.all(items.map(async (it) => {
    if (it.id != null) {
      const cached = await isCached(it.id)
      cacheFlags.value[it.id] = cached
    }
  }))
}, { flush: 'post' })

// ---- quality picker (affects download + send-to + play) ----
// 128000 = standard, 320000 = high, 999000 = lossless (needs VIP cookie). Stored on the search
// panel so the user picks once and all subsequent actions use it.
const bitrate = ref(320000)
const BITRATE_OPTS = [
  { v: 128000, label: '128k' },
  { v: 320000, label: '320k' },
  { v: 999000, label: 'FLAC' },
]

// Helper: build the same-origin stream URL inline (no dynamic import needed).
function streamUrl(id, br) { return `/api/music/stream/${id}?br=${br || 320000}` }

// Play a search hit as PREVIEW — does NOT add to library. Only an explicit "+" adds.
async function playSong(song) {
  loadingId.value = song.id
  try {
    const ok = await store.playNcmPreview(song, bitrate.value)
    if (!ok) showToast(t('media.ncm.playFailed'))
  } catch (e) {
    showToast(String(e?.message || e))
  } finally {
    loadingId.value = null
  }
}

// Add to library + cache.
async function addSong(song) {
  loadingId.value = song.id
  try {
    const rec = await store.addNcmTrack(song)
    if (!rec) return
    await store.ensurePlayable(rec.id, { background: true, br: bitrate.value })
    cacheFlags.value = { ...cacheFlags.value, [song.id]: true }
    showToast(t('media.ncm.added'))
  } catch (e) {
    showToast(String(e?.message || e))
  } finally {
    loadingId.value = null
  }
}

// Download — fetch blob → browser download. No dynamic import, no caching side-effects.
async function downloadSong(song) {
  loadingId.value = song.id
  try {
    const resp = await fetch(streamUrl(song.id, bitrate.value))
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
    const blob = await resp.blob()
    if (!blob || !blob.size) throw new Error('empty blob')
    const safeName = String(song.name || 'audio').replace(/[\/\\:*?"<>|]/g, '_')
    const artists = (song.ar || []).map((a) => a.name).filter(Boolean).join(', ')
    const ext = bitrate.value >= 999000 ? 'flac' : 'mp3'
    const fname = artists ? `${safeName} - ${artists}.${ext}` : `${safeName}.${ext}`
    downloadBlob(blob, fname)
    showToast('✓ ' + fname)
  } catch (e) {
    showToast(String(e?.message || e))
  } finally {
    loadingId.value = null
  }
}

// Send-to targets.
const SEND_TARGETS = [
  { route: '/media/convert', label: 'media.tab.convert' },
  { route: '/media/compress', label: 'media.nav.compress' },
  { route: '/media/edit', label: 'media.tab.edit' },
  { route: '/media/transcribe', label: 'media.nav.transcribe' },
  { route: '/media/subtitles', label: 'media.nav.subtitles' },
]
const sendMenuFor = ref(null)

async function sendTo(song, target) {
  sendMenuFor.value = null
  loadingId.value = song.id
  try {
    const resp = await fetch(streamUrl(song.id, bitrate.value))
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
    const blob = await resp.blob()
    if (!blob || !blob.size) throw new Error('empty blob')
    const safeName = String(song.name || 'audio').replace(/[\/\\:*?"<>|]/g, '_')
    const ext = bitrate.value >= 999000 ? 'flac' : 'mp3'
    const file = new File([blob], `${safeName}.${ext}`, { type: blob.type || 'audio/mpeg' })

    // Sending to subtitles? Also fetch lyrics.
    let auxiliary = null
    if (target.route === '/media/subtitles') {
      try {
        const lrcResp = await fetch(`/api/music/lyric/${song.id}`)
        if (lrcResp.ok) {
          const lyricData = await lrcResp.json()
          const lrcText = lyricData?.lrc?.lyric || ''
          if (lrcText) auxiliary = new File([lrcText], `${safeName}.lrc`, { type: 'text/plain' })
        }
      } catch { /* best-effort */ }
    }

    handoff.send(file, { kind: 'av', from: '/media/player', auxiliary })
    router.push(target.route)
  } catch (e) {
    showToast(String(e?.message || e))
  } finally {
    loadingId.value = null
  }
}

function openPlaylist(item) {
  emit('open-playlist', item.id)
}
function openAlbum(item) {
  // Future: album detail. For now, treat like a playlist via the playlist endpoint isn't right;
  // just play the first track if the album has songs inline.
}

// Artist rendering: ar is an array of { id, name }.
function artistNames(song) {
  return (song?.ar || []).map((a) => a.name).filter(Boolean).join(' / ') || ''
}
function albumName(song) {
  return song?.al?.name || ''
}
function coverUrl(item) {
  return item?.al?.picUrl || item?.picUrl || ''
}
</script>

<template>
  <div class="ncm">
    <!-- Search box -->
    <div class="ncm-search">
      <svg class="ncm-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>
      <input v-model="keywords" type="search" :placeholder="t('media.ncm.searchPlaceholder')" @input="onInput" @keydown.enter="runSearch" />
      <button v-if="loading" class="ncm-spinner" disabled>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 12a9 9 0 1 1-6.2-8.5"/></svg>
      </button>
    </div>

    <!-- Type tabs -->
    <div class="segbar ncm-types">
      <button v-for="tp in TYPES" :key="tp.v" class="segbar-item" :class="{ active: type === tp.v }" @click="type = tp.v">
        {{ t(tp.label) }}
      </button>
    </div>

    <!-- Quality picker (only shown for song search; affects download + send + play) -->
    <div v-if="type === 1" class="ncm-quality">
      <span class="ncm-quality-label">{{ t('media.quality') || 'Quality' }}:</span>
      <button v-for="opt in BITRATE_OPTS" :key="opt.v"
        class="ncm-q-btn" :class="{ on: bitrate === opt.v }"
        @click="bitrate = opt.v">{{ opt.label }}</button>
    </div>

    <!-- Results -->
    <div v-if="error" class="ncm-error">{{ error }}</div>

    <div v-else-if="type === 1" class="ncm-list">
      <div v-for="item in results" :key="item.id" class="ncm-row" :class="{ cached: cacheFlags[item.id], loading: loadingId === item.id }" @click="playSong(item)">
        <div class="ncm-row-art">
          <img v-if="coverUrl(item)" :src="coverUrl(item) + '?param=80x80'" alt="" loading="lazy" />
          <span v-else class="ncm-row-ph">♪</span>
          <span v-if="cacheFlags[item.id]" class="ncm-cached-mark">✓</span>
        </div>
        <div class="ncm-row-meta">
          <div class="ncm-row-title">{{ item.name }}</div>
          <div class="ncm-row-sub">{{ artistNames(item) }} <span v-if="albumName(item)">· {{ albumName(item) }}</span></div>
        </div>
        <div class="ncm-row-dur">{{ formatTime(Math.floor((item.dt || 0) / 1000)) }}</div>
        <div class="ncm-row-actions" @click.stop>
          <!-- Play (primary) -->
          <button class="row-act primary" @click="playSong(item)" :disabled="loadingId === item.id" :title="t('media.ncm.playNow')">
            <span v-if="loadingId === item.id" class="row-spin"></span>
            <svg v-else viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
          </button>
          <!-- Add to library (explicit — play does NOT add) -->
          <button class="row-act" @click="addSong(item)" :disabled="loadingId === item.id || cacheFlags[item.id]" :title="t('media.ncm.addToLibrary')">
            <svg v-if="!cacheFlags[item.id]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>
            <svg v-else viewBox="0 0 24 24" fill="none" stroke="var(--status-ok)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>
          </button>
          <!-- Download -->
          <button class="row-act" @click="downloadSong(item)" :disabled="loadingId === item.id" :title="t('media.download')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/></svg>
          </button>
          <!-- Send to -->
          <div class="row-send-wrap">
            <button class="row-act" @click="sendMenuFor = sendMenuFor === item.id ? null : item.id" :disabled="loadingId === item.id" :title="t('handoff.sendTo')">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4z"/></svg>
            </button>
            <div v-if="sendMenuFor === item.id" class="row-send-menu" @click.stop>
              <button v-for="tg in SEND_TARGETS" :key="tg.route" class="row-send-item" @click="sendTo(item, tg)">{{ t(tg.label) }}</button>
            </div>
          </div>
        </div>
      </div>
      <div v-if="sendMenuFor" class="menu-scrim" @click="sendMenuFor = null"></div>
    </div>

    <div v-else-if="type === 1000" class="ncm-list">
      <div v-for="item in results" :key="item.id" class="ncm-card" @click="openPlaylist(item)">
        <img v-if="item.picUrl || item.coverImgUrl" :src="(item.picUrl || item.coverImgUrl) + '?param=120x120'" alt="" class="ncm-card-art" loading="lazy" />
        <div class="ncm-card-meta">
          <div class="ncm-card-title">{{ item.name }}</div>
          <div class="ncm-card-sub">{{ item.creator?.nickname || '' }} · {{ item.trackCount || (item.tracks?.length || 0) }} {{ t('media.ncm.tracksUnit') }}</div>
          <div v-if="item.description" class="ncm-card-desc">{{ item.description }}</div>
        </div>
      </div>
    </div>

    <div v-else-if="type === 10" class="ncm-list">
      <div v-for="item in results" :key="item.id" class="ncm-card" @click="openAlbum(item)">
        <img v-if="item.picUrl" :src="item.picUrl + '?param=120x120'" alt="" class="ncm-card-art" loading="lazy" />
        <div class="ncm-card-meta">
          <div class="ncm-card-title">{{ item.name }}</div>
          <div class="ncm-card-sub">{{ (item.artists || []).map(a => a.name).join(' / ') }}</div>
        </div>
      </div>
    </div>

    <div v-else-if="type === 100" class="ncm-list">
      <div v-for="item in results" :key="item.id" class="ncm-card">
        <img v-if="item.picUrl || item.img1v1Url" :src="(item.picUrl || item.img1v1Url) + '?param=120x120'" alt="" class="ncm-card-art rounded-full" loading="lazy" />
        <div class="ncm-card-meta">
          <div class="ncm-card-title">{{ item.name }}</div>
          <div class="ncm-card-sub">{{ (item.alias || []).join(' · ') }}</div>
        </div>
      </div>
    </div>

    <div v-else class="ncm-list">
      <div v-for="item in results" :key="item.id" class="ncm-card">
        <div class="ncm-card-meta">
          <div class="ncm-card-title">{{ item.name }}</div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ncm { display: flex; flex-direction: column; gap: 10px; }

.ncm-search { position: relative; display: flex; align-items: center; }
.ncm-search-icon { position: absolute; left: 12px; width: 16px; height: 16px; color: var(--text-tertiary); pointer-events: none; }
.ncm-search input { width: 100%; padding: 9px 36px 9px 34px; border: 1px solid var(--border-light); border-radius: 10px; background: var(--surface); color: var(--text); font-size: 13px; font-family: var(--font-sans); outline: none; transition: border-color var(--dur-1); }
.ncm-search input:focus { border-color: var(--accent); }
.ncm-spinner { position: absolute; right: 8px; width: 24px; height: 24px; border: none; background: none; color: var(--text-tertiary); }
.ncm-spinner svg { width: 16px; height: 16px; animation: tb-spin 1s linear infinite; }

.ncm-types { overflow-x: auto; scrollbar-width: none; }
.ncm-types::-webkit-scrollbar { display: none; }

/* Quality picker */
.ncm-quality { display: flex; align-items: center; gap: 6px; }
.ncm-quality-label { font-size: 11px; color: var(--text-tertiary); flex-shrink: 0; }
.ncm-q-btn { padding: 4px 10px; border: 1px solid var(--border-light); border-radius: 6px; background: var(--surface); color: var(--text-secondary); font-size: 11px; font-weight: 600; cursor: pointer; font-family: var(--font-mono); transition: all var(--dur-1); }
.ncm-q-btn:hover { border-color: var(--accent); }
.ncm-q-btn.on { background: var(--accent); border-color: var(--accent); color: var(--accent-text); }

.ncm-error { padding: 16px; text-align: center; color: var(--text-tertiary); font-size: 13px; }

.ncm-list { display: flex; flex-direction: column; gap: 2px; }

/* Song row */
.ncm-row { display: flex; align-items: center; gap: 10px; padding: 6px 8px; border-radius: 9px; cursor: pointer; transition: background var(--dur-1); }
.ncm-row:hover { background: var(--surface-hover); }
.ncm-row.loading { opacity: 0.6; }
.ncm-row.cached .ncm-row-title::after { content: ''; }
.ncm-row-art { position: relative; width: 40px; height: 40px; flex-shrink: 0; border-radius: 6px; overflow: hidden; background: var(--surface-hover); }
.ncm-row-art img { width: 100%; height: 100%; object-fit: cover; display: block; }
.ncm-row-ph { display: flex; align-items: center; justify-content: center; width: 100%; height: 100%; font-size: 18px; color: var(--text-tertiary); }
.ncm-cached-mark { position: absolute; bottom: 2px; right: 2px; background: var(--status-ok); color: #fff; font-size: 9px; font-weight: 700; width: 13px; height: 13px; border-radius: 50%; display: flex; align-items: center; justify-content: center; }
.ncm-row-meta { flex: 1; min-width: 0; }
.ncm-row-title { font-size: 13.5px; font-weight: 600; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ncm-row-sub { font-size: 11.5px; color: var(--text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 1px; }
.ncm-row-dur { font-size: 11px; color: var(--text-tertiary); font-variant-numeric: tabular-nums; flex-shrink: 0; }
.ncm-row-actions { display: flex; gap: 2px; opacity: 0; transition: opacity var(--dur-1); }
.ncm-row:hover .ncm-row-actions { opacity: 1; }
.ncm-row.loading .ncm-row-actions { opacity: 1; }
.row-act { width: 30px; height: 30px; display: inline-flex; align-items: center; justify-content: center; border: none; background: none; color: var(--text-secondary); cursor: pointer; border-radius: 7px; transition: all var(--dur-1); }
.row-act:hover:not(:disabled) { background: var(--surface-active); color: var(--text); }
.row-act:disabled { cursor: wait; }
.row-act.primary { color: var(--accent); }
.row-act svg { width: 16px; height: 16px; }
/* Spinner shown on the button while streaming/caching the song. */
.row-spin { display: inline-block; width: 14px; height: 14px; border: 2px solid var(--border); border-top-color: var(--accent); border-radius: 50%; animation: tb-spin 0.7s linear infinite; }
@media (hover: none) { .ncm-row-actions { opacity: 1; } }

/* Send-to dropdown */
.row-send-wrap { position: relative; }
.menu-scrim { position: fixed; inset: 0; z-index: 15; }
.row-send-menu { position: absolute; right: 0; top: calc(100% + 4px); z-index: 20; min-width: 160px; background: var(--surface); border: 1px solid var(--border-light); border-radius: 9px; box-shadow: var(--shadow-lg); padding: 4px; }
.row-send-item { display: block; width: 100%; text-align: left; padding: 8px 10px; border: none; border-radius: 6px; background: none; color: var(--text); font-size: 12.5px; font-family: var(--font-sans); cursor: pointer; }
.row-send-item:hover { background: var(--surface-hover); }

/* Playlist / album / artist card */
.ncm-card { display: flex; gap: 10px; padding: 8px; border-radius: 10px; cursor: pointer; transition: background var(--dur-1); border: 1px solid transparent; }
.ncm-card:hover { background: var(--surface-hover); border-color: var(--border-light); }
.ncm-card-art { width: 56px; height: 56px; flex-shrink: 0; border-radius: 8px; object-fit: cover; background: var(--surface-hover); }
.ncm-card-art.rounded-full { border-radius: 50%; }
.ncm-card-meta { flex: 1; min-width: 0; }
.ncm-card-title { font-size: 13.5px; font-weight: 600; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ncm-card-sub { font-size: 11.5px; color: var(--text-secondary); margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ncm-card-desc { font-size: 11px; color: var(--text-tertiary); margin-top: 4px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
</style>
