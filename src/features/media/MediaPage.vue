<script setup>
// Generic page for all /media/* audio CONVERTER + EDITOR routes. Wrapped in MediaShell (shared
// sub-nav + persistent mini-player). The sr-only <h1> + the sub-nav live OUTSIDE <ClientOnly> so
// they are present in the SSG-prerendered HTML for SEO; the interactive body (which touches ffmpeg/
// Blob/window) renders only after client mount. MediaConverter reads the route to pick its initial
// tab (/media/edit → Edit) and ingests any file handed off from the player.
import { useRouteHead } from '../../composables/useRouteHead'
import ClientOnly from '../../components/ClientOnly.vue'
import MediaShell from './MediaShell.vue'
import MediaToolNav from './MediaToolNav.vue'
import MediaConverter from './MediaConverter.vue'

const { meta: m } = useRouteHead()
</script>

<template>
  <MediaShell>
    <div class="route-page">
      <h1 class="sr-only">{{ m.h1 }}</h1>
      <div class="media-navwrap"><MediaToolNav /></div>
      <ClientOnly>
        <main class="media-converter-wrap">
          <MediaConverter />
        </main>
      </ClientOnly>
    </div>
  </MediaShell>
</template>

<style scoped>
/* Same structural pattern as TranscribePage / SubtitlePage: route-page is a flex column with
   min-height:0; nav sits at the top (fixed height, never scrolled away); the content area below
   scrolls independently. This prevents a tall video preview from (a) pushing the nav off-screen
   or (b) growing the page beyond the viewport with no way to scroll. */
.route-page { flex: 1; display: flex; flex-direction: column; min-height: 0; }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }
.media-navwrap { max-width: var(--page-wide); margin: 0 auto; width: 100%; padding: 22px 24px 0; flex-shrink: 0; }
.media-converter-wrap { flex: 1; min-height: 0; overflow-y: auto; max-width: var(--page-wide); margin: 0 auto; width: 100%; padding: 20px 24px 48px; }
@media (max-width: 768px) {
  .media-navwrap { padding: 16px 16px 0; }
  .media-converter-wrap { padding: 20px 16px 56px; }
}
</style>
