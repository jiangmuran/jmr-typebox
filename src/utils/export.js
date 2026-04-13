import { renderMarkdown, buildStandaloneHTML } from './markdown'
import { loadScript } from './loadScript'

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

export function exportHTML(content, filename) {
  const html = renderMarkdown(content)
  downloadBlob(buildStandaloneHTML(filename, html), `${filename}.html`, 'text/html;charset=utf-8')
  return { key: 'toast.downloaded', params: { name: `${filename}.html` } }
}

export async function exportPDF(content, filename) {
  await Promise.all([
    loadScript('https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js'),
    loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'),
  ])
  const el = createExportElement(renderMarkdown(content), false)
  el.style.background = '#fff'; el.style.color = '#1c1c1e'
  const canvas = await window.html2canvas(el, { scale: 2, useCORS: true, backgroundColor: '#fff', logging: false })
  document.body.removeChild(el)

  const { jsPDF } = window.jspdf
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
  await loadScript('https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js')
  const el = createExportElement(renderMarkdown(content), isDark)

  // Branding footer
  const footer = document.createElement('div')
  const borderColor = isDark ? '#38383a' : '#e5e5ea'
  const textColor = isDark ? '#636366' : '#aeaeb2'
  footer.style.cssText = `margin-top:32px;padding-top:16px;border-top:1px solid ${borderColor};font-size:12px;color:${textColor};display:flex;align-items:center;gap:8px;`
  footer.innerHTML = `<svg viewBox="0 0 16 16" width="14" height="14"><defs><linearGradient id="wg" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#a78bfa"/><stop offset="100%" stop-color="#6366f1"/></linearGradient></defs><rect width="16" height="16" rx="4" fill="url(#wg)"/><path d="M5 5.5h6M8 5.5v6" stroke="#fff" stroke-width="1.4" stroke-linecap="round"/></svg><span>Made with TypeBox · github.com/jmr/typebox</span>`
  el.appendChild(footer)

  const bg = isDark ? '#1c1c1e' : '#fff'
  const canvas = await window.html2canvas(el, { scale: 2, useCORS: true, backgroundColor: bg, logging: false })
  document.body.removeChild(el)
  const link = document.createElement('a'); link.download = `${filename}.png`; link.href = canvas.toDataURL('image/png'); link.click()
  return { key: 'toast.pngDone' }
}

export async function copyHTML(content) {
  const html = renderMarkdown(content)
  try { await navigator.clipboard.writeText(html) } catch { await fallbackCopy(html) }
  return { key: 'toast.htmlCopied' }
}

export async function copyMarkdown(content) {
  try { await navigator.clipboard.writeText(content) } catch { await fallbackCopy(content) }
  return { key: 'toast.mdCopied' }
}
