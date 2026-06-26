import { describe, it, expect } from 'vitest'
import { pixelate, boxBlur, normalizeRect } from '../redact'

// Build a checkerboard-ish RGBA image for deterministic tests.
function makeImage(width, height, fill) {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    const o = i * 4
    const v = fill != null ? fill : (i % 2 === 0 ? 0 : 255)
    data[o] = v; data[o + 1] = v; data[o + 2] = v; data[o + 3] = 255
  }
  return { data, width, height }
}

function px(img, x, y) {
  const i = (y * img.width + x) * 4
  return [img.data[i], img.data[i + 1], img.data[i + 2], img.data[i + 3]]
}

describe('normalizeRect', () => {
  it('orders corners into non-negative w/h', () => {
    expect(normalizeRect(10, 10, 30, 40)).toEqual({ x: 10, y: 10, w: 20, h: 30 })
    expect(normalizeRect(30, 40, 10, 10)).toEqual({ x: 10, y: 10, w: 20, h: 30 })
    expect(normalizeRect(5, 5, 5, 5)).toEqual({ x: 5, y: 5, w: 0, h: 0 })
  })
})

describe('pixelate', () => {
  it('flattens each block to a single averaged colour', () => {
    // 4x4 alternating 0/255 -> a 4x4 block averages to ~128 everywhere.
    const img = makeImage(4, 4)
    pixelate(img, { x: 0, y: 0, w: 4, h: 4 }, 4)
    const first = px(img, 0, 0)
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        expect(px(img, x, y)).toEqual(first)
      }
    }
    expect(first[0]).toBeGreaterThan(120)
    expect(first[0]).toBeLessThan(136)
  })

  it('only affects pixels inside the rect', () => {
    const img = makeImage(8, 8, 100)
    // mark an outside pixel distinctly
    const outside = (7 * 8 + 7) * 4
    img.data[outside] = 5
    pixelate(img, { x: 0, y: 0, w: 4, h: 4 }, 2)
    expect(img.data[outside]).toBe(5) // untouched
  })

  it('clamps a rect that exceeds bounds without throwing', () => {
    const img = makeImage(4, 4, 50)
    expect(() => pixelate(img, { x: 2, y: 2, w: 100, h: 100 }, 3)).not.toThrow()
  })

  it('blockSize 1 is a no-op on colour values', () => {
    const img = makeImage(3, 3)
    const before = Array.from(img.data)
    pixelate(img, { x: 0, y: 0, w: 3, h: 3 }, 1)
    expect(Array.from(img.data)).toEqual(before)
  })
})

describe('boxBlur', () => {
  it('smooths high-contrast regions toward the local mean', () => {
    const img = makeImage(8, 8) // alternating 0/255
    boxBlur(img, { x: 0, y: 0, w: 8, h: 8 }, 2, 3)
    // After blur, interior pixels should be pulled away from pure 0/255 extremes.
    const center = px(img, 4, 4)
    expect(center[0]).toBeGreaterThan(40)
    expect(center[0]).toBeLessThan(215)
  })

  it('does not modify pixels outside the rect', () => {
    const img = makeImage(10, 10, 200)
    const outside = (9 * 10 + 9) * 4
    img.data[outside] = 3
    boxBlur(img, { x: 0, y: 0, w: 4, h: 4 }, 2, 2)
    expect(img.data[outside]).toBe(3)
  })

  it('handles an empty/degenerate rect safely', () => {
    const img = makeImage(4, 4, 100)
    const before = Array.from(img.data)
    boxBlur(img, { x: 0, y: 0, w: 0, h: 0 }, 2)
    expect(Array.from(img.data)).toEqual(before)
  })

  it('preserves a uniform region (mean of constant is constant)', () => {
    const img = makeImage(6, 6, 123)
    boxBlur(img, { x: 1, y: 1, w: 4, h: 4 }, 2, 2)
    expect(px(img, 3, 3)).toEqual([123, 123, 123, 255])
  })
})
