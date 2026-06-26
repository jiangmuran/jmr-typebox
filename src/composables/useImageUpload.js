import { useSettings } from './useSettings'

// Image-host (图床) upload client. Pasting/dropping an image in the editor calls
// `uploadImage(file, …)`, which validates the file, picks an endpoint, and uploads via
// XMLHttpRequest so a real upload progress bar can be driven (fetch can't report upload
// progress). Resolves with the public URL of the stored image.
//
// Endpoint selection:
//   • Custom host configured (Settings → imageHostUrl) → upload DIRECTLY to that URL with the
//     user's Bearer key (imageHostKey).
//   • Otherwise → POST to the same-origin `/api/upload` proxy (the Worker attaches the shared
//     host's secret key server-side; no key ever reaches the client).

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024 // 5 MB
const PROXY_PATH = '/api/upload'

export class ImageUploadError extends Error {
  constructor(message, { status, code } = {}) {
    super(message)
    this.name = 'ImageUploadError'
    this.status = status
    this.code = code
  }
}

// Validate a File/Blob is an image and within the size limit. Throws ImageUploadError with a
// `code` ('type' | 'size' | 'empty') so callers can localize the message. Pure (no DOM).
export function validateImageFile(file, { maxBytes = MAX_IMAGE_BYTES } = {}) {
  if (!file) throw new ImageUploadError('No file provided', { code: 'empty' })
  const type = file.type || ''
  if (!type.startsWith('image/')) {
    throw new ImageUploadError('Only image files can be uploaded', { code: 'type' })
  }
  if (typeof file.size === 'number' && file.size > maxBytes) {
    throw new ImageUploadError('Image is larger than 5 MB', { code: 'size' })
  }
  return true
}

// Decide where to upload, given the current settings. Returns { url, direct, key }.
// Custom host → direct upload with the user's key; otherwise the same-origin proxy.
export function resolveEndpoint(settings = {}) {
  const customUrl = (settings.imageHostUrl || '').trim()
  if (customUrl) {
    return { url: customUrl, direct: true, key: (settings.imageHostKey || '').trim() }
  }
  return { url: PROXY_PATH, direct: false, key: '' }
}

// Extract the public URL from the various JSON shapes image hosts return. Pure.
export function parseUploadResponse(data) {
  if (typeof data === 'string') {
    const s = data.trim()
    // Some hosts return a bare URL string.
    if (/^https?:\/\//i.test(s)) return s
    try { data = JSON.parse(s) } catch { return '' }
  }
  if (!data || typeof data !== 'object') return ''
  const cands = [
    data.url,
    data.link,
    data.src,
    data.data?.url,
    data.data?.link,
    data.data?.src,
    data.result?.url,
    Array.isArray(data.data) ? data.data[0]?.url : undefined,
  ]
  for (const c of cands) {
    if (typeof c === 'string' && c) return c
  }
  return ''
}

// Perform the XHR upload. Exported (and DOM-only) so the composable stays thin; resolves the
// public URL. `onProgress(0..1)` fires during the upload; `signal` (AbortSignal) cancels it.
export function xhrUpload(file, { url, direct, key, onProgress, signal } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new DOMException('Aborted', 'AbortError')); return }

    const xhr = new XMLHttpRequest()
    xhr.open('POST', url, true)
    if (direct && key) xhr.setRequestHeader('Authorization', `Bearer ${key}`)

    const onAbort = () => { try { xhr.abort() } catch {} }
    if (signal) signal.addEventListener('abort', onAbort, { once: true })
    const cleanup = () => { if (signal) signal.removeEventListener('abort', onAbort) }

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && typeof onProgress === 'function') {
        onProgress(Math.min(1, e.loaded / e.total))
      }
    }

    xhr.onload = () => {
      cleanup()
      let data = null
      try { data = JSON.parse(xhr.responseText) } catch { data = xhr.responseText }
      if (xhr.status < 200 || xhr.status >= 300) {
        const detail = (data && typeof data === 'object' && (data.error || data.message)) || `HTTP ${xhr.status}`
        reject(new ImageUploadError(String(detail), { status: xhr.status }))
        return
      }
      const link = parseUploadResponse(data)
      if (!link) { reject(new ImageUploadError('Upload succeeded but no URL was returned', { status: xhr.status })); return }
      resolve(link)
    }

    xhr.onerror = () => { cleanup(); reject(new ImageUploadError('Network error during upload')) }
    xhr.ontimeout = () => { cleanup(); reject(new ImageUploadError('Upload timed out')) }
    xhr.onabort = () => { cleanup(); reject(new DOMException('Aborted', 'AbortError')) }

    xhr.timeout = 60000

    const form = new FormData()
    form.append('file', file, file.name || 'image.png')
    xhr.send(form)
  })
}

export function useImageUpload() {
  const { settings } = useSettings()

  // Upload `file` and resolve its public URL. Validates first (throws ImageUploadError on a
  // non-image or > 5 MB file). `onProgress(0..1)` drives a progress bar; `signal` cancels.
  async function uploadImage(file, { onProgress, signal } = {}) {
    validateImageFile(file)
    const { url, direct, key } = resolveEndpoint(settings)
    // The default path uses our same-origin /api/upload proxy — that's "the backend". When the
    // master backend toggle is off (and no custom host is set), uploading is unavailable.
    if (!direct && !settings.backendEnabled) {
      throw new ImageUploadError('Backend is disabled', { code: 'backend' })
    }
    return xhrUpload(file, { url, direct, key, onProgress, signal })
  }

  return { uploadImage, validateImageFile, resolveEndpoint, MAX_IMAGE_BYTES }
}
