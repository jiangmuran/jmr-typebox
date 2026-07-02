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
const store = usePlayerStore()
const pool = useMediaPool()
const handoff = useHandoff()

// Desktop right-pane toggle: now-playing vs lyrics.
const rightTab = ref('now') // 'now' | 'lyrics'
// Mobile swipe deck index: 0 = now, 1 = lyrics, 2 = queue.
const panel = ref(0)
const PANELS = ['now', 'lyrics', 'queue']

const editTagsFor = ref('')

onMounted(async () => {
  await store.init()
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
        <!-- DESKTOP: two columns -->
        <div class="pl-desktop">
          <section class="pl-col pl-left">
            <PlayerLibrary />
          </section>
          <section class="pl-col pl-right">
            <div class="pl-right-tabs">
              <button :class="{ on: rightTab === 'now' }" @click="rightTab = 'now'">{{ t('media.player.nowPlaying') }}</button>
              <button :class="{ on: rightTab === 'lyrics' }" @click="rightTab = 'lyrics'">{{ t('media.player.lyrics') }}</button>
            </div>
            <div class="pl-right-body">
              <div v-show="rightTab === 'now'" class="pl-now"><NowPlaying @edit-tags="editTagsFor = $event" /></div>
              <div v-show="rightTab === 'lyrics'" class="pl-lyrics-pane"><PlayerLyrics /></div>
            </div>
          </section>
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
.pl-desktop { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.05fr); gap: 22px; align-items: start; }
.pl-col { min-width: 0; }
.pl-left { height: calc(100dvh - 220px); min-height: 420px; }
.pl-right { display: flex; flex-direction: column; gap: 14px; }
.pl-right-tabs { display: flex; gap: 3px; padding: 3px; background: var(--surface-hover); border-radius: 9px; align-self: flex-start; }
.pl-right-tabs button { padding: 7px 16px; border: none; border-radius: 7px; font-size: 12.5px; font-weight: 600; background: transparent; color: var(--text-secondary); cursor: pointer; font-family: var(--font-sans); transition: all 0.15s; }
.pl-right-tabs button.on { background: var(--surface); color: var(--text); box-shadow: var(--shadow-xs); }
.pl-right-body { min-height: 0; }
.pl-lyrics-pane { height: calc(100dvh - 280px); min-height: 380px; border: 1px solid var(--border-light); border-radius: 14px; background: var(--surface); overflow: hidden; }

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
