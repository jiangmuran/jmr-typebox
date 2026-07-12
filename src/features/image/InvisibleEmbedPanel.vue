<script setup>
// Embed side of the invisible-watermark tool. Job rows are the single source of truth:
// a result blob is only offered (checkmark / Copy / Download / ZIP) while jobFresh() says the
// inputs it was generated from are unchanged — editing content or flipping the register toggle
// silently returns the row to "needs generating" instead of serving a mislabeled stale blob.
// Generate therefore only processes non-fresh rows, which also stops register mode from
// re-registering (and duplicating) already-registered records on every click.
import { ref, computed, onUnmounted } from 'vue'
import JSZip from 'jszip'
import { useI18n } from '../../composables/useI18n'
import { useToast } from '../../composables/useToast'
import ImageDropZone from './ImageDropZone.vue'
import SendToMenu from '../../components/SendToMenu.vue'
import { pickImageFiles, imageFilesFromEvent, downloadBlob, copyImageToClipboard } from './canvasUtils'
import { embedImageBlob } from './invisibleWatermarkCanvas'
import {
  makeJob, duplicateJobs, jobFileName, jobFresh, fitContent, contentByteLength,
  CONTENT_MAX, FORMAT_VERSION,
} from './invisibleWatermark'
import { registerRecords } from './watermarkApi'

const { t } = useI18n()
const { showToast } = useToast()

// { id, source:File, name, srcUrl, content, status:'idle'|'working'|'done'|'error',
//   blob?, embedded?: { content, registered, verifyId } }
const jobs = ref([])
const uniform = ref('')
const dupCount = ref(3)
const generating = ref(false)
const dragOver = ref(false)

// When on, content is registered server-side and the returned id (not the raw text) is embedded,
// which lifts the 16-byte offline cap. CONTENT_MAX_BYTES is a sane client-side guard only.
const registerOn = ref(false)
const CONTENT_MAX_BYTES = 2048

const eff = (job) => job.content || uniform.value
const fresh = (job) => jobFresh(job, uniform.value, registerOn.value)
// Bytes a row's effective content exceeds the offline cap by (0 = fits / register mode).
const overBy = (job) => registerOn.value ? 0 : Math.max(0, contentByteLength(eff(job)) - CONTENT_MAX)

// The uniform meter may go negative (shown in warn color). Content is NOT truncated while
// typing — a live fitContent rewrite fights CJK IME composition; the clamp happens at generate.
const bytesLeft = computed(() => CONTENT_MAX - contentByteLength(uniform.value))
const pendingJobs = computed(() => jobs.value.filter(j => !fresh(j)))
const readyJobs = computed(() => jobs.value.filter(j => fresh(j) && j.blob))
const sendBlob = computed(() => (jobs.value.length === 1 && fresh(jobs.value[0]) && jobs.value[0].blob) || null)

function addFiles(files) {
  for (const f of files) {
    jobs.value.push({ ...makeJob(f, ''), name: f.name, srcUrl: URL.createObjectURL(f) })
  }
}
async function pick() { addFiles(await pickImageFiles({ multiple: true })) }
function onDrop(e) { dragOver.value = false; addFiles(imageFilesFromEvent(e)) }
function removeJob(id) {
  const job = jobs.value.find(j => j.id === id)
  if (job?.srcUrl) URL.revokeObjectURL(job.srcUrl)
  jobs.value = jobs.value.filter(j => j.id !== id)
}
function clearAll() {
  for (const job of jobs.value) if (job.srcUrl) URL.revokeObjectURL(job.srcUrl)
  jobs.value = []
}
function makeVersions(job) {
  const n = Math.min(50, Math.max(2, dupCount.value || 2))
  const dups = duplicateJobs({ ...job, content: eff(job) }, n, registerOn.value ? CONTENT_MAX_BYTES : CONTENT_MAX)
    // Each row owns its object URL so remove/clear can revoke per-row.
    .map(d => ({ ...d, name: job.name, srcUrl: URL.createObjectURL(job.source) }))
  const i = jobs.value.findIndex(j => j.id === job.id)
  if (job.srcUrl) URL.revokeObjectURL(job.srcUrl)
  jobs.value.splice(i, 1, ...dups)
}

async function generate() {
  // Snapshot both the pending rows and the register flag: rows removed or toggles flipped
  // during the awaits must not shift ids[i] onto the wrong job.
  const pending = pendingJobs.value.slice()
  const reg = registerOn.value
  if (!pending.length || generating.value) return
  generating.value = true
  const stamp = Math.floor(Date.now() / 1000)   // one "now" for the whole batch
  try {
    // Register mode: batch-register only the rows that need (re)generating, then embed the
    // returned ids (flags:1) instead of the raw text — one bad response aborts before any embed.
    let ids = null
    if (reg) {
      const records = pending.map(j => ({ content: eff(j), timestamp: stamp, version: FORMAT_VERSION }))
      if (records.some(r => contentByteLength(r.content) > CONTENT_MAX_BYTES)) { showToast(t('img2.inv.registerFailed')); return }
      try { ids = await registerRecords(records) }
      catch { showToast(t('img2.inv.registerFailed')); return }
    }
    for (let i = 0; i < pending.length; i++) {
      const job = pending[i]
      const content = eff(job)
      // Per-job try/catch: one bad image (e.g. too small for a pass) must not abort the batch.
      try {
        job.status = 'working'
        const blob = reg
          ? await embedImageBlob(job.source, { content: ids[i], timestamp: stamp, flags: 1 })
          : await embedImageBlob(job.source, { content: fitContent(content, CONTENT_MAX), timestamp: stamp })
        job.blob = blob
        job.embedded = { content, registered: reg, verifyId: reg ? ids[i] : null }
        job.status = 'done'
      } catch (err) {
        job.status = 'error'
        showToast(/too small/i.test(err?.message || '') ? t('img2.inv.tooSmall') : t('img2.unsupported'))
      }
    }
  } finally { generating.value = false }
}

// Filenames always come from the content snapshot the blob was actually generated with —
// never from the live inputs, which may have changed since.
function nameFor(job, i) {
  return jobFileName(job.name, job.embedded.registered ? job.embedded.content : fitContent(job.embedded.content), i)
}
function downloadOne(job) { if (fresh(job) && job.blob) downloadBlob(job.blob, nameFor(job, readyJobs.value.indexOf(job))) }
async function downloadZip() {
  const zip = new JSZip()
  readyJobs.value.forEach((job, i) => zip.file(nameFor(job, i), job.blob))
  const out = await zip.generateAsync({ type: 'blob' })
  downloadBlob(out, 'invisible-watermark.zip')
}
async function copyResult(job) {
  if (!fresh(job) || !job.blob) return
  try { await copyImageToClipboard(job.blob); showToast(t('img2.copied')) }
  catch { showToast(t('img2.copyUnsupported')) }
}

onUnmounted(clearAll)
defineExpose({ addFiles })
</script>

<template>
  <div class="card card-stack">
    <div class="ctrl">
      <div class="ctrl-label">
        <span>{{ t('img2.inv.uniform') }}</span>
        <span v-if="!registerOn" class="val" :class="{ warn: bytesLeft < 0 }">{{ t('img2.inv.bytesLeft').replace('{n}', bytesLeft) }}</span>
      </div>
      <input type="text" v-model="uniform" class="text-input" :placeholder="t('img2.inv.content')" />
      <p class="hint">{{ t('img2.inv.contentHint') }}</p>
    </div>
    <label class="reg-toggle">
      <input type="checkbox" v-model="registerOn" />
      <span>{{ t('img2.inv.register') }}</span>
    </label>
    <p v-if="registerOn" class="hint reg-note">{{ t('img2.inv.registerHint') }}</p>
  </div>

  <ImageDropZone
    v-if="!jobs.length"
    :title="t('img2.dropBatch')" :hint="t('img2.browseBatch')" :drag-over="dragOver"
    @pick="pick" @drop="onDrop"
    @dragover="e => { e.preventDefault(); dragOver = true }" @dragleave="dragOver = false"
  />

  <div v-else class="card job-table">
    <div v-for="job in jobs" :key="job.id" class="job-row">
      <img :src="job.srcUrl" class="thumb" alt="" />
      <span class="job-name mono">{{ job.name }}</span>
      <div class="job-content">
        <input type="text" v-model="job.content" :placeholder="uniform || t('img2.inv.content')" class="text-input" />
        <p v-if="overBy(job)" class="hint warn">{{ t('img2.inv.overCap').replace('{n}', overBy(job)) }}</p>
      </div>
      <span class="job-status" :class="{ done: fresh(job), error: job.status === 'error' }">
        <svg v-if="fresh(job)" width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M13.5 4.5 6 12 2.5 8.5"/></svg>
        <svg v-else-if="job.status === 'error'" width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M8 1.8 1 14h14L8 1.8Z"/><path d="M8 6.4v3.1"/><path d="M8 12h.01"/></svg>
        <template v-else-if="job.status === 'working'">{{ t('img2.inv.generating') }}</template>
      </span>
      <div class="job-actions">
        <button class="btn small" @click="makeVersions(job)">{{ t('img2.inv.duplicate').replace('{n}', Math.min(50, Math.max(2, dupCount || 2))) }}</button>
        <template v-if="fresh(job) && job.blob">
          <button class="btn small" @click="copyResult(job)">{{ t('img2.copy') }}</button>
          <button class="btn small" @click="downloadOne(job)">{{ t('img2.download') }}</button>
        </template>
        <button class="link-btn" @click="removeJob(job.id)">{{ t('img2.remove') }}</button>
      </div>
    </div>
    <div class="job-add">
      <button class="btn small" @click="pick">{{ t('img2.addMore') }}</button>
      <label class="dup-n">{{ t('img2.inv.versions') }} <input type="number" v-model.number="dupCount" min="2" max="50" /></label>
      <button class="link-btn clear-all" @click="clearAll">{{ t('img2.clear') }}</button>
    </div>
  </div>

  <div v-if="jobs.length" class="dl-row">
    <button class="btn primary" :disabled="generating || !pendingJobs.length" @click="generate">
      {{ generating ? t('img2.inv.generating') : t('img2.inv.generate') }}
    </button>
    <button v-if="readyJobs.length > 1" class="btn" @click="downloadZip">{{ t('img2.inv.downloadZip') }}</button>
    <SendToMenu v-if="sendBlob" :payload="sendBlob" kind="image" from="/image/invisible" />
  </div>
  <p class="hint robust">{{ t('img2.inv.robustNote') }}</p>
</template>

<style scoped>
.job-table { display: flex; flex-direction: column; gap: 10px; }
.job-row { display: grid; grid-template-columns: 40px 1fr 1.4fr auto auto; gap: 10px; align-items: center; }
.thumb { width: 40px; height: 40px; object-fit: cover; border-radius: 6px; background: var(--code-bg); }
.job-name { font-family: var(--font-mono); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.job-content { display: flex; flex-direction: column; gap: 3px; }
.job-status { display: inline-flex; align-items: center; justify-content: center; min-width: 20px; font-size: 11.5px; color: var(--text-tertiary); }
.job-status.done { color: var(--accent); }
.job-status.error { color: var(--status-warn); }
.job-actions { display: flex; gap: 6px; align-items: center; }
.job-add { display: flex; gap: 12px; align-items: center; margin-top: 4px; }
.clear-all { margin-left: auto; }
.dup-n { display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; color: var(--text-tertiary); }
.dup-n input { width: 56px; }
.hint { color: var(--text-tertiary); font-size: 12px; }
.hint.warn, .val.warn { color: var(--status-warn); }
.robust { margin-top: 10px; }
.reg-toggle { display: inline-flex; align-items: center; gap: 8px; margin-top: 4px; font-size: 12.5px; color: var(--text); cursor: pointer; }
.reg-toggle input { width: 16px; height: 16px; flex: 0 0 16px; margin: 0; accent-color: var(--accent); cursor: pointer; }
.reg-note { margin-top: 6px; }

/* Phones: collapse the 5-column job row into stacked bands (thumb/name/status,
   then the content input, then actions). */
@media (max-width: 768px) {
  .job-row { grid-template-columns: 32px 1fr auto; grid-template-areas: "thumb name status" "content content content" "actions actions actions"; row-gap: 6px; }
  .thumb { grid-area: thumb; width: 32px; height: 32px; }
  .job-name { grid-area: name; }
  .job-status { grid-area: status; }
  .job-content { grid-area: content; }
  .job-actions { grid-area: actions; justify-content: flex-end; flex-wrap: wrap; }
}
</style>
