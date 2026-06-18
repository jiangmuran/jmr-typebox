// Markdown -> DOCX for the Convert suite.
//
// Uses @turbodocx/html-to-docx, lazy-imported via loadLibrary. Vite resolves the
// package's "browser" export (dist/html-to-docx.browser.esm.js), whose default
// export is `(html, headerHTML, options, footerHTML) => Promise<Blob>`.
//
// BROWSER-COMPAT NOTE: that browser bundle references a bare `global` (it does
// `Object.prototype.hasOwnProperty.call(global, 'Blob')` to decide its return
// type). `global` is undefined in a Vite browser build and would throw
// `ReferenceError: global is not defined`. We cannot edit vite.config.js (out of
// scope), so we shim `globalThis.global = globalThis` right before invoking the
// library. With that, `global.Blob` is truthy -> the lib returns a real Blob.

import { loadLibrary } from '../../../utils/loadLibrary.js'
import { renderMarkdown } from '../../../utils/markdown.js'
import { MIME } from './fileHelpers.js'

// Word renders the docx using the document's own styles, so we keep the wrapper
// HTML minimal but pass a base font + sane defaults. We deliberately do NOT inject
// the screen export theme CSS here: complex CSS (flex/grid, pseudo-elements) does
// not translate to OOXML and can corrupt output. A light, Word-friendly stylesheet
// gives the most reliable result across themes.
const DOCX_BASE_CSS = `
  body { font-family: Calibri, "PingFang SC", "Microsoft YaHei", sans-serif; font-size: 11pt; line-height: 1.5; color: #1a1a1a; }
  h1 { font-size: 22pt; } h2 { font-size: 17pt; } h3 { font-size: 14pt; }
  h4, h5, h6 { font-size: 12pt; }
  h1, h2, h3, h4, h5, h6 { font-weight: 700; margin: 14pt 0 6pt; }
  p { margin: 0 0 8pt; }
  a { color: #0563c1; }
  blockquote { margin: 8pt 0; padding-left: 12pt; border-left: 3px solid #cccccc; color: #555555; }
  ul, ol { margin: 0 0 8pt 0; }
  code, pre { font-family: Consolas, "Courier New", monospace; }
  pre { background: #f4f4f4; padding: 8pt; border: 1px solid #e0e0e0; }
  code { background: #f4f4f4; padding: 1pt 3pt; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid #bfbfbf; padding: 4pt 8pt; }
  th { background: #f0f0f0; font-weight: 700; }
  img { max-width: 100%; }
`

// PURE + testable: turn markdown into the full HTML string handed to the docx lib.
// `title` becomes the document <title>. Exported separately so tests can assert on
// it without importing the heavy library or touching the DOM.
export function buildDocxHtml(markdown, title = 'Document') {
  const body = renderMarkdown(markdown || '')
  const safeTitle = String(title).replace(/[<>&]/g, '')
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${safeTitle}</title>` +
    `<style>${DOCX_BASE_CSS}</style></head><body class="markdown-body">${body}</body></html>`
}

// Some bundlers/library code expect Node's `global`. Provide it in the browser.
function ensureGlobalShim() {
  if (typeof globalThis !== 'undefined' && typeof globalThis.global === 'undefined') {
    // eslint-disable-next-line no-undef
    globalThis.global = globalThis
  }
}

let converter = null
async function loadConverter() {
  if (converter) return converter
  const mod = await loadLibrary(
    'docx',
    () => import('@turbodocx/html-to-docx'),
    { sizeMB: 1.2 }
  )
  converter = mod.default || mod
  return converter
}

// Browser-only: build a .docx Blob from markdown. Returns a Blob (MIME docx).
export async function markdownToDocxBlob(markdown, title = 'Document', options = {}) {
  ensureGlobalShim()
  const htmlToDocx = await loadConverter()
  const html = buildDocxHtml(markdown, title)
  const result = await htmlToDocx(html, null, {
    table: { row: { cantSplit: true } },
    footer: false,
    pageNumber: false,
    font: 'Calibri',
    ...options,
  })
  // Browser build returns a Blob; normalize just in case an ArrayBuffer comes back.
  if (result instanceof Blob) return result
  return new Blob([result], { type: MIME.docx })
}
