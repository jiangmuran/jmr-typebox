// Tiny client-only DOM helpers for the media pages. No top-level side effects; only called from
// event handlers, so importing during SSG is safe.

// Trigger a browser download for a Blob with a given filename.
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Defer revoke so the download has time to start.
  setTimeout(() => { try { URL.revokeObjectURL(url) } catch { /* ignore */ } }, 1000)
}
