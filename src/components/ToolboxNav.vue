<script setup>
// Sub-tool switcher shown on every toolbox page so all tools are reachable by tapping
// (previously they were only findable via ⌘K or a direct URL). Mirrors ImageToolNav/MediaToolNav:
// horizontal, scroll-safe, and reveals the active tool on load. Styles reuse the global .img-nav kit.
import { ref, onMounted, nextTick } from 'vue'
import { useI18n } from '../composables/useI18n'
const { t } = useI18n()
const TOOLS = [
  { id: 'base64', to: '/tools/base64' },
  { id: 'aes', to: '/tools/aes' },
  { id: 'rsa', to: '/tools/rsa' },
  { id: 'hash', to: '/tools/hash' },
  { id: 'json', to: '/tools/json' },
  { id: 'jwt', to: '/tools/jwt' },
  { id: 'totp', to: '/tools/totp' },
  { id: 'qr', to: '/tools/qr' },
  { id: 'word-count', to: '/tools/word-count' },
]
const navEl = ref(null)
function revealActive() {
  const nav = navEl.value
  if (!nav) return
  const active = nav.querySelector('.active')
  if (active && nav.scrollWidth > nav.clientWidth) active.scrollIntoView({ block: 'nearest', inline: 'nearest' })
}
onMounted(() => nextTick(revealActive))
</script>

<template>
  <nav ref="navEl" class="img-nav toolbox-nav">
    <router-link v-for="tool in TOOLS" :key="tool.id" :to="tool.to" class="img-nav-item" active-class="active" @click="$nextTick(revealActive)">
      {{ t('toolnav.' + tool.id) }}
    </router-link>
  </nav>
</template>

<style scoped>
.toolbox-nav { margin-bottom: 18px; }
</style>
