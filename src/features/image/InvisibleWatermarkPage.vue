<script setup>
import { ref } from 'vue'
import { useRouteHead } from '../../composables/useRouteHead'
import { useI18n } from '../../composables/useI18n'
import { useToast } from '../../composables/useToast'
import ImageShell from './ImageShell.vue'
import ImageDropZone from './ImageDropZone.vue'
import { pickImageFiles, imageFilesFromEvent } from './canvasUtils'
import { decodeImageBlob } from './invisibleWatermarkCanvas'
import { SERVICE } from './invisibleWatermark'

const { meta: m } = useRouteHead()
const { t, locale } = useI18n()
const { showToast } = useToast()

const mode = ref('embed')          // 'embed' | 'decode'

// ---- Decode ----
const decoding = ref(false)
const result = ref(null)           // { ok, content, timestamp, version, confidence } | { ok:false } | null
const dragOver = ref(false)

async function readBlob(blob) {
  if (!blob) return
  decoding.value = true; result.value = null
  try { result.value = await decodeImageBlob(blob) }
  catch { result.value = { ok: false } }
  finally { decoding.value = false }
}
async function pickDecode() { const f = await pickImageFiles({ multiple: false }); if (f[0]) readBlob(f[0]) }
function onDropDecode(e) { dragOver.value = false; const f = imageFilesFromEvent(e); if (f[0]) readBlob(f[0]) }
function fmtTime(sec) { try { return new Date(sec * 1000).toLocaleString(locale.value) } catch { return String(sec) } }
</script>

<template>
  <ImageShell wide :h1="m.h1" :title="t('img2.inv.title')" :sub="t('img2.inv.sub')">
    <div class="seg mode-seg">
      <button :class="{ on: mode === 'embed' }" @click="mode = 'embed'">{{ t('img2.inv.tabEmbed') }}</button>
      <button :class="{ on: mode === 'decode' }" @click="mode = 'decode'">{{ t('img2.inv.tabDecode') }}</button>
    </div>

    <template v-if="mode === 'decode'">
      <ImageDropZone
        :title="t('img2.inv.decDrop')" :hint="t('img2.browse')" :drag-over="dragOver"
        @pick="pickDecode" @drop="onDropDecode"
        @dragover="e => { e.preventDefault(); dragOver = true }" @dragleave="dragOver = false"
      />
      <div v-if="decoding" class="ctrl">{{ t('img2.inv.generating') }}</div>
      <div v-else-if="result && result.ok" class="card info-card">
        <div class="info-row"><span class="k">{{ t('img2.inv.fldContent') }}</span><span class="v mono">{{ result.content || '—' }}</span></div>
        <div class="info-row"><span class="k">{{ t('img2.inv.fldTime') }}</span><span class="v">{{ fmtTime(result.timestamp) }}</span></div>
        <div class="info-row"><span class="k">{{ t('img2.inv.fldService') }}</span><span class="v mono">{{ SERVICE }}</span></div>
        <div class="info-row"><span class="k">{{ t('img2.inv.fldVersion') }}</span><span class="v">v{{ result.version }}</span></div>
        <div class="info-row"><span class="k">{{ t('img2.inv.fldConfidence') }}</span><span class="v">{{ Math.round(result.confidence * 100) }}%</span></div>
      </div>
      <div v-else-if="result" class="card empty">{{ t('img2.inv.decNone') }}</div>
    </template>

    <template v-else>
      <!-- Embed panel implemented in Task 10 -->
    </template>
  </ImageShell>
</template>

<style scoped>
.mode-seg { margin-bottom: 16px; max-width: 320px; }
.info-card { display: flex; flex-direction: column; gap: 8px; }
.info-row { display: flex; justify-content: space-between; gap: 16px; }
.info-row .k { color: var(--muted, #888); }
.info-row .v.mono { font-family: var(--font-mono); }
.empty { color: var(--muted, #888); text-align: center; padding: 24px; }
</style>
