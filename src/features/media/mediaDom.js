// Tiny client-only DOM helpers for the media pages. No top-level side effects; only called from
// event handlers, so importing during SSG is safe.

// Build a shareable deep link for NCM content. kind: 'song' | 'playlist'. The player page
// consumes these query params on mount (plays the song / opens the playlist drawer).
export function ncmShareUrl(kind, id) {
  const base = typeof location !== 'undefined' ? location.origin : ''
  return `${base}/media/player?${kind}=${encodeURIComponent(String(id))}`
}

// Share a URL via the native share sheet when available, else copy it to the clipboard.
// Returns 'shared' | 'copied' | 'cancelled' | false — callers toast on 'copied'/false only
// (the OS sheet is its own feedback, and a user-dismissed sheet needs no nagging).
export async function shareOrCopy(url, title = '') {
  if (typeof navigator === 'undefined') return false
  if (navigator.share) {
    try { await navigator.share({ title: title || url, url }); return 'shared' } catch (e) {
      if (e?.name === 'AbortError') return 'cancelled'
      // NotAllowedError etc. → fall through to the clipboard path
    }
  }
  try { await navigator.clipboard.writeText(url); return 'copied' } catch { return false }
}

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
