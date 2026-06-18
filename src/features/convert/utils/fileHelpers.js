// Pure filename / MIME helpers for the Convert suite. No DOM access here so they
// are unit-testable; the actual download() touches the DOM and is guarded.

export const MIME = {
  html: 'text/html;charset=utf-8',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pdf: 'application/pdf',
  md: 'text/markdown;charset=utf-8',
  txt: 'text/plain;charset=utf-8',
}

// Strip a trailing extension (any of the common ones we accept) and trim.
export function stripExt(name) {
  return String(name || '')
    .replace(/\.(md|markdown|txt|pdf|docx|html?|png|jpe?g|webp)$/i, '')
    .trim()
}

// Produce a safe base filename. Falls back to `fallback` when empty after
// sanitizing. Removes characters illegal in filenames on common OSes; spaces are
// kept (valid in filenames) but collapsed.
export function safeBaseName(name, fallback = 'document') {
  const base = stripExt(name)
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return base || fallback
}

// Build a full filename with the given extension (no leading dot needed).
export function withExt(name, ext, fallback = 'document') {
  const clean = ext.replace(/^\./, '')
  return `${safeBaseName(name, fallback)}.${clean}`
}

// First non-empty line of a markdown doc, used to title HTML/PDF output.
// Strips a leading "# " so an H1 becomes a clean title.
export function deriveTitle(markdown, fallback = 'Document') {
  const lines = String(markdown || '').split('\n')
  for (const raw of lines) {
    const line = raw.trim()
    if (line) return line.replace(/^#{1,6}\s+/, '').replace(/[*_`]/g, '').trim() || fallback
  }
  return fallback
}

// Map a dropped/selected File to the converter input kind we expect.
// Returns 'markdown' | 'pdf' | null.
export function fileKind(file) {
  if (!file) return null
  const name = (file.name || '').toLowerCase()
  if (name.endsWith('.pdf') || file.type === 'application/pdf') return 'pdf'
  if (/\.(md|markdown|txt)$/.test(name) || (file.type || '').startsWith('text')) return 'markdown'
  return null
}

// DOM download helper (guarded so importing this module is SSG-safe).
export function downloadBlob(blob, filename) {
  if (typeof document === 'undefined' || typeof URL === 'undefined') return
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Revoke on next tick so the click is processed first.
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

export function downloadText(text, filename, mime) {
  if (typeof Blob === 'undefined') return
  downloadBlob(new Blob([text], { type: mime }), filename)
}
