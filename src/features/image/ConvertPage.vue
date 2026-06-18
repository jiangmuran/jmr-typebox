<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { useRouteHead } from '../../composables/useRouteHead'
import { useI18n } from '../../composables/useI18n'
import { useToast } from '../../composables/useToast'
import ClientOnly from '../../components/ClientOnly.vue'
import ImageDropZone from './ImageDropZone.vue'
import ImageToolNav from './ImageToolNav.vue'
import {
  loadImageFromBlob, drawToCanvas, encodeCanvas, downloadBlob,
  pickImageFiles, imageFilesFromEvent, imageFileFromEvent, supportsOutputMime,
} from './canvasUtils'
import { formatSize, withExtension, mimeForFormat, BASE_FORMATS } from './imageHelpers'

const { meta: m } = useRouteHead()
const { t } = useI18n()
const { showToast } = useToast()

const format = ref('png')
const quality = ref(90)
const items = ref([])        // [{ id, name, size, url, image, w, h }]
const formats = ref([...BASE_FORMATS])
const dragOver = ref(false)
const busy = ref(false)
let nextId = 0

onMounted(async () => {
  window.addEventListener('paste', onPaste)
  // Feature-detect AVIF support and append it if encodable.
  if (await supportsOutputMime('image/avif')) formats.value = [...BASE_FORMATS, 'avif']
})
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
  <div class="route-page">
    <h1 class="sr-only">{{ m.h1 }}</h1>
    <ClientOnly>
      <main class="img-wrap">
        <ImageToolNav />
        <header class="img-head">
          <h2>{{ t('img2.convert.title') }}</h2>
          <p>{{ t('img2.convert.sub') }}</p>
        </header>

        <div class="card controls">
          <div class="ctrl">
            <label>{{ t('img2.format') }}</label>
            <div class="seg">
              <button v-for="f in formats" :key="f" :class="{ on: format === f }" @click="format = f">
                {{ f.toUpperCase() }}
              </button>
            </div>
          </div>
          <div v-if="isLossyFmt(format)" class="ctrl">
            <label>{{ t('img2.quality') }}: {{ quality }}%</label>
            <input type="range" v-model.number="quality" min="10" max="100" step="1" />
          </div>
        </div>

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

        <template v-else>
          <div
            class="list"
            :class="{ over: dragOver }"
            @dragover.prevent="onDragOver"
            @dragleave="onDragLeave"
            @drop.prevent="onDrop"
          >
            <div v-for="item in items" :key="item.id" class="row">
              <img :src="item.url" :alt="item.name" />
              <div class="row-meta">
                <span class="row-name">{{ item.name }}</span>
                <span class="row-sub">{{ item.w }}×{{ item.h }} · {{ formatSize(item.size) }}</span>
              </div>
              <button class="icon-btn" :title="t('img2.download')" :disabled="busy" @click="downloadOne(item)">
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M14 10v3.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 13.5V10"/><polyline points="5 7 8 10 11 7"/><line x1="8" y1="10" x2="8" y2="2"/></svg>
              </button>
              <button class="icon-btn" :title="t('img2.remove')" @click="removeItem(item.id)">
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><line x1="4" y1="4" x2="12" y2="12"/><line x1="12" y1="4" x2="4" y2="12"/></svg>
              </button>
            </div>
          </div>

          <div class="actions">
            <button class="btn" @click="openPicker">{{ t('img2.addMore') }}</button>
            <button class="btn" @click="clearAll">{{ t('img2.clear') }}</button>
            <button class="btn primary" :disabled="busy" @click="downloadAll">
              {{ items.length > 1 ? t('img2.downloadAll') : t('img2.download') }}
            </button>
          </div>
        </template>
      </main>
    </ClientOnly>
  </div>
</template>

<style scoped>
.route-page { flex: 1; display: flex; flex-direction: column; min-height: 0; overflow: hidden; }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }

.img-wrap { flex: 1; overflow-y: auto; max-width: 560px; width: 100%; margin: 0 auto; padding: 28px 20px 48px; animation: imgIn 0.32s var(--ease-out); }
@keyframes imgIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
.img-head { margin-bottom: 18px; }
.img-head h2 { font-size: 22px; font-weight: 750; letter-spacing: -0.4px; }
.img-head p { margin-top: 5px; color: var(--text-secondary); font-size: 13px; }

.card { background: var(--surface); border: 1px solid var(--border-light); border-radius: var(--radius-lg); padding: 14px; margin-bottom: 12px; }
.controls { display: flex; flex-direction: column; gap: 12px; }
.ctrl label { display: block; font-size: 11px; font-weight: 500; color: var(--text-secondary); margin-bottom: 5px; }
.seg { display: flex; background: var(--surface-hover); border-radius: var(--radius-sm); padding: 2px; gap: 2px; }
.seg button { flex: 1; padding: 6px; border: none; border-radius: 5px; font-size: 11px; font-weight: 500; background: transparent; color: var(--text-secondary); cursor: pointer; transition: all 0.15s; font-family: var(--font-sans); }
.seg button.on { background: var(--surface); color: var(--text); box-shadow: var(--shadow-xs); }
input[type="range"] { width: 100%; accent-color: var(--accent); }

.list { display: flex; flex-direction: column; gap: 8px; border: 2px dashed transparent; border-radius: var(--radius-lg); transition: border-color 0.2s; }
.list.over { border-color: var(--accent); }
.row { display: flex; align-items: center; gap: 10px; padding: 8px 10px; background: var(--surface); border: 1px solid var(--border-light); border-radius: var(--radius); }
.row img { width: 44px; height: 44px; object-fit: cover; border-radius: var(--radius-sm); background: var(--code-bg); flex-shrink: 0; }
.row-meta { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.row-name { font-size: 12px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.row-sub { font-size: 11px; color: var(--text-secondary); font-family: var(--font-mono); }
.icon-btn { display: inline-flex; align-items: center; justify-content: center; width: 30px; height: 30px; border: 1px solid var(--border-light); border-radius: var(--radius-sm); background: var(--surface); color: var(--text-secondary); cursor: pointer; transition: all 0.15s; flex-shrink: 0; }
.icon-btn:hover { background: var(--surface-hover); color: var(--text); }
.icon-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.icon-btn svg { width: 15px; height: 15px; }

.actions { display: flex; gap: 8px; margin-top: 14px; }
.btn { flex: 1; display: inline-flex; align-items: center; justify-content: center; gap: 6px; padding: 10px 14px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); color: var(--text); font-size: 13px; font-weight: 500; font-family: var(--font-sans); cursor: pointer; transition: all 0.15s; }
.btn:hover { background: var(--surface-hover); }
.btn:active { transform: scale(0.98); }
.btn.primary { background: var(--text); color: var(--bg); border-color: var(--text); }
.btn.primary:hover { opacity: 0.9; }
.btn:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
