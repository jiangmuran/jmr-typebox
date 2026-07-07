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
