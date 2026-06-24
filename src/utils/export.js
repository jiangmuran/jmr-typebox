import { renderMarkdown, buildStandaloneHTML } from './markdown'
import { prerenderMermaid, hasMermaid } from './mermaid'

// Math present? -> embed KaTeX CSS (with bundled fonts) so a standalone/exported
// document styles it. Lazy so no-math exports stay lean.
async function katexCssIfNeeded(html) {
  if (typeof html !== 'string' || html.indexOf('class="katex') === -1) return ''
  try {
    const { getKatexCss } = await import('./katexCss')
    return await getKatexCss()
  } catch { return '' }
}

function downloadBlob(content, filename, type) {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

function createExportElement(html, isDark) {
  const el = document.createElement('div')
  el.innerHTML = html
  el.style.cssText = `position:fixed;left:-9999px;top:0;width:816px;padding:48px;background:${isDark ? '#1c1c1e' : '#fff'};color:${isDark ? '#f5f5f7' : '#1c1c1e'};font-family:-apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;font-size:15px;line-height:1.7;`
  el.className = 'markdown-body'
  document.body.appendChild(el)
  return el
}

async function fallbackCopy(text) {
  const ta = document.createElement('textarea')
  ta.value = text; ta.style.cssText = 'position:fixed;left:-9999px'
  document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta)
}

// All export functions return {key, params} for i18n toast messages

export function exportTXT(content, filename) {
  downloadBlob(content, `${filename}.txt`, 'text/plain;charset=utf-8')
  return { key: 'toast.downloaded', params: { name: `${filename}.txt` } }
}

export function exportMD(content, filename) {
  downloadBlob(content, `${filename}.md`, 'text/markdown;charset=utf-8')
  return { key: 'toast.downloaded', params: { name: `${filename}.md` } }
}

export async function exportHTML(content, filename, isDark = false) {
  let html = renderMarkdown(content)
  html = await prerenderMermaid(html, isDark) // diagrams -> inline SVG
  const katexCss = await katexCssIfNeeded(html)
  downloadBlob(buildStandaloneHTML(filename, html, { katexCss }), `${filename}.html`, 'text/html;charset=utf-8')
  return { key: 'toast.downloaded', params: { name: `${filename}.html` } }
}

export async function exportPDF(content, filename) {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
    import('html2canvas'),
    import('jspdf'),
  ])
  const html = renderMarkdown(content)
  const el = createExportElement(html, false)
  el.style.background = '#fff'; el.style.color = '#1c1c1e'
  if (hasMermaid(html)) { const { renderMermaidIn } = await import('./mermaid'); await renderMermaidIn(el, false) }
  const canvas = await html2canvas(el, { scale: 2, useCORS: true, backgroundColor: '#fff', logging: false })
  document.body.removeChild(el)
  const pdf = new jsPDF('p', 'px', 'a4', true)
  const pw = pdf.internal.pageSize.getWidth(), ph = pdf.internal.pageSize.getHeight()
  const ratio = pw / canvas.width
  const pages = Math.ceil(canvas.height * ratio / ph)

  for (let i = 0; i < pages; i++) {
    if (i > 0) pdf.addPage()
    const srcY = Math.round(i * ph / ratio)
    const srcH = Math.min(Math.round(ph / ratio), canvas.height - srcY)
    if (srcH <= 0) break
    const pg = document.createElement('canvas'); pg.width = canvas.width; pg.height = srcH
    pg.getContext('2d').drawImage(canvas, 0, srcY, canvas.width, srcH, 0, 0, canvas.width, srcH)
    pdf.addImage(pg.toDataURL('image/jpeg', 0.94), 'JPEG', 0, 0, pw, srcH * ratio)
  }
  pdf.save(`${filename}.pdf`)
  return { key: 'toast.pdfDone' }
}

export async function exportPNG(content, filename, isDark) {
  const { default: html2canvas } = await import('html2canvas')
  const html = renderMarkdown(content)
  const el = createExportElement(html, isDark)
  if (hasMermaid(html)) { const { renderMermaidIn } = await import('./mermaid'); await renderMermaidIn(el, isDark) }

  // Branding footer
  const footer = document.createElement('div')
  const borderColor = isDark ? '#38383a' : '#e5e5ea'
  const textColor = isDark ? '#636366' : '#aeaeb2'
  footer.style.cssText = `margin-top:32px;padding-top:16px;border-top:1px solid ${borderColor};font-size:12px;color:${textColor};display:flex;align-items:center;gap:8px;`
  footer.innerHTML = `<svg viewBox="0 0 16 16" width="14" height="14"><rect width="16" height="16" rx="4" fill="${isDark ? '#f5f5f7' : '#1c1c1e'}"/><path d="M5 5.5h6M8 5.5v6" stroke="${isDark ? '#1c1c1e' : '#fff'}" stroke-width="1.4" stroke-linecap="round"/></svg><span>Made with TypeBox · box.muran.tech</span>`
  el.appendChild(footer)

  const bg = isDark ? '#1c1c1e' : '#fff'
  const canvas = await html2canvas(el, { scale: 2, useCORS: true, backgroundColor: bg, logging: false })
  document.body.removeChild(el)
  const link = document.createElement('a'); link.download = `${filename}.png`; link.href = canvas.toDataURL('image/png'); link.click()
  return { key: 'toast.pngDone' }
}

// Render themed HTML (a full <html> doc string from buildThemedHtml) to a canvas, isolated in
// an iframe so the export theme's CSS applies faithfully without leaking into the app.
async function renderThemedCanvas(themedHtml) {
  const { default: html2canvas } = await import('html2canvas')
  const iframe = document.createElement('iframe')
  iframe.setAttribute('aria-hidden', 'true')
  iframe.style.cssText = 'position:fixed;left:-9999px;top:0;width:840px;height:1200px;border:0;'
  document.body.appendChild(iframe)
  try {
    await new Promise((res) => { iframe.onload = () => res(); iframe.srcdoc = themedHtml })
    await new Promise((r) => setTimeout(r, 320)) // let fonts + layout settle
    const doc = iframe.contentDocument
    const target = doc.getElementById('write') || doc.body
    const bg = getComputedStyle(doc.body).backgroundColor || '#ffffff'
    return await html2canvas(target, {
      scale: 2, useCORS: true, backgroundColor: bg, logging: false,
      windowWidth: 840, windowHeight: Math.max(target.scrollHeight + 80, 600),
    })
  } finally {
    document.body.removeChild(iframe)
  }
}

export async function exportThemedPNG(filename, themedHtml) {
  const canvas = await renderThemedCanvas(themedHtml)
  const link = document.createElement('a')
  link.download = `${filename}.png`
  link.href = canvas.toDataURL('image/png')
  link.click()
}

export async function copyThemedPNG(themedHtml) {
  if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) throw new Error('clipboard-image-unsupported')
  const canvas = await renderThemedCanvas(themedHtml)
  const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'))
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
}

export async function copyHTML(content, isDark = false) {
  let html = renderMarkdown(content)
  html = await prerenderMermaid(html, isDark) // diagrams -> inline SVG so pasted HTML is self-contained
  try { await navigator.clipboard.writeText(html) } catch { await fallbackCopy(html) }
  return { key: 'toast.htmlCopied' }
}

export async function copyMarkdown(content) {
  try { await navigator.clipboard.writeText(content) } catch { await fallbackCopy(content) }
  return { key: 'toast.mdCopied' }
}
