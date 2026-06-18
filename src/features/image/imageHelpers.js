// Pure, SSG-safe helpers for the Image suite. No window/document/Canvas/Blob access here —
// these operate on plain values so they can be unit-tested in node/jsdom and imported anywhere.

// Map a short format token to its canvas MIME type.
const FORMAT_MIME = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  avif: 'image/avif',
}

export function mimeForFormat(format) {
  return FORMAT_MIME[String(format || '').toLowerCase()] || 'image/png'
}

// Reverse: derive a friendly extension/token from a MIME type.
export function formatForMime(mime) {
  const m = String(mime || '').toLowerCase()
  if (m.includes('jpeg') || m.includes('jpg')) return 'jpg'
  if (m.includes('webp')) return 'webp'
  if (m.includes('avif')) return 'avif'
  if (m.includes('png')) return 'png'
  return 'png'
}

// PNG is lossless: a quality argument to toBlob is ignored, so callers should omit it.
export function isLossy(format) {
  const f = String(format || '').toLowerCase()
  return f === 'jpg' || f === 'jpeg' || f === 'webp' || f === 'avif'
}

// Human-readable byte size.
export function formatSize(bytes) {
  const b = Number(bytes) || 0
  if (b < 1024) return b + ' B'
  if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB'
  return (b / (1024 * 1024)).toFixed(2) + ' MB'
}

// Percentage reduction from `from` -> `to` (negative means it grew). Rounded int.
export function reductionPercent(from, to) {
  const a = Number(from) || 0
  const b = Number(to) || 0
  if (a <= 0) return 0
  return Math.round(((a - b) / a) * 100)
}

export function clamp(value, min, max) {
  const n = Number(value)
  if (Number.isNaN(n)) return min
  return Math.min(max, Math.max(min, n))
}

// Compute target dimensions honoring an optional max width (0/falsey = keep original).
// Never upscales beyond the source width. Preserves aspect ratio; result is integer px.
export function fitDimensions(srcW, srcH, maxWidth) {
  const w0 = Math.max(1, Math.round(Number(srcW) || 1))
  const h0 = Math.max(1, Math.round(Number(srcH) || 1))
  const max = Number(maxWidth) || 0
  if (max <= 0 || max >= w0) return { width: w0, height: h0 }
  const width = max
  const height = Math.max(1, Math.round(h0 * (width / w0)))
  return { width, height }
}

// Swap a filename's extension. Keeps the basename; adds the extension if none present.
export function withExtension(name, ext) {
  const base = String(name || 'image').replace(/\.[^./\\]+$/, '')
  return `${base || 'image'}.${ext}`
}

// Strip any extension to get a clean basename for download naming.
export function baseName(name) {
  return String(name || 'image').replace(/\.[^./\\]+$/, '') || 'image'
}

// Output format options. AVIF is gated behind a runtime feature-detect (see supportsFormat).
export const BASE_FORMATS = ['png', 'jpg', 'webp']

// 9-grid anchor -> normalized {x,y} in [0,1] (0=left/top, 1=right/bottom).
const GRID_ANCHORS = {
  'top-left': { x: 0, y: 0 },
  'top-center': { x: 0.5, y: 0 },
  'top-right': { x: 1, y: 0 },
  'center-left': { x: 0, y: 0.5 },
  center: { x: 0.5, y: 0.5 },
  'center-right': { x: 1, y: 0.5 },
  'bottom-left': { x: 0, y: 1 },
  'bottom-center': { x: 0.5, y: 1 },
  'bottom-right': { x: 1, y: 1 },
}

export const GRID_POSITIONS = Object.keys(GRID_ANCHORS)

// Resolve a watermark's top-left draw point given the canvas, the watermark box size,
// a 9-grid anchor, and an edge margin (px). Result is clamped so the box stays on-canvas.
export function anchorPosition(canvasW, canvasH, boxW, boxH, anchor, margin = 0) {
  const a = GRID_ANCHORS[anchor] || GRID_ANCHORS.center
  const m = Number(margin) || 0
  const freeW = canvasW - boxW
  const freeH = canvasH - boxH
  // Margin pulls toward the nearest edge; center anchors ignore margin.
  const mx = a.x === 0.5 ? 0 : (a.x === 0 ? m : -m)
  const my = a.y === 0.5 ? 0 : (a.y === 0 ? m : -m)
  const x = freeW * a.x + mx
  const y = freeH * a.y + my
  return {
    x: clamp(x, 0, Math.max(0, freeW)),
    y: clamp(y, 0, Math.max(0, freeH)),
  }
}

// Grid of center points to tile a watermark across the whole canvas. `gapX/gapY` are the
// step between tile centers (box size + spacing). Covers edges by starting half a step before 0.
export function tilePositions(canvasW, canvasH, gapX, gapY) {
  const sx = Math.max(1, gapX)
  const sy = Math.max(1, gapY)
  const points = []
  for (let y = sy / 2; y < canvasH + sy; y += sy) {
    for (let x = sx / 2; x < canvasW + sx; x += sx) {
      points.push({ x, y })
    }
  }
  return points
}
