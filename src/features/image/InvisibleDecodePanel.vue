<script setup>
// Read side of the invisible-watermark tool. Shows which file was analyzed (thumb + name)
// alongside the decoded record; registered records (flags bit 0) are resolved server-side.
import { ref, onUnmounted } from 'vue'
import { useI18n } from '../../composables/useI18n'
import ImageDropZone from './ImageDropZone.vue'
import { pickImageFiles, imageFilesFromEvent } from './canvasUtils'
import { decodeImageBlob } from './invisibleWatermarkCanvas'
import { SERVICE } from './invisibleWatermark'
import { resolveWatermark } from './watermarkApi'

const { t, locale } = useI18n()

const decoding = ref(false)
const result = ref(null)     // { ok, content, timestamp, version, confidence, flags } | { ok:false } | null
const resolved = ref(null)   // { content, timestamp, version } from the server, when registered
const verifyId = ref('')
const dragOver = ref(false)
const srcUrl = ref('')       // preview of the analyzed image
const srcName = ref('')

async function read(blob) {
  if (!blob) return
  decoding.value = true; result.value = null; resolved.value = null; verifyId.value = ''
  if (srcUrl.value) URL.revokeObjectURL(srcUrl.value)
  srcUrl.value = URL.createObjectURL(blob)
  srcName.value = blob.name || ''
  try {
    result.value = await decodeImageBlob(blob)
    // Registered records embed the server id, not the raw text — resolve it to the full stored
    // content and a verify-page link. A backend miss/failure just leaves resolved null.
    if (result.value?.ok && (result.value.flags & 1)) {
      verifyId.value = result.value.content
      try { resolved.value = await resolveWatermark(verifyId.value) } catch { resolved.value = null }
    }
  } catch { result.value = { ok: false } }
  finally { decoding.value = false }
}
async function pick() { const f = await pickImageFiles({ multiple: false }); if (f[0]) read(f[0]) }
function onDrop(e) { dragOver.value = false; const f = imageFilesFromEvent(e); if (f[0]) read(f[0]) }
function fmtTime(sec) { try { return new Date(sec * 1000).toLocaleString(locale.value) } catch { return String(sec) } }

onUnmounted(() => { if (srcUrl.value) URL.revokeObjectURL(srcUrl.value) })
defineExpose({ read })
</script>

<template>
  <ImageDropZone
    :title="t('img2.inv.decDrop')" :hint="t('img2.browse')" :drag-over="dragOver"
    @pick="pick" @drop="onDrop"
    @dragover="e => { e.preventDefault(); dragOver = true }" @dragleave="dragOver = false"
  />
  <div v-if="decoding" class="ctrl">{{ t('img2.inv.generating') }}</div>
  <template v-else-if="result">
    <div class="card src-card">
      <img :src="srcUrl" class="thumb" alt="" />
      <span class="mono src-name">{{ srcName || '—' }}</span>
    </div>
    <div v-if="result.ok" class="card info-card">
      <div class="info-row">
        <span class="k">{{ t('img2.inv.fldContent') }}</span>
        <span class="v mono">{{ (result.flags & 1) ? (resolved ? resolved.content : ('#' + verifyId)) : (result.content || '—') }}</span>
      </div>
      <div v-if="result.flags & 1" class="info-row">
        <span class="k">{{ t('img2.inv.fldService') }}</span>
        <span class="v">
          <template v-if="resolved">
            {{ t('img2.inv.registered') }} · <router-link :to="'/w/' + verifyId">{{ t('img2.inv.viewVerify') }}</router-link>
          </template>
          <template v-else>{{ t('img2.inv.regNotFound') }}</template>
        </span>
      </div>
      <div class="info-row"><span class="k">{{ t('img2.inv.fldTime') }}</span><span class="v">{{ fmtTime(result.timestamp) }}</span></div>
      <div v-if="!(result.flags & 1)" class="info-row"><span class="k">{{ t('img2.inv.fldService') }}</span><span class="v mono">{{ SERVICE }}</span></div>
      <div class="info-row"><span class="k">{{ t('img2.inv.fldVersion') }}</span><span class="v">v{{ result.version }}</span></div>
      <div class="info-row"><span class="k">{{ t('img2.inv.fldConfidence') }}</span><span class="v">{{ Math.round(result.confidence * 100) }}%</span></div>
    </div>
    <div v-else class="card empty">{{ t('img2.inv.decNone') }}</div>
  </template>
</template>

<style scoped>
.src-card { display: flex; align-items: center; gap: 10px; padding: 10px 14px; margin-bottom: 10px; }
.src-card .thumb { width: 40px; height: 40px; object-fit: cover; border-radius: 6px; background: var(--code-bg); }
.src-name { font-family: var(--font-mono); font-size: 12.5px; color: var(--text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.info-card { display: flex; flex-direction: column; gap: 8px; }
.info-row { display: flex; justify-content: space-between; gap: 16px; }
.info-row .k { color: var(--text-tertiary); }
.info-row .v.mono { font-family: var(--font-mono); }
.empty { color: var(--text-tertiary); text-align: center; padding: 24px; }
@media (max-width: 768px) { .info-row { flex-direction: column; gap: 2px; } }
</style>
