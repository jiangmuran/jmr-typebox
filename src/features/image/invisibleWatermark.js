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
