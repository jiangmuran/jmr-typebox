<script setup>
// Spreadsheet preview + light editing for a parsed workbook. Sheet tabs switch between sheets;
// cells are editable (contenteditable-free: a plain <input> overlay on focus keeps it simple and
// fast); "Download .xlsx" rebuilds the workbook from the edited grid via SheetJS (lazy).
//
// Large sheets are capped by the parser (MAX_GRID_ROWS x MAX_GRID_COLS); we surface that with a
// "showing N of M rows" note so the tab never freezes. Merged cells + best-effort column widths are
// applied from the parsed model.
import { ref, computed, watch } from 'vue'
import { useI18n } from '../../composables/useI18n'
import { useToast } from '../../composables/useToast'
import { colLabel, formatBytes, MAX_GRID_ROWS } from './officeHelpers'

const props = defineProps({
  // { sheetNames, sheets:[{name, rows, cols, rowCount, colCount, truncated, merges, colWidths}] }
  model: { type: Object, required: true },
  fileName: { type: String, default: 'workbook' },
  fileSize: { type: Number, default: 0 },
})
const emit = defineEmits(['change-file'])

const { t } = useI18n()
const { showToast } = useToast()

const active = ref(0)
watch(() => props.model, () => { active.value = 0 }, { deep: false })

const sheet = computed(() => props.model.sheets[active.value] || props.model.sheets[0])

// Map "r:c" -> { rs, cs } for merge anchors, and a Set of covered (hidden) cells.
const mergeInfo = computed(() => {
  const anchors = new Map()
  const covered = new Set()
  for (const m of sheet.value?.merges || []) {
    anchors.set(`${m.r}:${m.c}`, { rs: m.rs, cs: m.cs })
    for (let r = m.r; r < m.r + m.rs; r++)
      for (let c = m.c; c < m.c + m.cs; c++)
        if (!(r === m.r && c === m.c)) covered.add(`${r}:${c}`)
  }
  return { anchors, covered }
})

function spanFor(r, c) { return mergeInfo.value.anchors.get(`${r}:${c}`) || null }
function isCovered(r, c) { return mergeInfo.value.covered.has(`${r}:${c}`) }
function widthFor(c) {
  const w = sheet.value?.colWidths?.[c]
  return (typeof w === 'number' && w > 0) ? Math.max(48, Math.min(420, w)) : null
}

// Editing: keep edits in a per-sheet override map so switching tabs preserves them and download
// reflects them. We mutate the sheet rows in place (they're plain arrays from the parse).
const editing = ref(null) // { r, c } or null
function onCellInput(r, c, e) {
  const rows = sheet.value.rows
  if (!rows[r]) return
  rows[r][c] = e.target.value
}
function startEdit(r, c) { if (!isCovered(r, c)) editing.value = { r, c } }
function stopEdit() { editing.value = null }
function isEditing(r, c) { return editing.value && editing.value.r === r && editing.value.c === c }

async function download() {
  try {
    showToast(t('office.building'))
    const { buildWorkbook } = await import('./xlsxRunner')
    const { downloadBlob } = await import('./officeDom')
    const blob = await buildWorkbook(props.model.sheets)
    downloadBlob(blob, `${props.fileName || 'workbook'}.xlsx`)
    showToast(t('office.downloaded'))
  } catch (err) {
    console.error('[office] xlsx download failed', err)
    showToast(t('office.exportFailed'))
  }
}

const truncated = computed(() => sheet.value?.truncated)
</script>

<template>
  <div class="sheet-viewer">
    <header class="sv-head">
      <div class="sv-file">
        <svg class="sv-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/></svg>
        <div class="sv-meta">
          <span class="sv-name" :title="fileName">{{ fileName }}.{{ '' }}<span class="sv-ext">xlsx</span></span>
          <span class="sv-sub">{{ formatBytes(fileSize) }} · {{ model.sheets.length }} {{ model.sheets.length === 1 ? t('office.sheet') : t('office.sheets') }}</span>
        </div>
      </div>
      <div class="sv-actions">
        <button class="sv-btn ghost" @click="emit('change-file')">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M2 8a6 6 0 0 1 10.5-4M14 8a6 6 0 0 1-10.5 4"/><polyline points="12 1 12.5 4 9.5 4"/><polyline points="4 15 3.5 12 6.5 12"/></svg>
          {{ t('office.openAnother') }}
        </button>
        <button class="sv-btn primary" @click="download">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2v8"/><polyline points="5 7 8 10 11 7"/><path d="M3 13h10"/></svg>
          {{ t('office.downloadXlsx') }}
        </button>
      </div>
    </header>

    <!-- Sheet tabs -->
    <div v-if="model.sheets.length > 1" class="sv-tabs" role="tablist">
      <button v-for="(s, i) in model.sheets" :key="i" class="sv-tab" :class="{ on: i === active }" role="tab" :aria-selected="i === active" @click="active = i; stopEdit()">{{ s.name }}</button>
    </div>

    <p v-if="truncated" class="sv-note">
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><circle cx="8" cy="8" r="6.5"/><line x1="8" y1="5" x2="8" y2="9"/><circle cx="8" cy="11.2" r="0.4" fill="currentColor"/></svg>
      {{ t('office.showingRows').replace('{n}', Math.min(sheet.rowCount, MAX_GRID_ROWS)).replace('{m}', sheet.rowCount) }}
    </p>

    <!-- Grid -->
    <div class="sv-scroll">
      <table class="sv-grid">
        <thead>
          <tr>
            <th class="corner"></th>
            <th v-for="c in sheet.cols" :key="c" class="colhdr" :style="widthFor(c - 1) ? { width: widthFor(c - 1) + 'px' } : {}">{{ colLabel(c - 1) }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, r) in sheet.rows" :key="r">
            <th class="rowhdr">{{ r + 1 }}</th>
            <template v-for="(cell, c) in row" :key="c">
              <td
                v-if="!isCovered(r, c)"
                class="cell"
                :class="{ editing: isEditing(r, c) }"
                :rowspan="spanFor(r, c)?.rs || 1"
                :colspan="spanFor(r, c)?.cs || 1"
                :style="widthFor(c) ? { width: widthFor(c) + 'px' } : {}"
                @click="startEdit(r, c)"
              >
                <input
                  v-if="isEditing(r, c)"
                  class="cell-input"
                  :value="cell"
                  @input="onCellInput(r, c, $event)"
                  @blur="stopEdit"
                  @keydown.enter.prevent="stopEdit"
                  @keydown.esc.prevent="stopEdit"
                  v-focus
                />
                <span v-else class="cell-text">{{ cell }}</span>
              </td>
            </template>
          </tr>
        </tbody>
      </table>
    </div>

    <p class="sv-foot">{{ t('office.editHint') }}</p>
  </div>
</template>

<script>
// Local directive: autofocus + select-all when a cell input mounts.
export default {
  directives: {
    focus: {
      mounted(el) { el.focus(); try { el.select() } catch { /* ignore */ } },
    },
  },
}
</script>

<style scoped>
.sheet-viewer { flex: 1; display: flex; flex-direction: column; min-height: 0; }
.sv-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 16px; border-bottom: 1px solid var(--border-light); flex-wrap: wrap; }
.sv-file { display: flex; align-items: center; gap: 11px; min-width: 0; }
.sv-ic { width: 26px; height: 26px; color: var(--accent); flex-shrink: 0; }
.sv-meta { display: flex; flex-direction: column; min-width: 0; }
.sv-name { font-size: 14px; font-weight: 650; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sv-ext { color: var(--text-tertiary); font-weight: 500; }
.sv-sub { font-size: 11px; color: var(--text-secondary); }
.sv-actions { display: flex; align-items: center; gap: 8px; }
.sv-btn { display: inline-flex; align-items: center; gap: 6px; padding: 8px 13px; border-radius: 9px; font-size: 12.5px; font-weight: 600; font-family: var(--font-sans); cursor: pointer; border: 1px solid var(--border); background: var(--surface); color: var(--text); transition: all 0.15s; }
.sv-btn svg { width: 14px; height: 14px; }
.sv-btn.ghost { color: var(--text-secondary); }
.sv-btn.ghost:hover { background: var(--surface-hover); color: var(--text); }
.sv-btn.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
.sv-btn.primary:hover { opacity: 0.92; }

.sv-tabs { display: flex; gap: 2px; padding: 6px 12px 0; overflow-x: auto; border-bottom: 1px solid var(--border-light); flex-shrink: 0; }
.sv-tab { padding: 7px 13px; border: 1px solid transparent; border-bottom: none; border-radius: 8px 8px 0 0; background: transparent; color: var(--text-tertiary); font-size: 12px; font-weight: 600; font-family: var(--font-sans); cursor: pointer; white-space: nowrap; }
.sv-tab:hover { color: var(--text-secondary); background: var(--surface-hover); }
.sv-tab.on { color: var(--text); background: var(--surface); border-color: var(--border-light); }

.sv-note { display: flex; align-items: center; gap: 7px; margin: 10px 16px 0; font-size: 12px; color: var(--text-secondary); }
.sv-note svg { width: 15px; height: 15px; flex-shrink: 0; color: var(--text-tertiary); }

.sv-scroll { flex: 1; overflow: auto; margin: 10px 0 0; min-height: 0; }
.sv-grid { border-collapse: collapse; font-size: 13px; font-family: var(--font-mono); table-layout: fixed; }
.sv-grid th, .sv-grid td { border: 1px solid var(--border-light); }
.corner, .colhdr, .rowhdr { background: var(--surface-hover); color: var(--text-secondary); font-weight: 600; text-align: center; position: sticky; }
.corner { left: 0; top: 0; z-index: 3; width: 46px; }
.colhdr { top: 0; z-index: 2; padding: 5px 8px; min-width: 90px; }
.rowhdr { left: 0; z-index: 1; padding: 5px 8px; min-width: 46px; width: 46px; font-size: 11px; }
.cell { padding: 0; min-width: 90px; max-width: 420px; vertical-align: top; background: var(--surface); }
.cell-text { display: block; padding: 5px 8px; min-height: 16px; white-space: pre; overflow: hidden; text-overflow: ellipsis; color: var(--text); }
.cell:hover { background: var(--surface-hover); cursor: text; }
.cell.editing { outline: 2px solid var(--accent); outline-offset: -2px; }
.cell-input { width: 100%; box-sizing: border-box; padding: 4px 7px; border: none; background: var(--bg); color: var(--text); font: inherit; outline: none; }

.sv-foot { padding: 8px 16px 12px; font-size: 11px; color: var(--text-tertiary); }

@media (max-width: 560px) {
  .sv-head { padding: 10px 12px; }
  .sv-actions { width: 100%; }
  .sv-btn { flex: 1; justify-content: center; }
}
</style>
