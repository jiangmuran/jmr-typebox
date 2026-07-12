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

// QIM step on a low-frequency luma DCT coefficient. Tuned empirically in Task 5
// against the JPEG-q70 proxy: COEF_INDEX=2 is raster (row 0, col 2), whose standard
// JPEG luma quant step is the smallest in the block (Q50=10 → Q70≈6). Survival needs
// the QIM basin (delta/4) to clear JPEG's rounding error (~Q70/2=3), i.e. delta > 2·Q70 = 12.
// DELTA=14 is the smallest value past that per-block guarantee; it holds all four
// robustness assertions with margin (gradient PSNR≈56.7 dB, JPEG-q70/brightness/0.5×-downscale
// all decode) and even survives the harsher q50 on most content.
export let DELTA = 14
export const COEF_INDEX = 2

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

// A block can only carry the QIM mark if its luma has headroom. Where pixels are pinned near
// 0/255 (flat white/black — screenshots, documents, logos) the perturbation clamps away, so the
// block reads a constant wrong bit. Skip such blocks in BOTH encode (leave them pristine, so pure
// white stays pure white) and decode (so they don't poison the majority vote). Same test on the
// same pixels keeps the k-index aligned between the two passes.
function _blockReliable(blk) {
  let clipped = 0
  for (let p = 0; p < 64; p++) if (blk[p] <= 2 || blk[p] >= 253) clipped++
  return clipped <= 32
}

// Luma headroom (see encode). Keeps flat white/black regions embeddable so the mark survives on
// screenshots, documents, and logos. White 255→249, black 0→6 — barely perceptible.
export const HEADROOM = 6

export function encode(pixels, w, h, record, opts = {}) {
  const delta = opts.delta ?? DELTA
  const coef = opts.coefIndex ?? COEF_INDEX
  if (capacityBlocks(w, h) < RECORD_BITS) throw new Error('image too small for one watermark pass')
  const bits = bytesToBits(record)
  const { Y, Cb, Cr } = toYCbCr(pixels, w, h)
  // Adaptive luma headroom: pull luma off the 0/255 rails ONLY when the image has extensive flat
  // white/black area (screenshots, documents, logos), where the QIM perturbation would otherwise
  // clamp away and carry no mark. Photos have little saturation, so they stay pristine (full
  // invisibility). When applied, white 255→249 / black 0→6 — barely perceptible.
  let clipped = 0
  for (let i = 0; i < Y.length; i++) if (Y[i] <= 2 || Y[i] >= 253) clipped++
  if (clipped > Y.length * 0.12) {
    const sc = (255 - 2 * HEADROOM) / 255
    for (let i = 0; i < Y.length; i++) Y[i] = Y[i] * sc + HEADROOM
  }
  const bw = Math.floor(w / 8), bh = Math.floor(h / 8)
  let k = 0
  for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) {
    const blk = _readBlock(Y, w, bx, by)
    if (_blockReliable(blk)) {
      const d = dct8x8(blk)
      d[coef] = embedCoef(d[coef], bits[k % RECORD_BITS], delta)
      _writeBlock(Y, w, bx, by, idct8x8(d))
    }
    k++
  }
  // Embedding only perturbs luma; carry the source alpha through so transparent
  // PNG/GIF inputs don't come back opaque (toRGB hardcodes alpha=255).
  const out = toRGB(Y, Cb, Cr, w, h)
  for (let i = 3; i < out.length; i += 4) out[i] = pixels[i]
  return out
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
    const blk = _readBlock(Y, w, bx, by)
    if (_blockReliable(blk)) {
      const d = dct8x8(blk)
      votes[k % RECORD_BITS] += extractCoef(d[coef], delta) ? 1 : -1
      counts[k % RECORD_BITS]++
    }
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

// --- Task 5: robustness helpers (JPEG-proxy survival, resize, invisibility) ---

// Peak signal-to-noise ratio over RGB (alpha skipped), in dB. Higher = less visible.
export function psnr(a, b) {
  let sse = 0, n = 0
  for (let i = 0; i < a.length; i++) { if (i % 4 === 3) continue; const dd = a[i] - b[i]; sse += dd * dd; n++ }
  if (sse === 0) return Infinity
  return 10 * Math.log10((255 * 255) / (sse / n))
}

// Nearest-neighbour resample to nw×nh. Pure integer index math, canvas-free.
export function resampleNearest(pixels, w, h, nw, nh) {
  const out = new Uint8ClampedArray(nw * nh * 4)
  for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) {
    const sx = Math.min(w - 1, (x * w / nw) | 0), sy = Math.min(h - 1, (y * h / nh) | 0)
    const si = (sy * w + sx) * 4, di = (y * nw + x) * 4
    out[di] = pixels[si]; out[di + 1] = pixels[si + 1]; out[di + 2] = pixels[si + 2]; out[di + 3] = 255
  }
  return out
}

// Try the image at a few clean scale factors (rescaled to an 8-multiple working
// size) and return the first CRC-valid decode, tagged with the scale that worked.
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

// --- Task 7: pure UI-logic helpers (batch "job model") ---
// Kept pure and canvas-free so the Vue page stays thin. Ids come from a
// module-local monotonic counter (no Date/Math.random → deterministic, testable).

let _jobSeq = 0

export function makeJob(source, content = '') {
  return { id: ++_jobSeq, source, content, status: 'idle' }
}

// Fan one source out into n jobs sharing job.source, content suffixed ` #1..#n`
// (an empty base content yields `#1`, `#2`, … thanks to the trim).
// Reserve room for the widest suffix (` #n`) up front so a near-cap base isn't
// re-truncated by fitContent at generate time — which would drop every suffix and
// collapse all versions to one identical mark, defeating traitor-tracing.
export function duplicateJobs(job, n, maxBytes = CONTENT_MAX) {
  const base = fitContent(job.content, maxBytes - contentByteLength(' #' + n))
  const out = []
  for (let i = 1; i <= n; i++) {
    out.push({ id: ++_jobSeq, source: job.source, content: `${base} #${i}`.trim(), status: 'idle' })
  }
  return out
}

// A generated result is only current while the inputs it was produced from are unchanged.
// job.embedded snapshots { content, registered } at generate time; comparing against the row's
// current effective content (and the register toggle) tells the UI whether the stored blob
// still matches what's on screen — stale rows lose their checkmark and get re-generated,
// instead of silently serving a blob that embeds different content than the visible text.
export function jobFresh(job, uniform = '', registered = false) {
  return job.status === 'done' && !!job.embedded &&
    job.embedded.content === (job.content || uniform) &&
    !!job.embedded.registered === !!registered
}

// Safe download filename: base__content__idx.ext, content slugified to [a-z0-9-] and capped at
// 40 chars (registered content can be 2KB — that must not become the filename); an empty/blank
// content collapses to base__idx.ext. index is 0-based, shown 1-based.
export function jobFileName(baseName, content, index, ext = 'png') {
  const base = String(baseName || 'image').replace(/\.[^./\\]+$/, '') || 'image'
  const slug = String(content || '').toLowerCase().replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '')
  return slug ? `${base}__${slug}__${index + 1}.${ext}` : `${base}__${index + 1}.${ext}`
}
