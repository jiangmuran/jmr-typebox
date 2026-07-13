<script setup>
// Now-Playing panel — the visual centerpiece of the player. Phase 2 redesign:
//   • Large album artwork as the focal point.
//   • Standard five-button transport (shuffle · prev · play · next · repeat). Sentence-level
//     navigation is done by clicking a lyric line or using the ↑/↓ keys — the old inline
//     ⏮⋮/⏭⋮ buttons were removed (they read as duplicated prev/next-track controls).
//   • A "go full-screen lyrics" button (top-right) that routes to /media/lyrics.
//   • The EMBED iframe branch (NetEase/Bilibili/YouTube) is GONE — that surface was deleted.
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import { usePlayerStore } from './usePlayerStore'
import { useMediaPool } from './useMediaPool'
import { useI18n } from '../../composables/useI18n'
import { useToast } from '../../composables/useToast'
import MediaWaveform from './MediaWaveform.vue'
import { formatTime, initialOf, hashHue } from './playerHelpers'
import { parseLrc, parseYrc, prevLineIndex, nextLineIndex, timeOfLine } from './lrc'
import { ncmShareUrl, shareOrCopy } from './mediaDom'

const store = usePlayerStore()
const pool = useMediaPool()
const router = useRouter()
const { t } = useI18n()
const { showToast } = useToast()

const emit = defineEmits(['edit-tags'])

const track = store.currentTrack
const hasTrack = computed(() => !!track.value)

// Share the current track — only NCM tracks have a deep link that resolves on other devices.
async function shareCurrent() {
  const ncmId = track.value?.ncmId
  if (!ncmId) return
  const r = await shareOrCopy(ncmShareUrl('song', ncmId), track.value?.title || track.value?.name || '')
  if (r === 'copied') showToast(t('media.share.copied'))
  else if (!r) showToast(t('media.share.failed'))
}

// Artwork view mode: 'art' (rotating cover) or 'wave' (waveform). Cover is the default.
const artMode = ref('art')

const peaks = ref(null)
const wfLoading = ref(false)
const playRatio = computed(() => (store.duration.value ? store.currentTime.value / store.duration.value : 0))

const speeds = [0.5, 0.75, 1, 1.25, 1.5, 2]

// Synced lyric lines for sentence-level navigation (parsed from the current track's lrc/yrc).
// Re-parsed only when the lyric text changes (cheap binary search per call elsewhere).
const lyricLines = computed(() => {
  const yrc = store.liveLyrics.value?.yrc
  if (yrc) {
    const parsed = parseYrc(yrc)
    if (parsed.synced && parsed.lines.length) return parsed.lines
  }
  const original = store.liveLyrics.value?.original
  if (original) {
    const parsed = parseLrc(original)
    if (parsed.synced) return parsed.lines
  }
  return []
})

// Decode the waveform when the track changes. Also re-run when `buffering` flips false: an NCM
// track commits its id BEFORE its bytes finish streaming (instant-identity), so the first attempt
// finds no blob — we retry once the stream lands (this is why the waveform used to appear only
// after a manual refresh). A per-track guard prevents a stale decode from overwriting a newer one.
let _wfToken = 0
async function decodeWaveform(id) {
  if (!id) { peaks.value = null; return }
  const token = ++_wfToken
  wfLoading.value = true
  try {
    const blob = await store.getBlobFor(id)
    if (!blob || token !== _wfToken) return
    const { decodeToPeaks } = await import('./waveform')
    const res = await decodeToPeaks(blob, 1200)
    if (token === _wfToken && store.currentId.value === id) {
      peaks.value = res.peaks
      if (res.duration) store.duration.value = res.duration
    }
  } catch { if (token === _wfToken) peaks.value = null } finally { if (token === _wfToken) wfLoading.value = false }
}
watch(() => store.currentId.value, (id) => { peaks.value = null; decodeWaveform(id) }, { immediate: true })
// Retry once the streamed bytes arrive (buffering true → false with peaks still empty).
watch(() => store.buffering.value, (b) => { if (!b && !peaks.value && store.currentId.value) decodeWaveform(store.currentId.value) })

function onSeek(sec) { store.seek(sec) }

// Jump to the previous/next LYRIC line (not the previous/next track). Falls back to ±5s when no
// synced lyrics are loaded.
function prevLine() {
  const lines = lyricLines.value
  if (!lines.length) return store.seek(Math.max(0, store.currentTime.value - 5))
  const i = prevLineIndex(lines, store.currentTime.value)
  if (i >= 0) store.seek(timeOfLine(lines, i))
  else store.seek(0)
}
function nextLine() {
  const lines = lyricLines.value
  if (!lines.length) return store.seek(store.currentTime.value + 5)
  const i = nextLineIndex(lines, store.currentTime.value)
  if (i >= 0) store.seek(timeOfLine(lines, i))
}

async function sendTo(tab) {
  if (!track.value) return
  try {
    const blob = await store.getBlobFor(track.value.id)
    if (!blob) { showToast(t('media.failed')); return }
    const file = new File([blob], track.value.name, { type: track.value.type || blob.type })
    pool.handOff(file, { source: 'player', tab })
    router.push(tab === 'edit' ? '/media/edit' : '/media/convert')
  } catch { showToast(t('media.failed')) }
}

// A–B repeat state machine.
const abState = computed(() => {
  if (store.abStart.value != null && store.abEnd.value != null) return 'set'
  if (store.abStart.value != null) return 'a'
  return 'off'
})
function toggleAB() {
  if (abState.value === 'off') store.setA()
  else if (abState.value === 'a') store.setB()
  else store.clearAB()
}

function openFullScreenLyrics() {
  router.push('/media/lyrics')
}

// Keyboard transport + sentence nav (arrows = ±5s; Shift+arrows = track; ↑↓ = line).
function onKey(e) {
  if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return
  if (e.code === 'Space') { e.preventDefault(); store.toggle() }
  else if (e.code === 'ArrowRight' && e.shiftKey) store.next()
  else if (e.code === 'ArrowLeft' && e.shiftKey) store.prev()
  else if (e.code === 'ArrowRight') store.seek(store.currentTime.value + 5)
  else if (e.code === 'ArrowLeft') store.seek(Math.max(0, store.currentTime.value - 5))
  else if (e.code === 'ArrowUp') { e.preventDefault(); prevLine() }
  else if (e.code === 'ArrowDown') { e.preventDefault(); nextLine() }
  else if (e.code === 'KeyL') openFullScreenLyrics()
  // (bare A/B used to set loop markers — an invisible side effect of ordinary typing;
  // the A–B button and the lyric context menu cover that intent explicitly.)
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <div class="np">
    <div v-if="!hasTrack" class="np-empty">
      <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 30V12l20-4v18"/><circle cx="14" cy="30" r="4"/><circle cx="34" cy="26" r="4"/></svg>
      <p>{{ t('media.player.nothingPlaying') }}</p>
    </div>

    <template v-else>
      <!-- Artwork / waveform stage -->
      <div class="np-stage">
        <button class="np-mode np-mode-art" @click="artMode = artMode === 'art' ? 'wave' : 'art'" :title="t('media.player.toggleArt')">
          <svg v-if="artMode === 'art'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M3 12h3l2-5 3 9 2.5-7 1.5 5h6"/></svg>
          <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="14" rx="2"/><circle cx="8" cy="9" r="1.6"/><path d="M21 15l-5-4-4 3-2-1.5L3 16"/></svg>
        </button>
        <button class="np-mode np-mode-full" @click="openFullScreenLyrics" :title="t('media.player.fullLyrics')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h16M4 12h10M4 18h16"/><circle cx="18" cy="12" r="2"/></svg>
        </button>
        <div v-show="artMode === 'art'" class="np-art">
          <img v-if="store.coverUrl.value" :src="store.coverUrl.value" alt="" />
          <span v-else class="np-art-ph" :style="{ '--ph-hue': hashHue(track.title || track.name) }">{{ initialOf(track.title || track.name) }}</span>
        </div>
        <div v-show="artMode === 'wave'" class="np-wave">
          <MediaWaveform :peaks="peaks" :duration="store.duration.value" :play-ratio="playRatio" :selectable="false" :loading="wfLoading" :height="200" @seek="onSeek" />
        </div>
      </div>

      <!-- Title / artist + edit -->
      <div class="np-meta">
        <div class="np-text">
          <h3 class="np-title" :title="track.title">{{ track.title }}</h3>
          <p class="np-artist">{{ track.artist || track.album || '—' }}</p>
        </div>
        <button class="icon-btn" @click="emit('edit-tags', track.id)" :title="t('media.player.editTags')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5"/><path d="M18.5 2.5a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4z"/></svg>
        </button>
      </div>

      <!-- Seek bar -->
      <div class="np-seek">
        <span class="np-time">{{ formatTime(store.currentTime.value) }}</span>
        <MediaWaveform class="np-seekwave" :peaks="peaks" :duration="store.duration.value" :play-ratio="playRatio" :selectable="false" :loading="wfLoading" :height="44" @seek="onSeek" />
        <span class="np-time">{{ formatTime(store.duration.value) }}</span>
      </div>

      <!-- Transport: the standard five (shuffle · prev · play · next · repeat). Sentence-level
           navigation lives where sentences live: click a lyric line, or use the ↑/↓ keys —
           the old inline ⏮⋮/⏭⋮ buttons looked near-identical to prev/next-track and read as
           duplicated controls. -->
      <div class="np-transport">
        <button class="t-btn" :class="{ on: store.shuffle.value }" @click="store.toggleShuffle()" :title="t('media.player.shuffle')" :aria-label="t('media.player.shuffle')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M16 3h5v5"/><path d="M21 3l-7 7"/><path d="M3 21l7-7"/><path d="M16 21h5v-5"/><path d="M21 21L3 3"/></svg>
        </button>
        <button class="t-btn big" @click="store.prev()" :title="t('media.player.prev')" :aria-label="t('media.player.prev')">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/></svg>
        </button>
        <button class="t-btn play" :class="{ buffering: store.buffering.value }" @click="store.toggle()" :title="store.buffering.value ? t('media.player.buffering') : store.isPlaying.value ? t('media.player.pause') : t('media.player.play')" :aria-label="store.buffering.value ? t('media.player.buffering') : store.isPlaying.value ? t('media.player.pause') : t('media.player.play')">
          <span v-if="store.buffering.value" class="t-spin"></span>
          <svg v-else-if="store.isPlaying.value" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>
          <svg v-else viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
        </button>
        <button class="t-btn big" @click="store.next()" :title="t('media.player.next')" :aria-label="t('media.player.next')">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M16 6h2v12h-2zM6 6v12l8.5-6z"/></svg>
        </button>
        <button class="t-btn" :class="{ on: store.repeat.value !== 'off' }" @click="store.cycleRepeat()" :title="t('media.player.repeat')" :aria-label="t('media.player.repeat')">
          <svg v-if="store.repeat.value !== 'one'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17 2l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>
          <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17 2l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/><text x="12" y="15" font-size="9" font-weight="700" fill="currentColor" stroke="none" text-anchor="middle">1</text></svg>
        </button>
      </div>

      <!-- Secondary controls -->
      <div class="np-controls">
        <div class="np-vol">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9v6h4l5 4V5L8 9z"/><path v-if="store.volume.value > 0.5" d="M16 8a5 5 0 0 1 0 8"/><path v-if="store.volume.value > 0" d="M18.5 5.5a9 9 0 0 1 0 13"/></svg>
          <input type="range" min="0" max="1" step="0.01" :value="store.volume.value" @input="store.setVolume($event.target.value)" :aria-label="t('media.player.volume')" />
        </div>
        <div class="np-right">
          <select class="np-speed" :value="store.rate.value" @change="store.setRate(Number($event.target.value))" :aria-label="t('media.player.speed')">
            <option v-for="s in speeds" :key="s" :value="s">{{ s }}×</option>
          </select>
          <button class="ab-btn" :class="{ a: abState === 'a', set: abState === 'set' }" @click="toggleAB" :title="t('media.player.abRepeat')">
            {{ abState === 'off' ? 'A–B' : abState === 'a' ? 'A·' : 'A–B' }}
          </button>
          <!-- Share (NCM tracks only — local uploads have no cross-device link) -->
          <button v-if="track?.ncmId" class="ab-btn np-share" @click="shareCurrent" :title="t('media.share.song')" :aria-label="t('media.share.song')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 3.9M15.4 6.6L8.6 10.5"/></svg>
          </button>
        </div>
      </div>

      <div class="np-send">
        <button class="send-btn" @click="sendTo('edit')">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11.5 1.5l3 3L5 14H2v-3z"/></svg>
          {{ t('media.player.sendEdit') }}
        </button>
        <button class="send-btn" @click="sendTo('convert')">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 5h9l-2.5-2.5M14 11H5l2.5 2.5"/></svg>
          {{ t('media.player.sendConvert') }}
        </button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.np { display: flex; flex-direction: column; gap: 16px; }
.np-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px; padding: 60px 20px; color: var(--text-tertiary); text-align: center; }
.np-empty svg { width: 52px; height: 52px; }
.np-empty p { font-size: 14px; }

.np-stage { position: relative; }
.np-mode { position: absolute; top: 10px; z-index: 2; width: 34px; height: 34px; display: inline-flex; align-items: center; justify-content: center; border: none; border-radius: 9px; background: color-mix(in srgb, var(--surface) 70%, transparent); backdrop-filter: blur(8px); color: var(--text-secondary); cursor: pointer; transition: color var(--dur-1); }
.np-mode:hover { color: var(--text); }
.np-mode svg { width: 18px; height: 18px; }
.np-mode-art { right: 10px; }
.np-mode-full { right: 50px; }

/* Album art — square, no rotation (user requested static). */
.np-art { aspect-ratio: 1; width: 100%; max-width: min(360px, 75vw); margin: 0 auto; border-radius: 16px; overflow: hidden; background: var(--surface-hover); box-shadow: var(--shadow-md); }
.np-art img { width: 100%; height: 100%; object-fit: cover; display: block; }
.np-art-ph { display: flex; align-items: center; justify-content: center; width: 100%; height: 100%; font-size: 120px; font-weight: 800; color: var(--text); background: linear-gradient(150deg, color-mix(in srgb, hsl(var(--ph-hue, 40), 28%, 50%) 26%, var(--surface)), var(--surface-hover)); letter-spacing: -2px; }
.np-wave { display: flex; align-items: center; min-height: 200px; }

.np-meta { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.np-text { min-width: 0; }
.np-title { font-size: 20px; font-weight: 750; letter-spacing: -0.4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.np-artist { margin-top: 3px; font-size: 13px; color: var(--text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.icon-btn { flex-shrink: 0; width: 36px; height: 36px; display: inline-flex; align-items: center; justify-content: center; border: 1px solid var(--border-light); border-radius: 9px; background: var(--surface); color: var(--text-secondary); cursor: pointer; transition: all var(--dur-1); }
.icon-btn:hover { color: var(--text); border-color: var(--border); }
.icon-btn svg { width: 17px; height: 17px; }

.np-seek { display: flex; align-items: center; gap: 10px; }
.np-seekwave { flex: 1; min-width: 0; }
.np-time { font-size: 11px; color: var(--text-secondary); font-variant-numeric: tabular-nums; flex-shrink: 0; min-width: 34px; }
.np-seek .np-time:last-child { text-align: right; }

.np-transport { display: flex; align-items: center; justify-content: center; gap: 6px; flex-wrap: wrap; }
.t-btn { width: 44px; height: 44px; display: inline-flex; align-items: center; justify-content: center; border: none; background: none; color: var(--text-secondary); cursor: pointer; border-radius: 12px; transition: all var(--dur-1); }
.t-btn:hover { color: var(--text); background: var(--surface-hover); }
.t-btn.on { color: var(--accent); }
.t-btn svg { width: 22px; height: 22px; }
.t-btn.big svg { width: 28px; height: 28px; }
.t-btn.play { width: 60px; height: 60px; background: var(--text); color: var(--bg); border-radius: 50%; }
.t-btn.play:hover { opacity: 0.92; background: var(--text); }
.t-btn.play svg { width: 28px; height: 28px; }
/* Buffering: play button shows a ring spinner in the fill colour. */
.t-spin { width: 22px; height: 22px; border: 2.5px solid color-mix(in srgb, var(--bg) 35%, transparent); border-top-color: var(--bg); border-radius: 50%; animation: tb-spin 0.7s linear infinite; }

.np-controls { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.np-vol { display: flex; align-items: center; gap: 8px; flex: 1; max-width: 200px; color: var(--text-secondary); }
.np-vol svg { width: 18px; height: 18px; flex-shrink: 0; }
.np-vol input[type="range"] { flex: 1; accent-color: var(--accent); }
.np-right { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
.np-speed { padding: 6px 8px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); color: var(--text); font-size: 12px; font-family: var(--font-sans); cursor: pointer; outline: none; }
.np-speed:focus { border-color: var(--accent); }
.ab-btn { padding: 6px 10px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); color: var(--text-secondary); font-size: 11px; font-weight: 650; font-family: var(--font-sans); cursor: pointer; min-width: 44px; }
.np-share { min-width: 34px; display: inline-flex; align-items: center; justify-content: center; }
.np-share svg { width: 14px; height: 14px; }
.ab-btn.a { border-color: var(--accent); color: var(--accent); }
.ab-btn.set { background: var(--accent); border-color: var(--accent); color: var(--accent-text); }

.np-send { display: flex; gap: 8px; }
.send-btn { flex: 1; display: inline-flex; align-items: center; justify-content: center; gap: 7px; padding: 9px 12px; border: 1px solid var(--border-light); border-radius: 10px; background: var(--surface); color: var(--text-secondary); font-size: 12.5px; font-weight: 600; font-family: var(--font-sans); cursor: pointer; transition: all var(--dur-1); }
.send-btn:hover { color: var(--text); border-color: var(--accent); }
.send-btn svg { width: 15px; height: 15px; }

@media (max-width: 768px) {
  .t-btn { width: 48px; height: 48px; }
  .t-btn.play { width: 66px; height: 66px; }
}
</style>
