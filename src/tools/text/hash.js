// Hashing via Web Crypto (SHA family + HMAC). MD5 is loaded lazily on the hash page
// (no native support) — kept out of this core so it stays dependency-free + testable.
const enc = new TextEncoder()
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('')

async function digest(algo, str) {
  return hex(await crypto.subtle.digest(algo, enc.encode(str)))
}

export const sha1 = s => digest('SHA-1', s)
export const sha256 = s => digest('SHA-256', s)
export const sha384 = s => digest('SHA-384', s)
export const sha512 = s => digest('SHA-512', s)

export async function hmac(message, key, algo = 'SHA-256') {
  const k = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: algo }, false, ['sign'])
  return hex(await crypto.subtle.sign('HMAC', k, enc.encode(message)))
}
