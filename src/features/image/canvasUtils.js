// Browser-only canvas helpers. These DEFINE functions that touch Image/Canvas/Blob, but the
// module has NO top-level side effects, so importing it during SSG is safe — the functions are
// only ever invoked from event handlers / onMounted in the pages.
import { mimeForFormat, isLossy } from './imageHelpers'

// Decode a Blob/File into an HTMLImageElement via an object URL (revoked after load).
export function loadImageFromBlob(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob)
    const img = new Image()
    img.onload = () => { URL.revokeObjectURL(url); resolve(img) }
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(e) }
    img.src = url
  })
}

// Decode from a data URL or remote/object URL string.
export function loadImageFromSrc(src) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })
}

// canvas.toBlob promisified. Returns null if the browser can't encode the requested type
// (e.g. unsupported AVIF/WebP), letting callers fall back.
export function canvasToBlob(canvas, mime, quality) {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), mime, quality)
  })
}

// Copy an image to the clipboard. Clipboards only reliably accept image/png, so a non-PNG blob
// is re-encoded to PNG first. Throws if the Clipboard API / ClipboardItem is unavailable.
export async function copyImageToClipboard(blob) {
  if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) throw new Error('clipboard-unsupported')
  let png = blob
  if (!blob || blob.type !== 'image/png') {
    const img = await loadImageFromBlob(blob)
    const c = makeCanvas(img.naturalWidth, img.naturalHeight)
    c.getContext('2d').drawImage(img, 0, 0)
    png = await canvasToBlob(c, 'image/png')
  }
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })])
}

// Create a 2D canvas of the given size (offscreen, not attached to the DOM).
export function makeCanvas(width, height) {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width))
  canvas.height = Math.max(1, Math.round(height))
  return canvas
}

// Draw an image into a fresh canvas at target dimensions. For lossy formats with no alpha
// channel (jpg), paints a white background so transparency doesn't turn black.
export function drawToCanvas(img, width, height, { background } = {}) {
  const canvas = makeCanvas(width, height)
  const ctx = canvas.getContext('2d')
  ctx.imageSmoothingQuality = 'high'
  if (background) {
    ctx.fillStyle = background
    ctx.fillRect(0, 0, canvas.width, canvas.height)
  }
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  return canvas
}

// Encode a canvas to a given short format token, handling PNG's lack of quality and JPG's
// need for a solid background. Returns { blob, mime, format } or null if encoding failed.
export async function encodeCanvas(canvas, format, qualityPct) {
  const mime = mimeForFormat(format)
  const quality = isLossy(format) ? clampQuality(qualityPct) : undefined
  const blob = await canvasToBlob(canvas, mime, quality)
  if (!blob) return null
  return { blob, mime, format }
}

function clampQuality(pct) {
  const n = Number(pct)
  if (Number.isNaN(n)) return 0.85
  return Math.min(1, Math.max(0.01, n / 100))
}

// Runtime feature-detect for an output MIME by attempting a 1px encode. Cached per-mime.
const supportCache = new Map()
export async function supportsOutputMime(mime) {
  if (supportCache.has(mime)) return supportCache.get(mime)
  let ok = false
  try {
    const c = makeCanvas(2, 2)
    const blob = await canvasToBlob(c, mime, 0.8)
    // Some browsers silently fall back to PNG; verify the returned type matches.
    ok = !!blob && blob.type === mime
  } catch { ok = false }
  supportCache.set(mime, ok)
  return ok
}

// Trigger a browser download for a Blob.
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Defer revoke so the download has time to start.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// Open the OS file picker. Resolves with a FileList-like array (possibly empty).
export function pickImageFiles({ multiple = false } = {}) {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.multiple = multiple
    input.onchange = (e) => resolve(Array.from(e.target.files || []))
    input.click()
  })
}

// Pull the first image File from a paste/drop event's items/files. Returns File|null.
export function imageFileFromEvent(e) {
  const files = e.dataTransfer?.files || e.clipboardData?.files
  if (files && files.length) {
    for (const f of files) if (f.type.startsWith('image/')) return f
  }
  const items = e.clipboardData?.items || e.dataTransfer?.items
  if (items) {
    for (const it of items) {
      if (it.kind === 'file' && it.type.startsWith('image/')) {
        const f = it.getAsFile()
        if (f) return f
      }
    }
  }
  return null
}

// Pull all image Files from a drop/picker event (for batch flows).
export function imageFilesFromEvent(e) {
  const out = []
  const files = e.dataTransfer?.files
  if (files) for (const f of files) if (f.type.startsWith('image/')) out.push(f)
  return out
}
