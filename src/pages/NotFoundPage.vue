<script setup>
// Catch-all 404. Unknown paths used to render an empty shell (nav bar over a blank page);
// this gives them a real destination with a way back.
import { useRoute } from 'vue-router'
import { useI18n } from '../composables/useI18n'

const route = useRoute()
const { t } = useI18n()
</script>

<template>
  <div class="nf-page">
    <div class="nf-wrap">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="10.5" cy="10.5" r="6.5"/><line x1="15.5" y1="15.5" x2="21" y2="21"/><line x1="8" y1="10.5" x2="13" y2="10.5"/></svg>
      <h1>{{ t('nf.title') }}</h1>
      <p class="nf-path mono">{{ route.fullPath }}</p>
      <p class="nf-desc">{{ t('nf.desc') }}</p>
      <router-link class="btn primary" to="/">{{ t('nf.home') }}</router-link>
    </div>
  </div>
</template>

<style scoped>
.nf-page { flex: 1; overflow-y: auto; display: flex; }
.nf-wrap { margin: auto; padding: 40px 24px; text-align: center; display: flex; flex-direction: column; align-items: center; gap: 10px; max-width: 480px; }
.nf-wrap svg { width: 40px; height: 40px; color: var(--text-tertiary); }
h1 { font-size: 24px; font-weight: 750; letter-spacing: -0.5px; }
.nf-path { font-family: var(--font-mono); font-size: 12.5px; color: var(--text-tertiary); word-break: break-all; }
.nf-desc { color: var(--text-secondary); font-size: 13px; line-height: 1.6; }
.nf-wrap .btn { margin-top: 8px; text-decoration: none; }
</style>
