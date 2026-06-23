<script setup>
// Sub-tool switcher shown on every image page so all four tools are reachable
// (the image tab used to expose only "compress").
import { useI18n } from '../../composables/useI18n'
const { t } = useI18n()
const TOOLS = [
  { id: 'compress', to: '/image/compress' },
  { id: 'convert', to: '/image/convert' },
  { id: 'watermark', to: '/image/watermark' },
  { id: 'edit', to: '/image/edit' },
]
</script>

<template>
  <nav class="img-nav">
    <router-link v-for="tool in TOOLS" :key="tool.id" :to="tool.to" class="img-nav-item" active-class="active">
      {{ t('img2.nav.' + tool.id) }}
    </router-link>
  </nav>
</template>

<style scoped>
.img-nav { display: flex; gap: 3px; margin-bottom: 18px; background: var(--surface-hover); padding: 3px; border-radius: 10px; overflow-x: auto; scrollbar-width: none; }
.img-nav::-webkit-scrollbar { display: none; }
.img-nav-item { flex: 1; text-align: center; white-space: nowrap; padding: 8px 12px; border-radius: 7px; font-size: 12.5px; font-weight: 500; color: var(--text-secondary); text-decoration: none; transition: all 0.15s; }
.img-nav-item:hover { color: var(--text); }
.img-nav-item.active { background: var(--surface); color: var(--text); box-shadow: var(--shadow-xs); }
@media (max-width: 768px) {
  .img-nav { margin-bottom: 14px; }
  .img-nav-item { padding: 10px 14px; font-size: 13px; }
}
</style>
