<script setup>
import { ref, computed, onUnmounted } from 'vue'
import JSZip from 'jszip'
import { useRouteHead } from '../../composables/useRouteHead'
import { useI18n } from '../../composables/useI18n'
import { useToast } from '../../composables/useToast'
import ImageShell from './ImageShell.vue'
import ImageDropZone from './ImageDropZone.vue'
import SendToMenu from '../../components/SendToMenu.vue'
import { pickImageFiles, imageFilesFromEvent, downloadBlob } from './canvasUtils'
import { decodeImageBlob, embedImageBlob } from './invisibleWatermarkCanvas'
import { SERVICE, makeJob, duplicateJobs, jobFileName, fitContent, contentByteLength, CONTENT_MAX, FORMAT_VERSION } from './invisibleWatermark'
import { registerRecords } from './watermarkApi'

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

// ---- Embed ----
const jobs = ref([])               // { id, source:File, content, status, url?, blob?, name }
const uniform = ref('')
const dupCount = ref(3)
const generating = ref(false)
const embedDragOver = ref(false)
const lastSingleBlob = ref(null)

// When on, content is registered server-side and the returned id (not the raw text) is embedded,
// which lifts the 16-byte offline cap. CONTENT_MAX_BYTES is a sane client-side guard only.
const registerOn = ref(false)
const CONTENT_MAX_BYTES = 2048

// 16-byte cap; contentByteLength counts UTF-8 bytes so CJK (~3 bytes/char) shrinks the meter faster.
// Meaningful offline only — with registerOn the cap is lifted, so the meter is hidden.
const bytesLeft = computed(() => CONTENT_MAX - contentByteLength(uniform.value))
function onUniformInput() { if (!registerOn.value) uniform.value = fitContent(uniform.value, CONTENT_MAX) }

function addFiles(files) {
  lastSingleBlob.value = null                        // a new drop invalidates any prior single result
  for (const f of files) jobs.value.push({ ...makeJob(f, uniform.value), name: f.name })
}
async function pickEmbed() { addFiles(await pickImageFiles({ multiple: true })) }
function onDropEmbed(e) { embedDragOver.value = false; addFiles(imageFilesFromEvent(e)) }
function removeJob(id) {
  const job = jobs.value.find(j => j.id === id)
  if (job?.url) URL.revokeObjectURL(job.url)          // free the row's object URL before dropping it
  lastSingleBlob.value = null                         // dropping a row invalidates any prior single result
  jobs.value = jobs.value.filter(j => j.id !== id)
}
function makeVersions(job) {
  const dups = duplicateJobs({ ...job, content: job.content || uniform.value }, Math.min(50, Math.max(2, dupCount.value)))
    .map(d => ({ ...d, source: job.source, name: job.name }))
  const i = jobs.value.findIndex(j => j.id === job.id)
  if (job.url) URL.revokeObjectURL(job.url)           // the source row is replaced; free its object URL
  lastSingleBlob.value = null                         // versioning invalidates any prior single result
  jobs.value.splice(i, 1, ...dups)
}

async function generate() {
  if (!jobs.value.length) return
  generating.value = true
  const stamp = Math.floor(Date.now() / 1000)   // one "now" for the whole batch
  try {
    // Register mode: batch-register every job's content up-front, then embed the returned
    // ids (flags:1) instead of the raw text — one bad backend response aborts before any embed.
    let ids = null
    if (registerOn.value) {
      const records = jobs.value.map(j => ({ content: j.content || uniform.value, timestamp: stamp, version: FORMAT_VERSION }))
      if (records.some(r => contentByteLength(r.content) > CONTENT_MAX_BYTES)) { showToast(t('img2.inv.registerFailed')); return }
      try { ids = await registerRecords(records) }
      catch { showToast(t('img2.inv.registerFailed')); return }
    }
    for (let i = 0; i < jobs.value.length; i++) {
      const job = jobs.value[i]
      // Per-job try/catch: one bad image (e.g. too small for a pass) must not abort the batch.
      try {
        job.status = 'working'
        const blob = registerOn.value
          ? await embedImageBlob(job.source, { content: ids[i], timestamp: stamp, flags: 1 })
          : await embedImageBlob(job.source, { content: fitContent(job.content || uniform.value, CONTENT_MAX), timestamp: stamp })
        if (job.url) URL.revokeObjectURL(job.url)   // free the prior result URL before replacing it
        job.blob = blob
        job.url = URL.createObjectURL(blob)
        job.status = 'done'
      } catch (err) {
        job.status = 'error'
        showToast(/too small/i.test(err?.message || '') ? t('img2.inv.tooSmall') : t('img2.unsupported'))
      }
    }
    lastSingleBlob.value = jobs.value.length === 1 && jobs.value[0].blob ? jobs.value[0].blob : null
  } finally { generating.value = false }
}

async function downloadZip() {
  const zip = new JSZip()
  jobs.value.forEach((job, i) => { if (job.blob) zip.file(jobFileName(job.name, fitContent(job.content || uniform.value), i), job.blob) })
  const out = await zip.generateAsync({ type: 'blob' })
  downloadBlob(out, 'invisible-watermark.zip')
}
function downloadOne(job, i) { if (job.blob) downloadBlob(job.blob, jobFileName(job.name, fitContent(job.content || uniform.value), i)) }

// Free every outstanding result URL on navigate-away (row-level revokes only cover
// remove/versionize/regenerate, not unmount).
onUnmounted(() => { for (const job of jobs.value) if (job.url) URL.revokeObjectURL(job.url) })
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
      <div class="card card-stack">
        <div class="ctrl">
          <div class="ctrl-label"><span>{{ t('img2.inv.uniform') }}</span><span v-if="!registerOn" class="val">{{ t('img2.inv.bytesLeft').replace('{n}', bytesLeft) }}</span></div>
          <input type="text" v-model="uniform" @input="onUniformInput" class="text-input" :placeholder="t('img2.inv.content')" />
          <p class="hint">{{ t('img2.inv.contentHint') }}</p>
          <label class="check reg-toggle">
            <input type="checkbox" v-model="registerOn" />
            <span>{{ t('img2.inv.register') }}</span>
          </label>
          <p v-if="registerOn" class="hint reg-note">{{ t('img2.inv.registerHint') }}</p>
        </div>
      </div>

      <ImageDropZone
        v-if="!jobs.length"
        :title="t('img2.dropBatch')" :hint="t('img2.browseBatch')" :drag-over="embedDragOver"
        @pick="pickEmbed" @drop="onDropEmbed"
        @dragover="e => { e.preventDefault(); embedDragOver = true }" @dragleave="embedDragOver = false"
      />

      <div v-else class="card job-table">
        <div v-for="(job, i) in jobs" :key="job.id" class="job-row">
          <img v-if="job.url" :src="job.url" class="thumb" alt="" />
          <span v-else class="thumb ph"></span>
          <span class="job-name mono">{{ job.name }}</span>
          <input type="text" v-model="job.content" :placeholder="uniform || t('img2.inv.content')" class="text-input job-content" />
          <span class="job-status" :class="job.status">
            <svg v-if="job.status === 'done'" width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M13.5 4.5 6 12 2.5 8.5"/></svg>
            <svg v-else-if="job.status === 'error'" width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M8 1.8 1 14h14L8 1.8Z"/><path d="M8 6.4v3.1"/><path d="M8 12h.01"/></svg>
            <template v-else-if="job.status === 'working'">{{ t('img2.inv.generating') }}</template>
          </span>
          <div class="job-actions">
            <button class="btn small" @click="makeVersions(job)">{{ t('img2.inv.duplicate') }}</button>
            <button v-if="job.url" class="btn small" @click="downloadOne(job, i)">{{ t('img2.download') }}</button>
            <button class="link-btn" @click="removeJob(job.id)">{{ t('img2.remove') }}</button>
          </div>
        </div>
        <div class="job-add">
          <button class="btn small" @click="pickEmbed">{{ t('img2.addMore') }}</button>
          <label class="dup-n">{{ t('img2.inv.versions') }} <input type="number" v-model.number="dupCount" min="2" max="50" /></label>
        </div>
      </div>

      <div v-if="jobs.length" class="dl-row">
        <button class="btn primary" :disabled="generating" @click="generate">
          {{ generating ? t('img2.inv.generating') : t('img2.inv.generate') }}
        </button>
        <button v-if="jobs.length > 1 && jobs.some(j => j.blob)" class="btn" @click="downloadZip">{{ t('img2.inv.downloadZip') }}</button>
        <SendToMenu v-if="lastSingleBlob" :payload="lastSingleBlob" kind="image" from="/image/invisible" />
      </div>
      <p class="hint robust">{{ t('img2.inv.robustNote') }}</p>
    </template>
  </ImageShell>
</template>

<style scoped>
.mode-seg { margin-bottom: 16px; max-width: 320px; }
.info-card { display: flex; flex-direction: column; gap: 8px; }
.info-row { display: flex; justify-content: space-between; gap: 16px; }
.info-row .k { color: var(--text-tertiary); }
.info-row .v.mono { font-family: var(--font-mono); }
.empty { color: var(--text-tertiary); text-align: center; padding: 24px; }
.job-table { display: flex; flex-direction: column; gap: 10px; }
.job-row { display: grid; grid-template-columns: 40px 1fr 1.4fr auto auto; gap: 10px; align-items: center; }
.thumb { width: 40px; height: 40px; object-fit: cover; border-radius: 6px; }
.thumb.ph { background: var(--code-bg); }
.job-name { font-family: var(--font-mono); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.job-status { display: inline-flex; align-items: center; justify-content: center; min-width: 20px; font-size: 11.5px; color: var(--text-tertiary); }
.job-status.done { color: var(--accent); }
.job-status.error { color: var(--status-warn); }
.job-actions { display: flex; gap: 6px; align-items: center; }
.job-add { display: flex; gap: 12px; align-items: center; margin-top: 4px; }
.dup-n { display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; color: var(--text-tertiary); }
.dup-n input { width: 56px; }
.hint { color: var(--text-tertiary); font-size: 12px; }
.robust { margin-top: 10px; }
.reg-toggle { margin-top: 12px; }
.reg-note { margin-top: 6px; }

/* Phones: collapse the 5-column job row into stacked bands (thumb/name/status,
   then the content input, then actions) and stack the decode card's rows. */
@media (max-width: 768px) {
  .job-row { grid-template-columns: 32px 1fr auto; grid-template-areas: "thumb name status" "content content content" "actions actions actions"; row-gap: 6px; }
  .thumb { grid-area: thumb; width: 32px; height: 32px; }
  .job-name { grid-area: name; }
  .job-status { grid-area: status; }
  .job-content { grid-area: content; }
  .job-actions { grid-area: actions; justify-content: flex-end; }
  .info-row { flex-direction: column; gap: 2px; }
}
</style>
