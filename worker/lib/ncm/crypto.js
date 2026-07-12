// NCM crypto — vendored from api-enhanced/util/crypto.js, rewritten for the Cloudflare Workers
// runtime. We keep ONLY the schemes our 12 whitelisted modules use:
//
//   weapi     — web client request encryption (AES-CBC double + RSA-wrapped key). Used by
//               search / playlist / song_detail / lyric / song_url.
//   linuxapi  — /api/linux/forward envelope (AES-ECB). Reserved for an emergency fallback path.
//   eapi      — PC client envelope (AES-ECB with a digest). Used by some newer endpoints.
//   api       — plaintext GET (no body encryption). Used for read-only public data.
//
// DROPPED (vs upstream):
//   - xeapi* (X25519 + AES-GCM + HMAC) — would need crypto.generateKeyPairSync('x25519') which
//     Workers' nodejs_compat doesn't expose; song_url/v1 falls back to the weapi path instead.
//   - eapiResDecrypt with zlib.gunzipSync — replaced by a stream-based path that we never hit
//     because APP_CONF.encryptResponse=false (we don't opt into e_r / encrypted responses).
//
// Deps: crypto-js@4.2.0 (pure JS, Workers-compatible), node-forge@1.4.0 (pure JS RSA PKCS#1 v1.5;
// Web Crypto's SubtleCrypto only does RSA-OAEP, which NCM does NOT use).

import CryptoJS from 'crypto-js'
import forge from 'node-forge'

const iv = '0102030405060708'
const presetKey = '0CoJUm6Qyw8W8jud'           // weapi outer AES key (well-known, public)
const linuxapiKey = 'rFgB&h#%2?^eDg:Q'           // linuxapi AES key
const eapiKey = 'e82ckenh8dichen8'              // eapi AES key
const base62 = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'

// NCM's RSA public key (well-known, public). Used to wrap the per-request secretKey in weapi.
const publicKey = `-----BEGIN PUBLIC KEY-----
MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDgtQn2JZ34ZC28NWYpAUd98iZ37BUrX/aKzmFbt7clFSs6sXqHauqKWqdtLkF2KexO40H1YTX8z2lSgBBOAxLsvaklV8k4cBFK9snQXE9/DDaFt6Rr7iVZMldczhC0JNgTz+SHXT6CBHuX3e9SdB1Ua44oncaTWz7OBGLbCiK45wIDAQAB
-----END PUBLIC KEY-----`

/** AES encrypt with selectable mode (cbc|ecb) and output format (base64|hex). */
export function aesEncrypt(text, mode, key, ivStr, format = 'base64') {
  const encrypted = CryptoJS.AES.encrypt(
    CryptoJS.enc.Utf8.parse(text),
    CryptoJS.enc.Utf8.parse(key),
    {
      iv: CryptoJS.enc.Utf8.parse(ivStr || ''),
      mode: CryptoJS.mode[mode.toUpperCase()],
      padding: CryptoJS.pad.Pkcs7,
    }
  )
  if (format === 'base64') return encrypted.toString()
  return encrypted.ciphertext.toString().toUpperCase()
}

/** AES decrypt (ECB-style, used for eapi response peeking if we ever enable e_r). */
export function aesDecrypt(ciphertext, key, ivStr, format = 'base64') {
  let bytes
  if (format === 'base64') {
    bytes = CryptoJS.AES.decrypt(ciphertext, CryptoJS.enc.Utf8.parse(key), {
      iv: CryptoJS.enc.Utf8.parse(ivStr || ''),
      mode: CryptoJS.mode.ECB,
      padding: CryptoJS.pad.Pkcs7,
    })
  } else {
    bytes = CryptoJS.AES.decrypt(
      { ciphertext: CryptoJS.enc.Hex.parse(ciphertext) },
      CryptoJS.enc.Utf8.parse(key),
      {
        iv: CryptoJS.enc.Utf8.parse(ivStr || ''),
        mode: CryptoJS.mode.ECB,
        padding: CryptoJS.pad.Pkcs7,
      }
    )
  }
  return bytes
}

/** RSA encrypt (PKCS#1 v1.5, no padding scheme) → hex. */
export function rsaEncrypt(str, pem = publicKey) {
  const pub = forge.pki.publicKeyFromPem(pem)
  const encrypted = pub.encrypt(str, 'NONE')
  return forge.util.bytesToHex(encrypted)
}

/**
 * weapi — the web-client request envelope. Doubly AES-CBC encrypted body, secretKey wrapped by
 * RSA. Returns { params, encSecKey } suitable for application/x-www-form-urlencoded posting.
 */
export function weapi(object) {
  const text = JSON.stringify(object)
  let secretKey = ''
  for (let i = 0; i < 16; i++) secretKey += base62.charAt(Math.round(Math.random() * 61))
  return {
    params: aesEncrypt(
      aesEncrypt(text, 'cbc', presetKey, iv),
      'cbc',
      secretKey,
      iv
    ),
    encSecKey: rsaEncrypt(secretKey.split('').reverse().join('')),
  }
}

/** linuxapi — AES-ECB envelope for /api/linux/forward. Returns { eparams } as hex. */
export function linuxapi(object) {
  const text = JSON.stringify(object)
  return { eparams: aesEncrypt(text, 'ecb', linuxapiKey, '', 'hex') }
}

/** eapi — PC client envelope (AES-ECB with a digest of url+body). Returns { params } as hex. */
export function eapi(url, object) {
  const text = typeof object === 'object' ? JSON.stringify(object) : object
  const message = `nobody${url}use${text}md5forencrypt`
  const digest = CryptoJS.MD5(message).toString()
  const data = `${url}-36cd479b6b5-${text}-36cd479b6b5-${digest}`
  return { params: aesEncrypt(data, 'ecb', eapiKey, '', 'hex') }
}

/** MD5 hex (re-exported for any future module that needs it inline). */
export function md5(text) {
  return CryptoJS.MD5(text).toString()
}

export { presetKey, linuxapiKey, eapiKey, iv, publicKey }
