<script setup>
// The audio HUB layout. Wraps every /media/* page with the shared sub-tool nav (Convert · Edit ·
// Subtitles · Player) and the persistent bottom mini-player, so the four tools feel like one suite
// and playback continues across them. Page content goes in the default slot.
//
// SSG-SAFETY: the mini-player + store init are gated behind <ClientOnly> (they touch Audio/
// IndexedDB). The store is a singleton, so init() is idempotent — every media page mounting this
// shell ensures the player is hydrated once. Each PAGE renders its own <MediaToolNav> at the top of
// its centered container so the nav aligns with that page's width; the shell only frames the
// scroll region + the persistent mini-player below it.
import { onMounted } from 'vue'
import ClientOnly from '../../components/ClientOnly.vue'
import MiniPlayer from './MiniPlayer.vue'
import { usePlayerStore } from './usePlayerStore'

const store = usePlayerStore()
onMounted(() => { store.init() })
</script>

<template>
  <div class="media-shell">
    <div class="media-shell-scroll">
      <slot />
    </div>
    <ClientOnly><MiniPlayer /></ClientOnly>
  </div>
</template>

<style scoped>
.media-shell { flex: 1; display: flex; flex-direction: column; min-height: 0; }
.media-shell-scroll { flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; }
</style>
