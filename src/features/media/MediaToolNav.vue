<script setup>
// Sub-tool switcher shown across every audio page so the four tools form one coherent hub:
// Convert · Edit · Subtitles · Player. Mirrors the image tab's ImageToolNav. The Player route owns
// the local file library; all four share the in-memory pool + persistent mini-player.
import { ref, onMounted, nextTick } from 'vue'
import { useI18n } from '../../composables/useI18n'
const { t } = useI18n()
const TOOLS = [
  { id: 'convert', to: '/media/convert', icon: 'convert' },
  { id: 'edit', to: '/media/edit', icon: 'edit' },
  { id: 'subtitles', to: '/media/subtitles', icon: 'subtitle' },
  { id: 'metadata', to: '/media/metadata', icon: 'metadata' },
  { id: 'player', to: '/media/player', icon: 'player' },
]

// On phones this bar scrolls horizontally; keep the ACTIVE tab in view on load so the current
// tool (often the last, "Player") is never left clipped past the right edge.
const navEl = ref(null)
function revealActive() {
  const nav = navEl.value
  if (!nav) return
  const active = nav.querySelector('.active')
  if (active && nav.scrollWidth > nav.clientWidth) {
    active.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }
}
onMounted(() => nextTick(revealActive))
</script>

<template>
  <nav ref="navEl" class="media-nav" aria-label="Audio tools">
    <router-link v-for="tool in TOOLS" :key="tool.id" :to="tool.to" class="media-nav-item" active-class="active" @click="$nextTick(revealActive)">
      <svg v-if="tool.icon === 'convert'" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M2 5h9l-2.5-2.5M14 11H5l2.5 2.5"/></svg>
      <svg v-else-if="tool.icon === 'edit'" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M11.5 1.5l3 3L5 14H2v-3z"/></svg>
      <svg v-else-if="tool.icon === 'subtitle'" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3.5" width="12" height="9" rx="1.5"/><line x1="4.5" y1="9.5" x2="8" y2="9.5"/><line x1="9.5" y1="9.5" x2="11.5" y2="9.5"/></svg>
      <svg v-else-if="tool.icon === 'metadata'" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M8.2 2H3.5A1.5 1.5 0 002 3.5v4.7a1 1 0 00.3.7l5.3 5.3a1 1 0 001.4 0l4.7-4.7a1 1 0 000-1.4L8.9 2.3A1 1 0 008.2 2z"/><circle cx="5.3" cy="5.3" r="0.9" fill="currentColor" stroke="none"/></svg>
      <svg v-else viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M6 12V3.5l7-1.3V10"/><circle cx="4.3" cy="12" r="1.7"/><circle cx="11.3" cy="10" r="1.7"/></svg>
      <span>{{ t('media.nav.' + tool.id) }}</span>
    </router-link>
  </nav>
</template>

<style scoped>
.media-nav { display: flex; gap: 3px; margin-bottom: 18px; background: var(--surface-hover); padding: 3px; border-radius: 10px; overflow-x: auto; scrollbar-width: none; }
.media-nav::-webkit-scrollbar { display: none; }
.media-nav-item { flex: 1; display: inline-flex; align-items: center; justify-content: center; gap: 6px; white-space: nowrap; padding: 8px 12px; border-radius: 7px; font-size: 12.5px; font-weight: 500; color: var(--text-secondary); text-decoration: none; transition: all 0.15s; }
.media-nav-item svg { width: 14px; height: 14px; flex-shrink: 0; }
.media-nav-item:hover { color: var(--text); }
.media-nav-item.active { background: var(--surface); color: var(--text); box-shadow: var(--shadow-xs); }
.media-nav-item.active svg { color: var(--accent); }
@media (max-width: 768px) {
  .media-nav { margin-bottom: 14px; }
  .media-nav-item { padding: 10px 10px; font-size: 12.5px; }
  .media-nav-item span { display: inline; }
}
@media (max-width: 380px) {
  .media-nav-item { gap: 4px; padding: 9px 6px; }
}
</style>
