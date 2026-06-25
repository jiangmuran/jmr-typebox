// TOTP (RFC 6238) + base32 (RFC 4648), via Web Crypto — dependency-free, fully client-side.
// Powers the /tools/totp tool. Nothing is ever sent anywhere.

// Decode a base32 secret (case-insensitive; spaces and '=' padding tolerated) to bytes.
export function base32Decode(input) {
  const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  const clean = String(input || '').toUpperCase().replace(/[\s=]/g, '')
  if (!clean) return new Uint8Array(0)
  let bits = 0, value = 0
  const out = []
  for (const ch of clean) {
    const idx = ALPHABET.indexOf(ch)
    if (idx === -1) throw new Error('invalid base32 character')
    value = (value << 5) | idx
    bits += 5
    if (bits >= 8) { bits -= 8; out.push((value >>> bits) & 0xff) }
  }
  return new Uint8Array(out)
}

const HASHES = { SHA1: 'SHA-1', SHA256: 'SHA-256', SHA512: 'SHA-512' }

// Generate a TOTP code from a base32 `secret`. Returns the zero-padded code string.
export async function totp(secret, { time = Date.now(), step = 30, digits = 6, algorithm = 'SHA1' } = {}) {
  const key = base32Decode(secret)
  if (!key.length) throw new Error('empty secret')
  const counter = Math.floor(time / 1000 / step)
  const buf = new ArrayBuffer(8)
  const view = new DataView(buf)
  view.setUint32(0, Math.floor(counter / 2 ** 32))
  view.setUint32(4, counter % 2 ** 32)
  const cryptoKey = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: HASHES[algorithm] || 'SHA-1' }, false, ['sign'])
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, buf))
  // RFC 4226 dynamic truncation.
  const offset = mac[mac.length - 1] & 0x0f
  const bin = ((mac[offset] & 0x7f) << 24) | (mac[offset + 1] << 16) | (mac[offset + 2] << 8) | mac[offset + 3]
  const n = Math.max(6, Math.min(8, digits))
  return (bin % 10 ** n).toString().padStart(n, '0')
}

// Seconds left in the current step window.
export function totpRemaining(step = 30, time = Date.now()) {
  return step - (Math.floor(time / 1000) % step)
}

// Best-effort parse of an otpauth:// URI (e.g. scanned from a QR) → { secret, digits, step, algorithm, label }.
export function parseOtpauth(uri) {
  try {
    const u = new URL(String(uri).trim())
    if (u.protocol !== 'otpauth:') return null
    const secret = u.searchParams.get('secret')
    if (!secret) return null
    return {
      secret,
      digits: Number(u.searchParams.get('digits')) || 6,
      step: Number(u.searchParams.get('period')) || 30,
      algorithm: (u.searchParams.get('algorithm') || 'SHA1').toUpperCase().replace('-', ''),
      label: decodeURIComponent(u.pathname.replace(/^\/+/, '')),
    }
  } catch { return null }
}
