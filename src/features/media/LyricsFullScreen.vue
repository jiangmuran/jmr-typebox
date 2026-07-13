<script setup>
// Full-screen lyrics mode at /media/lyrics — the "art piece" view. Album cover blurred 50x as
// the background, current lyric in big dark-gold type with a soft glow,前后行 fade by distance.
//
// Behaviour:
//   • Page load requests a screen wake-lock so playback + lyrics don't sleep.
//   • Auto-hide transport after 3s of no interaction (cinema mode); tap toggles.
//   • Double-tap = play/pause (single tap = show/hide controls, so these don't fight).
//   • Sentence-nav buttons always visible on touch devices (no ↑↓ keys).
//   • KTV mode (yrc) renders per-syllable highlighting.
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { usePlayerStore } from './usePlayerStore'
import { useI18n } from '../../composables/useI18n'
import { parseLrc, parseYrc, activeLineIndex, activeYrcIndices, prevLineIndex, nextLineIndex, timeOfLine } from './lrc'
import ClientOnly from '../../components/ClientOnly.vue'

const router = useRouter()
const store = usePlayerStore()
const { t } = useI18n()

// View: prefer yrc (KTV) when present, otherwise the plain lrc. No view switcher here — this is
// the immersive single-purpose view (the four-way picker lives on PlayerLyrics.vue).
const lyricLines = computed(() => {
  const ll = store.liveLyrics.value || {}
  if (ll.yrc) {
    const parsed = parseYrc(ll.yrc)
    if (parsed.synced && parsed.lines.length) return { lines: parsed.lines, ktv: true }
  }
  if (ll.original) {
    const parsed = parseLrc(ll.original)
    if (parsed.synced) return { lines: parsed.lines, ktv: false }
  }
  return { lines: [], ktv: false }
})
const isKtv = computed(() => lyricLines.value.ktv)
const lines = computed(() => lyricLines.value.lines)

const activeIdx = computed(() => {
  if (!lines.value.length) return -1
  if (isKtv.value) return activeYrcIndices(lines.value, store.currentTime.value).lineIndex
  return activeLineIndex(lines.value, store.currentTime.value)
})
const activeWordIdx = computed(() => {
  if (!isKtv.value) return -1
  return activeYrcIndices(lines.value, store.currentTime.value).wordIndex
})

const hasTrack = computed(() => !!store.currentTrack.value)
const coverUrl = computed(() => store.coverUrl.value || '')

// Auto-scroll the active line to ~1/4 down the stage (not centre, not top) as playback advances —
// this view previously never scrolled, so the current line kept drifting to the top and off-screen.
const stageEl = ref(null)
watch(activeIdx, async () => {
  await nextTick()
  const root = stageEl.value
  if (!root) return
  const active = root.querySelector('[data-active="true"]')
  if (!active) return
  const target = active.offsetTop - root.clientHeight / 4 + active.clientHeight / 2
  root.scrollTo({ top: Math.max(0, target), behavior: 'smooth' })
})

// Wake lock so the screen stays on while lyrics are showing.
let wakeLock = null
async function requestWakeLock() {
  if (typeof navigator === 'undefined' || !navigator.wakeLock?.request) return
  try { wakeLock = await navigator.wakeLock.request('screen') } catch { /* best-effort */ }
}
function releaseWakeLock() {
  if (wakeLock?.released !== false) { try { wakeLock.release?.() } catch { /* ignore */ } }
  wakeLock = null
}
// Re-acquire on visibility change (e.g. tab switch drops the lock).
function onVisibility() { if (document.visibilityState === 'visible') requestWakeLock() }
onMounted(() => {
  requestWakeLock()
  document.addEventListener('visibilitychange', onVisibility)
  document.addEventListener('keydown', onKey)
  // Deep links / refreshes land here without MediaShell, so the store is un-hydrated.
  // init() is idempotent; when nothing is playing afterwards, bail to the player
  // instead of stranding the user on an empty lyric stage.
  store.init().then(() => {
    if (!store.currentTrack.value) router.replace('/media/player')
  })
})
onBeforeUnmount(() => {
  releaseWakeLock()
  document.removeEventListener('visibilitychange', onVisibility)
  document.removeEventListener('keydown', onKey)
})

// Cinema mode: hide controls after 3s of no interaction. Cleared on any pointer/touch move.
const showControls = ref(true)
let hideTimer = null
function resetHideTimer() {
  showControls.value = true
  if (hideTimer) clearTimeout(hideTimer)
  hideTimer = setTimeout(() => { showControls.value = false }, 3000)
}
onMounted(resetHideTimer)
onBeforeUnmount(() => { if (hideTimer) clearTimeout(hideTimer) })

function onToggleControls() { resetHideTimer() }
function onPlayToggle() { store.toggle(); resetHideTimer() }
function onPrevLine() {
  const l = lines.value
  if (!l.length) return
  const i = prevLineIndex(l, store.currentTime.value)
  if (i >= 0) store.seek(timeOfLine(l, i))
}
function onNextLine() {
  const l = lines.value
  if (!l.length) return
  const i = nextLineIndex(l, store.currentTime.value)
  if (i >= 0) store.seek(timeOfLine(l, i))
}
function onSeek10(delta) { store.seek(Math.max(0, store.currentTime.value + delta)); resetHideTimer() }

// Back to wherever the user came from; a deep link straight into /media/lyrics has no in-app
// history entry, so fall back to the player instead of backing out of the site.
function exit() {
  if (typeof window !== 'undefined' && window.history.state?.back) router.back()
  else router.replace('/media/player')
}

// Keyboard shortcuts.
function onKey(e) {
  if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return
  if (e.code === 'Space') { e.preventDefault(); onPlayToggle() }
  else if (e.code === 'ArrowUp') { e.preventDefault(); onPrevLine() }
  else if (e.code === 'ArrowDown') { e.preventDefault(); onNextLine() }
  else if (e.code === 'ArrowLeft') onSeek10(-5)
  else if (e.code === 'ArrowRight') onSeek10(5)
  else if (e.code === 'Escape') exit()
  resetHideTimer()
}

// Click → toggle controls. Double-click → toggle play. We use a small click-delay to distinguish.
let clickTimer = null
function onBackdropClick() {
  if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; onPlayToggle() }
  else { clickTimer = setTimeout(() => { clickTimer = null; onToggleControls() }, 220) }
}

// Line opacity by distance from active. 0 active · 1 near · 2 far · ≥3 very far.
function lineOpacity(i) {
  const d = Math.abs(i - activeIdx.value)
  if (d === 0) return 1
  if (d === 1) return 0.7
  if (d === 2) return 0.4
  if (d === 3) return 0.22
  return 0.12
}
function lineScale(i) {
  return i === activeIdx.value ? 1.04 : 1
}
</script>

<template>
  <!-- Real single-element root: the router-view wraps pages in <Transition mode="out-in">, and a
       fragment root (ClientOnly's conditional slot) breaks the leave transition — navigating BACK
       from this page left the incoming view never inserted (blank page). -->
  <div class="fls-page">
    <ClientOnly>
    <div class="fls" :class="{ 'hide-controls': !showControls }" @mousemove="resetHideTimer" @touchstart.passive="resetHideTimer">
      <!-- Blurred cover backdrop -->
      <div class="fls-bg" :style="coverUrl ? { backgroundImage: `url(${coverUrl})` } : {}"></div>
      <div class="fls-overlay"></div>

      <!-- Top bar: back + title -->
      <header class="fls-top">
        <button class="fls-back" @click="exit" :title="t('media.lyrics.back')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
        </button>
        <div class="fls-title-block">
          <div class="fls-song">{{ store.currentTrack.value?.title || '' }}</div>
          <div class="fls-artist">{{ store.currentTrack.value?.artist || '' }}</div>
        </div>
        <div class="fls-top-spacer"></div>
      </header>

      <!-- Empty state -->
      <div v-if="!hasTrack" class="fls-empty">
        <p>{{ t('media.player.nothingPlaying') }}</p>
      </div>

      <!-- Main area: on desktop a two-column [cover + meta | lyrics] layout; on mobile the cover
           panel is hidden (cover lives in the blurred backdrop) and lyrics fill the screen. -->
      <div v-else class="fls-main">
        <aside class="fls-cover-panel">
          <div class="fls-cover">
            <img v-if="coverUrl" :src="coverUrl" alt="" />
            <span v-else class="fls-cover-ph">♪</span>
          </div>
          <div class="fls-cover-title">{{ store.currentTrack.value?.title || '' }}</div>
          <div class="fls-cover-artist">{{ store.currentTrack.value?.artist || '' }}</div>
        </aside>

        <!-- Lyric stage -->
        <div v-if="lines.length" ref="stageEl" class="fls-stage" @click="onBackdropClick">
          <div class="fls-lines" :class="{ ktv: isKtv }">
            <div v-for="(line, i) in lines" :key="i"
              class="fls-line"
              :class="{ active: i === activeIdx }"
              :data-active="i === activeIdx"
              :style="{ opacity: lineOpacity(i), transform: `scale(${lineScale(i)})` }">
              <template v-if="isKtv">
                <span v-for="(w, wi) in line.words" :key="wi" class="fls-word" :class="{ on: i === activeIdx && wi <= activeWordIdx }">{{ w.text }}</span>
              </template>
              <template v-else>{{ line.text || '·' }}</template>
            </div>
          </div>
        </div>

        <!-- Plain text fallback (no synced lyrics) -->
        <div v-else class="fls-stage" @click="onBackdropClick">
          <div v-if="store.lyricsLoading.value" class="fls-plain">{{ t('media.lyrics.loading') }}</div>
          <div v-else class="fls-plain">{{ (store.liveLyrics.value?.original || '').split('\n').slice(0, 40).join('\n') || t('media.lyrics.empty') }}</div>
        </div>
      </div>

      <!-- Bottom transport -->
      <footer v-if="hasTrack" class="fls-bottom">
        <div class="fls-progress">
          <span class="fls-time">{{ Math.floor(store.currentTime.value / 60) }}:{{ String(Math.floor(store.currentTime.value % 60)).padStart(2, '0') }}</span>
          <div class="fls-bar" @click="store.seekRatio($event.offsetX / $event.currentTarget.offsetWidth)">
            <div class="fls-bar-fill" :style="{ width: ((store.currentTime.value / (store.duration.value || 1)) * 100) + '%' }"></div>
          </div>
          <span class="fls-time">{{ Math.floor(store.duration.value / 60) }}:{{ String(Math.floor(store.duration.value % 60)).padStart(2, '0') }}</span>
        </div>
        <div class="fls-controls">
          <button class="fls-btn" @click="onSeek10(-10)" :title="t('media.lyrics.back10')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M11 19V5l-9 7zM22 19V5l-9 7z"/></svg>
          </button>
          <button class="fls-btn" @click="onPrevLine" :disabled="!lines.length" :title="t('media.player.prevLine')">
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/></svg>
          </button>
          <button class="fls-btn play" @click="onPlayToggle">
            <svg v-if="store.isPlaying.value" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>
            <svg v-else viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
          </button>
          <button class="fls-btn" @click="onNextLine" :disabled="!lines.length" :title="t('media.player.nextLine')">
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M16 6h2v12h-2zM6 6v12l8.5-6z"/></svg>
          </button>
          <button class="fls-btn" @click="onSeek10(10)" :title="t('media.lyrics.fwd10')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M13 19V5l9 7zM2 19V5l9 7z"/></svg>
          </button>
        </div>
      </footer>
    </div>
    </ClientOnly>
  </div>
</template>

<style scoped>
.fls-page { flex: 1; min-height: 0; }
.fls { position: fixed; inset: 0; z-index: 100; overflow: hidden; background: #000; color: #fff; display: flex; flex-direction: column; }

/* Blurred backdrop: cover scaled up + 30px blur, with a strong dark gradient overlay so the lyric
   remains legible regardless of cover art brightness. */
.fls-bg { position: absolute; inset: -10%; background-size: cover; background-position: center; filter: blur(30px) saturate(180%); transform: scale(1.2); opacity: 0.6; transition: background-image 0.6s var(--ease-out); }
.fls-overlay { position: absolute; inset: 0; background: linear-gradient(to bottom, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.4) 35%, rgba(0,0,0,0.85) 100%); }

.fls-top, .fls-bottom { position: relative; z-index: 2; padding: 20px 24px; transition: opacity var(--dur-3), transform var(--dur-3); }
.fls.hide-controls .fls-top { opacity: 0; transform: translateY(-12px); pointer-events: none; }
.fls.hide-controls .fls-bottom { opacity: 0; transform: translateY(12px); pointer-events: none; }

.fls-top { display: flex; align-items: center; gap: 14px; }
.fls-back { width: 40px; height: 40px; display: inline-flex; align-items: center; justify-content: center; border: none; background: rgba(255,255,255,0.1); color: #fff; cursor: pointer; border-radius: 10px; backdrop-filter: blur(8px); transition: background var(--dur-1); }
.fls-back:hover { background: rgba(255,255,255,0.2); }
.fls-back svg { width: 20px; height: 20px; }
.fls-title-block { flex: 1; min-width: 0; text-align: center; }
.fls-song { font-size: 14px; font-weight: 650; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.fls-artist { font-size: 12px; opacity: 0.65; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.fls-top-spacer { width: 40px; flex-shrink: 0; }

/* Main area holds the (desktop-only) cover panel + the lyric stage. */
.fls-main { flex: 1; min-height: 0; display: flex; position: relative; z-index: 1; }

/* Cover panel — DESKTOP ONLY (hidden ≤899px; the cover still shows as the blurred backdrop). */
.fls-cover-panel { display: none; }

/* A real scroll container (no flex-centering — that clips the top and blocks scroll-to-top).
   The active line is JS-scrolled to ~1/4 down; the tall padding lets the first/last lines reach it. */
.fls-stage { flex: 1; min-height: 0; padding: 0 24px; position: relative; z-index: 1; overflow-y: auto; cursor: pointer; scrollbar-width: none; }
.fls-stage::-webkit-scrollbar { display: none; }
.fls-lines { width: 100%; max-width: 760px; margin: 0 auto; padding: 25vh 0 60vh; text-align: center; }
.fls-line { font-size: clamp(20px, 4.5vw, 32px); font-weight: 700; letter-spacing: -0.01em; line-height: 1.55; color: #fff; margin: 12px 0; transition: opacity 0.35s var(--ease-out), transform 0.35s var(--ease-out), color 0.3s; }
.fls-line.active { color: var(--accent); text-shadow: 0 0 40px color-mix(in srgb, var(--accent) 50%, transparent); }

/* KTV (yrc) per-syllable */
.fls-lines.ktv .fls-line { font-size: clamp(22px, 5vw, 36px); line-height: 1.9; }
.fls-word { display: inline-block; color: rgba(255,255,255,0.5); transition: color 0.08s; padding: 0 1px; }
.fls-word.on { color: var(--accent); }

/* Plain-text fallback (no synced lyrics). */
.fls-plain { font-size: clamp(16px, 3vw, 22px); color: rgba(255,255,255,0.7); white-space: pre-wrap; max-width: 600px; text-align: center; line-height: 1.7; }

.fls-empty { flex: 1; display: flex; align-items: center; justify-content: center; color: rgba(255,255,255,0.5); font-size: 14px; position: relative; z-index: 1; }

.fls-bottom { padding-bottom: max(20px, env(safe-area-inset-bottom)); }
.fls-progress { display: flex; align-items: center; gap: 10px; max-width: 760px; margin: 0 auto 14px; }
.fls-time { font-size: 11px; color: rgba(255,255,255,0.7); font-variant-numeric: tabular-nums; flex-shrink: 0; min-width: 36px; }
.fls-time:last-child { text-align: right; }
.fls-bar { flex: 1; height: 3px; background: rgba(255,255,255,0.18); border-radius: 99px; cursor: pointer; position: relative; }
.fls-bar:hover { height: 5px; }
.fls-bar-fill { height: 100%; background: var(--accent); border-radius: 99px; transition: width var(--dur-1) linear; }

.fls-controls { display: flex; align-items: center; justify-content: center; gap: 14px; max-width: 760px; margin: 0 auto; }
.fls-btn { width: 44px; height: 44px; display: inline-flex; align-items: center; justify-content: center; border: none; background: rgba(255,255,255,0.1); color: #fff; cursor: pointer; border-radius: 50%; transition: all var(--dur-1); backdrop-filter: blur(8px); }
.fls-btn:hover { background: rgba(255,255,255,0.2); }
.fls-btn:disabled { opacity: 0.3; cursor: not-allowed; }
.fls-btn svg { width: 20px; height: 20px; }
.fls-btn.play { width: 60px; height: 60px; background: var(--accent); color: var(--accent-text); }
.fls-btn.play:hover { background: var(--accent-hover); }

/* ---------- DESKTOP (≥900px): cover on the left, lyrics on the right, left-aligned ---------- */
@media (min-width: 900px) {
  /* align-items: stretch (default) so the lyric stage fills the height and scrolls INTERNALLY;
     the cover panel centers itself vertically within its own column. */
  .fls-main { max-width: 1200px; margin: 0 auto; width: 100%; gap: 56px; padding: 8px 48px 24px; }
  .fls-cover-panel { display: flex; flex-direction: column; align-items: flex-start; justify-content: center; flex: 0 0 300px; }
  .fls-cover { width: 300px; height: 300px; border-radius: 16px; overflow: hidden; background: rgba(255,255,255,0.06); box-shadow: 0 20px 60px rgba(0,0,0,0.5); }
  .fls-cover img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .fls-cover-ph { display: flex; align-items: center; justify-content: center; width: 100%; height: 100%; font-size: 90px; color: rgba(255,255,255,0.4); }
  .fls-cover-title { margin-top: 22px; font-size: 22px; font-weight: 750; letter-spacing: -0.4px; max-width: 300px; }
  .fls-cover-artist { margin-top: 6px; font-size: 14px; opacity: 0.7; max-width: 300px; }
  /* Lyrics read as a left-aligned column beside the cover (not centered on the whole screen). */
  .fls-stage { padding: 0; }
  .fls-lines { margin: 0; max-width: none; text-align: left; padding: 30vh 0 55vh; }
  .fls-line { font-size: clamp(22px, 2vw, 30px); margin: 14px 0; }
  .fls-lines.ktv .fls-line { font-size: clamp(24px, 2.2vw, 32px); }
  /* Mouse users get persistent controls — the auto-hide cinema mode is for touch only. */
  .fls.hide-controls .fls-top,
  .fls.hide-controls .fls-bottom { opacity: 1; transform: none; pointer-events: auto; }
  .fls-progress, .fls-controls { max-width: 1104px; }
  /* The centered top title is redundant with the cover panel on desktop. */
  .fls-title-block { visibility: hidden; }
}

@media (max-width: 768px) {
  .fls-top { padding: 14px 16px; }
  .fls-bottom { padding: 14px 16px calc(14px + env(safe-area-inset-bottom)); }
  .fls-line { font-size: clamp(18px, 5.5vw, 26px); line-height: 1.7; margin: 10px 0; }
  .fls-lines.ktv .fls-line { font-size: clamp(20px, 6vw, 30px); }
  .fls-btn { width: 42px; height: 42px; }
  .fls-btn.play { width: 56px; height: 56px; }
}
@media (prefers-reduced-motion: reduce) {
  .fls-line, .fls-bg, .fls-top, .fls-bottom { transition: none; }
}
</style>
