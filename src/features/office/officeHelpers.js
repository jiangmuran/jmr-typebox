// Pure, SSG-safe helpers for the Office suite (xlsx + pptx preview/edit).
//
// NOTHING here touches window / document / Blob / File / SheetJS / JSZip — everything operates on
// plain values (strings, arrays, objects) so it can be unit-tested in node and imported from
// index.js (which must stay side-effect-free at import). The heavy libraries (SheetJS, JSZip) are
// dynamically imported only inside the runners (xlsxRunner.js / pptxRunner.js) at call time.

// ---------------------------------------------------------------------------
// File-type detection (used by the editor's open-file flow + the viewer)
// ---------------------------------------------------------------------------

// Lowercased extension without the dot, or '' if none.
export function extOf(name = '') {
  const m = String(name).toLowerCase().match(/\.([a-z0-9]+)$/)
  return m ? m[1] : ''
}

// Base name with the extension stripped (keeps any path-ish prefix the caller passed).
export function baseName(name = '') {
  return String(name).replace(/\.[^.]+$/, '')
}

export const XLSX_EXTS = ['xlsx', 'xlsm', 'xlsb', 'xls', 'ods', 'csv']
export const PPTX_EXTS = ['pptx', 'ppt']

export function isXlsxName(name) { return XLSX_EXTS.includes(extOf(name)) }
export function isPptxName(name) { return PPTX_EXTS.includes(extOf(name)) }
export function isOfficeName(name) { return isXlsxName(name) || isPptxName(name) }

// Which office viewer a filename routes to: 'sheet' | 'slides' | null.
export function officeKind(name) {
  if (isXlsxName(name)) return 'sheet'
  if (isPptxName(name)) return 'slides'
  return null
}

// ---------------------------------------------------------------------------
// Spreadsheet column helpers
// ---------------------------------------------------------------------------

// 0 -> 'A', 25 -> 'Z', 26 -> 'AA', 701 -> 'ZZ', 702 -> 'AAA'. (Spreadsheet column labels.)
export function colLabel(index) {
  let n = Math.floor(index)
  if (!Number.isFinite(n) || n < 0) return ''
  let s = ''
  n += 1
  while (n > 0) {
    const rem = (n - 1) % 26
    s = String.fromCharCode(65 + rem) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

// Build the list of column headers 'A'.. for a given column count.
export function colLabels(count) {
  const out = []
  for (let i = 0; i < Math.max(0, count | 0); i++) out.push(colLabel(i))
  return out
}

// ---------------------------------------------------------------------------
// AOA (array-of-arrays) normalization — the shape we render as a grid
// ---------------------------------------------------------------------------

// Normalize a ragged array-of-arrays (rows of cells) into a rectangular grid:
//   • every row becomes an array of exactly `cols` entries
//   • cells are coerced to display strings ('' for null/undefined)
//   • trailing fully-empty rows are trimmed (best-effort, so a sheet that reports a huge
//     used-range of blanks doesn't render thousands of empty rows)
// Returns { rows: string[][], cols, rowCount }.
export function normalizeAoa(aoa, { maxRows = Infinity } = {}) {
  const src = Array.isArray(aoa) ? aoa : []
  // Determine width from the widest row.
  let cols = 0
  for (const r of src) if (Array.isArray(r) && r.length > cols) cols = r.length
  if (cols === 0) cols = 1

  // Trim trailing empty rows.
  let last = -1
  for (let i = 0; i < src.length; i++) {
    const r = src[i]
    if (Array.isArray(r) && r.some(c => !isBlankCell(c))) last = i
  }
  const usedRowCount = last + 1

  const limit = Math.min(usedRowCount, maxRows === Infinity ? usedRowCount : maxRows)
  const rows = []
  for (let i = 0; i < limit; i++) {
    const r = Array.isArray(src[i]) ? src[i] : []
    const row = new Array(cols)
    for (let c = 0; c < cols; c++) row[c] = cellToString(r[c])
    rows.push(row)
  }
  return { rows, cols, rowCount: usedRowCount }
}

export function isBlankCell(v) {
  return v === null || v === undefined || v === ''
}

// Coerce any cell value (string/number/boolean/Date) to a display string.
export function cellToString(v) {
  if (v === null || v === undefined) return ''
  if (typeof v === 'string') return v
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : ''
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE'
  if (v instanceof Date) return isNaN(v.getTime()) ? '' : v.toISOString().slice(0, 10)
  // SheetJS rich-text / objects: best-effort.
  if (typeof v === 'object') {
    if (typeof v.text === 'string') return v.text
    if (typeof v.w === 'string') return v.w
    if (typeof v.v !== 'undefined') return cellToString(v.v)
  }
  return String(v)
}

// ---------------------------------------------------------------------------
// pptx OOXML text extraction (pure — operates on already-parsed XML strings)
// ---------------------------------------------------------------------------

// XML entity decode for the handful that appear in DrawingML text runs.
export function decodeXmlEntities(s = '') {
  return String(s)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => safeCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => safeCodePoint(parseInt(d, 10)))
    .replace(/&amp;/g, '&') // last, so we don't double-decode
}

function safeCodePoint(cp) {
  try { return Number.isFinite(cp) ? String.fromCodePoint(cp) : '' } catch { return '' }
}

// Extract the visible text of a single slide's XML, paragraph by paragraph. We pull every <a:t>
// run, grouping runs that belong to the same <a:p> onto one line, and treat <a:br> as a line break.
// This is the text fallback (and feeds the "honest" preview when shapes can't be positioned).
// Returns an array of paragraph strings (no empty trailing paragraphs).
export function extractSlideParagraphs(slideXml = '') {
  const xml = String(slideXml)
  const paras = []
  // Split on paragraph boundaries. We keep it regex-based (no DOM) so it runs in node for tests.
  const pRegex = /<a:p\b[^>]*>([\s\S]*?)<\/a:p>/g
  let pm
  let matchedAnyP = false
  while ((pm = pRegex.exec(xml)) !== null) {
    matchedAnyP = true
    paras.push(paragraphText(pm[1]))
  }
  // Some minimal decks omit explicit <a:p> wrappers; fall back to scraping all <a:t> runs.
  if (!matchedAnyP) {
    const all = scrapeRuns(xml)
    if (all) paras.push(all)
  }
  // Drop trailing empties but keep interior blank lines (they’re intentional spacing).
  while (paras.length && paras[paras.length - 1].trim() === '') paras.pop()
  return paras
}

// Join the <a:t> runs inside one paragraph body, honoring <a:br/> as a soft line break.
function paragraphText(pBody = '') {
  // Normalize <a:br> to a marker, then collect runs in document order.
  const withBreaks = pBody.replace(/<a:br\b[^>]*\/?>(?:<\/a:br>)?/g, '')
  let out = ''
  const tRegex = /<a:t\b[^>]*>([\s\S]*?)<\/a:t>|()/g
  let m
  while ((m = tRegex.exec(withBreaks)) !== null) {
    if (m[2] === '') out += '\n'
    else out += decodeXmlEntities(m[1])
  }
  return out
}

function scrapeRuns(xml = '') {
  const tRegex = /<a:t\b[^>]*>([\s\S]*?)<\/a:t>/g
  let m, out = ''
  while ((m = tRegex.exec(xml)) !== null) out += decodeXmlEntities(m[1])
  return out
}

// Convenience: collapse a slide's paragraphs to a single plain-text blob (for thumbnails/search).
export function slidePlainText(slideXml = '') {
  return extractSlideParagraphs(slideXml).join('\n').trim()
}

// ---------------------------------------------------------------------------
// pptx geometry — EMU (English Metric Units) → fraction of the slide
// ---------------------------------------------------------------------------

// PowerPoint positions everything in EMUs. 914400 EMU = 1 inch. A 16:9 deck is typically
// 12192000 x 6858000 EMU. We render slides into a fixed-aspect box and position shapes as a
// percentage of the slide size, so the preview scales responsively without overflow.
export const EMU_PER_INCH = 914400
export const DEFAULT_SLIDE_W = 12192000 // 16:9 default (matches PowerPoint)
export const DEFAULT_SLIDE_H = 6858000

// Convert an EMU offset/extent to a percentage of the slide dimension, clamped to [0,100].
export function emuToPct(emu, slideEmu) {
  const v = Number(emu)
  const d = Number(slideEmu)
  if (!Number.isFinite(v) || !Number.isFinite(d) || d <= 0) return 0
  return Math.max(0, Math.min(100, (v / d) * 100))
}

// Build a CSS-friendly box { leftPct, topPct, widthPct, heightPct } from a DrawingML xfrm
// { x, y, cx, cy } in EMU and the slide size. Width/height are clamped so a box never spills
// past the slide edge in the preview.
export function xfrmToBox(xfrm, slideW = DEFAULT_SLIDE_W, slideH = DEFAULT_SLIDE_H) {
  const x = xfrm?.x ?? 0, y = xfrm?.y ?? 0, cx = xfrm?.cx ?? 0, cy = xfrm?.cy ?? 0
  const leftPct = emuToPct(x, slideW)
  const topPct = emuToPct(y, slideH)
  const widthPct = Math.max(0, Math.min(100 - leftPct, emuToPct(cx, slideW)))
  const heightPct = Math.max(0, Math.min(100 - topPct, emuToPct(cy, slideH)))
  return { leftPct, topPct, widthPct, heightPct }
}

// Parse a DrawingML <a:off x= y=/> and <a:ext cx= cy=/> out of an <a:xfrm> string. Returns
// { x, y, cx, cy } (numbers, missing → undefined) or null if no xfrm present.
export function parseXfrm(xml = '') {
  const block = String(xml)
  const xfrmMatch = block.match(/<a:xfrm\b[^>]*>([\s\S]*?)<\/a:xfrm>/)
  const inner = xfrmMatch ? xfrmMatch[1] : block
  const off = inner.match(/<a:off\b[^>]*\bx="(-?\d+)"[^>]*\by="(-?\d+)"/)
  const ext = inner.match(/<a:ext\b[^>]*\bcx="(\d+)"[^>]*\bcy="(\d+)"/)
  if (!off && !ext) return null
  return {
    x: off ? Number(off[1]) : undefined,
    y: off ? Number(off[2]) : undefined,
    cx: ext ? Number(ext[1]) : undefined,
    cy: ext ? Number(ext[2]) : undefined,
  }
}

// Pull the slide size out of presentation.xml (<p:sldSz cx= cy=/>). Falls back to the 16:9 default.
export function parseSlideSize(presentationXml = '') {
  const m = String(presentationXml).match(/<p:sldSz\b[^>]*\bcx="(\d+)"[^>]*\bcy="(\d+)"/)
  if (!m) return { cx: DEFAULT_SLIDE_W, cy: DEFAULT_SLIDE_H }
  return { cx: Number(m[1]) || DEFAULT_SLIDE_W, cy: Number(m[2]) || DEFAULT_SLIDE_H }
}

// Order slide part names (ppt/slides/slideN.xml) by their numeric index so navigation matches the
// deck order. (Presentation order technically comes from presentation.xml's r:id list, but numeric
// slideN ordering is correct for the overwhelming majority of decks and needs no rels resolution.)
export function sortSlidePaths(paths = []) {
  return [...paths]
    .filter(p => /slides\/slide\d+\.xml$/i.test(p))
    .sort((a, b) => slideNum(a) - slideNum(b))
}

function slideNum(p) {
  const m = String(p).match(/slide(\d+)\.xml$/i)
  return m ? Number(m[1]) : 0
}

// ---------------------------------------------------------------------------
// Misc display
// ---------------------------------------------------------------------------

export function formatBytes(n) {
  const b = Number(n) || 0
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`
  return `${(b / (1024 * 1024)).toFixed(1)} MB`
}

// Hard caps so a pathological sheet can never freeze the tab. The grid is capped and the UI shows a
// "showing N of M" note when truncated.
export const MAX_GRID_ROWS = 2000
export const MAX_GRID_COLS = 200
