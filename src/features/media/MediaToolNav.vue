<script setup>
// Sub-tool switcher shown across every audio page so the four tools form one coherent hub:
// Convert · Edit · Subtitles · Player. Mirrors the image tab's ImageToolNav. The Player route owns
// the local file library; all four share the in-memory pool + persistent mini-player.
import { useI18n } from '../../composables/useI18n'
const { t } = useI18n()
const TOOLS = [
  { id: 'convert', to: '/media/convert', icon: 'convert' },
  { id: 'edit', to: '/media/edit', icon: 'edit' },
  { id: 'subtitles', to: '/media/subtitles', icon: 'subtitle' },
  { id: 'player', to: '/media/player', icon: 'player' },
]
</script>

<template>
  <nav class="media-nav" aria-label="Audio tools">
    <router-link v-for="tool in TOOLS" :key="tool.id" :to="tool.to" class="media-nav-item" active-class="active">
      <svg v-if="tool.icon === 'convert'" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M2 5h9l-2.5-2.5M14 11H5l2.5 2.5"/></svg>
      <svg v-else-if="tool.icon === 'edit'" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M11.5 1.5l3 3L5 14H2v-3z"/></svg>
      <svg v-else-if="tool.icon === 'subtitle'" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3.5" width="12" height="9" rx="1.5"/><line x1="4.5" y1="9.5" x2="8" y2="9.5"/><line x1="9.5" y1="9.5" x2="11.5" y2="9.5"/></svg>
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
