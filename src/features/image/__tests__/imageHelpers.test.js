import { describe, it, expect } from 'vitest'
import {
  mimeForFormat, formatForMime, isLossy, formatSize, reductionPercent,
  clamp, fitDimensions, withExtension, baseName, anchorPosition, GRID_POSITIONS,
  tilePositions,
} from '../imageHelpers'

describe('mimeForFormat / formatForMime', () => {
  it('maps known formats to MIME types', () => {
    expect(mimeForFormat('png')).toBe('image/png')
    expect(mimeForFormat('jpg')).toBe('image/jpeg')
    expect(mimeForFormat('jpeg')).toBe('image/jpeg')
    expect(mimeForFormat('webp')).toBe('image/webp')
    expect(mimeForFormat('avif')).toBe('image/avif')
    expect(mimeForFormat('WEBP')).toBe('image/webp')
  })
  it('falls back to png for unknown/empty', () => {
    expect(mimeForFormat('bmp')).toBe('image/png')
    expect(mimeForFormat('')).toBe('image/png')
    expect(mimeForFormat(undefined)).toBe('image/png')
  })
  it('derives a token from a MIME type', () => {
    expect(formatForMime('image/jpeg')).toBe('jpg')
    expect(formatForMime('image/png')).toBe('png')
    expect(formatForMime('image/webp')).toBe('webp')
    expect(formatForMime('image/avif')).toBe('avif')
    expect(formatForMime('application/octet-stream')).toBe('png')
  })
})

describe('isLossy', () => {
  it('treats jpg/webp/avif as lossy and png as lossless', () => {
    expect(isLossy('jpg')).toBe(true)
    expect(isLossy('jpeg')).toBe(true)
    expect(isLossy('webp')).toBe(true)
    expect(isLossy('avif')).toBe(true)
    expect(isLossy('png')).toBe(false)
  })
})

describe('formatSize', () => {
  it('formats bytes, KB and MB', () => {
    expect(formatSize(0)).toBe('0 B')
    expect(formatSize(512)).toBe('512 B')
    expect(formatSize(1024)).toBe('1.0 KB')
    expect(formatSize(1536)).toBe('1.5 KB')
    expect(formatSize(1024 * 1024)).toBe('1.00 MB')
    expect(formatSize(2.5 * 1024 * 1024)).toBe('2.50 MB')
  })
})

describe('reductionPercent', () => {
  it('computes percent reduction and handles edges', () => {
    expect(reductionPercent(100, 25)).toBe(75)
    expect(reductionPercent(100, 150)).toBe(-50) // grew
    expect(reductionPercent(0, 10)).toBe(0)
    expect(reductionPercent(200, 100)).toBe(50)
  })
})

describe('clamp', () => {
  it('clamps within range and handles NaN', () => {
    expect(clamp(5, 0, 10)).toBe(5)
    expect(clamp(-3, 0, 10)).toBe(0)
    expect(clamp(99, 0, 10)).toBe(10)
    expect(clamp('abc', 1, 10)).toBe(1)
  })
})

describe('fitDimensions', () => {
  it('keeps original when no max or max >= width', () => {
    expect(fitDimensions(800, 600, 0)).toEqual({ width: 800, height: 600 })
    expect(fitDimensions(800, 600, 1000)).toEqual({ width: 800, height: 600 })
    expect(fitDimensions(800, 600, 800)).toEqual({ width: 800, height: 600 })
  })
  it('scales down preserving aspect ratio, integer px', () => {
    expect(fitDimensions(800, 600, 400)).toEqual({ width: 400, height: 300 })
    expect(fitDimensions(1000, 333, 500)).toEqual({ width: 500, height: 167 })
  })
  it('never produces zero dimensions', () => {
    const r = fitDimensions(1000, 1, 2)
    expect(r.width).toBe(2)
    expect(r.height).toBeGreaterThanOrEqual(1)
  })
})

describe('withExtension / baseName', () => {
  it('swaps extensions and falls back', () => {
    expect(withExtension('photo.png', 'jpg')).toBe('photo.jpg')
    expect(withExtension('a.b.c.jpeg', 'webp')).toBe('a.b.c.webp')
    expect(withExtension('noext', 'png')).toBe('noext.png')
    expect(withExtension('', 'png')).toBe('image.png')
  })
  it('strips extension for basename', () => {
    expect(baseName('photo.png')).toBe('photo')
    expect(baseName('a.b.jpg')).toBe('a.b')
    expect(baseName('')).toBe('image')
  })
})

describe('anchorPosition', () => {
  it('exposes nine grid positions', () => {
    expect(GRID_POSITIONS).toHaveLength(9)
    expect(GRID_POSITIONS).toContain('center')
    expect(GRID_POSITIONS).toContain('top-left')
    expect(GRID_POSITIONS).toContain('bottom-right')
  })
  it('centers a box', () => {
    expect(anchorPosition(100, 100, 20, 20, 'center')).toEqual({ x: 40, y: 40 })
  })
  it('anchors corners with margin pulling inward', () => {
    expect(anchorPosition(100, 100, 20, 20, 'top-left', 10)).toEqual({ x: 10, y: 10 })
    expect(anchorPosition(100, 100, 20, 20, 'bottom-right', 10)).toEqual({ x: 70, y: 70 })
    expect(anchorPosition(100, 100, 20, 20, 'top-right', 0)).toEqual({ x: 80, y: 0 })
  })
  it('clamps so the box stays on canvas', () => {
    const r = anchorPosition(100, 100, 20, 20, 'top-left', 999)
    expect(r.x).toBeLessThanOrEqual(80)
    expect(r.x).toBeGreaterThanOrEqual(0)
  })
})

describe('tilePositions', () => {
  it('covers the canvas with a grid of centers', () => {
    const pts = tilePositions(100, 100, 50, 50)
    expect(pts.length).toBeGreaterThan(0)
    // Every point should be within the extended bounds.
    for (const p of pts) {
      expect(p.x).toBeGreaterThan(0)
      expect(p.y).toBeGreaterThan(0)
    }
    // First center starts at half-step.
    expect(pts[0]).toEqual({ x: 25, y: 25 })
  })
  it('guards against zero gaps', () => {
    expect(() => tilePositions(10, 10, 0, 0)).not.toThrow()
  })
})
