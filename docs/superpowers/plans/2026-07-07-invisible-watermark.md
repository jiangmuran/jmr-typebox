# Invisible Watermark Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a fully client-side Image-suite tool at `/image/invisible` that embeds a robust, imperceptible watermark carrying `{custom content, timestamp, service, version}` and decodes it back into a structured card, with batch and one-image→many-versions support.

**Architecture:** A pure, canvas-free codec module (`invisibleWatermark.js`) does all the math — record packing, CRC, DCT-QIM embed/extract on a luma channel, redundancy + majority-vote decode. A thin canvas adapter (`invisibleWatermarkCanvas.js`) moves bytes between `Blob`/`ImageData` and the pure functions using existing `canvasUtils`. A Vue page (`InvisibleWatermarkPage.vue`) provides Embed (single + batch job table) and Decode (structured card) modes, reusing the tool-kit design system.

**Tech Stack:** Vue 3 `<script setup>`, Vite, Vitest (jsdom, `globals:true`), existing `canvasUtils`/`ImageShell`/`ImageDropZone`, `jszip` (already a dependency) for batch ZIP.

## Global Constraints

- **Fully client-side.** The pure module imports no `window`/`document`/canvas/`Blob`; it works on `Uint8ClampedArray` pixels + width/height. (Mirrors `imageHelpers.js`.)
- **i18n:** every user string goes through `useI18n` `t()`, namespaced `img2.*`, with **matching en + zh keys** (enforced by `src/features/image/__tests__/module.test.js`).
- **Design:** reuse tool-kit classes (`.card`, `.btn.primary`, `.seg`, `.ctrl`, `.img-nav`); **SVG-only icons, no emoji**.
- **Format constants:** `SYNC = 0x1d9e`, `FORMAT_VERSION = 1`, `SERVICE = 'box.muran.tech'`, `CONTENT_MAX = 16` (bytes, ~16 ASCII / ~5 CJK chars), fixed `RECORD_BYTES = 27` (`RECORD_BITS = 216`).
- **Robustness claim (ship in UI copy):** survives JPEG re-compression (~q60+), moderate rescale, brightness/colour shifts, PNG↔JPEG↔WebP. Not crop/rotation/AI-regeneration.
- **Commits:** conventional, `feat(image): …`. Commit after each task's tests are green.
- **Test command:** `npx vitest run <path>` (single test: add `-t "<name>"`).

---

## File Structure

- `src/features/image/invisibleWatermark.js` — **new**, pure codec + UI-logic helpers. One responsibility: watermark math + pure data helpers. No canvas.
- `src/features/image/invisibleWatermarkCanvas.js` — **new**, thin Blob↔pixels adapter over `canvasUtils`.
- `src/features/image/InvisibleWatermarkPage.vue` — **new**, the tool page (Embed + Decode modes).
- `src/features/image/__tests__/invisibleWatermark.test.js` — **new**, all pure-module tests.
- `src/features/image/index.js` — **modify**, register component thunk + `img2.inv.*`/`img2.nav.invisible` i18n (en+zh).
- `src/features/image/ImageToolNav.vue` — **modify**, add `{ id: 'invisible', to: '/image/invisible' }`.
- `src/router/meta.js` — **modify**, add `/image/invisible` route + SEO meta.
- `src/router/routes.js` — **modify only if** the `/image/*` mapping needs the new path (verify during Task 8).
- `src/features/image/__tests__/module.test.js` — **modify**, add `/image/invisible` to the route list.

---

## Task 1: Bit I/O + CRC-16

**Files:**
- Create: `src/features/image/invisibleWatermark.js`
- Test: `src/features/image/__tests__/invisibleWatermark.test.js`

**Interfaces:**
- Produces: `crc16(bytes: Uint8Array): number` (CRC-16/CCITT-FALSE), `bytesToBits(bytes: Uint8Array): Uint8Array` (0/1 per element, MSB-first), `bitsToBytes(bits: Uint8Array): Uint8Array`.

- [ ] **Step 1: Write the failing test**

```js
// src/features/image/__tests__/invisibleWatermark.test.js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/image/__tests__/invisibleWatermark.test.js`
Expected: FAIL — "crc16 is not a function" / module not found.

- [ ] **Step 3: Write minimal implementation**

```js
// src/features/image/invisibleWatermark.js
// Pure, canvas-free invisible-watermark codec. No window/document/Blob/Canvas —
// operates on plain Uint8ClampedArray pixels + width/height so it is unit-testable
// in node/jsdom and SSG-safe (same contract as imageHelpers.js).

// CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF, no reflection). Check("123456789")=0x29B1.
export function crc16(bytes) {
  let crc = 0xffff
  for (let i = 0; i < bytes.length; i++) {
    crc ^= bytes[i] << 8
    for (let b = 0; b < 8; b++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff
    }
  }
  return crc & 0xffff
}

// Byte array → one 0/1 per bit, most-significant-bit first.
export function bytesToBits(bytes) {
  const bits = new Uint8Array(bytes.length * 8)
  for (let i = 0; i < bytes.length; i++) {
    for (let b = 0; b < 8; b++) bits[i * 8 + b] = (bytes[i] >> (7 - b)) & 1
  }
  return bits
}

// Inverse of bytesToBits. Trailing bits that don't fill a byte are ignored.
export function bitsToBytes(bits) {
  const n = bits.length >> 3
  const bytes = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    let v = 0
    for (let b = 0; b < 8; b++) v = (v << 1) | (bits[i * 8 + b] & 1)
    bytes[i] = v
  }
  return bytes
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/image/__tests__/invisibleWatermark.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/image/invisibleWatermark.js src/features/image/__tests__/invisibleWatermark.test.js
git commit -m "feat(image): invisible-watermark bit I/O and CRC-16"
```

---

## Task 2: Fixed-size record pack/unpack + content helpers

**Files:**
- Modify: `src/features/image/invisibleWatermark.js`
- Test: `src/features/image/__tests__/invisibleWatermark.test.js`

**Interfaces:**
- Consumes: `crc16`.
- Produces:
  - `SYNC`, `FORMAT_VERSION`, `SERVICE`, `CONTENT_MAX`, `RECORD_BYTES` (27), `RECORD_BITS` (216) constants.
  - `contentByteLength(str: string): number`
  - `fitContent(str: string, max=CONTENT_MAX): string` — truncates on a UTF-8 char boundary so the result is ≤ max bytes.
  - `packRecord({ version, flags=0, timestamp, content='' }): Uint8Array` — always length `RECORD_BYTES`; content zero-padded to `CONTENT_MAX`. Throws if content > CONTENT_MAX bytes.
  - `unpackRecord(bytes: Uint8Array): { ok, version, flags, timestamp, content }` — validates SYNC + CRC; `ok:false` otherwise.

Record layout (byte-aligned, finalized from the spec's bit sketch):
`sync u16 | version u8 | flags u8 | timestamp u32(BE) | contentLen u8 | content[16] | crc16 u16` = 27 bytes.

- [ ] **Step 1: Write the failing test**

```js
// append to invisibleWatermark.test.js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/image/__tests__/invisibleWatermark.test.js`
Expected: FAIL — `packRecord` etc. not exported.

- [ ] **Step 3: Write minimal implementation**

```js
// append to invisibleWatermark.js
export const SYNC = 0x1d9e
export const FORMAT_VERSION = 1
export const SERVICE = 'box.muran.tech'
export const CONTENT_MAX = 16
export const RECORD_BYTES = 2 + 1 + 1 + 4 + 1 + CONTENT_MAX + 2 // 27
export const RECORD_BITS = RECORD_BYTES * 8

const _enc = new TextEncoder()
const _dec = new TextDecoder()

export function contentByteLength(str) {
  return _enc.encode(String(str ?? '')).length
}

// Truncate to ≤ max UTF-8 bytes without splitting a multi-byte char.
export function fitContent(str, max = CONTENT_MAX) {
  const s = String(str ?? '')
  if (contentByteLength(s) <= max) return s
  let out = ''
  for (const ch of s) {
    if (contentByteLength(out + ch) > max) break
    out += ch
  }
  return out
}

export function packRecord({ version, flags = 0, timestamp, content = '' }) {
  const enc = _enc.encode(String(content ?? ''))
  if (enc.length > CONTENT_MAX) throw new Error('content exceeds CONTENT_MAX')
  const body = new Uint8Array(1 + 1 + 4 + 1 + CONTENT_MAX) // version,flags,ts,len,content[16]
  const bdv = new DataView(body.buffer)
  bdv.setUint8(0, version & 0xff)
  bdv.setUint8(1, flags & 0xff)
  bdv.setUint32(2, timestamp >>> 0, false)
  bdv.setUint8(6, enc.length)
  body.set(enc, 7) // remaining bytes stay zero-padded
  const crc = crc16(body)
  const out = new Uint8Array(RECORD_BYTES)
  const odv = new DataView(out.buffer)
  odv.setUint16(0, SYNC, false)
  out.set(body, 2)
  odv.setUint16(2 + body.length, crc, false)
  return out
}

export function unpackRecord(bytes) {
  if (!bytes || bytes.length < RECORD_BYTES) return { ok: false }
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (dv.getUint16(0, false) !== SYNC) return { ok: false }
  const body = bytes.subarray(2, 2 + 23)
  const crc = dv.getUint16(2 + 23, false)
  if (crc16(body) !== crc) return { ok: false }
  const bdv = new DataView(body.buffer, body.byteOffset, body.byteLength)
  const version = bdv.getUint8(0)
  const flags = bdv.getUint8(1)
  const timestamp = bdv.getUint32(2, false)
  const len = Math.min(bdv.getUint8(6), CONTENT_MAX)
  const content = _dec.decode(body.subarray(7, 7 + len))
  return { ok: true, version, flags, timestamp, content }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/image/__tests__/invisibleWatermark.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/image/invisibleWatermark.js src/features/image/__tests__/invisibleWatermark.test.js
git commit -m "feat(image): fixed-size watermark record pack/unpack"
```

---

## Task 3: YCbCr conversion + 8×8 DCT/iDCT

**Files:**
- Modify: `src/features/image/invisibleWatermark.js`
- Test: `src/features/image/__tests__/invisibleWatermark.test.js`

**Interfaces:**
- Produces:
  - `toYCbCr(pixels: Uint8ClampedArray, w, h): { Y: Float64Array, Cb: Float64Array, Cr: Float64Array }` (BT.601; each length `w*h`).
  - `toRGB(Y, Cb, Cr, w, h): Uint8ClampedArray` (RGBA, alpha 255).
  - `dct8x8(block: Float64Array): Float64Array` and `idct8x8(block: Float64Array): Float64Array` (length-64, orthonormal DCT-II; new array returned).

- [ ] **Step 1: Write the failing test**

```js
// append to invisibleWatermark.test.js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/image/__tests__/invisibleWatermark.test.js`
Expected: FAIL — `toYCbCr`/`dct8x8` not defined.

- [ ] **Step 3: Write minimal implementation**

```js
// append to invisibleWatermark.js
// BT.601 full-range RGB <-> YCbCr.
export function toYCbCr(pixels, w, h) {
  const n = w * h
  const Y = new Float64Array(n), Cb = new Float64Array(n), Cr = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const r = pixels[i * 4], g = pixels[i * 4 + 1], b = pixels[i * 4 + 2]
    Y[i] = 0.299 * r + 0.587 * g + 0.114 * b
    Cb[i] = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b
    Cr[i] = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b
  }
  return { Y, Cb, Cr }
}

export function toRGB(Y, Cb, Cr, w, h) {
  const n = w * h
  const out = new Uint8ClampedArray(n * 4)
  for (let i = 0; i < n; i++) {
    const y = Y[i], cb = Cb[i] - 128, cr = Cr[i] - 128
    out[i * 4] = y + 1.402 * cr
    out[i * 4 + 1] = y - 0.344136 * cb - 0.714136 * cr
    out[i * 4 + 2] = y + 1.772 * cb
    out[i * 4 + 3] = 255
  }
  return out
}

// Orthonormal 8-point DCT-II basis (so the inverse is the transpose).
const _N = 8
const _C = (() => {
  const c = new Float64Array(_N * _N)
  for (let u = 0; u < _N; u++) {
    const s = u === 0 ? Math.sqrt(1 / _N) : Math.sqrt(2 / _N)
    for (let x = 0; x < _N; x++) c[u * _N + x] = s * Math.cos(((2 * x + 1) * u * Math.PI) / (2 * _N))
  }
  return c
})()

function _rows(inp, out, fwd) {
  const tmp = new Float64Array(_N)
  for (let r = 0; r < _N; r++) {
    for (let k = 0; k < _N; k++) {
      let sum = 0
      for (let j = 0; j < _N; j++) sum += (fwd ? _C[k * _N + j] : _C[j * _N + k]) * inp[r * _N + j]
      tmp[k] = sum
    }
    for (let k = 0; k < _N; k++) out[r * _N + k] = tmp[k]
  }
}
function _transpose(a) {
  const t = new Float64Array(64)
  for (let i = 0; i < _N; i++) for (let j = 0; j < _N; j++) t[j * _N + i] = a[i * _N + j]
  return t
}
export function dct8x8(block) {
  const rows = new Float64Array(64); _rows(block, rows, true)
  const cols = new Float64Array(64); _rows(_transpose(rows), cols, true)
  return _transpose(cols)
}
export function idct8x8(block) {
  const rows = new Float64Array(64); _rows(block, rows, false)
  const cols = new Float64Array(64); _rows(_transpose(rows), cols, false)
  return _transpose(cols)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/image/__tests__/invisibleWatermark.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/image/invisibleWatermark.js src/features/image/__tests__/invisibleWatermark.test.js
git commit -m "feat(image): YCbCr + orthonormal 8x8 DCT/iDCT"
```

---

## Task 4: QIM embed/extract + pixel-level encode/decode

**Files:**
- Modify: `src/features/image/invisibleWatermark.js`
- Test: `src/features/image/__tests__/invisibleWatermark.test.js`

**Interfaces:**
- Produces:
  - `DELTA` (default QIM step, exported so it can be tuned in Task 5), `COEF_INDEX` (default mid-frequency coefficient, linear 0..63).
  - `embedCoef(c: number, bit: 0|1, delta=DELTA): number`, `extractCoef(c: number, delta=DELTA): 0|1` (dither/QIM: bit 0 → integer lattice, bit 1 → half-integer lattice of `delta`).
  - `capacityBlocks(w, h): number` — number of full 8×8 blocks.
  - `encode(pixels, w, h, record: Uint8Array, opts?): Uint8ClampedArray` — embeds `record` (length `RECORD_BYTES`) repeated across luma blocks; returns new RGBA pixels. Throws if `capacityBlocks < RECORD_BITS`.
  - `decode(pixels, w, h, opts?): { ok, version, flags, timestamp, content, confidence }` — majority-vote over repeats; `confidence` ∈ [0,1] = mean per-bit vote agreement.

- [ ] **Step 1: Write the failing test**

```js
// append to invisibleWatermark.test.js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/image/__tests__/invisibleWatermark.test.js`
Expected: FAIL — `encode`/`decode` not defined.

- [ ] **Step 3: Write minimal implementation**

```js
// append to invisibleWatermark.js
export let DELTA = 18          // QIM step on luma DCT coefficients; tuned in Task 5
export const COEF_INDEX = 21   // mid-frequency coefficient (row 2, col 5) in 8x8 linear order

// Dither/QIM: bit 0 → nearest integer multiple of delta; bit 1 → nearest half-integer multiple.
export function embedCoef(c, bit, delta = DELTA) {
  const off = bit ? 0.5 : 0
  return (Math.round(c / delta - off) + off) * delta
}
export function extractCoef(c, delta = DELTA) {
  const r = c / delta
  const dInt = Math.abs(r - Math.round(r))
  const dHalf = Math.abs(r - (Math.round(r - 0.5) + 0.5))
  return dInt <= dHalf ? 0 : 1
}

export function capacityBlocks(w, h) {
  return Math.floor(w / 8) * Math.floor(h / 8)
}

function _readBlock(Y, w, bx, by) {
  const blk = new Float64Array(64)
  for (let r = 0; r < 8; r++) for (let cc = 0; cc < 8; cc++) blk[r * 8 + cc] = Y[(by * 8 + r) * w + (bx * 8 + cc)]
  return blk
}
function _writeBlock(Y, w, bx, by, blk) {
  for (let r = 0; r < 8; r++) for (let cc = 0; cc < 8; cc++) Y[(by * 8 + r) * w + (bx * 8 + cc)] = blk[r * 8 + cc]
}

export function encode(pixels, w, h, record, opts = {}) {
  const delta = opts.delta ?? DELTA
  const coef = opts.coefIndex ?? COEF_INDEX
  if (capacityBlocks(w, h) < RECORD_BITS) throw new Error('image too small for one watermark pass')
  const bits = bytesToBits(record)
  const { Y, Cb, Cr } = toYCbCr(pixels, w, h)
  const bw = Math.floor(w / 8), bh = Math.floor(h / 8)
  let k = 0
  for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) {
    const blk = _readBlock(Y, w, bx, by)
    const d = dct8x8(blk)
    d[coef] = embedCoef(d[coef], bits[k % RECORD_BITS], delta)
    _writeBlock(Y, w, bx, by, idct8x8(d))
    k++
  }
  return toRGB(Y, Cb, Cr, w, h)
}

export function decode(pixels, w, h, opts = {}) {
  const delta = opts.delta ?? DELTA
  const coef = opts.coefIndex ?? COEF_INDEX
  if (capacityBlocks(w, h) < RECORD_BITS) return { ok: false }
  const { Y } = toYCbCr(pixels, w, h)
  const bw = Math.floor(w / 8), bh = Math.floor(h / 8)
  const votes = new Float64Array(RECORD_BITS) // + toward 1, - toward 0
  const counts = new Uint32Array(RECORD_BITS)
  let k = 0
  for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) {
    const d = dct8x8(_readBlock(Y, w, bx, by))
    votes[k % RECORD_BITS] += extractCoef(d[coef], delta) ? 1 : -1
    counts[k % RECORD_BITS]++
    k++
  }
  const bits = new Uint8Array(RECORD_BITS)
  let agree = 0
  for (let i = 0; i < RECORD_BITS; i++) {
    bits[i] = votes[i] > 0 ? 1 : 0
    agree += counts[i] ? Math.abs(votes[i]) / counts[i] : 0
  }
  const rec = unpackRecord(bitsToBytes(bits))
  return rec.ok ? { ...rec, confidence: agree / RECORD_BITS } : { ok: false }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/image/__tests__/invisibleWatermark.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/image/invisibleWatermark.js src/features/image/__tests__/invisibleWatermark.test.js
git commit -m "feat(image): DCT-QIM embed/decode with redundancy + majority vote"
```

---

## Task 5: Robustness — JPEG-proxy, resize, invisibility; tune DELTA

**Files:**
- Modify: `src/features/image/invisibleWatermark.js`
- Test: `src/features/image/__tests__/invisibleWatermark.test.js`

**Interfaces:**
- Produces:
  - `psnr(a: Uint8ClampedArray, b: Uint8ClampedArray): number` (dB; RGB only).
  - `resampleNearest(pixels, w, h, nw, nh): Uint8ClampedArray`.
  - `decodeMultiScale(pixels, w, h, opts?): { ok, ..., scale }` — tries scales `[1, 0.5, 2]` (rescaling to a working size that is a multiple of 8) and returns the first CRC-valid decode.
- Test-only helper `simulateJpegLuma(pixels, w, h, quality)` lives in the test file (models JPEG's lossy luma step: 8×8 DCT → quantise by the scaled standard luminance table → iDCT). It needs no dependency.

- [ ] **Step 1: Write the failing test**

```js
// append to invisibleWatermark.test.js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/image/__tests__/invisibleWatermark.test.js`
Expected: FAIL — `psnr`/`resampleNearest`/`decodeMultiScale` not defined (and possibly the JPEG/brightness assertions fail until DELTA is tuned).

- [ ] **Step 3: Write minimal implementation, then tune DELTA**

```js
// append to invisibleWatermark.js
export function psnr(a, b) {
  let sse = 0, n = 0
  for (let i = 0; i < a.length; i++) { if (i % 4 === 3) continue; const dd = a[i] - b[i]; sse += dd * dd; n++ }
  if (sse === 0) return Infinity
  return 10 * Math.log10((255 * 255) / (sse / n))
}

export function resampleNearest(pixels, w, h, nw, nh) {
  const out = new Uint8ClampedArray(nw * nh * 4)
  for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) {
    const sx = Math.min(w - 1, (x * w / nw) | 0), sy = Math.min(h - 1, (y * h / nh) | 0)
    const si = (sy * w + sx) * 4, di = (y * nw + x) * 4
    out[di] = pixels[si]; out[di + 1] = pixels[si + 1]; out[di + 2] = pixels[si + 2]; out[di + 3] = 255
  }
  return out
}

export function decodeMultiScale(pixels, w, h, opts = {}) {
  for (const scale of [1, 0.5, 2]) {
    const nw = Math.max(8, Math.round((w * scale) / 8) * 8)
    const nh = Math.max(8, Math.round((h * scale) / 8) * 8)
    const px = scale === 1 && nw === w && nh === h ? pixels : resampleNearest(pixels, w, h, nw, nh)
    if (capacityBlocks(nw, nh) < RECORD_BITS) continue
    const got = decode(px, nw, nh, opts)
    if (got.ok) return { ...got, scale }
  }
  return { ok: false }
}
```

Then **tune `DELTA`**: run the suite; if the JPEG-q70 or brightness test fails, raise `DELTA` (e.g. 18 → 22 → 26); if the PSNR-38 test fails, lower it. Pick the smallest `DELTA` that passes all four robustness assertions. Leave the chosen value in code.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/image/__tests__/invisibleWatermark.test.js`
Expected: PASS (all robustness assertions). If resize proves flaky, keep the `[1,0.5,2]` set and the clean-factor test only — do not claim arbitrary-resize robustness (matches the spec's honest boundary).

- [ ] **Step 5: Commit**

```bash
git add src/features/image/invisibleWatermark.js src/features/image/__tests__/invisibleWatermark.test.js
git commit -m "feat(image): watermark robustness (JPEG/resize/brightness) + tuned DELTA"
```

---

## Task 6: Canvas adapter (Blob ↔ pixels)

**Files:**
- Create: `src/features/image/invisibleWatermarkCanvas.js`

**Interfaces:**
- Consumes: `encode`, `decodeMultiScale`, `packRecord`, `FORMAT_VERSION` from `invisibleWatermark.js`; `loadImageFromBlob`, `makeCanvas`, `canvasToBlob` from `canvasUtils.js`.
- Produces:
  - `embedImageBlob(blob, { content, timestamp, flags=0, version=FORMAT_VERSION, delta, coefIndex }): Promise<Blob>` (PNG out — lossless keeps the mark intact).
  - `decodeImageBlob(blob, opts?): Promise<{ ok, version, flags, timestamp, content, confidence, scale }>`.

**Note on testing:** jsdom here has no real 2D canvas (`getContext` returns null; no `canvas` npm package), so this adapter is **not** unit-tested — its math is covered by Tasks 1–5 and it is verified end-to-end by running the app in Task 11. Keep the adapter a thin, obvious pass-through so all logic stays in the tested pure module.

- [ ] **Step 1: Implement the adapter**

```js
// src/features/image/invisibleWatermarkCanvas.js
// Thin bridge between Blob/canvas and the pure invisibleWatermark codec. All math lives in
// invisibleWatermark.js (unit-tested); this only moves pixels in and out of a canvas.
import { loadImageFromBlob, makeCanvas, canvasToBlob } from './canvasUtils'
import { encode, decodeMultiScale, packRecord, FORMAT_VERSION } from './invisibleWatermark'

async function imageDataOf(blob) {
  const img = await loadImageFromBlob(blob)
  const w = img.naturalWidth, h = img.naturalHeight
  const canvas = makeCanvas(w, h)
  const ctx = canvas.getContext('2d')
  ctx.drawImage(img, 0, 0, w, h)
  return { ctx, canvas, data: ctx.getImageData(0, 0, w, h), w, h }
}

export async function embedImageBlob(blob, { content, timestamp, flags = 0, version = FORMAT_VERSION, delta, coefIndex } = {}) {
  const { ctx, canvas, data, w, h } = await imageDataOf(blob)
  const record = packRecord({ version, flags, timestamp, content })
  const marked = encode(data.data, w, h, record, { delta, coefIndex })
  ctx.putImageData(new ImageData(marked, w, h), 0, 0)
  return canvasToBlob(canvas, 'image/png')
}

export async function decodeImageBlob(blob, opts = {}) {
  const { data, w, h } = await imageDataOf(blob)
  return decodeMultiScale(data.data, w, h, opts)
}
```

- [ ] **Step 2: Verify it imports cleanly (no syntax/import errors)**

Run: `npx vitest run src/features/image/__tests__/module.test.js`
Expected: PASS (unchanged; confirms the feature tree still imports). Full behaviour is verified in Task 11.

- [ ] **Step 3: Commit**

```bash
git add src/features/image/invisibleWatermarkCanvas.js
git commit -m "feat(image): canvas adapter for invisible watermark embed/decode"
```

---

## Task 7: UI-logic helpers (job model)

**Files:**
- Modify: `src/features/image/invisibleWatermark.js`
- Test: `src/features/image/__tests__/invisibleWatermark.test.js`

**Interfaces:**
- Produces (pure, testable so the Vue component stays thin):
  - `makeJob(source, content=''): { id, source, content, status }` — `id` is a monotonic counter (module-local; no Date/random).
  - `duplicateJobs(job, n): Array<job>` — returns `n` jobs sharing `job.source`, content suffixed ` #1..#n`.
  - `jobFileName(baseName, content, index, ext='png'): string` — safe filename `base__content__idx.ext` (content sanitized to `[a-z0-9-_]`, empties → index only).

- [ ] **Step 1: Write the failing test**

```js
// append to invisibleWatermark.test.js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/image/__tests__/invisibleWatermark.test.js`
Expected: FAIL — helpers not defined.

- [ ] **Step 3: Write minimal implementation**

```js
// append to invisibleWatermark.js
let _jobSeq = 0
export function makeJob(source, content = '') {
  return { id: ++_jobSeq, source, content, status: 'idle' }
}
export function duplicateJobs(job, n) {
  const out = []
  for (let i = 1; i <= n; i++) out.push({ id: ++_jobSeq, source: job.source, content: `${job.content} #${i}`.trim(), status: 'idle' })
  return out
}
export function jobFileName(baseName, content, index, ext = 'png') {
  const base = String(baseName || 'image').replace(/\.[^./\\]+$/, '') || 'image'
  const slug = String(content || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return slug ? `${base}__${slug}__${index + 1}.${ext}` : `${base}__${index + 1}.${ext}`
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/image/__tests__/invisibleWatermark.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/image/invisibleWatermark.js src/features/image/__tests__/invisibleWatermark.test.js
git commit -m "feat(image): pure job-model helpers for batch watermarking"
```

---

## Task 8: Wire route, nav, i18n, and meta

**Files:**
- Modify: `src/features/image/index.js` (component thunk + i18n en/zh)
- Modify: `src/features/image/ImageToolNav.vue` (TOOLS entry)
- Modify: `src/router/meta.js` (route + SEO)
- Modify: `src/features/image/__tests__/module.test.js` (route list)
- Verify: `src/router/routes.js` (only edit if `/image/*` needs the new path explicitly)

**Interfaces:**
- Produces: a resolvable `/image/invisible` route rendering `InvisibleWatermarkPage.vue`; i18n keys `img2.nav.invisible`, `img2.inv.*` (en+zh); nav tab.

- [ ] **Step 1: Update the module route-coverage test (failing)**

In `src/features/image/__tests__/module.test.js`, add `/image/invisible` to the routes array asserted to have a thunk:

```js
const routes = ['/image/compress', '/image/convert', '/image/watermark', '/image/edit', '/image/compose', '/image/metadata', '/image/invisible']
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/image/__tests__/module.test.js`
Expected: FAIL — `feature.components['/image/invisible']` is not a function.

- [ ] **Step 3: Register component + i18n in `index.js`**

Add to the `components` map:

```js
    '/image/invisible': () => import('./InvisibleWatermarkPage.vue'),
```

Add to `i18n.en` (alongside the other `img2.nav.*` and after the Metadata block):

```js
      'img2.nav.invisible': 'Invisible',
      'img2.inv.title': 'Invisible Watermark',
      'img2.inv.sub': 'Embed a hidden, robust mark that survives re-compression — then read it back. Fully private, on your device.',
      'img2.inv.tabEmbed': 'Embed',
      'img2.inv.tabDecode': 'Read',
      'img2.inv.content': 'Custom content',
      'img2.inv.contentHint': 'Up to 16 bytes (~16 letters / ~5 CJK chars). Longer content needs the verify page.',
      'img2.inv.bytesLeft': '{n} bytes left',
      'img2.inv.uniform': 'Content for all',
      'img2.inv.perImage': 'Per-image content',
      'img2.inv.duplicate': 'Make N versions',
      'img2.inv.versions': 'Versions',
      'img2.inv.generate': 'Generate',
      'img2.inv.generating': 'Generating…',
      'img2.inv.downloadZip': 'Download all (ZIP)',
      'img2.inv.tooSmall': 'Image is too small to hold the watermark (needs ≥ ~120×120).',
      'img2.inv.decDrop': 'Drop a watermarked image to read it',
      'img2.inv.decNone': 'No watermark detected, or the image is too degraded.',
      'img2.inv.fldContent': 'Content',
      'img2.inv.fldTime': 'Timestamp',
      'img2.inv.fldService': 'Service',
      'img2.inv.fldVersion': 'Version',
      'img2.inv.fldConfidence': 'Confidence',
      'img2.inv.robustNote': 'Survives JPEG re-compression, rescaling, and colour shifts. Not crop, rotation, or AI re-generation.',
```

Add the **zh** parity block (same keys) to `i18n.zh`:

```js
      'img2.nav.invisible': '隐水印',
      'img2.inv.title': '隐水印',
      'img2.inv.sub': '嵌入一层隐藏、抗压的水印，重新压缩后仍可读出。全程本地、完全私密。',
      'img2.inv.tabEmbed': '写入',
      'img2.inv.tabDecode': '读取',
      'img2.inv.content': '自定义内容',
      'img2.inv.contentHint': '最多 16 字节（约 16 个字母 / 约 5 个汉字）。更长内容需用验证页。',
      'img2.inv.bytesLeft': '还剩 {n} 字节',
      'img2.inv.uniform': '统一内容',
      'img2.inv.perImage': '逐张内容',
      'img2.inv.duplicate': '生成 N 个版本',
      'img2.inv.versions': '版本数',
      'img2.inv.generate': '生成',
      'img2.inv.generating': '生成中…',
      'img2.inv.downloadZip': '全部下载（ZIP）',
      'img2.inv.tooSmall': '图片太小，放不下水印（需 ≥ 约 120×120）。',
      'img2.inv.decDrop': '拖入带水印的图片以读取',
      'img2.inv.decNone': '未检测到水印，或图片损毁过重。',
      'img2.inv.fldContent': '内容',
      'img2.inv.fldTime': '时间戳',
      'img2.inv.fldService': '服务',
      'img2.inv.fldVersion': '版本',
      'img2.inv.fldConfidence': '置信度',
      'img2.inv.robustNote': '可抵抗 JPEG 重压缩、缩放与调色；不抗裁剪、旋转或 AI 重绘。',
```

- [ ] **Step 4: Add the nav tab in `ImageToolNav.vue`**

Insert into `TOOLS` after `watermark`:

```js
  { id: 'invisible', to: '/image/invisible' },
```

- [ ] **Step 5: Add the route + SEO meta in `src/router/meta.js`**

Open `src/router/meta.js`, find the existing `/image/watermark` meta entry, and add a sibling for `/image/invisible` following the exact same shape (path, `h1`, `title`, `description`, and whatever keys the other image routes use — copy the watermark entry and adapt the copy to "Invisible Watermark / 隐水印"). Read the file first to match its structure precisely.

- [ ] **Step 6: Create a minimal placeholder page so the route resolves**

```vue
<!-- src/features/image/InvisibleWatermarkPage.vue -->
<script setup>
import { useRouteHead } from '../../composables/useRouteHead'
import { useI18n } from '../../composables/useI18n'
import ImageShell from './ImageShell.vue'
const { meta: m } = useRouteHead()
const { t } = useI18n()
</script>
<template>
  <ImageShell wide :h1="m.h1" :title="t('img2.inv.title')" :sub="t('img2.inv.sub')">
    <p class="ctrl">{{ t('img2.inv.robustNote') }}</p>
  </ImageShell>
</template>
```

- [ ] **Step 7: Run tests + build check**

Run: `npx vitest run src/features/image/__tests__/module.test.js`
Expected: PASS (thunk present; en/zh parity holds).
Run: `npx vitest run` (full suite) — Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/features/image/index.js src/features/image/ImageToolNav.vue src/router/meta.js src/features/image/InvisibleWatermarkPage.vue src/features/image/__tests__/module.test.js
git commit -m "feat(image): route/nav/i18n wiring for /image/invisible"
```

---

## Task 9: Decode mode (structured card)

**Files:**
- Modify: `src/features/image/InvisibleWatermarkPage.vue`

**Interfaces:**
- Consumes: `decodeImageBlob` (adapter), `SERVICE` from the pure module, `ImageDropZone`, `useImageSource`/`canvasUtils.pickImageFiles`, `useToast`.
- Produces: a two-mode page (`embed`|`decode` via `.seg`); Decode reads a dropped/picked image and renders a structured card or an empty state.

**Verification:** canvas-dependent → verified by running the app (Task 11), not jsdom unit tests.

- [ ] **Step 1: Implement Decode mode**

Replace the placeholder page with the mode-switching shell + Decode panel. Embed panel is added in Task 10 (leave a stub `<template v-else>` block).

```vue
<!-- src/features/image/InvisibleWatermarkPage.vue -->
<script setup>
import { ref } from 'vue'
import { useRouteHead } from '../../composables/useRouteHead'
import { useI18n } from '../../composables/useI18n'
import { useToast } from '../../composables/useToast'
import ImageShell from './ImageShell.vue'
import ImageDropZone from './ImageDropZone.vue'
import { pickImageFiles, imageFilesFromEvent } from './canvasUtils'
import { decodeImageBlob } from './invisibleWatermarkCanvas'
import { SERVICE } from './invisibleWatermark'

const { meta: m } = useRouteHead()
const { t, locale } = useI18n()
const { showToast } = useToast()

const mode = ref('embed')          // 'embed' | 'decode'

// ---- Decode ----
const decoding = ref(false)
const result = ref(null)           // { ok, content, timestamp, version, confidence } | { ok:false } | null
const dragOver = ref(false)

async function readBlob(blob) {
  if (!blob) return
  decoding.value = true; result.value = null
  try { result.value = await decodeImageBlob(blob) }
  catch { result.value = { ok: false } }
  finally { decoding.value = false }
}
async function pickDecode() { const f = await pickImageFiles({ multiple: false }); if (f[0]) readBlob(f[0]) }
function onDropDecode(e) { dragOver.value = false; const f = imageFilesFromEvent(e); if (f[0]) readBlob(f[0]) }
function fmtTime(sec) { try { return new Date(sec * 1000).toLocaleString(locale.value) } catch { return String(sec) } }
</script>

<template>
  <ImageShell wide :h1="m.h1" :title="t('img2.inv.title')" :sub="t('img2.inv.sub')">
    <div class="seg mode-seg">
      <button :class="{ on: mode === 'embed' }" @click="mode = 'embed'">{{ t('img2.inv.tabEmbed') }}</button>
      <button :class="{ on: mode === 'decode' }" @click="mode = 'decode'">{{ t('img2.inv.tabDecode') }}</button>
    </div>

    <template v-if="mode === 'decode'">
      <ImageDropZone
        :title="t('img2.inv.decDrop')" :hint="t('img2.browse')" :drag-over="dragOver"
        @pick="pickDecode" @drop="onDropDecode"
        @dragover="e => { e.preventDefault(); dragOver = true }" @dragleave="dragOver = false"
      />
      <div v-if="decoding" class="ctrl">{{ t('img2.inv.generating') }}</div>
      <div v-else-if="result && result.ok" class="card info-card">
        <div class="info-row"><span class="k">{{ t('img2.inv.fldContent') }}</span><span class="v mono">{{ result.content || '—' }}</span></div>
        <div class="info-row"><span class="k">{{ t('img2.inv.fldTime') }}</span><span class="v">{{ fmtTime(result.timestamp) }}</span></div>
        <div class="info-row"><span class="k">{{ t('img2.inv.fldService') }}</span><span class="v mono">{{ SERVICE }}</span></div>
        <div class="info-row"><span class="k">{{ t('img2.inv.fldVersion') }}</span><span class="v">v{{ result.version }}</span></div>
        <div class="info-row"><span class="k">{{ t('img2.inv.fldConfidence') }}</span><span class="v">{{ Math.round(result.confidence * 100) }}%</span></div>
      </div>
      <div v-else-if="result" class="card empty">{{ t('img2.inv.decNone') }}</div>
    </template>

    <template v-else>
      <!-- Embed panel implemented in Task 10 -->
    </template>
  </ImageShell>
</template>

<style scoped>
.mode-seg { margin-bottom: 16px; max-width: 320px; }
.info-card { display: flex; flex-direction: column; gap: 8px; }
.info-row { display: flex; justify-content: space-between; gap: 16px; }
.info-row .k { color: var(--muted, #888); }
.info-row .v.mono { font-family: var(--font-mono); }
.empty { color: var(--muted, #888); text-align: center; padding: 24px; }
</style>
```

- [ ] **Step 2: Verify it builds/imports**

Run: `npx vitest run src/features/image/__tests__/module.test.js`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/features/image/InvisibleWatermarkPage.vue
git commit -m "feat(image): invisible-watermark decode mode with structured card"
```

---

## Task 10: Embed mode (single + batch job table + ZIP)

**Files:**
- Modify: `src/features/image/InvisibleWatermarkPage.vue`

**Interfaces:**
- Consumes: `embedImageBlob` (adapter), `makeJob`/`duplicateJobs`/`jobFileName`/`fitContent`/`contentByteLength`/`CONTENT_MAX` (pure), `pickImageFiles`/`imageFilesFromEvent`/`loadImageFromBlob`/`downloadBlob` (canvasUtils), `jszip`.
- Produces: Embed panel — drop/pick multiple images → job table; a uniform-content field with a live byte meter; "make N versions" from one image; Generate (single "now" timestamp for the batch); per-item + ZIP download; `SendToMenu` for a single result.

**Verification:** end-to-end via running the app (Task 11).

- [ ] **Step 1: Implement Embed mode**

Add embed state to `<script setup>` (imports + logic) and replace the Task-9 stub `<template v-else>` with the panel.

```js
// add to <script setup> imports
import JSZip from 'jszip'
import { loadImageFromBlob, downloadBlob } from './canvasUtils'
import SendToMenu from '../../components/SendToMenu.vue'
import { makeJob, duplicateJobs, jobFileName, fitContent, contentByteLength, CONTENT_MAX } from './invisibleWatermark'
import { embedImageBlob } from './invisibleWatermarkCanvas'

// ---- Embed ----
const jobs = ref([])               // { id, source:File, content, status, url?, blob?, name }
const uniform = ref('')
const dupCount = ref(3)
const generating = ref(false)
const embedDragOver = ref(false)
const lastSingleBlob = ref(null)

const bytesLeft = computed(() => CONTENT_MAX - contentByteLength(uniform.value))
function onUniformInput() { uniform.value = fitContent(uniform.value, CONTENT_MAX) }

function addFiles(files) {
  for (const f of files) jobs.value.push({ ...makeJob(f, uniform.value), name: f.name })
}
async function pickEmbed() { addFiles(await pickImageFiles({ multiple: true })) }
function onDropEmbed(e) { embedDragOver.value = false; addFiles(imageFilesFromEvent(e)) }
function removeJob(id) { jobs.value = jobs.value.filter(j => j.id !== id) }
function makeVersions(job) {
  const dups = duplicateJobs({ ...job, content: job.content || uniform.value }, Math.max(2, dupCount.value))
    .map(d => ({ ...d, source: job.source, name: job.name }))
  const i = jobs.value.findIndex(j => j.id === job.id)
  jobs.value.splice(i, 1, ...dups)
}

async function generate() {
  if (!jobs.value.length) return
  generating.value = true
  const stamp = Math.floor(Date.now() / 1000)   // one "now" for the whole batch
  try {
    for (const job of jobs.value) {
      job.status = 'working'
      const content = fitContent(job.content || uniform.value, CONTENT_MAX)
      job.blob = await embedImageBlob(job.source, { content, timestamp: stamp })
      job.url = URL.createObjectURL(job.blob)
      job.status = 'done'
    }
    lastSingleBlob.value = jobs.value.length === 1 ? jobs.value[0].blob : null
  } catch { showToast(t('img2.unsupported')) }
  finally { generating.value = false }
}

async function downloadZip() {
  const zip = new JSZip()
  jobs.value.forEach((job, i) => { if (job.blob) zip.file(jobFileName(job.name, fitContent(job.content || uniform.value), i), job.blob) })
  const out = await zip.generateAsync({ type: 'blob' })
  downloadBlob(out, 'invisible-watermark.zip')
}
function downloadOne(job, i) { if (job.blob) downloadBlob(job.blob, jobFileName(job.name, fitContent(job.content || uniform.value), i)) }
```

Add `computed` to the `vue` import at the top: `import { ref, computed } from 'vue'`.

```vue
<!-- replace the Task-9 stub <template v-else> with: -->
    <template v-else>
      <div class="card card-stack">
        <div class="ctrl">
          <div class="ctrl-label"><span>{{ t('img2.inv.uniform') }}</span><span class="val">{{ t('img2.inv.bytesLeft', { n: bytesLeft }) }}</span></div>
          <input type="text" v-model="uniform" @input="onUniformInput" class="text-input" :placeholder="t('img2.inv.content')" />
          <p class="hint">{{ t('img2.inv.contentHint') }}</p>
        </div>
      </div>

      <ImageDropZone
        v-if="!jobs.length"
        :title="t('img2.dropBatch')" :hint="t('img2.browseBatch')" :drag-over="embedDragOver"
        @pick="pickEmbed" @drop="onDropEmbed"
        @dragover="e => { e.preventDefault(); embedDragOver = true }" @dragleave="embedDragOver = false"
      />

      <div v-else class="card job-table">
        <div v-for="(job, i) in jobs" :key="job.id" class="job-row">
          <img v-if="job.url" :src="job.url" class="thumb" alt="" />
          <span v-else class="thumb ph"></span>
          <span class="job-name mono">{{ job.name }}</span>
          <input type="text" v-model="job.content" :placeholder="uniform || t('img2.inv.content')" class="text-input job-content" />
          <span class="job-status">{{ job.status }}</span>
          <div class="job-actions">
            <button class="btn small" @click="makeVersions(job)">{{ t('img2.inv.duplicate') }}</button>
            <button v-if="job.url" class="btn small" @click="downloadOne(job, i)">{{ t('img2.download') }}</button>
            <button class="link-btn" @click="removeJob(job.id)">{{ t('img2.remove') }}</button>
          </div>
        </div>
        <div class="job-add">
          <button class="btn small" @click="pickEmbed">{{ t('img2.addMore') }}</button>
          <label class="dup-n">{{ t('img2.inv.versions') }} <input type="number" v-model.number="dupCount" min="2" max="50" /></label>
        </div>
      </div>

      <div v-if="jobs.length" class="dl-row">
        <button class="btn primary" :disabled="generating" @click="generate">
          {{ generating ? t('img2.inv.generating') : t('img2.inv.generate') }}
        </button>
        <button v-if="jobs.length > 1 && jobs.some(j => j.blob)" class="btn" @click="downloadZip">{{ t('img2.inv.downloadZip') }}</button>
        <SendToMenu v-if="lastSingleBlob" :payload="lastSingleBlob" kind="image" from="/image/invisible" />
      </div>
      <p class="hint robust">{{ t('img2.inv.robustNote') }}</p>
    </template>
```

Add styles:

```css
.job-table { display: flex; flex-direction: column; gap: 10px; }
.job-row { display: grid; grid-template-columns: 40px 1fr 1.4fr auto auto; gap: 10px; align-items: center; }
.thumb { width: 40px; height: 40px; object-fit: cover; border-radius: 6px; }
.thumb.ph { background: var(--panel, #2a2a2a); }
.job-name { font-family: var(--font-mono); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.job-actions { display: flex; gap: 6px; align-items: center; }
.job-add { display: flex; gap: 12px; align-items: center; margin-top: 4px; }
.hint { color: var(--muted, #888); font-size: 12px; }
```

- [ ] **Step 2: Verify it builds/imports**

Run: `npx vitest run src/features/image/__tests__/module.test.js`
Expected: PASS.
Run: `npx vitest run` (full suite) — Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/features/image/InvisibleWatermarkPage.vue
git commit -m "feat(image): invisible-watermark embed mode (single + batch + versions + ZIP)"
```

---

## Task 11: Mobile responsiveness + end-to-end app verification

**Files:**
- Modify: `src/features/image/InvisibleWatermarkPage.vue` (responsive styles)

- [ ] **Step 1: Add mobile styles**

```css
@media (max-width: 768px) {
  .job-row { grid-template-columns: 32px 1fr auto; grid-template-areas: "thumb name status" "content content content" "actions actions actions"; row-gap: 6px; }
  .thumb { grid-area: thumb; width: 32px; height: 32px; }
  .job-name { grid-area: name; }
  .job-status { grid-area: status; }
  .job-content { grid-area: content; }
  .job-actions { grid-area: actions; justify-content: flex-end; }
  .info-row { flex-direction: column; gap: 2px; }
}
```

- [ ] **Step 2: Build the app**

Run: `npm run build`
Expected: build completes with no errors (SSG renders `/image/invisible`).

- [ ] **Step 3: Manual end-to-end verification (REQUIRED — invoke the `verify` skill)**

Start the dev server (`npm run dev`) and drive the real tool:
1. **Embed single:** open `/image/invisible`, drop a photo, set content `trace-A`, Generate, Download.
2. **Decode:** switch to Read, drop the downloaded PNG → card shows `trace-A`, a timestamp, `box.muran.tech`, `v1`, confidence.
3. **JPEG survival (real):** convert the marked PNG to JPEG (use `/image/convert`, quality ~75), then Decode the JPEG → still recovers `trace-A`.
4. **Multi-version:** drop one image, "Make N versions" = 3, give contents, Generate, Download all (ZIP) → 3 files; decode each → distinct content.
5. **Mobile:** narrow the viewport to ~390px → job rows stack, controls reachable, nav scrolls to the active "Invisible" tab.
6. **Negative:** decode an un-watermarked image → "No watermark detected" empty state.

Record the actual observed results (content read back, confidence, that the JPEG survived). If JPEG decode fails at q75, raise `DELTA` in the pure module, re-run Task 5 tests, and re-verify.

- [ ] **Step 4: Commit**

```bash
git add src/features/image/InvisibleWatermarkPage.vue
git commit -m "feat(image): responsive layout + verified end-to-end invisible watermark"
```

---

## Self-Review (completed while writing)

**Spec coverage:**
- §5 architecture (page + pure module + adapter) → Tasks 1–10. ✅
- §6 payload format → Tasks 1–2 (byte-aligned finalization noted in Global Constraints & Task 2). ✅
- §7 DCT-QIM codec → Tasks 3–5. ✅
- §8 batch/multi-version job model → Tasks 7, 10. ✅
- §9 reader/structured card → Task 9. ✅
- §11 UI/mobile (tool-kit, SVG, no emoji, byte meter) → Tasks 8–11. ✅
- §13 robustness boundaries → Task 5 tests + `img2.inv.robustNote` copy. ✅
- §15 testing strategy → Tasks 1–5, 7. ✅
- §10 verify page (Phase 3) → **out of scope for this plan** (separate future plan), per Scope Check. ✅
- §16 Phase 1 + Phase 2 → this plan. ✅

**Placeholder scan:** No TBD/TODO; every code step has complete code. The only empirical step (DELTA tuning, Task 5 Step 3) has a concrete starting value, a bounded procedure, and a test oracle — not a placeholder.

**Type consistency:** `encode`/`decode`/`decodeMultiScale`, `packRecord`/`unpackRecord`, `makeJob`/`duplicateJobs`/`jobFileName`, `embedImageBlob`/`decodeImageBlob`, `fitContent`/`contentByteLength`/`CONTENT_MAX`, `SERVICE`/`FORMAT_VERSION` are named identically across producing and consuming tasks. `RECORD_BYTES=27`/`RECORD_BITS=216` consistent. i18n keys used in Tasks 9–10 are all declared in Task 8 (en+zh).

**Known risk:** resize robustness (multi-scale) is best-effort for clean scale factors only — deliberately not over-claimed (matches spec §13).
