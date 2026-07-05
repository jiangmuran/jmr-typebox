// RSA keychain — pure, SSG-safe helpers for persisting named key pairs locally.
//
// These are the primitives only (serialize/parse, fingerprint, optional
// passphrase-encryption). The reactive store + localStorage wiring lives in the
// ToolboxPage component. Nothing here touches window/document/localStorage or runs
// crypto at module top level, so it is safe to import during SSG prerender; the
// crypto calls only happen when a function is actually invoked (in the browser).
//
// A saved item: { id, label, purpose:'encrypt'|'sign', pub, priv, fp, created }
// Storage wrapper (a single JSON string under one localStorage key):
//   plain:     { v, enc:false, items:[…] }
//   encrypted: { v, enc:true,  blob:"<AES-GCM base64>" }   // blob decrypts to items[]
import { aesEncrypt, aesDecrypt } from './crypto'

export const KEYCHAIN_VERSION = 1

// PEM (public key) → DER ArrayBuffer. Kept local so this module doesn't pull in the
// lazy-loaded rsa.js (which would bloat the shared toolbox bundle).
function pemToDer(pem) {
  const b64 = String(pem).replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')
  if (!b64) throw new Error('empty PEM')
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes.buffer
}

function newId() {
  try { return crypto.randomUUID() } catch {}
  return 'k' + Math.random().toString(36).slice(2) + Date.now().toString(36)
}

// Build a keychain item from a captured pair. Sync & pure — the caller computes the
// fingerprint (async) and passes it in.
export function makeKeyItem({ label, purpose, pub, priv, fp, created } = {}) {
  return {
    id: newId(),
    label: String(label ?? '').trim() || 'Untitled',
    purpose: purpose === 'sign' ? 'sign' : 'encrypt',
    pub: String(pub ?? ''),
    priv: String(priv ?? ''),
    fp: String(fp ?? ''),
    created: Number(created) || Date.now(),
  }
}

// items[] → plain JSON wrapper string.
export function serializeKeychain(items) {
  return JSON.stringify({ v: KEYCHAIN_VERSION, enc: false, items: Array.isArray(items) ? items : [] })
}

// Tolerant parse of a stored wrapper. Never throws; always returns a shape:
//   { v, enc, items }        for a plain store
//   { v, enc:true, blob }    for an encrypted store (items stays [] until decrypted)
export function parseKeychain(raw) {
  const empty = { v: KEYCHAIN_VERSION, enc: false, items: [] }
  if (!raw) return empty
  let obj
  try { obj = JSON.parse(raw) } catch { return empty }
  if (Array.isArray(obj)) return { v: KEYCHAIN_VERSION, enc: false, items: obj } // legacy bare array
  if (obj && typeof obj === 'object') {
    if (obj.enc) return { v: obj.v || KEYCHAIN_VERSION, enc: true, blob: String(obj.blob || ''), items: [] }
    return { v: obj.v || KEYCHAIN_VERSION, enc: false, items: Array.isArray(obj.items) ? obj.items : [] }
  }
  return empty
}

// items[] → encrypted wrapper string (AES-GCM via PBKDF2 from the passphrase).
export async function encryptKeychain(items, passphrase) {
  const blob = await aesEncrypt(JSON.stringify(Array.isArray(items) ? items : []), passphrase)
  return JSON.stringify({ v: KEYCHAIN_VERSION, enc: true, blob })
}

// Encrypted wrapper (from parseKeychain) + passphrase → items[]. Throws on a wrong
// passphrase or corrupt blob (AES-GCM auth failure), which the caller treats as "locked".
export async function decryptKeychain(parsed, passphrase) {
  const json = await aesDecrypt(parsed.blob, passphrase)
  const items = JSON.parse(json)
  return Array.isArray(items) ? items : []
}

// SHA-256 fingerprint of the public key's DER, as colon-separated uppercase hex byte
// pairs (e.g. "A1:B2:…") for out-of-band comparison. Returns '' on empty/invalid input.
export async function publicKeyFingerprint(pubPem) {
  try {
    if (!pubPem || !String(pubPem).trim()) return ''
    const der = pemToDer(pubPem)
    const hash = await crypto.subtle.digest('SHA-256', der)
    return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join(':').toUpperCase()
  } catch {
    return ''
  }
}
