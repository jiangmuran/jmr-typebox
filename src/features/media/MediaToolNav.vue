<script setup>
// Sub-tool switcher shown across every audio/video page so the seven tools form one coherent hub.
// Organized (不要乱) into small labelled groups rather than a flat wall of tabs:
//   Transform  → Convert · Compress      (change format / shrink)
//   Produce    → Edit · Subtitles · Transcribe   (modify / generate from)
//   Inspect    → Metadata · Player       (read tags / play)
// On phones the bar scrolls horizontally; the active tab is scrolled into view on load so the
// current tool (often a later one) is never clipped past the right edge. The Player route owns the
// local file library; all tools share the in-memory pool + persistent mini-player.
import { ref, onMounted, nextTick } from 'vue'
import { useI18n } from '../../composables/useI18n'
const { t } = useI18n()

// Each group renders its tools together with a thin separator + a tiny group label between groups.
const GROUPS = [
  { id: 'transform', tools: [
    { id: 'convert', to: '/media/convert', icon: 'convert' },
    { id: 'compress', to: '/media/compress', icon: 'compress' },
  ] },
  { id: 'produce', tools: [
    { id: 'edit', to: '/media/edit', icon: 'edit' },
    { id: 'subtitles', to: '/media/subtitles', icon: 'subtitle' },
    { id: 'transcribe', to: '/media/transcribe', icon: 'transcribe' },
  ] },
  { id: 'inspect', tools: [
    { id: 'metadata', to: '/media/metadata', icon: 'metadata' },
    { id: 'player', to: '/media/player', icon: 'player' },
  ] },
]

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
  <nav ref="navEl" class="media-nav" aria-label="Audio & video tools">
    <template v-for="(group, gi) in GROUPS" :key="group.id">
      <span v-if="gi > 0" class="media-nav-sep" aria-hidden="true"></span>
      <router-link
        v-for="tool in group.tools"
        :key="tool.id"
        :to="tool.to"
        class="media-nav-item"
        active-class="active"
        :title="t('media.nav.' + tool.id)"
        @click="$nextTick(revealActive)"
      >
        <svg v-if="tool.icon === 'convert'" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M2 5h9l-2.5-2.5M14 11H5l2.5 2.5"/></svg>
        <svg v-else-if="tool.icon === 'compress'" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6V2.5M4 2.5H7.5M4 2.5L7 5.5"/><path d="M12 10v3.5M12 13.5H8.5M12 13.5L9 10.5"/></svg>
        <svg v-else-if="tool.icon === 'edit'" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M11.5 1.5l3 3L5 14H2v-3z"/></svg>
        <svg v-else-if="tool.icon === 'subtitle'" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3.5" width="12" height="9" rx="1.5"/><line x1="4.5" y1="9.5" x2="8" y2="9.5"/><line x1="9.5" y1="9.5" x2="11.5" y2="9.5"/></svg>
        <svg v-else-if="tool.icon === 'transcribe'" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="1.5" width="4" height="8" rx="2"/><path d="M3.5 7.5a4.5 4.5 0 009 0"/><line x1="8" y1="12" x2="8" y2="14.5"/><line x1="5.5" y1="14.5" x2="10.5" y2="14.5"/></svg>
        <svg v-else-if="tool.icon === 'metadata'" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M8.2 2H3.5A1.5 1.5 0 002 3.5v4.7a1 1 0 00.3.7l5.3 5.3a1 1 0 001.4 0l4.7-4.7a1 1 0 000-1.4L8.9 2.3A1 1 0 008.2 2z"/><circle cx="5.3" cy="5.3" r="0.9" fill="currentColor" stroke="none"/></svg>
        <svg v-else viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M6 12V3.5l7-1.3V10"/><circle cx="4.3" cy="12" r="1.7"/><circle cx="11.3" cy="10" r="1.7"/></svg>
        <span>{{ t('media.nav.' + tool.id) }}</span>
      </router-link>
    </template>
  </nav>
</template>

<style scoped>
.media-nav { display: flex; align-items: stretch; gap: 3px; margin-bottom: 18px; background: var(--surface-hover); padding: 3px; border-radius: 10px; overflow-x: auto; scrollbar-width: none; }
.media-nav::-webkit-scrollbar { display: none; }
/* Thin separator marks the boundary between tool groups (Transform · Produce · Inspect). */
.media-nav-sep { flex: 0 0 1px; align-self: center; width: 1px; height: 18px; background: var(--border); margin: 0 4px; }
.media-nav-item { flex: 1 0 auto; display: inline-flex; align-items: center; justify-content: center; gap: 6px; white-space: nowrap; padding: 8px 13px; border-radius: 6px; font-size: 12.5px; font-weight: 500; color: var(--text-secondary); text-decoration: none; transition: all 0.15s; }
.media-nav-item svg { width: 14px; height: 14px; flex-shrink: 0; }
.media-nav-item:hover { color: var(--text); }
.media-nav-item.active { background: var(--surface); color: var(--text); box-shadow: var(--shadow-xs); }
.media-nav-item.active svg { color: var(--accent); }
@media (max-width: 768px) {
  .media-nav { margin-bottom: 14px; }
  .media-nav-item { padding: 10px 12px; font-size: 12.5px; }
}
/* Narrow phones (360–414px): icon-forward, labels hide to prevent overflow; the active label
   stays visible so the current tool is always named, and active-into-view scroll handles the rest. */
@media (max-width: 480px) {
  .media-nav-item { gap: 0; padding: 9px 11px; }
  .media-nav-item span { display: none; }
  .media-nav-item.active { gap: 6px; }
  .media-nav-item.active span { display: inline; }
  .media-nav-sep { margin: 0 2px; }
}
</style>
