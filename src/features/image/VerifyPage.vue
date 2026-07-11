<!-- src/features/image/VerifyPage.vue -->
<script setup>
import { ref, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from '../../composables/useI18n'
import { resolveWatermark } from './watermarkApi'
import { SERVICE } from './invisibleWatermark'

const route = useRoute()
const { t, locale } = useI18n()
const state = ref('loading')   // 'loading' | 'found' | 'missing'
const record = ref(null)

function fmtTime(sec) { try { return new Date(sec * 1000).toLocaleString(locale.value) } catch { return String(sec) } }

onMounted(async () => {
  try {
    const r = await resolveWatermark(String(route.params.id))
    if (r) { record.value = r; state.value = 'found' } else { state.value = 'missing' }
  } catch { state.value = 'missing' }
})
</script>

<template>
  <div class="verify-wrap">
    <h1>{{ t('img2.verify.title') }}</h1>
    <p v-if="state === 'loading'" class="ctrl">{{ t('img2.verify.loading') }}</p>
    <div v-else-if="state === 'found'" class="card info-card">
      <div class="info-row"><span class="k">{{ t('img2.inv.fldContent') }}</span><span class="v mono">{{ record.content || '—' }}</span></div>
      <div class="info-row"><span class="k">{{ t('img2.inv.fldTime') }}</span><span class="v">{{ fmtTime(record.timestamp) }}</span></div>
      <div class="info-row"><span class="k">{{ t('img2.inv.fldService') }}</span><span class="v mono">{{ SERVICE }}</span></div>
      <div class="info-row"><span class="k">{{ t('img2.inv.fldVersion') }}</span><span class="v">v{{ record.version }}</span></div>
      <p class="hint">{{ t('img2.verify.service') }}</p>
    </div>
    <div v-else class="card empty">{{ t('img2.verify.notFound') }}</div>
  </div>
</template>

<style scoped>
.verify-wrap { max-width: 560px; margin: 0 auto; padding: 24px 16px; }
.info-card { display: flex; flex-direction: column; gap: 8px; }
.info-row { display: flex; justify-content: space-between; gap: 16px; }
.info-row .k { color: var(--text-tertiary); }
.info-row .v.mono { font-family: var(--font-mono); }
.empty { color: var(--text-tertiary); text-align: center; padding: 24px; }
@media (max-width: 768px) { .info-row { flex-direction: column; gap: 2px; } }
</style>
