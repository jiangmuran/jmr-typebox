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
      <MediaToolNav />
      <ClientOnly><MediaConverter /></ClientOnly>
    </div>
  </MediaShell>
</template>

<style scoped>
.route-page { flex: 1; max-width: var(--page-wide); margin: 0 auto; width: 100%; padding: 22px 24px 28px; }
@media (max-width: 768px) { .route-page { padding: 16px 16px 22px; } }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }
</style>
