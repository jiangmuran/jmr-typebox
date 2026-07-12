<script setup>
// Music PLAYER route (/media/player). The sr-only <h1> lives OUTSIDE <ClientOnly> for SEO; the
// interactive player (which touches Audio/IndexedDB/window) renders only after client mount.
//
// Layout:
//   • DESKTOP (≥900px): two columns — left = library/queue/playlists; right = Now-Playing with a
//     Lyrics toggle. Both live under the shared store, so the mini-player in MediaShell mirrors it.
//   • MOBILE (<900px): a full-screen, swipeable 3-panel deck — Now-Playing ⇄ Lyrics ⇄ Queue — with
//     dot indicators; the persistent bottom mini-player (MediaShell) stays below.
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useRouteHead } from '../../composables/useRouteHead'
import { useI18n } from '../../composables/useI18n'
import ClientOnly from '../../components/ClientOnly.vue'
import MediaShell from './MediaShell.vue'
import MediaToolNav from './MediaToolNav.vue'
import NowPlaying from './NowPlaying.vue'
import PlayerLibrary from './PlayerLibrary.vue'
import PlayerLyrics from './PlayerLyrics.vue'
import TrackTagEditor from './TrackTagEditor.vue'
import { usePlayerStore } from './usePlayerStore'
import { useMediaPool } from './useMediaPool'
import { useHandoff } from '../../composables/useHandoff'

const { meta: m } = useRouteHead()
const { t } = useI18n()
const router = useRouter()
const store = usePlayerStore()
const pool = useMediaPool()
const handoff = useHandoff()

// Desktop layout mode: 'split' = NowPlaying left + Lyrics right (default); 'library' = show library.
const desktopMode = ref('split')
// Mobile swipe deck index: 0 = now, 1 = lyrics, 2 = queue.
const panel = ref(0)
const PANELS = ['now', 'lyrics', 'queue']

const editTagsFor = ref('')

onMounted(async () => {
  await store.init()
  // Land where the user's next action is: with nothing playing (first visit, or no resumable
  // track) the split view is just an empty "Nothing playing" screen and the library — the only
  // useful surface — hides behind a tab. Default to the library in that case; keep the split
  // view when a track is loaded/resumed.
  if (!store.currentId.value) {
    desktopMode.value = 'library'
    panel.value = 2
  }
  // Cross-module "Send to →": add a file sent here from another tool to the library and play it.
  const taken = handoff.take(['av', 'audio', 'video'])
  if (taken?.payload) {
    const f = taken.payload instanceof File ? taken.payload : new File([taken.payload], taken.name || 'audio', { type: taken.payload?.type || '' })
    await store.addFile(f, { autoplay: true })
  }
  // Register the player as the live "Add to player" sink so the converter/editor can push files
  // straight into the library without a route change.
  pool.registerPlayerSink(async (file) => { await store.addFile(file) })
  // If another tool handed off a file destined for the player, ingest it now.
  const pending = pool.peekPending()
  if (pending && pending.file && (!pending.tab || pending.tab === 'player')) {
    pool.takePending()
    await store.addFile(pending.file, { autoplay: true })
  }
})

// ---- mobile swipe ----
let touchX = 0
let touchY = 0
let swiping = false
function onTouchStart(e) { const tch = e.touches?.[0]; if (!tch) return; touchX = tch.clientX; touchY = tch.clientY; swiping = true }
function onTouchEnd(e) {
  if (!swiping) return
  swiping = false
  const tch = e.changedTouches?.[0]; if (!tch) return
  const dx = tch.clientX - touchX
  const dy = tch.clientY - touchY
  if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) * 1.4) return // mostly-vertical → ignore
  if (dx < 0 && panel.value < PANELS.length - 1) panel.value++
  else if (dx > 0 && panel.value > 0) panel.value--
}

const trackX = computed(() => `translateX(-${panel.value * 100}%)`)
</script>

<template>
  <MediaShell>
    <div class="player">
      <h1 class="sr-only">{{ m.h1 }}</h1>
      <MediaToolNav />
      <ClientOnly>
        <!-- DESKTOP: split view (NowPlaying + Lyrics side by side) or Library overlay -->
        <div class="pl-desktop">
          <div class="pl-desktop-bar">
            <button class="pl-bar-btn" :class="{ on: desktopMode === 'split' }" @click="desktopMode = 'split'">
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="1" y="2" width="6" height="12" rx="1"/><rect x="9" y="2" width="6" height="12" rx="1"/></svg>
              {{ t('media.player.nowPlaying') }}
            </button>
            <button class="pl-bar-btn" :class="{ on: desktopMode === 'library' }" @click="desktopMode = 'library'">
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M2 4h12M2 8h12M2 12h8"/></svg>
              {{ t('media.player.tabFiles') }}
            </button>
            <button class="pl-bar-btn pl-fullscreen-btn" @click="router ? router.push('/media/lyrics') : null">
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M2 2h5M14 2h-5M2 14h5M14 14h-5M2 2v5M2 14v-5M14 2v5M14 14v-5"/></svg>
              {{ t('media.player.fullLyrics') }}
            </button>
          </div>

          <!-- Split mode: NowPlaying (left) + Lyrics (right) -->
          <div v-show="desktopMode === 'split'" class="pl-split">
            <section class="pl-split-left"><NowPlaying @edit-tags="editTagsFor = $event" /></section>
            <section class="pl-split-right"><PlayerLyrics /></section>
          </div>

          <!-- Library mode -->
          <div v-show="desktopMode === 'library'" class="pl-lib-full">
            <PlayerLibrary />
          </div>
        </div>

        <!-- MOBILE: swipeable 3-panel deck -->
        <div class="pl-mobile" @touchstart.passive="onTouchStart" @touchend="onTouchEnd">
          <div class="pl-dots">
            <button v-for="(p, i) in PANELS" :key="p" class="dot" :class="{ on: panel === i }" @click="panel = i" :aria-label="p"></button>
          </div>
          <div class="pl-deck-clip">
            <div class="pl-deck" :style="{ transform: trackX }">
              <div class="pl-slide"><NowPlaying @edit-tags="editTagsFor = $event" /></div>
              <div class="pl-slide pl-slide-lyrics"><PlayerLyrics /></div>
              <div class="pl-slide pl-slide-lib"><PlayerLibrary /></div>
            </div>
          </div>
          <div class="pl-swipe-hint">{{ PANELS[panel] === 'now' ? t('media.player.swipeLyrics') : PANELS[panel] === 'queue' ? t('media.player.swipeBack') : t('media.player.swipeHint') }}</div>
        </div>

        <TrackTagEditor v-if="editTagsFor" :track-id="editTagsFor" @close="editTagsFor = ''" />
      </ClientOnly>
    </div>
  </MediaShell>
</template>

<style scoped>
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }
.player { flex: 1; max-width: 1120px; margin: 0 auto; width: 100%; padding: 22px 24px 28px; animation: tbIn 0.3s var(--ease-out); }
@media (max-width: 768px) { .player { padding: 16px 16px 22px; } }
@keyframes tbIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }

/* ---------- DESKTOP ---------- */
.pl-desktop { display: flex; flex-direction: column; gap: 14px; }
.pl-desktop-bar { display: flex; gap: 3px; padding: 3px; background: var(--surface-hover); border-radius: 9px; align-self: flex-start; }
.pl-bar-btn { display: inline-flex; align-items: center; gap: 6px; padding: 7px 14px; border: none; border-radius: 7px; font-size: 12.5px; font-weight: 600; background: transparent; color: var(--text-secondary); cursor: pointer; font-family: var(--font-sans); transition: all 0.15s; }
.pl-bar-btn svg { width: 14px; height: 14px; }
.pl-bar-btn.on { background: var(--surface); color: var(--text); box-shadow: var(--shadow-xs); }
.pl-bar-btn.pl-fullscreen-btn { margin-left: auto; }

.pl-split { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.1fr); gap: 22px; align-items: start; }
.pl-split-left { min-width: 0; }
.pl-split-right { min-width: 0; height: calc(100dvh - 240px); min-height: 400px; border: 1px solid var(--border-light); border-radius: 14px; background: var(--surface); overflow: hidden; }
.pl-lib-full { height: calc(100dvh - 240px); min-height: 400px; }

.pl-mobile { display: none; }

/* ---------- MOBILE ---------- */
@media (max-width: 900px) {
  .pl-desktop { display: none; }
  .pl-mobile { display: flex; flex-direction: column; gap: 10px; }
  .pl-dots { display: flex; align-items: center; justify-content: center; gap: 2px; padding: 2px 0 4px; }
  /* The visible pill stays small (::before), but the button itself is a ~32px tap target so the
     deck pager is reliably reachable by thumb. */
  .dot { width: 28px; height: 30px; border: none; background: transparent; cursor: pointer; padding: 0; display: inline-flex; align-items: center; justify-content: center; }
  .dot::before { content: ''; width: 7px; height: 7px; border-radius: 50%; background: var(--border); transition: all 0.2s; }
  .dot.on::before { background: var(--accent); width: 20px; border-radius: 4px; }
  .pl-deck-clip { overflow: hidden; }
  .pl-deck { display: flex; width: 100%; transition: transform 0.32s var(--ease-out); }
  .pl-slide { flex: 0 0 100%; min-width: 100%; padding: 0 2px; }
  .pl-slide-lyrics { height: calc(100dvh - 260px); min-height: 380px; border: 1px solid var(--border-light); border-radius: 14px; background: var(--surface); overflow: hidden; }
  .pl-slide-lib { height: calc(100dvh - 230px); min-height: 420px; }
  .pl-swipe-hint { text-align: center; font-size: 11px; color: var(--text-tertiary); padding-top: 2px; }
}
</style>
