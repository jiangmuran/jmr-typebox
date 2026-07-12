<!-- src/features/image/VerifyPage.vue -->
<script setup>
// Public landing page for a registered watermark id (/w/:id). Its entire audience is
// strangers who decoded a link out of somebody's image — so it explains what they're
// looking at, shows the record, and offers the reader tool as the next step.
import { ref, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from '../../composables/useI18n'
import { resolveWatermark } from './watermarkApi'
import { SERVICE } from './invisibleWatermark'

const route = useRoute()
const { t, locale } = useI18n()
const state = ref('loading')   // 'loading' | 'found' | 'missing'
const record = ref(null)
const id = String(route.params.id || '')

function fmtTime(sec) { try { return new Date(sec * 1000).toLocaleString(locale.value) } catch { return String(sec) } }

onMounted(async () => {
  try {
    const r = await resolveWatermark(id)
    if (r) { record.value = r; state.value = 'found' } else { state.value = 'missing' }
  } catch { state.value = 'missing' }
})
</script>

<template>
  <div class="verify-page">
    <div class="verify-wrap">
      <div class="v-mark">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2.5S5.5 10 5.5 14.5a6.5 6.5 0 0 0 13 0C18.5 10 12 2.5 12 2.5z"/></svg>
      </div>
      <h1>{{ t('img2.verify.title') }}</h1>
      <p class="v-intro">{{ t('img2.verify.intro') }}</p>

      <p v-if="state === 'loading'" class="v-loading">{{ t('img2.verify.loading') }}</p>

      <div v-else-if="state === 'found'" class="card info-card">
        <div class="info-row"><span class="k">{{ t('img2.verify.fldId') }}</span><span class="v mono">#{{ id }}</span></div>
        <div class="info-row"><span class="k">{{ t('img2.inv.fldContent') }}</span><span class="v mono">{{ record.content || '—' }}</span></div>
        <div class="info-row"><span class="k">{{ t('img2.inv.fldTime') }}</span><span class="v">{{ fmtTime(record.timestamp) }}</span></div>
        <div class="info-row"><span class="k">{{ t('img2.inv.fldService') }}</span><span class="v mono">{{ SERVICE }}</span></div>
        <div class="info-row"><span class="k">{{ t('img2.inv.fldVersion') }}</span><span class="v">v{{ record.version }}</span></div>
        <p class="hint ok-hint">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="6.5"/><path d="M5.2 8.3l2 2 3.6-4.2"/></svg>
          {{ t('img2.verify.service') }}
        </p>
      </div>

      <div v-else class="card empty">
        <p class="empty-title">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><circle cx="7" cy="7" r="4.5"/><line x1="10.5" y1="10.5" x2="14" y2="14"/></svg>
          {{ t('img2.verify.notFound') }}
        </p>
        <p class="empty-desc">{{ t('img2.verify.notFoundDesc') }}</p>
      </div>

      <div class="v-cta card">
        <p class="hint">{{ t('img2.verify.ctaHint') }}</p>
        <router-link class="btn primary" to="/image/invisible">{{ t('img2.verify.cta') }}</router-link>
      </div>
    </div>
  </div>
</template>

<style scoped>
.verify-page { flex: 1; overflow-y: auto; }
.verify-wrap { max-width: 560px; margin: 0 auto; padding: 40px 16px 56px; display: flex; flex-direction: column; gap: 14px; }
.v-mark { display: flex; justify-content: center; color: var(--text-secondary); }
.v-mark svg { width: 36px; height: 36px; }
.ok-hint { display: inline-flex; align-items: center; gap: 5px; }
.ok-hint svg { width: 13px; height: 13px; color: var(--status-ok); flex-shrink: 0; }
.empty-title svg { width: 14px; height: 14px; vertical-align: -2px; margin-right: 4px; }
h1 { font-size: 24px; font-weight: 750; letter-spacing: -0.5px; text-align: center; }
.v-intro { color: var(--text-secondary); font-size: 13px; line-height: 1.6; text-align: center; margin-bottom: 6px; }
.v-loading { color: var(--text-tertiary); text-align: center; padding: 16px; }
.info-card { display: flex; flex-direction: column; gap: 8px; }
.info-row { display: flex; justify-content: space-between; gap: 16px; }
.info-row .k { color: var(--text-tertiary); }
.info-row .v { word-break: break-word; text-align: right; }
.info-row .v.mono { font-family: var(--font-mono); }
.empty { text-align: center; padding: 24px; }
.empty-title { font-weight: 600; }
.empty-desc { margin-top: 6px; color: var(--text-tertiary); font-size: 12.5px; }
.hint { color: var(--text-tertiary); font-size: 12px; line-height: 1.5; }
.v-cta { display: flex; flex-direction: column; gap: 10px; align-items: flex-start; }
.v-cta .btn { text-decoration: none; }
@media (max-width: 768px) { .info-row { flex-direction: column; gap: 2px; } .info-row .v { text-align: left; } }
</style>
