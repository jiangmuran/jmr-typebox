<script setup>
// Image Metadata viewer + editor. Reads EVERY metadata block (EXIF / GPS / IPTC / XMP / PNG
// text chunks) with exifr, lets the user edit the commonly-written EXIF fields for JPEG via
// piexifjs, and can strip all metadata for privacy. Both heavy libs are lazy-imported from
// metadataIO only after a file is opened, so the page stays light at prerender.
//
// SSG-safe: no window/Image/exif access at setup top level; all of it lives in handlers, and
// the interactive body renders inside <ClientOnly> (via ImageShell).
import { ref, computed, reactive, shallowRef } from 'vue'
import { useRouteHead } from '../../composables/useRouteHead'
import { useI18n } from '../../composables/useI18n'
import { useToast } from '../../composables/useToast'
import ImageShell from './ImageShell.vue'
import ImageDropZone from './ImageDropZone.vue'
import { useImageSource } from './useImageSource'
import { downloadBlob, copyImageToClipboard } from './canvasUtils'
import { withExtension, formatSize } from './imageHelpers'
import {
  buildMetadataModel, readEditableValues, EDITABLE_FIELDS,
  mapUrl, formatCoord, parseLatLon, inputDateToExif,
} from './metadataHelpers'
import {
  readAllMetadata, writeJpegMetadata, removeAllMetadata, isJpeg, isPng,
} from './metadataIO'

const { meta: m } = useRouteHead()
const { t } = useI18n()
const { showToast } = useToast()

const src = useImageSource(onLoaded)

const rawTags = shallowRef(null)         // last parsed-tags object from exifr
const reading = ref(false)
const working = ref(false)
const showRaw = ref(false)
const view = ref('view')                 // 'view' | 'edit'
const edits = reactive({})               // form values, keyed by EDITABLE_FIELDS id + gpsLat/gpsLon
// A produced result after edit/strip, so we can offer download + copy without re-deriving.
const produced = ref(null)               // { blob, name, label }

const editableFields = EDITABLE_FIELDS

// When a file loads, read all metadata and prefill the edit form.
async function onLoaded({ file }) {
  produced.value = null
  view.value = 'view'
  showRaw.value = false
  reading.value = true
  rawTags.value = null
  try {
    const tags = await readAllMetadata(file)
    rawTags.value = tags
    const vals = readEditableValues(tags)
    for (const k of Object.keys(edits)) delete edits[k]
    Object.assign(edits, vals)
  } catch {
    rawTags.value = {}
    showToast(t('img2.meta.readError'))
  } finally {
    reading.value = false
  }
}

// Display model (grouped sections + GPS + raw list), derived from the parsed tags + decoded size.
const model = computed(() => {
  if (!rawTags.value) return null
  return buildMetadataModel(rawTags.value, { width: src.width.value, height: src.height.value })
})

const gps = computed(() => model.value?.gps || null)
const gpsMapUrl = computed(() => (gps.value ? mapUrl(gps.value.lat, gps.value.lon) : null))
const gpsCoordText = computed(() => (gps.value ? formatCoord(gps.value.lat, gps.value.lon) : ''))

const canEdit = computed(() => !!src.file.value && isJpeg(src.file.value))
const formatLabel = computed(() => {
  const f = src.file.value
  if (!f) return ''
  if (isJpeg(f)) return 'JPEG'
  if (isPng(f)) return 'PNG'
  const ft = (f.type || '').split('/')[1]
  return ft ? ft.toUpperCase() : (f.name.split('.').pop() || '').toUpperCase()
})
// useI18n's t() has no interpolation, so fill the {fmt} placeholder here.
const editUnsupportedText = computed(() =>
  t('img2.meta.editUnsupportedDesc').replace('{fmt}', formatLabel.value)
)

// ---- Actions -------------------------------------------------------------------------------

async function saveEdits() {
  const file = src.file.value
  if (!file || !canEdit.value) return
  // Validate GPS pair: both-or-neither, in range.
  const latRaw = (edits.gpsLat || '').trim()
  const lonRaw = (edits.gpsLon || '').trim()
  if ((latRaw === '') !== (lonRaw === '')) { showToast(t('img2.meta.gpsPairWarn')); return }
  if (latRaw !== '') {
    if (parseLatLon(latRaw, 'lat') == null || parseLatLon(lonRaw, 'lon') == null) {
      showToast(t('img2.meta.gpsInvalid')); return
    }
  }
  working.value = true
  try {
    const payload = {
      ImageDescription: edits.ImageDescription,
      Artist: edits.Artist,
      Copyright: edits.Copyright,
      Make: edits.Make,
      Model: edits.Model,
      Software: edits.Software,
      DateTimeOriginal: inputDateToExif(edits.DateTimeOriginal),
      gpsLat: latRaw,
      gpsLon: lonRaw,
    }
    const blob = await writeJpegMetadata(file, payload)
    const name = saveName(file, 'meta')
    produced.value = { blob, name, label: t('img2.meta.savedReady') }
    // Re-read the produced blob so the view reflects the saved state.
    const reread = await readAllMetadata(blobToFile(blob, name))
    rawTags.value = reread
    Object.assign(edits, readEditableValues(reread))
    view.value = 'view'
    showToast(t('img2.meta.saved'))
  } catch {
    showToast(t('img2.meta.saveError'))
  } finally {
    working.value = false
  }
}

async function stripAll() {
  const file = src.file.value
  if (!file) return
  working.value = true
  try {
    const { blob, mime } = await removeAllMetadata(file)
    const ext = mime.includes('png') ? 'png' : (mime.includes('webp') ? 'webp' : 'jpg')
    const name = withExtension(saveName(file, 'clean'), ext)
    produced.value = { blob, name, label: t('img2.meta.strippedReady') }
    // Re-read to prove it's gone.
    const reread = await readAllMetadata(blobToFile(blob, name))
    rawTags.value = reread
    Object.assign(edits, readEditableValues(reread))
    view.value = 'view'
    showToast(t('img2.meta.stripped'))
  } catch {
    showToast(t('img2.meta.stripError'))
  } finally {
    working.value = false
  }
}

// Strip only the GPS block (privacy shortcut): clear the coordinate fields and save (JPEG),
// otherwise fall back to a full strip via canvas re-encode.
async function removeGps() {
  const file = src.file.value
  if (!file) return
  if (canEdit.value) {
    edits.gpsLat = ''
    edits.gpsLon = ''
    await saveEdits()
  } else {
    await stripAll()
  }
}

function downloadProduced() {
  if (!produced.value) return
  downloadBlob(produced.value.blob, produced.value.name)
  showToast(`${formatSize(produced.value.blob.size)}`)
}
async function copyProduced() {
  if (!produced.value) return
  try { await copyImageToClipboard(produced.value.blob); showToast(t('img2.copied')) }
  catch { showToast(t('img2.copyUnsupported')) }
}

// ---- helpers (component-local, browser-only) -----------------------------------------------
function saveName(file, suffix) {
  const base = String(file.name || 'image').replace(/\.[^./\\]+$/, '') || 'image'
  return `${base}-${suffix}`
}
function blobToFile(blob, name) {
  try { return new File([blob], name, { type: blob.type }) }
  catch { blob.name = name; return blob }
}
function reset() { src.reset(); rawTags.value = null; produced.value = null }
</script>

<template>
  <ImageShell wide :h1="m.h1" :title="t('img2.meta.title')" :sub="t('img2.meta.sub')">
    <ImageDropZone
      v-if="!src.image.value"
      :title="t('img2.drop')"
      :hint="t('img2.browse')"
      :drag-over="src.dragOver.value"
      @pick="src.openPicker"
      @drop="src.onDrop"
      @dragover="src.onDragOver"
      @dragleave="src.onDragLeave"
    />

    <div v-else class="layout">
      <!-- Left: image preview + identity -->
      <div class="preview-col">
        <div class="canvas-pane preview-pane">
          <div class="canvas-frame">
            <img :src="src.objectUrl.value" :alt="src.name.value" class="meta-img" />
          </div>
          <div class="preview-meta">
            <span class="meta-name mono">{{ src.name.value }} · {{ formatLabel }} · {{ src.width.value }}×{{ src.height.value }}</span>
            <button class="link-btn" @click="reset">{{ t('img2.change') }}</button>
          </div>
        </div>

        <!-- GPS callout — prominent since location is a privacy concern -->
        <div v-if="gps" class="card gps-card">
          <div class="gps-head">
            <span class="gps-ico" aria-hidden="true">
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M13 6.5c0 3.5-5 8-5 8s-5-4.5-5-8a5 5 0 0 1 10 0Z"/><circle cx="8" cy="6.5" r="1.8"/></svg>
            </span>
            <strong>{{ t('img2.meta.gpsFound') }}</strong>
          </div>
          <p class="gps-coord mono">{{ gpsCoordText }}<span v-if="gps.altitude != null"> · {{ Math.round(gps.altitude) }} m</span></p>
          <div class="gps-actions">
            <a class="btn small" :href="gpsMapUrl" target="_blank" rel="noopener noreferrer">
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2 2 4v10l4-2 4 2 4-2V2l-4 2-4-2Z"/><line x1="6" y1="2" x2="6" y2="12"/><line x1="10" y1="4" x2="10" y2="14"/></svg>
              {{ t('img2.meta.viewMap') }}
            </a>
            <button class="btn small danger" :disabled="working" @click="removeGps">
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3 4h10M6.5 4V2.5h3V4M5 4l.5 9h5L11 4"/></svg>
              {{ t('img2.meta.removeGps') }}
            </button>
          </div>
        </div>

        <!-- Privacy / strip action -->
        <div class="card strip-card">
          <p class="strip-note">{{ t('img2.meta.stripNote') }}</p>
          <button class="btn block danger-soft" :disabled="working || reading" @click="stripAll">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M2 5h12M5.5 5V3h5v2M4 5l.6 8.5h6.8L12 5"/><path d="M6.5 7.5v4M9.5 7.5v4"/></svg>
            {{ t('img2.meta.stripAll') }}
          </button>
        </div>

        <!-- Result of an edit / strip -->
        <div v-if="produced" class="card result-card">
          <p class="result-label">{{ produced.label }} · {{ formatSize(produced.blob.size) }}</p>
          <div class="dl-row">
            <button class="btn primary" @click="downloadProduced">
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M14 10v3.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 13.5V10"/><polyline points="5 7 8 10 11 7"/><line x1="8" y1="10" x2="8" y2="2"/></svg>
              {{ t('img2.download') }}
            </button>
            <button class="btn" @click="copyProduced">
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="5" width="9" height="9" rx="1.5"/><path d="M3 11V3.5A1.5 1.5 0 0 1 4.5 2H11"/></svg>
              {{ t('img2.copy') }}
            </button>
          </div>
        </div>
      </div>

      <!-- Right: metadata view / edit -->
      <div class="info-col">
        <!-- View / Edit switch -->
        <div class="seg view-seg">
          <button :class="{ on: view === 'view' }" @click="view = 'view'">{{ t('img2.meta.tabView') }}</button>
          <button :class="{ on: view === 'edit' }" @click="view = 'edit'">{{ t('img2.meta.tabEdit') }}</button>
        </div>

        <!-- Loading -->
        <div v-if="reading" class="empty-state">
          <p>{{ t('img2.meta.reading') }}</p>
        </div>

        <!-- VIEW MODE -->
        <template v-else-if="view === 'view'">
          <div v-if="model && model.hasEmbedded" class="info-body">
            <section v-for="sec in model.sections" :key="sec.id" class="card meta-section">
              <h3 class="sec-title">{{ t(sec.titleKey) }}</h3>
              <dl class="kv">
                <template v-for="row in sec.rows" :key="row.key">
                  <dt>{{ row.label }}</dt>
                  <dd>{{ row.value }}</dd>
                </template>
              </dl>
            </section>

            <!-- Raw all-tags list (collapsible) -->
            <section v-if="model.raw.length" class="card meta-section">
              <button class="raw-toggle" @click="showRaw = !showRaw" :aria-expanded="showRaw">
                <span class="sec-title">{{ t('img2.meta.allTags') }} · {{ model.raw.length }}</span>
                <svg class="chev" :class="{ open: showRaw }" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 6 8 10 12 6"/></svg>
              </button>
              <dl v-if="showRaw" class="kv raw-kv">
                <template v-for="row in model.raw" :key="row.key">
                  <dt :title="row.key">{{ row.label }}</dt>
                  <dd>{{ row.value }}</dd>
                </template>
              </dl>
            </section>
          </div>

          <!-- Empty state -->
          <div v-else class="card empty-state">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><line x1="12" y1="11" x2="12" y2="16"/><circle cx="12" cy="8" r="0.6" fill="currentColor"/></svg>
            <h3>{{ t('img2.meta.emptyTitle') }}</h3>
            <p>{{ t('img2.meta.emptyDesc') }}</p>
          </div>
        </template>

        <!-- EDIT MODE -->
        <template v-else>
          <div v-if="canEdit" class="info-body">
            <div class="card card-stack">
              <div v-for="f in editableFields" :key="f.id" class="ctrl">
                <label :for="'mf-' + f.id">{{ t(f.labelKey) }}</label>
                <input
                  :id="'mf-' + f.id"
                  v-if="f.type === 'datetime'"
                  type="datetime-local"
                  step="1"
                  v-model="edits[f.id]"
                  class="text-input"
                />
                <input
                  :id="'mf-' + f.id"
                  v-else
                  type="text"
                  v-model="edits[f.id]"
                  class="text-input"
                  :placeholder="t('img2.meta.empty')"
                />
              </div>
            </div>

            <!-- GPS editor -->
            <div class="card card-stack">
              <h3 class="sec-title">{{ t('img2.meta.gpsEdit') }}</h3>
              <div class="ctrl-row">
                <div class="ctrl">
                  <label for="mf-lat">{{ t('img2.meta.lat') }}</label>
                  <input id="mf-lat" type="text" inputmode="decimal" v-model="edits.gpsLat" class="text-input" placeholder="40.4461" />
                </div>
                <div class="ctrl">
                  <label for="mf-lon">{{ t('img2.meta.lon') }}</label>
                  <input id="mf-lon" type="text" inputmode="decimal" v-model="edits.gpsLon" class="text-input" placeholder="-73.9822" />
                </div>
              </div>
              <p class="note">{{ t('img2.meta.gpsEditHint') }}</p>
            </div>

            <div class="dl-row">
              <button class="btn primary" :disabled="working" @click="saveEdits">
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3h8l2 2v8a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z"/><path d="M5 3v3h5V3M5 14v-4h6v4"/></svg>
                {{ t('img2.meta.saveBtn') }}
              </button>
            </div>
            <p class="note edit-note">{{ t('img2.meta.editFormatNote') }}</p>
          </div>

          <!-- Non-JPEG: editing unsupported, read-only -->
          <div v-else class="card empty-state">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 12h8M8 16h5"/><path d="M9 4v4M15 4v4"/></svg>
            <h3>{{ t('img2.meta.editUnsupportedTitle') }}</h3>
            <p>{{ editUnsupportedText }}</p>
          </div>
        </template>
      </div>
    </div>
  </ImageShell>
</template>

<style scoped>
/* Two-column workbench: image + privacy actions on the left, metadata read/edit on the right.
   `.wide` collapses to one column ≤768px (shared rule); `.layout` mirrors it. */
.layout { display: grid; grid-template-columns: 360px 1fr; gap: 16px; align-items: start; }

.preview-col { display: flex; flex-direction: column; gap: 12px; position: sticky; top: 0; }
.canvas-frame { max-height: 44vh; }
.meta-img { max-width: 100%; max-height: calc(44vh - 28px); object-fit: contain; border-radius: var(--radius-sm); display: block; }
.preview-meta .mono { font-family: var(--font-mono); }

.info-col { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.info-body { display: flex; flex-direction: column; gap: 12px; }

/* ---- Key/value metadata sections ---- */
.meta-section { padding: 14px 16px; }
.sec-title { font-size: 12px; font-weight: 700; letter-spacing: 0.2px; text-transform: uppercase; color: var(--text-secondary); margin: 0 0 10px; }
.kv { display: grid; grid-template-columns: minmax(110px, 38%) 1fr; gap: 7px 14px; margin: 0; }
.kv dt { font-size: 12px; color: var(--text-secondary); min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.kv dd { font-size: 12.5px; color: var(--text); margin: 0; word-break: break-word; overflow-wrap: anywhere; }
.raw-kv { margin-top: 10px; }
.raw-kv dd { font-family: var(--font-mono); font-size: 11.5px; }

.raw-toggle { display: flex; align-items: center; justify-content: space-between; width: 100%; gap: 8px; background: none; border: none; padding: 0; cursor: pointer; font-family: var(--font-sans); }
.raw-toggle .sec-title { margin: 0; }
.raw-toggle .chev { width: 15px; height: 15px; color: var(--text-tertiary); transition: transform 0.18s; flex-shrink: 0; }
.raw-toggle .chev.open { transform: rotate(180deg); }

/* ---- GPS callout ---- */
.gps-card { border-color: var(--accent); background: var(--accent-bg); padding: 14px 16px; }
.gps-head { display: flex; align-items: center; gap: 8px; }
.gps-head strong { font-size: 13px; font-weight: 700; }
.gps-ico { display: inline-flex; color: var(--accent); }
.gps-ico svg { width: 16px; height: 16px; }
.gps-coord { font-size: 12.5px; color: var(--text); margin: 8px 0 12px; }
.gps-actions { display: flex; gap: 8px; flex-wrap: wrap; }
.gps-actions .btn { flex: 1; min-width: 0; }

/* ---- Strip / privacy ---- */
.strip-card { padding: 14px 16px; }
.strip-note { font-size: 11.5px; color: var(--text-secondary); line-height: 1.5; margin-bottom: 10px; }

.btn.danger { color: var(--status-warn); border-color: var(--status-warn-bg); }
.btn.danger:hover { background: var(--status-warn-bg); }
.btn.danger-soft { color: var(--text); }
.btn.danger-soft:hover { background: var(--status-warn-bg); color: var(--status-warn); border-color: var(--status-warn-bg); }

/* ---- Result ---- */
.result-card { padding: 14px 16px; }
.result-label { font-size: 12px; color: var(--status-ok); font-weight: 600; margin-bottom: 10px; }

/* ---- Empty / loading state ---- */
.empty-state { display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 36px 24px; gap: 4px; }
.empty-state svg { width: 38px; height: 38px; color: var(--text-tertiary); margin-bottom: 8px; }
.empty-state h3 { font-size: 14px; font-weight: 600; }
.empty-state p { font-size: 12.5px; color: var(--text-secondary); line-height: 1.5; max-width: 320px; }

.edit-note { margin-top: 2px; }

/* datetime-local needs a touch more breathing room and must not overflow its column. */
.text-input[type="datetime-local"] { max-width: 100%; }

@media (max-width: 768px) {
  .layout { grid-template-columns: 1fr; gap: 12px; }
  /* On phones the preview must not stick (it would cover the metadata) and is capped. */
  .preview-col { position: static; }
  .canvas-frame { max-height: 38vh; }
  .meta-img { max-height: calc(38vh - 28px); }
  .kv { grid-template-columns: minmax(96px, 40%) 1fr; }
}
</style>
