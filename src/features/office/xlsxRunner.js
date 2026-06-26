// Lazy SheetJS (xlsx) wrappers. SSG-UNSAFE work (parsing ArrayBuffers, building Blobs) lives here
// and the heavy `xlsx` package is pulled in via dynamic import() at CALL time only — never at module
// eval — so this file is harmless to import during prerender and the lib is code-split out of the
// home-page bundle.

import {
  normalizeAoa, colLabel, MAX_GRID_ROWS, MAX_GRID_COLS,
} from './officeHelpers'

let _xlsx = null
async function lib() {
  if (!_xlsx) _xlsx = await import('xlsx')
  return _xlsx.default || _xlsx
}

// Parse a workbook File/Blob/ArrayBuffer into a renderable model:
//   {
//     sheetNames: string[],
//     sheets: [{ name, rows: string[][], cols, rowCount, colCount, truncated,
//                merges: [{r,c,rs,cs}], colWidths: number[] }]
//   }
// `rows` is a rectangular, display-string grid (capped to MAX_GRID_ROWS x MAX_GRID_COLS so a huge
// sheet can never freeze the tab — `truncated` + the real counts let the UI show "showing N of M").
export async function parseWorkbook(input) {
  const XLSX = await lib()
  const data = await toUint8(input)
  const wb = XLSX.read(data, { type: 'array', cellDates: true, cellStyles: true })

  const sheets = wb.SheetNames.map((name) => {
    const ws = wb.Sheets[name] || {}
    const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, blankrows: true })
    const full = normalizeAoa(aoa, {})
    const colCount = full.cols
    const rowCount = full.rowCount

    // Cap for rendering.
    const capped = normalizeAoa(aoa, { maxRows: MAX_GRID_ROWS })
    let rows = capped.rows
    let truncated = rowCount > MAX_GRID_ROWS
    if (capped.cols > MAX_GRID_COLS) {
      rows = rows.map(r => r.slice(0, MAX_GRID_COLS))
      truncated = true
    }
    const shownCols = Math.min(capped.cols, MAX_GRID_COLS)

    return {
      name,
      rows,
      cols: shownCols,
      rowCount,
      colCount,
      truncated,
      merges: readMerges(ws['!merges'], rows.length, shownCols),
      colWidths: readColWidths(ws['!cols'], shownCols),
    }
  })

  return { sheetNames: wb.SheetNames.slice(), sheets }
}

// SheetJS merges are {s:{r,c}, e:{r,c}}; convert to {r,c,rs,cs} (row/col + row-span/col-span),
// clamped to the rendered grid so an out-of-range merge can't break the layout.
function readMerges(merges, maxRows, maxCols) {
  if (!Array.isArray(merges)) return []
  const out = []
  for (const m of merges) {
    const r = m?.s?.r ?? 0, c = m?.s?.c ?? 0
    const er = m?.e?.r ?? r, ec = m?.e?.c ?? c
    if (r >= maxRows || c >= maxCols) continue
    const rs = Math.min(er, maxRows - 1) - r + 1
    const cs = Math.min(ec, maxCols - 1) - c + 1
    if (rs > 1 || cs > 1) out.push({ r, c, rs, cs })
  }
  return out
}

// SheetJS column widths come as [{ wch }] (chars) or [{ wpx }] (px). Best-effort → px.
function readColWidths(cols, count) {
  const out = new Array(count).fill(null)
  if (!Array.isArray(cols)) return out
  for (let i = 0; i < count; i++) {
    const c = cols[i]
    if (!c) continue
    if (typeof c.wpx === 'number') out[i] = Math.round(c.wpx)
    else if (typeof c.width === 'number') out[i] = Math.round(c.width * 7)
    else if (typeof c.wch === 'number') out[i] = Math.round(c.wch * 7 + 10)
  }
  return out
}

// Build a downloadable .xlsx Blob from edited data. `sheets` is [{ name, rows: string[][] }] where
// rows are display strings; we coerce numeric-looking cells back to numbers so the spreadsheet stays
// useful (formulas / sorting) after a round-trip. Returns a Blob.
export async function buildWorkbook(sheets) {
  const XLSX = await lib()
  const wb = XLSX.utils.book_new()
  const used = new Set()
  ;(sheets || []).forEach((s, i) => {
    const aoa = (s.rows || []).map(row => (row || []).map(coerceCell))
    const ws = XLSX.utils.aoa_to_sheet(aoa)
    if (Array.isArray(s.merges) && s.merges.length) {
      ws['!merges'] = s.merges.map(m => ({ s: { r: m.r, c: m.c }, e: { r: m.r + m.rs - 1, c: m.c + m.cs - 1 } }))
    }
    let name = sanitizeSheetName(s.name || `Sheet${i + 1}`)
    // Excel sheet names must be unique (case-insensitive) and ≤31 chars.
    let base = name, n = 2
    while (used.has(name.toLowerCase())) { name = `${base.slice(0, 28)}_${n++}` }
    used.add(name.toLowerCase())
    XLSX.utils.book_append_sheet(wb, ws, name)
  })
  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
  return new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
}

// Coerce an edited display string back to the most useful type for the xlsx cell.
function coerceCell(v) {
  if (v === null || v === undefined) return null
  const s = String(v)
  if (s === '') return null
  if (s === 'TRUE') return true
  if (s === 'FALSE') return false
  // Numeric (but not things like "007" or phone numbers with separators — keep those as text).
  if (/^-?\d+(\.\d+)?$/.test(s) && !/^-?0\d/.test(s)) {
    const num = Number(s)
    if (Number.isFinite(num) && String(num) === s) return num
  }
  return s
}

// Excel forbids these in sheet names: : \ / ? * [ ] and >31 chars.
function sanitizeSheetName(name) {
  let s = String(name).replace(/[:\\/?*[\]]/g, ' ').trim()
  if (!s) s = 'Sheet'
  return s.slice(0, 31)
}

async function toUint8(input) {
  if (input instanceof Uint8Array) return input
  if (input instanceof ArrayBuffer) return new Uint8Array(input)
  if (typeof input?.arrayBuffer === 'function') return new Uint8Array(await input.arrayBuffer())
  throw new Error('Unsupported input for parseWorkbook')
}

// Re-export for the viewer's column header rendering convenience.
export { colLabel }
