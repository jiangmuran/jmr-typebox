// Pure text transforms — shared by the Toolbox pages and the editor right-click plugins.
// Encoders throw on malformed input so callers can show an error toast.

const enc = new TextEncoder()
const dec = new TextDecoder()

// ---- Base64 (UTF-8 safe) ----
export function base64Encode(str) {
  const bytes = enc.encode(str)
  let bin = ''
  bytes.forEach(b => { bin += String.fromCharCode(b) })
  return btoa(bin)
}
export function base64Decode(str) {
  const bin = atob(str.trim())
  const bytes = Uint8Array.from(bin, c => c.charCodeAt(0))
  return dec.decode(bytes)
}

// ---- Hex ----
export function hexEncode(str) {
  return [...enc.encode(str)].map(b => b.toString(16).padStart(2, '0')).join('')
}
export function hexDecode(hex) {
  const clean = hex.trim().replace(/\s+/g, '')
  if (clean.length % 2) throw new Error('Invalid hex length')
  const bytes = new Uint8Array(clean.length / 2)
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(clean.substr(i * 2, 2), 16)
  return dec.decode(bytes)
}

// ---- URL ----
export const urlEncode = s => encodeURIComponent(s)
export const urlDecode = s => decodeURIComponent(s)

// ---- HTML entities ----
export function htmlEntitiesEncode(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}
export function htmlEntitiesDecode(s) {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
}

// ---- Case ----
export const toUpper = s => s.toUpperCase()
export const toLower = s => s.toLowerCase()
export const toTitle = s => s.toLowerCase().replace(/\b\w/g, c => c.toUpperCase())
export const toSentence = s => s.toLowerCase().replace(/(^\s*\w|[.!?]\s+\w)/g, c => c.toUpperCase())

// ---- JSON ----
export const jsonFormat = s => JSON.stringify(JSON.parse(s), null, 2)
export const jsonMinify = s => JSON.stringify(JSON.parse(s))

// ---- Line ops ----
export const sortLines = s => s.split('\n').sort((a, b) => a.localeCompare(b)).join('\n')
export const uniqueLines = s => [...new Set(s.split('\n'))].join('\n')
export const reverseLines = s => s.split('\n').reverse().join('\n')

// ---- Word count ----
export function countText(s) {
  const words = s.trim() ? s.trim().split(/\s+/).length : 0
  return { chars: s.length, words, lines: s.split('\n').length, readMin: Math.max(1, Math.ceil(words / 250)) }
}

// ---- JWT decode (no signature verification) ----
export function jwtDecode(token) {
  const parts = token.trim().split('.')
  if (parts.length < 2) throw new Error('Invalid JWT')
  const decodePart = p => {
    let b = p.replace(/-/g, '+').replace(/_/g, '/')
    while (b.length % 4) b += '='
    return JSON.parse(base64Decode(b))
  }
  return { header: decodePart(parts[0]), payload: decodePart(parts[1]), signature: parts[2] || '' }
}
