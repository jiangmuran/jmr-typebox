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
