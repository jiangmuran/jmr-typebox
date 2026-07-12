<script setup>
// Persistent bottom mini-player. Phase 2 redesign:
//   • Slightly stronger blur + a subtle hairline accent on the seek bar (the album cover IS the
//     thumb when there's a current track).
//   • Prefetch state indicator on the right (✓ cached / ⏳ fetching / — idle) so the user can
//     see at a glance whether the next track is warmed up — important because NCM tracks need
//     a network fetch before they can play.
//   • Long-press on the artwork opens the full-screen lyrics view (/media/lyrics).
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { usePlayerStore } from './usePlayerStore'
import { formatTime, initialOf, hashHue } from './playerHelpers'
import { useI18n } from '../../composables/useI18n'

const store = usePlayerStore()
const route = useRoute()
const router = useRouter()
const { t } = useI18n()

const t_ = store.currentTrack
// Visible when a track is loaded OR a background import is running (so its progress is reachable).
const visible = computed(() => (!!store.currentId.value && !!t_.value) || store.importState.value.running)
const hasTrack = computed(() => !!store.currentId.value && !!t_.value)
const onPlayer = computed(() => (route.meta?.path || route.path) === '/media/player')
const progress = computed(() => (store.duration.value ? store.currentTime.value / store.duration.value : 0))

// Map the store's prefetchState ('idle' | 'fetching' | 'cached' | 'error') to a tiny UI badge.
const prefetchBadge = computed(() => {
  switch (store.prefetchState.value) {
    case 'cached': return { icon: '✓', cls: 'ok', title: t('media.player.nextCached') }
    case 'fetching': return { icon: '⏳', cls: 'fetching', title: t('media.player.nextFetching') }
    case 'error': return { icon: '!', cls: 'err', title: t('media.player.nextError') }
    default: return null
  }
})

function openPlayer() { if (!onPlayer.value) router.push('/media/player') }
function openLyrics() { router.push('/media/lyrics') }
function onSeek(e) {
  const bar = e.currentTarget
  const rect = bar.getBoundingClientRect()
  const r = (e.clientX - rect.left) / (rect.width || 1)
  store.seekRatio(Math.max(0, Math.min(1, r)))
}

// Long-press the artwork to jump to full-screen lyrics.
let pressTimer = null
function onArtTouchStart() { pressTimer = setTimeout(openLyrics, 500) }
function onArtTouchEnd() { if (pressTimer) { clearTimeout(pressTimer); pressTimer = null } }
</script>

<template>
  <transition name="mini-up">
    <div v-if="visible" class="mini" :class="{ 'on-player': onPlayer }">
      <!-- Background playlist-import progress: visible from any page, cancellable. -->
      <div v-if="store.importState.value.running" class="mini-import">
        <span class="mi-spin"></span>
        <span class="mi-text">{{ t('media.player.importing') }} {{ store.importState.value.done }}/{{ store.importState.value.total }}<template v-if="store.importState.value.currentTitle"> · {{ store.importState.value.currentTitle }}</template></span>
        <div class="mi-bar"><div class="mi-fill" :style="{ width: (store.importState.value.total ? store.importState.value.done / store.importState.value.total * 100 : 0) + '%' }"></div></div>
        <button class="mi-cancel" :title="t('media.player.importCancel')" @click="store.cancelImport()">✕</button>
      </div>
      <div v-if="hasTrack" class="mini-seek" @click="onSeek"><div class="mini-seek-fill" :style="{ width: (progress * 100) + '%' }"></div></div>
      <div v-if="hasTrack" class="mini-body">
        <button class="mini-art"
          :class="{ clickable: !onPlayer }"
          @click="openPlayer"
          @touchstart.passive="onArtTouchStart" @touchend="onArtTouchEnd" @touchmove="onArtTouchEnd"
          :title="onPlayer ? '' : 'Open player'">
          <img v-if="store.coverUrl.value" :src="store.coverUrl.value" alt="" />
          <span v-else class="mini-art-ph" :style="{ '--ph-hue': hashHue(t_.title || t_.name) }">{{ initialOf(t_.title || t_.name) }}</span>
        </button>
        <button class="mini-meta" :class="{ clickable: !onPlayer }" @click="openPlayer">
          <span class="mini-title">{{ t_.title }}</span>
          <span class="mini-sub">{{ t_.artist || formatTime(store.currentTime.value) + ' / ' + formatTime(store.duration.value) }}</span>
        </button>
        <div class="mini-controls">
          <button class="mini-btn" @click="store.prev()" :aria-label="t('media.player.prev')">
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/></svg>
          </button>
          <button class="mini-btn play" :class="{ buffering: store.buffering.value }" @click="store.toggle()" :aria-label="store.buffering.value ? t('media.player.buffering') : store.isPlaying.value ? t('media.player.pause') : t('media.player.play')">
            <span v-if="store.buffering.value" class="mini-spin"></span>
            <svg v-else-if="store.isPlaying.value" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>
            <svg v-else viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
          </button>
          <button class="mini-btn" @click="store.next()" :aria-label="t('media.player.next')">
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M16 6h2v12h-2zM6 6v12l8.5-6z"/></svg>
          </button>
          <span v-if="prefetchBadge" class="mini-prefetch" :class="prefetchBadge.cls" :title="prefetchBadge.title">{{ prefetchBadge.icon }}</span>
        </div>
      </div>
    </div>
  </transition>
</template>

<style scoped>
/* Slightly stronger blur than v1 (40px vs 20px) for the "floating glass" feel; also a hint of
   saturate(180%) to keep the album cover legible through it. */
.mini { position: sticky; bottom: 0; left: 0; right: 0; z-index: 40; background: var(--bar-bg); backdrop-filter: saturate(180%) blur(40px); -webkit-backdrop-filter: saturate(180%) blur(40px); border-top: 1px solid var(--border-light); }
.mini-seek { height: 3px; background: var(--surface-hover); cursor: pointer; position: relative; }
.mini-seek-fill { height: 100%; background: var(--accent); transition: width var(--dur-1) linear; }
.mini-seek:hover { height: 6px; }
.mini-body { display: flex; align-items: center; gap: 12px; padding: 8px 14px; max-width: var(--page-wide); margin: 0 auto; }

/* Background-import progress strip (above the seek bar). */
.mini-import { display: flex; align-items: center; gap: 10px; padding: 7px 14px; max-width: var(--page-wide); margin: 0 auto; border-bottom: 1px solid var(--border-light); }
.mi-spin { width: 13px; height: 13px; border: 2px solid var(--border); border-top-color: var(--accent); border-radius: 50%; animation: tb-spin 0.7s linear infinite; flex-shrink: 0; }
.mi-text { font-size: 11.5px; color: var(--text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.mi-bar { flex: 1; min-width: 40px; max-width: 160px; height: 3px; border-radius: 99px; background: var(--surface-hover); overflow: hidden; }
.mi-fill { height: 100%; background: var(--accent); border-radius: 99px; transition: width var(--dur-2) var(--ease-out); }
.mi-cancel { flex-shrink: 0; border: none; background: none; color: var(--text-tertiary); font-size: 13px; cursor: pointer; padding: 2px 6px; border-radius: 6px; }
.mi-cancel:hover { color: var(--text); background: var(--surface-hover); }

.mini-art { width: 42px; height: 42px; flex-shrink: 0; border: none; padding: 0; border-radius: 8px; overflow: hidden; background: var(--surface-hover); cursor: default; }
.mini-art.clickable { cursor: pointer; }
.mini-art img { width: 100%; height: 100%; object-fit: cover; display: block; }
.mini-art-ph { display: flex; align-items: center; justify-content: center; width: 100%; height: 100%; font-size: 18px; font-weight: 700; color: var(--text); background: linear-gradient(135deg, color-mix(in srgb, hsl(var(--ph-hue, 40), 30%, 50%) 22%, var(--surface-hover)), var(--surface-hover)); }

.mini-meta { flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: flex-start; gap: 2px; background: none; border: none; padding: 0; text-align: left; cursor: default; font-family: var(--font-sans); }
.mini-meta.clickable { cursor: pointer; }
.mini-title { font-size: 13px; font-weight: 650; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
.mini-sub { font-size: 11px; color: var(--text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; font-variant-numeric: tabular-nums; }

.mini-controls { display: flex; align-items: center; gap: 4px; flex-shrink: 0; }
.mini-btn { width: 38px; height: 38px; display: inline-flex; align-items: center; justify-content: center; border: none; background: none; color: var(--text); cursor: pointer; border-radius: 9px; transition: background var(--dur-1); }
.mini-btn:hover { background: var(--surface-hover); }
.mini-btn svg { width: 22px; height: 22px; }
.mini-btn.play { background: var(--text); color: var(--bg); }
.mini-btn.play:hover { opacity: 0.9; background: var(--text); }
.mini-btn.play svg { width: 20px; height: 20px; }
.mini-spin { width: 16px; height: 16px; border: 2px solid color-mix(in srgb, var(--bg) 35%, transparent); border-top-color: var(--bg); border-radius: 50%; animation: tb-spin 0.7s linear infinite; }

/* Prefetch status badge — small, monochrome, in the surface-active circle. */
.mini-prefetch { display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; border-radius: 50%; font-size: 11px; font-weight: 700; background: var(--surface-active); color: var(--text-secondary); margin-left: 4px; }
.mini-prefetch.ok { color: var(--status-ok); }
.mini-prefetch.fetching { color: var(--status-warn); animation: pulse 1.2s ease-in-out infinite; }
.mini-prefetch.err { color: var(--status-warn); }
@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.45; } }

.mini-up-enter-active, .mini-up-leave-active { transition: transform 0.25s var(--ease-out), opacity 0.25s; }
.mini-up-enter-from, .mini-up-leave-to { transform: translateY(100%); opacity: 0; }

@media (max-width: 768px) {
  .mini-body { gap: 10px; padding: 7px 12px; }
  .mini-art { width: 40px; height: 40px; }
  .mini-btn { width: 40px; height: 40px; }
  .mini-btn svg { width: 24px; height: 24px; }
}
</style>
