// JWT (HS256) helpers — for the admin session cookie. The Web Crypto API is used directly (no
// jsonwebtoken dependency). Tokens are signed with an HMAC key derived from env.AUTH_SECRET
// (any 16+ char random string the operator sets once via `wrangler secret put AUTH_SECRET`).
//
// Why JWT and not a random session id: a JWT is self-describing (no DO lookup needed to check
// expiry), so most admin requests can be validated without a DO round-trip. Revocation is rare
// for a single-user admin surface — if it's ever needed, rotate AUTH_SECRET (invalidates all
// sessions immediately) or add a per-passkey session table later.
//
// Cookie name: tb-admin. HttpOnly + SameSite=Strict + Secure (when not localhost).

const COOKIE_NAME = 'tb-admin'
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

let _keyCache = new WeakMap() // env → CryptoKey

/** Derive (or fetch from the per-env cache) the HMAC signing key from AUTH_SECRET. */
async function getKey(env) {
  if (_keyCache.has(env)) return _keyCache.get(env)
  const secret = env?.AUTH_SECRET
  if (!secret || typeof secret !== 'string' || secret.length < 16) {
    throw new Error('AUTH_SECRET missing or too short (need >= 16 chars)')
  }
  // HKDF-style: import the secret as raw key material, then derive a 32-byte HMAC key.
  const baseKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HKDF' },
    false,
    ['deriveKey']
  )
  const hmacKey = await crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new TextEncoder().encode('tb-admin-salt'), info: new TextEncoder().encode('session') },
    baseKey,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  )
  _keyCache.set(env, hmacKey)
  return hmacKey
}

function b64url(input) {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
function b64urlDecode(str) {
  const pad = str.length % 4 === 0 ? '' : '='.repeat(4 - (str.length % 4))
  const b64 = (str + pad).replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

/** Sign a session JWT. Payload is { sub:'admin', iat, exp }. Returns the compact JWT string. */
export async function signSession(env) {
  const key = await getKey(env)
  const header = { alg: 'HS256', typ: 'JWT' }
  const now = Date.now()
  const payload = { sub: 'admin', iat: now, exp: now + SESSION_TTL_MS }
  const h = b64url(JSON.stringify(header))
  const p = b64url(JSON.stringify(payload))
  const signingInput = `${h}.${p}`
  const sigBuf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signingInput))
  const sig = b64url(new Uint8Array(sigBuf))
  return `${signingInput}.${sig}`
}

/**
 * Verify a session JWT. Returns { ok, payload } or { ok:false, reason }.
 * Reason codes: 'no_token' | 'malformed' | 'bad_sig' | 'expired'.
 */
export async function verifySession(env, token) {
  if (!token || typeof token !== 'string') return { ok: false, reason: 'no_token' }
  const parts = token.split('.')
  if (parts.length !== 3) return { ok: false, reason: 'malformed' }
  const [h, p, sig] = parts
  const key = await getKey(env)
  let valid
  try {
    valid = await crypto.subtle.verify('HMAC', key, b64urlDecode(sig), new TextEncoder().encode(`${h}.${p}`))
  } catch {
    return { ok: false, reason: 'bad_sig' }
  }
  if (!valid) return { ok: false, reason: 'bad_sig' }
  let payload
  try { payload = JSON.parse(new TextDecoder().decode(b64urlDecode(p))) } catch { return { ok: false, reason: 'malformed' } }
  if (payload.exp && payload.exp < Date.now()) return { ok: false, reason: 'expired' }
  if (payload.sub !== 'admin') return { ok: false, reason: 'bad_sub' }
  return { ok: true, payload }
}

/** Read the session cookie from a Request. Returns the token string or ''. */
export function readSessionCookie(request) {
  const raw = request.headers.get('cookie') || ''
  const m = raw.match(new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]+)`))
  return m ? m[1] : ''
}

/**
 * Build the Set-Cookie header value for a fresh session. `maxAgeSec` defaults to 7 days.
 * Secure=false only when the request URL is localhost (so local dev over http still works).
 */
export function sessionCookieHeader(token, { request, maxAgeSec = SESSION_TTL_MS / 1000 } = {}) {
  const isLocal = request ? new URL(request.url).hostname === 'localhost' : false
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Strict${isLocal ? '' : '; Secure'}; Max-Age=${maxAgeSec}`
}

/** Build a Set-Cookie that EXPIRES the session cookie (used on logout). */
export function clearSessionCookieHeader({ request } = {}) {
  const isLocal = request ? new URL(request.url).hostname === 'localhost' : false
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict${isLocal ? '' : '; Secure'}; Max-Age=0`
}

export { COOKIE_NAME, SESSION_TTL_MS }

/** sha-256 hex of a string (used to hash the bootstrap token before storing it in the DO). */
export async function sha256Hex(input) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(input)))
  const bytes = new Uint8Array(buf)
  let hex = ''
  for (const b of bytes) hex += b.toString(16).padStart(2, '0')
  return hex
}

/** Generate a URL-safe random token (default 32 bytes / 43 base64url chars). */
export function randomToken(bytes = 32) {
  const buf = new Uint8Array(bytes)
  crypto.getRandomValues(buf)
  return b64url(buf)
}
