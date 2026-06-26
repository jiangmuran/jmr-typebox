<script setup>
// Persistent bottom mini-player, mounted by MediaShell so it stays visible across ALL audio
// sub-tabs (Convert / Edit / Subtitles / Player) and keeps the one shared <audio> playing. Compact
// transport + progress + a tap-target that opens the full Now-Playing (/media/player). Client-only
// content (the store touches Audio/IndexedDB) — MediaShell renders it inside <ClientOnly>.
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { usePlayerStore } from './usePlayerStore'
import { formatTime, initialOf, hashHue } from './playerHelpers'

const store = usePlayerStore()
const route = useRoute()
const router = useRouter()

const t = store.currentTrack
const visible = computed(() => !!store.currentId.value && !!t.value)
const onPlayer = computed(() => (route.meta?.path || route.path) === '/media/player')
const progress = computed(() => (store.duration.value ? store.currentTime.value / store.duration.value : 0))

function openPlayer() { if (!onPlayer.value) router.push('/media/player') }
function onSeek(e) {
  const bar = e.currentTarget
  const rect = bar.getBoundingClientRect()
  const r = (e.clientX - rect.left) / (rect.width || 1)
  store.seekRatio(Math.max(0, Math.min(1, r)))
}
</script>

<template>
  <transition name="mini-up">
    <div v-if="visible" class="mini" :class="{ 'on-player': onPlayer }">
      <div class="mini-seek" @click="onSeek"><div class="mini-seek-fill" :style="{ width: (progress * 100) + '%' }"></div></div>
      <div class="mini-body">
        <button class="mini-art" :class="{ clickable: !onPlayer }" @click="openPlayer" :title="onPlayer ? '' : 'Open player'">
          <img v-if="store.coverUrl.value" :src="store.coverUrl.value" alt="" />
          <span v-else class="mini-art-ph" :style="{ '--ph-hue': hashHue(t.title || t.name) }">{{ initialOf(t.title || t.name) }}</span>
        </button>
        <button class="mini-meta" :class="{ clickable: !onPlayer }" @click="openPlayer">
          <span class="mini-title">{{ t.title }}</span>
          <span class="mini-sub">{{ t.artist || formatTime(store.currentTime.value) + ' / ' + formatTime(store.duration.value) }}</span>
        </button>
        <div class="mini-controls">
          <button class="mini-btn" @click="store.prev()" aria-label="Previous">
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/></svg>
          </button>
          <button class="mini-btn play" @click="store.toggle()" :aria-label="store.isPlaying.value ? 'Pause' : 'Play'">
            <svg v-if="store.isPlaying.value" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>
            <svg v-else viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
          </button>
          <button class="mini-btn" @click="store.next()" aria-label="Next">
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M16 6h2v12h-2zM6 6v12l8.5-6z"/></svg>
          </button>
        </div>
      </div>
    </div>
  </transition>
</template>

<style scoped>
.mini { position: sticky; bottom: 0; left: 0; right: 0; z-index: 40; background: var(--bar-bg); backdrop-filter: saturate(180%) blur(20px); -webkit-backdrop-filter: saturate(180%) blur(20px); border-top: 1px solid var(--border-light); }
.mini-seek { height: 4px; background: var(--surface-hover); cursor: pointer; position: relative; }
.mini-seek-fill { height: 100%; background: var(--accent); transition: width 0.15s linear; }
.mini-seek:hover { height: 6px; }
.mini-body { display: flex; align-items: center; gap: 12px; padding: 8px 14px; max-width: 1120px; margin: 0 auto; }

.mini-art { width: 42px; height: 42px; flex-shrink: 0; border: none; padding: 0; border-radius: 8px; overflow: hidden; background: var(--surface-hover); cursor: default; }
.mini-art.clickable { cursor: pointer; }
.mini-art img { width: 100%; height: 100%; object-fit: cover; display: block; }
.mini-art-ph { display: flex; align-items: center; justify-content: center; width: 100%; height: 100%; font-size: 18px; font-weight: 700; color: var(--text); background: linear-gradient(135deg, color-mix(in srgb, hsl(var(--ph-hue, 40), 30%, 50%) 22%, var(--surface-hover)), var(--surface-hover)); }

.mini-meta { flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: flex-start; gap: 2px; background: none; border: none; padding: 0; text-align: left; cursor: default; font-family: var(--font-sans); }
.mini-meta.clickable { cursor: pointer; }
.mini-title { font-size: 13px; font-weight: 650; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
.mini-sub { font-size: 11px; color: var(--text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; font-variant-numeric: tabular-nums; }

.mini-controls { display: flex; align-items: center; gap: 4px; flex-shrink: 0; }
.mini-btn { width: 38px; height: 38px; display: inline-flex; align-items: center; justify-content: center; border: none; background: none; color: var(--text); cursor: pointer; border-radius: 9px; transition: background 0.15s; }
.mini-btn:hover { background: var(--surface-hover); }
.mini-btn svg { width: 22px; height: 22px; }
.mini-btn.play { background: var(--text); color: var(--bg); }
.mini-btn.play:hover { opacity: 0.9; background: var(--text); }
.mini-btn.play svg { width: 20px; height: 20px; }

.mini-up-enter-active, .mini-up-leave-active { transition: transform 0.25s var(--ease-out), opacity 0.25s; }
.mini-up-enter-from, .mini-up-leave-to { transform: translateY(100%); opacity: 0; }

@media (max-width: 768px) {
  .mini-body { gap: 10px; padding: 7px 12px; }
  .mini-art { width: 40px; height: 40px; }
  .mini-btn { width: 40px; height: 40px; }
  .mini-btn svg { width: 24px; height: 24px; }
}
</style>
