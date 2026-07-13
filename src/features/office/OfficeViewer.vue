<script setup>
// /office route — opens Excel (.xlsx) and PowerPoint (.pptx) files with a usable in-browser
// preview (and light editing for spreadsheets). Reachable from the editor's open-file flow (a
// dropped/picked .xlsx/.pptx is staged in officeStore and we consume it on mount) and directly by
// URL (shows a drop-zone empty state).
//
// SSG-safe: the sr-only <h1> lives OUTSIDE <ClientOnly>; everything that touches File/DOM/libs runs
// inside the client-only body behind dynamic import()s. SheetJS / JSZip are code-split into the
// runners and only fetched once a file is opened.
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { useRouteHead } from '../../composables/useRouteHead'
import { useI18n } from '../../composables/useI18n'
import { useToast } from '../../composables/useToast'
import ClientOnly from '../../components/ClientOnly.vue'
import ToolboxNav from '../../components/ToolboxNav.vue'
import SheetViewer from './SheetViewer.vue'
import SlideViewer from './SlideViewer.vue'
import { isXlsxName, isPptxName, isOfficeName, baseName, officeKind } from './officeHelpers'
import { takeOfficeFile } from './officeStore'

const { meta: m } = useRouteHead()
const { t } = useI18n()
const { showToast } = useToast()

const kind = ref(null)        // 'sheet' | 'slides' | null
const model = ref(null)       // parsed workbook / presentation model
const fileName = ref('')
const fileSize = ref(0)
const loading = ref(false)
const error = ref('')
const dragOver = ref(false)

// Monotonic token: only the most recent openFile() call may commit its result. A slow parse of an
// earlier-dropped file must not overwrite a later file's model (A's data under B's filename).
let openToken = 0

async function openFile(file) {
  if (!file) return
  if (!isOfficeName(file.name)) { showToast(t('office.unsupported')); return }
  const token = ++openToken
  error.value = ''
  loading.value = true
  kind.value = null
  model.value = null
  fileName.value = baseName(file.name)
  fileSize.value = file.size || 0
  try {
    if (isXlsxName(file.name)) {
      const { parseWorkbook } = await import('./xlsxRunner')
      const parsed = await parseWorkbook(file)
      if (token !== openToken) return // superseded by a newer open — discard
      model.value = parsed
      kind.value = 'sheet'
    } else if (isPptxName(file.name)) {
      const { parsePptx } = await import('./pptxRunner')
      const parsed = await parsePptx(file)
      if (token !== openToken) return
      model.value = parsed
      kind.value = 'slides'
    }
  } catch (err) {
    if (token !== openToken) return // a newer open is in flight; don't clobber its state
    console.error('[office] failed to open', err)
    error.value = t('office.parseFailed')
    showToast(t('office.parseFailed'))
  } finally {
    if (token === openToken) loading.value = false
  }
}

function pick() {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = '.xlsx,.xlsm,.xls,.csv,.ods,.pptx,.ppt'
  input.onchange = (e) => { const f = e.target.files?.[0]; if (f) openFile(f) }
  input.click()
}

function onDrop(e) {
  e.preventDefault(); dragOver.value = false
  const f = e.dataTransfer?.files?.[0]
  if (f) openFile(f)
}

function reset() { kind.value = null; model.value = null; error.value = '' }

onMounted(() => {
  const staged = takeOfficeFile()
  if (staged) openFile(staged)
})
onBeforeUnmount(() => {})
</script>

<template>
  <div class="route-page">
    <h1 class="sr-only">{{ m.h1 }}</h1>

    <ClientOnly>
      <!-- Loaded spreadsheet -->
      <SheetViewer
        v-if="kind === 'sheet' && model"
        :model="model"
        :file-name="fileName"
        :file-size="fileSize"
        @change-file="reset"
      />
      <!-- Loaded slides -->
      <SlideViewer
        v-else-if="kind === 'slides' && model"
        :model="model"
        :file-name="fileName"
        :file-size="fileSize"
        @change-file="reset"
      />

      <!-- Empty / loading / error state -->
      <main v-else class="office-empty">
        <div class="oe-inner">
          <ToolboxNav />
          <h2 class="oe-title">{{ t('office.title') }}</h2>
          <p class="oe-sub">{{ t('office.sub') }}</p>

          <div
            class="oe-drop"
            :class="{ over: dragOver, busy: loading }"
            role="button" tabindex="0"
            @click="!loading && pick()"
            @keydown.enter.prevent="!loading && pick()"
            @keydown.space.prevent="!loading && pick()"
            @dragover.prevent="dragOver = true"
            @dragleave.prevent="dragOver = false"
            @drop="onDrop"
          >
            <template v-if="loading">
              <span class="oe-spin"></span>
              <h3>{{ t('office.parsing') }}</h3>
            </template>
            <template v-else>
              <div class="oe-icons">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="3" x2="9" y2="21"/></svg>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="13" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
              </div>
              <h3>{{ t('office.dropTitle') }}</h3>
              <p>{{ t('office.dropHint') }}</p>
            </template>
          </div>

          <p v-if="error" class="oe-error">{{ error }}</p>

          <div class="oe-caps">
            <div class="oe-cap">
              <span class="oe-cap-h">{{ t('office.cap.xlsxTitle') }}</span>
              <span class="oe-cap-d">{{ t('office.cap.xlsxDesc') }}</span>
            </div>
            <div class="oe-cap">
              <span class="oe-cap-h">{{ t('office.cap.pptxTitle') }}</span>
              <span class="oe-cap-d">{{ t('office.cap.pptxDesc') }}</span>
            </div>
          </div>
          <p class="oe-privacy">{{ t('office.privacy') }}</p>
        </div>
      </main>
    </ClientOnly>
  </div>
</template>

<style scoped>
.route-page { flex: 1; display: flex; flex-direction: column; min-height: 0; overflow: hidden; }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }

.office-empty { flex: 1; overflow-y: auto; display: flex; align-items: flex-start; justify-content: center; padding: 48px 24px; }
.oe-inner { width: 100%; max-width: var(--page-narrow); }
@keyframes tbIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
.oe-title { font-size: 24px; font-weight: 750; letter-spacing: -0.5px; }
.oe-sub { margin-top: 6px; color: var(--text-secondary); font-size: 13px; line-height: 1.5; }

.oe-drop { margin-top: 22px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; padding: 48px 32px; border: 2px dashed var(--border); border-radius: var(--radius-lg); background: var(--surface); cursor: pointer; text-align: center; transition: all var(--dur-3) var(--ease-out); outline: none; }
.oe-drop:hover, .oe-drop:focus-visible, .oe-drop.over { border-color: var(--accent); background: var(--accent-bg); transform: translateY(-2px); }
.oe-drop.busy { cursor: default; }
.oe-icons { display: flex; gap: 14px; margin-bottom: 8px; }
.oe-icons svg { width: 40px; height: 40px; color: var(--text-tertiary); }
.oe-drop h3 { font-size: 15px; font-weight: 650; }
.oe-drop p { font-size: 13px; color: var(--text-secondary); }
.oe-spin { width: 30px; height: 30px; border: 3px solid var(--border); border-top-color: var(--accent); border-radius: 50%; animation: tb-spin 0.7s linear infinite; }

.oe-error { margin-top: 12px; font-size: 13px; color: var(--danger); }

.oe-caps { margin-top: 26px; display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.oe-cap { padding: 16px; border: 1px solid var(--border-light); border-radius: 12px; background: var(--surface); display: flex; flex-direction: column; gap: 4px; }
.oe-cap-h { font-size: 13px; font-weight: 650; color: var(--text); }
.oe-cap-d { font-size: 12px; color: var(--text-secondary); line-height: 1.45; }
.oe-privacy { margin-top: 18px; font-size: 12px; color: var(--text-tertiary); text-align: center; }

@media (max-width: 560px) { .oe-caps { grid-template-columns: 1fr; } .office-empty { padding: 28px 16px; } }
</style>
