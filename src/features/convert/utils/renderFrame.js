// Browser-only rendering helpers for the Convert suite: themed standalone HTML,
// print-to-PDF via an offscreen iframe, and an offscreen themed element for the
// image-PDF (html2canvas) path. All functions touch the DOM and must only run in
// onMounted/handlers (never at import / SSG time).

import { renderMarkdown } from '../../../utils/markdown.js'
import { getThemeCss, getTheme } from '../themes/registry.js'
import { loadLibrary } from '../../../utils/loadLibrary.js'

// Print page setup: A4 with comfortable margins. Kept in the document CSS so the
// browser's "Save as PDF" produces vector, selectable text.
const PRINT_CSS = `
@page { size: A4; margin: 18mm 16mm; }
html, body { margin: 0; padding: 0; }
body { padding: 0; }
.markdown-body { padding: 0; max-width: 100%; }
.markdown-body pre, .markdown-body table, .markdown-body img, .markdown-body blockquote { break-inside: avoid; }
.markdown-body h1, .markdown-body h2, .markdown-body h3 { break-after: avoid; }
@media screen { body { max-width: 820px; margin: 0 auto; padding: 32px 24px; } }
`

// Build a full, self-contained HTML document with the chosen theme inlined.
// Used for HTML export AND as the document written into the print iframe.
export async function buildThemedHTML(markdown, title, themeId, { includePrintCss = false } = {}) {
  const css = await getThemeCss(themeId)
  const theme = getTheme(themeId)
  const body = renderMarkdown(markdown || '')
  const safeTitle = String(title || 'Document').replace(/[<>&]/g, '')
  const pageBg = theme.swatch?.bg || '#ffffff'
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${safeTitle}</title>
<style>
html { background: ${pageBg}; }
body { margin: 0; }
${css}
${includePrintCss ? PRINT_CSS : `body{max-width:820px;margin:40px auto;padding:0 24px;}`}
</style>
</head>
<body><article class="markdown-body">${body}</article></body>
</html>`
}

// Print / Save-as-PDF: render the themed doc into a hidden iframe and trigger the
// browser print dialog scoped to that iframe (vector + selectable text).
// Resolves once the print dialog has been invoked.
export async function printThemed(markdown, title, themeId) {
  if (typeof document === 'undefined') return
  const html = await buildThemedHTML(markdown, title, themeId, { includePrintCss: true })

  const iframe = document.createElement('iframe')
  iframe.setAttribute('aria-hidden', 'true')
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;'
  document.body.appendChild(iframe)

  await new Promise(resolve => {
    iframe.onload = () => resolve()
    const doc = iframe.contentWindow.document
    doc.open()
    doc.write(html)
    doc.close()
    // Fallback in case onload already fired for about:blank.
    setTimeout(resolve, 300)
  })

  const win = iframe.contentWindow
  // Clean up after the print dialog closes. afterprint isn't always reliable, so
  // also remove on a timeout. Register BEFORE print() since the dialog can block.
  const cleanup = () => { if (iframe.parentNode) iframe.remove() }
  win.onafterprint = cleanup
  setTimeout(cleanup, 60000)

  // Give layout/fonts a moment, then print.
  await new Promise(r => setTimeout(r, 120))
  win.focus()
  win.print()
}

// Build an offscreen themed .markdown-body element for html2canvas capture.
function buildOffscreenEl(html, theme) {
  const wrap = document.createElement('div')
  // Scope the theme CSS to this subtree via a <style> with an id selector.
  const id = 'tb-export-' + Math.random().toString(36).slice(2, 8)
  wrap.id = id
  wrap.style.cssText = `position:fixed;left:-99999px;top:0;width:794px;background:${theme.swatch?.bg || '#fff'};`
  const article = document.createElement('article')
  article.className = 'markdown-body'
  article.style.cssText = 'padding:40px 48px;'
  article.innerHTML = html
  wrap.appendChild(article)
  return wrap
}

// Image-PDF core: rasterize the themed doc with html2canvas and lay it across A4
// pages with jsPDF. Mirrors src/utils/export.js exportPDF but uses the selected
// theme. Returns a jsPDF instance so callers can either .save() or get a Blob.
async function buildImagePdf(markdown, themeId) {
  const [css, { default: html2canvas }, { jsPDF }] = await Promise.all([
    getThemeCss(themeId),
    loadLibrary('html2canvas', () => import('html2canvas'), { sizeMB: 0.5 }),
    loadLibrary('jspdf', () => import('jspdf'), { sizeMB: 0.4 }),
  ])
  const theme = getTheme(themeId)
  const body = renderMarkdown(markdown || '')

  // Inject scoped theme CSS for the capture element.
  const styleEl = document.createElement('style')
  const el = buildOffscreenEl(body, theme)
  styleEl.textContent = css.replace(/\.markdown-body/g, `#${el.id} .markdown-body`)
  document.head.appendChild(styleEl)
  document.body.appendChild(el)

  try {
    const bg = theme.swatch?.bg || '#ffffff'
    const canvas = await html2canvas(el, { scale: 2, useCORS: true, backgroundColor: bg, logging: false })
    const pdf = new jsPDF('p', 'px', 'a4', true)
    const pw = pdf.internal.pageSize.getWidth()
    const ph = pdf.internal.pageSize.getHeight()
    const ratio = pw / canvas.width
    const pages = Math.max(1, Math.ceil((canvas.height * ratio) / ph))
    for (let i = 0; i < pages; i++) {
      if (i > 0) pdf.addPage()
      const srcY = Math.round((i * ph) / ratio)
      const srcH = Math.min(Math.round(ph / ratio), canvas.height - srcY)
      if (srcH <= 0) break
      const pg = document.createElement('canvas')
      pg.width = canvas.width
      pg.height = srcH
      pg.getContext('2d').drawImage(canvas, 0, srcY, canvas.width, srcH, 0, 0, canvas.width, srcH)
      pdf.addImage(pg.toDataURL('image/jpeg', 0.94), 'JPEG', 0, 0, pw, srcH * ratio)
    }
    return pdf
  } finally {
    el.remove()
    styleEl.remove()
  }
}

// UI path: build the image PDF and trigger a download.
export async function imagePdf(markdown, title, themeId, filename) {
  if (typeof document === 'undefined') return
  const pdf = await buildImagePdf(markdown, themeId)
  pdf.save(filename)
}

// Registry path: build the image PDF and return a Blob (no download side effect).
export async function markdownToPdfBlob(markdown, title, themeId) {
  if (typeof document === 'undefined') return null
  const pdf = await buildImagePdf(markdown, themeId)
  return pdf.output('blob')
}
