// AES-GCM encrypt/decrypt with a passphrase (PBKDF2 key derivation). Output packs
// salt(16) + iv(12) + ciphertext as base64. Fully client-side via Web Crypto.
const enc = new TextEncoder()
const dec = new TextDecoder()

async function deriveKey(passphrase, salt) {
  const km = await crypto.subtle.importKey('raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    km,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
}

function toB64(bytes) {
  let bin = ''
  bytes.forEach(b => { bin += String.fromCharCode(b) })
  return btoa(bin)
}

export async function aesEncrypt(plaintext, passphrase) {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await deriveKey(passphrase, salt)
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plaintext)))
  const out = new Uint8Array(16 + 12 + ct.byteLength)
  out.set(salt, 0); out.set(iv, 16); out.set(ct, 28)
  return toB64(out)
}

export async function aesDecrypt(b64, passphrase) {
  const raw = Uint8Array.from(atob(b64.trim()), c => c.charCodeAt(0))
  const salt = raw.slice(0, 16)
  const iv = raw.slice(16, 28)
  const ct = raw.slice(28)
  const key = await deriveKey(passphrase, salt)
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct)
  return dec.decode(pt)
}
