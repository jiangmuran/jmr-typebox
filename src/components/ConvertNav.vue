<script setup>
// Sub-tool switcher for the document converters, so every /convert/* page links to its
// siblings by tapping (previously they were dead ends — only findable via ⌘K or a direct
// URL). Mirrors ToolboxNav/ImageToolNav; styles reuse the global .img-nav kit.
import { ref, onMounted, nextTick } from 'vue'
import { useI18n } from '../composables/useI18n'
const { t } = useI18n()
const TOOLS = [
  { id: 'markdown-to-pdf', to: '/convert/markdown-to-pdf' },
  { id: 'markdown-to-docx', to: '/convert/markdown-to-docx' },
  { id: 'markdown-to-html', to: '/convert/markdown-to-html' },
  { id: 'pdf-to-markdown', to: '/convert/pdf-to-markdown' },
  { id: 'pdf-to-word', to: '/convert/pdf-to-word' },
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
  <nav ref="navEl" class="img-nav convert-nav">
    <router-link v-for="tool in TOOLS" :key="tool.id" :to="tool.to" class="img-nav-item" active-class="active" @click="$nextTick(revealActive)">
      {{ t('convertnav.' + tool.id) }}
    </router-link>
  </nav>
</template>

<style scoped>
.convert-nav { margin-bottom: 18px; }
</style>
