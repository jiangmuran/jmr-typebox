<script setup>
// Sub-tool switcher shown on every image page so all four tools are reachable
// (the image tab used to expose only "compress").
import { ref, onMounted, nextTick } from 'vue'
import { useI18n } from '../../composables/useI18n'
const { t } = useI18n()
const TOOLS = [
  { id: 'compress', to: '/image/compress' },
  { id: 'convert', to: '/image/convert' },
  { id: 'watermark', to: '/image/watermark' },
  { id: 'edit', to: '/image/edit' },
  { id: 'compose', to: '/image/compose' },
  { id: 'metadata', to: '/image/metadata' },
]

// On phones the bar scrolls horizontally; make sure the ACTIVE tab is visible on load
// (otherwise the current tool — often the last one — sits clipped past the right edge).
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
  <nav ref="navEl" class="img-nav">
    <router-link v-for="tool in TOOLS" :key="tool.id" :to="tool.to" class="img-nav-item" active-class="active" @click="$nextTick(revealActive)">
      {{ t('img2.nav.' + tool.id) }}
    </router-link>
  </nav>
</template>

<!-- Styles (.img-nav / .img-nav-item) are provided by the global tool-kit. -->

