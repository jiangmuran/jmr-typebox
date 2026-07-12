// RSA via the Web Crypto API — key-pair generation, encrypt/decrypt (RSA-OAEP) and
// sign/verify (RSA-PSS), with PEM import/export. Fully client-side; nothing is uploaded.
// Note: RSA-OAEP can only encrypt data smaller than the key size (≈190 bytes for 2048-bit),
// so encryption is for short messages/keys — hybrid encryption is out of scope here.

const enc = new TextEncoder()
const dec = new TextDecoder()

function ab2b64(buf) {
  const b = new Uint8Array(buf)
  let s = ''
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i])
  return btoa(s)
}
function b642ab(b64) {
  const s = atob(String(b64).replace(/\s+/g, ''))
  const b = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i)
  return b.buffer
}
export function toPem(buf, label) {
  const body = ab2b64(buf).replace(/(.{64})/g, '$1\n').trimEnd()
  return `-----BEGIN ${label}-----\n${body}\n-----END ${label}-----`
}
export function fromPem(pem) {
  const b64 = String(pem).replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')
  if (!b64) throw new Error('empty PEM')
  return b642ab(b64)
}

// A key is generated for ONE purpose (Web Crypto fixes key usages at creation).
const ALG = {
  encrypt: { name: 'RSA-OAEP', hash: 'SHA-256' },
  sign: { name: 'RSA-PSS', hash: 'SHA-256' },
}

export async function generateRsaKeys(purpose = 'encrypt', modulusLength = 2048) {
  const usages = purpose === 'encrypt' ? ['encrypt', 'decrypt'] : ['sign', 'verify']
  const kp = await crypto.subtle.generateKey(
    { ...ALG[purpose], modulusLength, publicExponent: new Uint8Array([1, 0, 1]) },
    true, usages,
  )
  const [spki, pkcs8] = await Promise.all([
    crypto.subtle.exportKey('spki', kp.publicKey),
    crypto.subtle.exportKey('pkcs8', kp.privateKey),
  ])
  return { publicKey: toPem(spki, 'PUBLIC KEY'), privateKey: toPem(pkcs8, 'PRIVATE KEY') }
}

// Recompute the public key from a PKCS#8 private key. RSA's SPKI (SubjectPublicKeyInfo)
// is algorithm-agnostic — it only carries the modulus n and exponent e — so importing
// the private key under RSA-OAEP and re-exporting the public half yields the very same
// `-----BEGIN PUBLIC KEY-----` PEM that generateRsaKeys produced, whether the pair was
// made for encryption (OAEP) or signing (PSS). Lets a user restore "my public key" when
// only the private key survived. Throws on an invalid/non-RSA private key.
export async function deriveRsaPublicKey(privPem) {
  const priv = await crypto.subtle.importKey('pkcs8', fromPem(privPem), { name: 'RSA-OAEP', hash: 'SHA-256' }, true, ['decrypt'])
  const jwk = await crypto.subtle.exportKey('jwk', priv)
  const pubKey = await crypto.subtle.importKey('jwk', { kty: 'RSA', n: jwk.n, e: jwk.e, ext: true }, { name: 'RSA-OAEP', hash: 'SHA-256' }, true, ['encrypt'])
  const spki = await crypto.subtle.exportKey('spki', pubKey)
  return toPem(spki, 'PUBLIC KEY')
}

const importPub = (pem, purpose) =>
  crypto.subtle.importKey('spki', fromPem(pem), ALG[purpose], false, [purpose === 'encrypt' ? 'encrypt' : 'verify'])
const importPriv = (pem, purpose) =>
  crypto.subtle.importKey('pkcs8', fromPem(pem), ALG[purpose], false, [purpose === 'encrypt' ? 'decrypt' : 'sign'])

export async function rsaEncrypt(text, pubPem) {
  const key = await importPub(pubPem, 'encrypt')
  return ab2b64(await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, key, enc.encode(text)))
}
export async function rsaDecrypt(b64, privPem) {
  const key = await importPriv(privPem, 'encrypt')
  return dec.decode(await crypto.subtle.decrypt({ name: 'RSA-OAEP' }, key, b642ab(b64)))
}
export async function rsaSign(text, privPem) {
  const key = await importPriv(privPem, 'sign')
  return ab2b64(await crypto.subtle.sign({ name: 'RSA-PSS', saltLength: 32 }, key, enc.encode(text)))
}
export async function rsaVerify(text, sigB64, pubPem) {
  const key = await importPub(pubPem, 'sign')
  return crypto.subtle.verify({ name: 'RSA-PSS', saltLength: 32 }, key, b642ab(sigB64), enc.encode(text))
}
