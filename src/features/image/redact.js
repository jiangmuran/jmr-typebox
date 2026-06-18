// Pure pixel algorithms for the redact tool, operating on raw RGBA buffers so they can be
// unit-tested without a real Canvas. Each takes/returns a plain object shaped like ImageData:
//   { data: Uint8ClampedArray|Array, width, height }
// They mutate `data` in place (matching how ctx.getImageData/putImageData is used) and also
// return it for convenience.

function idx(x, y, width) {
  return (y * width + x) * 4
}

// Pixelate / mosaic: average each blockSize x blockSize cell and flood it with that colour.
// Restricted to the rectangle [x0,y0,w,h]; coordinates are clamped to the buffer.
export function pixelate(image, rect, blockSize = 12) {
  const { data, width, height } = image
  const block = Math.max(1, Math.floor(blockSize))
  const x0 = clampInt(rect.x, 0, width)
  const y0 = clampInt(rect.y, 0, height)
  const x1 = clampInt(rect.x + rect.w, 0, width)
  const y1 = clampInt(rect.y + rect.h, 0, height)

  for (let by = y0; by < y1; by += block) {
    for (let bx = x0; bx < x1; bx += block) {
      const xEnd = Math.min(bx + block, x1)
      const yEnd = Math.min(by + block, y1)
      let r = 0, g = 0, b = 0, a = 0, count = 0
      for (let y = by; y < yEnd; y++) {
        for (let x = bx; x < xEnd; x++) {
          const i = idx(x, y, width)
          r += data[i]; g += data[i + 1]; b += data[i + 2]; a += data[i + 3]
          count++
        }
      }
      if (!count) continue
      r = Math.round(r / count); g = Math.round(g / count)
      b = Math.round(b / count); a = Math.round(a / count)
      for (let y = by; y < yEnd; y++) {
        for (let x = bx; x < xEnd; x++) {
          const i = idx(x, y, width)
          data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = a
        }
      }
    }
  }
  return image
}

// Box blur approximating a gaussian when applied repeatedly. `radius` is the kernel half-width.
// Operates only within the rectangle but samples neighbours (clamped to the rect) so the region
// is self-contained. `passes` (default 3) stacks box blurs for a smoother, gaussian-ish result.
export function boxBlur(image, rect, radius = 4, passes = 3) {
  const { data, width, height } = image
  const r = Math.max(1, Math.floor(radius))
  const x0 = clampInt(rect.x, 0, width)
  const y0 = clampInt(rect.y, 0, height)
  const x1 = clampInt(rect.x + rect.w, 0, width)
  const y1 = clampInt(rect.y + rect.h, 0, height)
  const rw = x1 - x0
  const rh = y1 - y0
  if (rw <= 0 || rh <= 0) return image

  // Copy the rectangle into a compact working buffer to avoid bleeding outside pixels.
  let buf = new Float32Array(rw * rh * 4)
  for (let y = 0; y < rh; y++) {
    for (let x = 0; x < rw; x++) {
      const src = idx(x0 + x, y0 + y, width)
      const dst = (y * rw + x) * 4
      buf[dst] = data[src]; buf[dst + 1] = data[src + 1]
      buf[dst + 2] = data[src + 2]; buf[dst + 3] = data[src + 3]
    }
  }

  for (let p = 0; p < passes; p++) {
    buf = blurPassH(buf, rw, rh, r)
    buf = blurPassV(buf, rw, rh, r)
  }

  for (let y = 0; y < rh; y++) {
    for (let x = 0; x < rw; x++) {
      const src = (y * rw + x) * 4
      const dst = idx(x0 + x, y0 + y, width)
      data[dst] = Math.round(buf[src]); data[dst + 1] = Math.round(buf[src + 1])
      data[dst + 2] = Math.round(buf[src + 2]); data[dst + 3] = Math.round(buf[src + 3])
    }
  }
  return image
}

function blurPassH(buf, w, h, r) {
  const out = new Float32Array(buf.length)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r0 = 0, g0 = 0, b0 = 0, a0 = 0, n = 0
      for (let k = -r; k <= r; k++) {
        const xx = clampInt(x + k, 0, w - 1)
        const i = (y * w + xx) * 4
        r0 += buf[i]; g0 += buf[i + 1]; b0 += buf[i + 2]; a0 += buf[i + 3]; n++
      }
      const o = (y * w + x) * 4
      out[o] = r0 / n; out[o + 1] = g0 / n; out[o + 2] = b0 / n; out[o + 3] = a0 / n
    }
  }
  return out
}

function blurPassV(buf, w, h, r) {
  const out = new Float32Array(buf.length)
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      let r0 = 0, g0 = 0, b0 = 0, a0 = 0, n = 0
      for (let k = -r; k <= r; k++) {
        const yy = clampInt(y + k, 0, h - 1)
        const i = (yy * w + x) * 4
        r0 += buf[i]; g0 += buf[i + 1]; b0 += buf[i + 2]; a0 += buf[i + 3]; n++
      }
      const o = (y * w + x) * 4
      out[o] = r0 / n; out[o + 1] = g0 / n; out[o + 2] = b0 / n; out[o + 3] = a0 / n
    }
  }
  return out
}

// Normalize a drag (two corner points) into a non-negative {x,y,w,h} rectangle.
export function normalizeRect(x1, y1, x2, y2) {
  const x = Math.min(x1, x2)
  const y = Math.min(y1, y2)
  return { x, y, w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) }
}

function clampInt(value, min, max) {
  const n = Math.round(Number(value) || 0)
  return Math.min(max, Math.max(min, n))
}
