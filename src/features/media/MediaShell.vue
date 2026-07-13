<script setup>
// The audio HUB layout. Wraps every /media/* page with the shared sub-tool nav (Convert · Edit ·
// Subtitles · Player), so the four tools feel like one suite and playback continues across them.
// Page content goes in the default slot.
//
// SSG-SAFETY: the store init is gated behind onMounted (client-only; it touches Audio/IndexedDB).
// The store is a singleton, so init() is idempotent — every media page mounting this shell ensures
// the player is hydrated once. Each PAGE renders its own <MediaToolNav> at the top of its centered
// container so the nav aligns with that page's width; the shell only frames the scroll region.
//
// The persistent mini-player is NOT rendered here — it lives in AppShell so playback stays
// controllable from ANY page (not just /media/*), and so it renders exactly once.
import { onMounted } from 'vue'
import { usePlayerStore } from './usePlayerStore'

const store = usePlayerStore()
onMounted(() => { store.init() })
</script>

<template>
  <div class="media-shell">
    <div class="media-shell-scroll">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.media-shell { flex: 1; display: flex; flex-direction: column; min-height: 0; }
.media-shell-scroll { flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; }
</style>
