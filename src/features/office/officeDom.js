// Tiny DOM helpers for the Office suite. Imported lazily from components so nothing touches
// document/URL at module eval (SSG-safe). Mirrors the media suite's mediaDom.

export function downloadBlob(blob, name) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => { try { URL.revokeObjectURL(a.href) } catch { /* ignore */ } }, 1000)
}
