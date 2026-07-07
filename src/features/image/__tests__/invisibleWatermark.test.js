import { describe, it, expect } from 'vitest'
import { crc16, bytesToBits, bitsToBytes } from '../invisibleWatermark'

describe('crc16 (CCITT-FALSE)', () => {
  it('matches the standard check vector for "123456789"', () => {
    const bytes = new TextEncoder().encode('123456789')
    expect(crc16(bytes)).toBe(0x29b1)
  })
  it('changes when a byte flips', () => {
    const a = crc16(new Uint8Array([1, 2, 3]))
    const b = crc16(new Uint8Array([1, 2, 4]))
    expect(a).not.toBe(b)
  })
})

describe('bit packing', () => {
  it('round-trips bytes → bits → bytes (MSB-first)', () => {
    const bytes = new Uint8Array([0b10110001, 0x00, 0xff, 0x1d])
    const bits = bytesToBits(bytes)
    expect(bits.slice(0, 8)).toEqual(new Uint8Array([1, 0, 1, 1, 0, 0, 0, 1]))
    expect(bitsToBytes(bits)).toEqual(bytes)
  })
})

import {
  SYNC, FORMAT_VERSION, CONTENT_MAX, RECORD_BYTES, RECORD_BITS,
  contentByteLength, fitContent, packRecord, unpackRecord,
} from '../invisibleWatermark'

describe('content helpers', () => {
  it('measures UTF-8 byte length', () => {
    expect(contentByteLength('abc')).toBe(3)
    expect(contentByteLength('中文')).toBe(6) // 3 bytes each
  })
  it('fits content to a byte budget on a char boundary', () => {
    expect(fitContent('abcdefghijklmnopqrstuvwxyz', 16)).toBe('abcdefghijklmnop')
    // 5 CJK chars = 15 bytes fit; a 6th (→18) does not.
    expect(contentByteLength(fitContent('一二三四五六', 16))).toBeLessThanOrEqual(16)
    expect(fitContent('一二三四五六', 16)).toBe('一二三四五')
  })
})

describe('record pack/unpack', () => {
  it('round-trips ASCII content at a fixed record size', () => {
    const rec = packRecord({ version: FORMAT_VERSION, timestamp: 1_700_000_000, content: 'batch-01' })
    expect(rec.length).toBe(RECORD_BYTES)
    expect(RECORD_BITS).toBe(RECORD_BYTES * 8)
    const got = unpackRecord(rec)
    expect(got).toMatchObject({ ok: true, version: FORMAT_VERSION, timestamp: 1_700_000_000, content: 'batch-01' })
  })
  it('round-trips CJK content', () => {
    const rec = packRecord({ version: 1, timestamp: 1_700_000_000, content: '甲乙丙' })
    expect(unpackRecord(rec).content).toBe('甲乙丙')
  })
  it('carries flags', () => {
    const rec = packRecord({ version: 1, flags: 1, timestamp: 42, content: 'x' })
    expect(unpackRecord(rec).flags).toBe(1)
  })
  it('rejects an unmarked buffer (bad SYNC)', () => {
    expect(unpackRecord(new Uint8Array(RECORD_BYTES)).ok).toBe(false)
  })
  it('rejects a corrupted record (CRC fails)', () => {
    const rec = packRecord({ version: 1, timestamp: 42, content: 'x' })
    rec[10] ^= 0xff
    expect(unpackRecord(rec).ok).toBe(false)
  })
  it('throws when content exceeds CONTENT_MAX bytes', () => {
    expect(() => packRecord({ version: 1, timestamp: 0, content: 'x'.repeat(17) })).toThrow()
  })
})

import { toYCbCr, toRGB, dct8x8, idct8x8 } from '../invisibleWatermark'

function almost(a, b, eps = 1e-6) { return Math.abs(a - b) <= eps }

describe('DCT 8x8', () => {
  it('idct(dct(x)) ≈ x', () => {
    const x = Float64Array.from({ length: 64 }, (_, i) => (i * 7) % 256)
    const y = idct8x8(dct8x8(x))
    for (let i = 0; i < 64; i++) expect(almost(y[i], x[i], 1e-6)).toBe(true)
  })
  it('DC term equals 8× the mean for a flat block', () => {
    const flat = new Float64Array(64).fill(10)
    expect(almost(dct8x8(flat)[0], 80, 1e-9)).toBe(true) // orthonormal DC = mean*8
  })
})

describe('YCbCr', () => {
  it('round-trips RGB within ±2 per channel', () => {
    const px = new Uint8ClampedArray([10, 20, 30, 255, 200, 150, 100, 255])
    const { Y, Cb, Cr } = toYCbCr(px, 2, 1)
    const back = toRGB(Y, Cb, Cr, 2, 1)
    for (let i = 0; i < 8; i++) if (i % 4 !== 3) expect(Math.abs(back[i] - px[i])).toBeLessThanOrEqual(2)
  })
})

import {
  DELTA, COEF_INDEX, embedCoef, extractCoef, capacityBlocks, encode, decode,
} from '../invisibleWatermark'

// Deterministic synthetic RGBA image (a smooth gradient) — no canvas needed.
function gradient(w, h) {
  const px = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4
    px[i] = (x * 255 / w) | 0; px[i + 1] = (y * 255 / h) | 0; px[i + 2] = 128; px[i + 3] = 255
  }
  return px
}

describe('QIM coefficient', () => {
  it('embeds and extracts a bit through rounding noise', () => {
    for (const bit of [0, 1]) {
      const c = embedCoef(37.4, bit, 16)
      expect(extractCoef(c, 16)).toBe(bit)
      expect(extractCoef(c + 3, 16)).toBe(bit) // tolerates < delta/2 perturbation
    }
  })
})

describe('encode/decode round-trip (clean)', () => {
  it('recovers the record from a marked image', () => {
    const w = 256, h = 256
    expect(capacityBlocks(w, h)).toBeGreaterThanOrEqual(RECORD_BITS)
    const rec = packRecord({ version: FORMAT_VERSION, timestamp: 1_700_000_000, content: 'trace-A' })
    const marked = encode(gradient(w, h), w, h, rec)
    const got = decode(marked, w, h)
    expect(got).toMatchObject({ ok: true, content: 'trace-A', timestamp: 1_700_000_000 })
    expect(got.confidence).toBeGreaterThan(0.9)
  })
  it('reports ok:false on an unmarked image', () => {
    const w = 256, h = 256
    expect(decode(gradient(w, h), w, h).ok).toBe(false)
  })
})

import { psnr, resampleNearest, decodeMultiScale, dct8x8 as _d, idct8x8 as _id } from '../invisibleWatermark'
import { toYCbCr as _toY, toRGB as _toRGB } from '../invisibleWatermark'

// Standard JPEG luminance quantization table (quality 50).
const JPEG_LUMA_Q50 = [
  16,11,10,16,24,40,51,61, 12,12,14,19,26,58,60,55, 14,13,16,24,40,57,69,56,
  14,17,22,29,51,87,80,62, 18,22,37,56,68,109,103,77, 24,35,55,64,81,104,113,92,
  49,64,78,87,103,121,120,101, 72,92,95,98,112,100,103,99,
]
function qtable(quality) {
  const s = quality < 50 ? 5000 / quality : 200 - quality * 2
  return JPEG_LUMA_Q50.map(q => Math.max(1, Math.floor((q * s + 50) / 100)))
}
function simulateJpegLuma(pixels, w, h, quality) {
  const Q = qtable(quality)
  const { Y, Cb, Cr } = _toY(pixels, w, h)
  const bw = Math.floor(w / 8), bh = Math.floor(h / 8)
  for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) {
    const blk = new Float64Array(64)
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) blk[r * 8 + c] = Y[(by * 8 + r) * w + (bx * 8 + c)] - 128
    const d = _d(blk)
    for (let i = 0; i < 64; i++) d[i] = Math.round(d[i] / Q[i]) * Q[i]
    const o = _id(d)
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) Y[(by * 8 + r) * w + (bx * 8 + c)] = o[r * 8 + c] + 128
  }
  return _toRGB(Y, Cb, Cr, w, h)
}

function gradient2(w, h) {
  const px = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4
    px[i] = (x * 255 / w) | 0; px[i + 1] = (y * 255 / h) | 0; px[i + 2] = 90; px[i + 3] = 255
  }
  return px
}

describe('robustness', () => {
  const w = 512, h = 512
  const rec = packRecord({ version: FORMAT_VERSION, timestamp: 1_700_000_000, content: 'trace-A' })

  it('is imperceptible (PSNR > 38 dB)', () => {
    const src = gradient2(w, h)
    expect(psnr(src, encode(src, w, h, rec))).toBeGreaterThan(38)
  })
  it('survives JPEG re-compression at q70', () => {
    const marked = encode(gradient2(w, h), w, h, rec)
    const jpeg = simulateJpegLuma(marked, w, h, 70)
    expect(decode(jpeg, w, h)).toMatchObject({ ok: true, content: 'trace-A' })
  })
  it('survives brightness/contrast shift', () => {
    const marked = encode(gradient2(w, h), w, h, rec)
    const adj = Uint8ClampedArray.from(marked, (v, i) => (i % 4 === 3 ? v : v * 1.08 + 6))
    expect(decode(adj, w, h).ok).toBe(true)
  })
  it('survives a clean 0.5x downscale via multi-scale decode', () => {
    const marked = encode(gradient2(w, h), w, h, rec)
    const small = resampleNearest(marked, w, h, w / 2, h / 2)
    expect(decodeMultiScale(small, w / 2, h / 2)).toMatchObject({ ok: true, content: 'trace-A' })
  })
})

import { makeJob, duplicateJobs, jobFileName } from '../invisibleWatermark'

describe('job model', () => {
  it('makes a job with a unique id', () => {
    const a = makeJob('imgA', 'x'), b = makeJob('imgB', 'y')
    expect(a.id).not.toBe(b.id)
    expect(a).toMatchObject({ source: 'imgA', content: 'x', status: 'idle' })
  })
  it('duplicates one source into N numbered versions', () => {
    const jobs = duplicateJobs(makeJob('imgA', '客户'), 3)
    expect(jobs).toHaveLength(3)
    expect(jobs.every(j => j.source === 'imgA')).toBe(true)
    expect(jobs.map(j => j.content)).toEqual(['客户 #1', '客户 #2', '客户 #3'])
  })
  it('builds safe filenames', () => {
    expect(jobFileName('photo.jpg', 'trace A/1', 0)).toBe('photo__trace-a-1__1.png')
    expect(jobFileName('photo', '', 4, 'png')).toBe('photo__5.png')
  })
})
