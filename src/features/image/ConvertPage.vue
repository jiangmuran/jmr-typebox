<script setup>
import { ref, watch, onMounted, onBeforeUnmount } from 'vue'
import { useRouteHead } from '../../composables/useRouteHead'
import { useI18n } from '../../composables/useI18n'
import { useToast } from '../../composables/useToast'
import { useHandoff } from '../../composables/useHandoff'
import ImageShell from './ImageShell.vue'
import ImageDropZone from './ImageDropZone.vue'
import SendToMenu from '../../components/SendToMenu.vue'
import {
  loadImageFromBlob, drawToCanvas, encodeCanvas, downloadBlob, copyImageToClipboard,
  pickImageFiles, imageFilesFromEvent, imageFileFromEvent, supportsOutputMime,
} from './canvasUtils'
import { formatSize, withExtension, mimeForFormat, BASE_FORMATS } from './imageHelpers'

const { meta: m } = useRouteHead()
const { t } = useI18n()
const { showToast } = useToast()
const handoff = useHandoff()

const format = ref('png')
const quality = ref(90)
const items = ref([])        // [{ id, name, size, url, image, w, h, outBlob }]
const formats = ref([...BASE_FORMATS])
const dragOver = ref(false)
const busy = ref(false)
let nextId = 0

onMounted(async () => {
  window.addEventListener('paste', onPaste)
  // Feature-detect AVIF support and append it if encodable.
  if (await supportsOutputMime('image/avif')) formats.value = [...BASE_FORMATS, 'avif']
  // Pick up a cross-module "send to" image, if one is staged.
  const h = handoff.take('image')
  if (h?.payload) {
    let f = h.payload
    if (h.name && !f.name) { try { f = new File([f], h.name, { type: f.type }) } catch { f.name = h.name } }
    if (f.type?.startsWith('image/')) { await addFiles([f]); showToast(t('handoff.received')) }
  }
})

// Keep a current converted blob per item (debounced) so each row's "Send to →" can hand off its
// result in the chosen format without re-encoding on demand.
let outTimer = null
function scheduleOutBlobs() {
  clearTimeout(outTimer)
  outTimer = setTimeout(async () => {
    for (const item of items.value) {
      try { const enc = await encodeItem(item); item.outBlob = enc?.blob || null } catch { item.outBlob = null }
    }
  }, 220)
}
watch([format, quality, () => items.value.length], scheduleOutBlobs)
onBeforeUnmount(() => {
  window.removeEventListener('paste', onPaste)
  items.value.forEach(i => URL.revokeObjectURL(i.url))
})

async function addFiles(files) {
  for (const f of files) {
    if (!f.type?.startsWith('image/')) continue
    try {
      const image = await loadImageFromBlob(f)
      items.value.push({
        id: nextId++, name: f.name || 'image', size: f.size || 0,
        url: URL.createObjectURL(f), image, w: image.naturalWidth, h: image.naturalHeight,
        outBlob: null,
      })
    } catch { /* skip undecodable */ }
  }
}

async function openPicker() {
  const files = await pickImageFiles({ multiple: true })
  if (files.length) await addFiles(files)
}
function onDrop(e) {
  dragOver.value = false
  const files = imageFilesFromEvent(e)
  if (files.length) addFiles(files)
}
function onDragOver() { dragOver.value = true }
function onDragLeave() { dragOver.value = false }
function onPaste(e) {
  const f = imageFileFromEvent(e)
  if (f) addFiles([f])
}

function removeItem(id) {
  const i = items.value.findIndex(x => x.id === id)
  if (i >= 0) { URL.revokeObjectURL(items.value[i].url); items.value.splice(i, 1) }
}
function clearAll() {
  items.value.forEach(i => URL.revokeObjectURL(i.url))
  items.value = []
}

async function encodeItem(item) {
  const bg = format.value === 'jpg' ? '#ffffff' : undefined
  const canvas = drawToCanvas(item.image, item.w, item.h, { background: bg })
  return encodeCanvas(canvas, format.value, quality.value)
}

async function downloadOne(item) {
  busy.value = true
  try {
    const enc = await encodeItem(item)
    if (!enc) { showToast(t('img2.unsupported')); return }
    downloadBlob(enc.blob, withExtension(item.name, format.value))
    showToast(`${formatSize(enc.blob.size)} · ${format.value.toUpperCase()}`)
  } finally { busy.value = false }
}
async function copyItem(item) {
  busy.value = true
  try {
    const enc = await encodeItem(item)
    if (!enc) { showToast(t('img2.unsupported')); return }
    try { await copyImageToClipboard(enc.blob); showToast(t('img2.copied')) }
    catch { showToast(t('img2.copyUnsupported')) }
  } finally { busy.value = false }
}

async function downloadAll() {
  if (!items.value.length) return
  busy.value = true
  let ok = 0
  try {
    for (const item of items.value) {
      const enc = await encodeItem(item)
      if (enc) { downloadBlob(enc.blob, withExtension(item.name, format.value)); ok++ }
      // Small gap so multiple downloads aren't dropped by the browser.
      await new Promise(r => setTimeout(r, 120))
    }
    showToast(`${ok} · ${format.value.toUpperCase()}`)
  } finally { busy.value = false }
}

const isLossyFmt = (f) => mimeForFormat(f) !== 'image/png'
</script>

<template>
  <ImageShell :h1="m.h1" :title="t('img2.convert.title')" :sub="t('img2.convert.sub')">
    <div class="img-body">
      <ImageDropZone
        v-if="!items.length"
        :title="t('img2.dropBatch')"
        :hint="t('img2.browseBatch')"
        :drag-over="dragOver"
        @pick="openPicker"
        @drop="onDrop"
        @dragover="onDragOver"
        @dragleave="onDragLeave"
      />

      <div
        v-else
        class="file-list"
        :class="{ over: dragOver }"
        @dragover.prevent="onDragOver"
        @dragleave="onDragLeave"
        @drop.prevent="onDrop"
      >
        <div v-for="item in items" :key="item.id" class="file-row">
          <img :src="item.url" :alt="item.name" />
          <div class="row-meta">
            <span class="row-name">{{ item.name }}</span>
            <span class="row-sub">{{ item.w }}×{{ item.h }} · {{ formatSize(item.size) }}</span>
          </div>
          <button class="icon-btn" :title="t('img2.download')" :disabled="busy" @click="downloadOne(item)">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M14 10v3.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 13.5V10"/><polyline points="5 7 8 10 11 7"/><line x1="8" y1="10" x2="8" y2="2"/></svg>
          </button>
          <button class="icon-btn" :title="t('img2.copy')" :disabled="busy" @click="copyItem(item)">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="5" width="9" height="9" rx="1.5"/><path d="M3 11V3.5A1.5 1.5 0 0 1 4.5 2H11"/></svg>
          </button>
          <button class="icon-btn" :title="t('img2.remove')" @click="removeItem(item.id)">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><line x1="4" y1="4" x2="12" y2="12"/><line x1="12" y1="4" x2="4" y2="12"/></svg>
          </button>
          <SendToMenu :payload="item.outBlob" kind="image" from="/image/convert" class="row-sendto" />
        </div>
      </div>

      <div class="card card-stack">
        <div class="ctrl">
          <label>{{ t('img2.format') }}</label>
          <div class="seg">
            <button v-for="f in formats" :key="f" :class="{ on: format === f }" @click="format = f">
              {{ f.toUpperCase() }}
            </button>
          </div>
        </div>
        <div v-if="isLossyFmt(format)" class="ctrl">
          <div class="ctrl-label"><span>{{ t('img2.quality') }}</span><span class="val">{{ quality }}%</span></div>
          <input type="range" v-model.number="quality" min="10" max="100" step="1" />
        </div>
      </div>

      <div v-if="items.length" class="actions">
        <button class="btn" @click="openPicker">{{ t('img2.addMore') }}</button>
        <button class="btn" @click="clearAll">{{ t('img2.clear') }}</button>
        <button class="btn primary" :disabled="busy" @click="downloadAll">
          {{ items.length > 1 ? t('img2.downloadAll') : t('img2.download') }}
        </button>
      </div>
    </div>
  </ImageShell>
</template>

<style scoped>
/* The "Send to →" control rides at the end of each file row; let rows wrap so it drops to its own
   line on narrow screens instead of overflowing. The send button shrinks to an icon on phones. */
.file-row { flex-wrap: wrap; }
.row-sendto { margin-left: auto; }
.row-sendto :deep(.sendto-btn) { padding: 6px 10px; }
@media (max-width: 480px) {
  .row-sendto { margin-left: 0; }
  .row-sendto :deep(.sendto-btn span) { display: none; }
  .row-sendto :deep(.sendto-btn) { padding: 8px; }
}
</style>
