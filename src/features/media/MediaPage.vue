<script setup>
// Generic page for all /media/* audio routes. The active conversion is derived from the
// route inside MediaConverter. The sr-only <h1> lives OUTSIDE <ClientOnly> so it is present
// in the SSG-prerendered HTML for SEO; the interactive body (which touches ffmpeg/Blob/
// window) renders only after client mount.
import { useRouteHead } from '../../composables/useRouteHead'
import { useI18n } from '../../composables/useI18n'
import ClientOnly from '../../components/ClientOnly.vue'
import MediaConverter from './MediaConverter.vue'

const { meta: m } = useRouteHead()
const { t } = useI18n()
</script>

<template>
  <div class="route-page">
    <h1 class="sr-only">{{ m.h1 }}</h1>
    <ClientOnly><MediaConverter /></ClientOnly>
  </div>
</template>

<style scoped>
.route-page { flex: 1; display: flex; flex-direction: column; min-height: 0; overflow: auto; }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }
</style>
