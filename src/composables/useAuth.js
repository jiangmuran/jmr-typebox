// useAuth — the admin surface's authentication composable. Wraps the entire WebAuthn flow
// (bootstrap → bind first passkey → subsequent biometric login → manage devices → one-time
// login links) against the worker's /api/auth/* routes.
//
// The browser-side WebAuthn calls use the native `navigator.credentials.create/get` API plus a
// 20-line base64url helper — no @simplewebauthn/browser dependency (the server side uses
// @simplewebauthn/server, the browser side is trivial enough to inline).
//
// State machine (surfaced via `view` ref so AdminPage.vue can switch screens):
//   'loading'      — initial probe in flight
//   'no-setup'     — bootstrap token not set yet (operator forgot `wrangler secret put`)
//   'bind'         — bootstrap token works but no passkey bound yet → show the bind flow
//   'login'        — passkey(s) exist, user not authenticated → show biometric login
//   'authenticated'— valid session, show the dashboard

import { ref, computed } from 'vue'

// ---- reactive singleton state ----
const authenticated = ref(false)
const session = ref(null)            // { sub, iat, exp } when authenticated
const view = ref('loading')          // 'loading' | 'no-setup' | 'bind' | 'login' | 'authenticated'
const status = ref(null)             // /api/admin/status body (bootstrap, passkeys, etc.)
const error = ref('')                // last error message (cleared on next action)
const busy = ref(false)              // an auth operation in flight

// Per-session WebAuthn options cache (between begin and finish calls).
let _pendingOptions = null

// ---- base64url helpers (the ONLY thing simplewebauthn/browser would have given us) ----
function bufToB64url(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
// REVERSE: base64url string → Uint8Array. The browser's navigator.credentials.create/get API
// needs ArrayBuffer/TypedArray for challenge, user.id, credential IDs — but @simplewebauthn/server
// returns these as base64url STRINGS in the JSON options. Without this conversion the browser
// throws "The provided value is not of type '(ArrayBuffer or ArrayBufferView)'".
function b64urlToBuf(b64url) {
  if (!b64url) return new Uint8Array(0)
  const pad = b64url.length % 4 === 0 ? '' : '='.repeat(4 - (b64url.length % 4))
  const b64 = (b64url + pad).replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

/**
 * Convert the registration options from simplewebauthn's JSON shape (base64url strings) into the
 * shape navigator.credentials.create() expects (ArrayBuffer/TypedArray). Converts challenge,
 * user.id, and every excludeCredentials[].id.
 */
function prepareRegistrationOptions(options) {
  return {
    ...options,
    challenge: b64urlToBuf(options.challenge),
    user: {
      ...options.user,
      id: b64urlToBuf(options.user.id),
    },
    excludeCredentials: (options.excludeCredentials || []).map((c) => ({
      ...c,
      id: b64urlToBuf(c.id),
    })),
  }
}

/**
 * Convert authentication options from simplewebauthn's JSON shape into the shape
 * navigator.credentials.get() expects. Converts challenge + every allowCredentials[].id.
 */
function prepareAuthenticationOptions(options) {
  return {
    ...options,
    challenge: b64urlToBuf(options.challenge),
    allowCredentials: (options.allowCredentials || []).map((c) => ({
      ...c,
      id: b64urlToBuf(c.id),
    })),
  }
}

/**
 * Convert the PublicKeyCredential object returned by navigator.credentials.create() / .get()
 * into a plain JSON-serialisable structure the server expects. Mirrors the shape simplewebauthn
 * uses, so verifyRegistrationResponse / verifyAuthenticationResponse accept it directly.
 */
function serializeCred(cred) {
  const out = {
    id: cred.id,
    rawId: bufToB64url(cred.rawId),
    type: cred.type,
    response: {},
  }
  const r = cred.response
  if (r.clientDataJSON) out.response.clientDataJSON = bufToB64url(r.clientDataJSON)
  if (r.attestationObject) out.response.attestationObject = bufToB64url(r.attestationObject)
  if (r.authenticatorData) out.response.authenticatorData = bufToB64url(r.authenticatorData)
  if (r.signature) out.response.signature = bufToB64url(r.signature)
  if (r.userHandle) out.response.userHandle = bufToB64url(r.userHandle)
  if (Array.isArray(r.transports)) out.response.transports = r.transports
  return out
}

// ---- internal: small fetch wrapper that throws on non-2xx ----
async function postJson(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'include', // carry + accept the session cookie
  })
  const text = await res.text()
  let parsed = {}
  try { parsed = text ? JSON.parse(text) : {} } catch { parsed = { _raw: text } }
  if (!res.ok) {
    const e = new Error(parsed.error || parsed.message || `HTTP ${res.status}`)
    e.status = res.status
    e.body = parsed
    throw e
  }
  return parsed
}
async function getJson(url) {
  const res = await fetch(url, { credentials: 'include' })
  const parsed = await res.json().catch(() => ({}))
  if (!res.ok) {
    const e = new Error(parsed.error || `HTTP ${res.status}`)
    e.status = res.status
    e.body = parsed
    throw e
  }
  return parsed
}

export function useAuth() {
  // ---------------- lifecycle ----------------

  /** Probe the current session + admin status. Decides which view to show. Idempotent. */
  async function probe() {
    error.value = ''
    view.value = 'loading'
    try {
      const sess = await getJson('/api/auth/session')
      if (sess.authenticated) {
        authenticated.value = true
        session.value = sess.session
        await loadStatus()
        view.value = 'authenticated'
        return
      }
      // Not authenticated. The session response carries a `setup` object telling us whether
      // a bootstrap token exists + whether any passkeys are registered — that's how we pick
      // between the bind flow and the login flow WITHOUT needing a session (which we don't have).
      authenticated.value = false
      session.value = null
      const setup = sess.setup || {}
      if (setup.hasPasskeys) {
        // Passkeys exist → user is a returning device, show biometric login.
        view.value = 'login'
      } else if (setup.hasBootstrap && !setup.bootstrapUsed) {
        // No passkeys yet but a bootstrap token is set → first-time bind flow.
        view.value = 'bind'
      } else {
        // No bootstrap token configured → operator needs to set BOOTSTRAP_TOKEN secret.
        view.value = 'no-setup'
      }
    } catch (e) {
      error.value = String(e.message || e)
      view.value = 'login'
    }
  }

  async function loadStatus() {
    try {
      status.value = await getJson('/api/admin/status')
    } catch { /* unauthenticated — leave status null */ }
  }

  // ---------------- bootstrap (first passkey) ----------------

  async function bootstrap(token, { nickname } = {}) {
    error.value = ''
    busy.value = true
    try {
      // 1. POST token → server returns WebAuthn registration options.
      const { options } = await postJson('/api/auth/bootstrap', { token, nickname })
      // 2. Browser: ask the authenticator to create a credential.
      //    Must convert base64url strings → ArrayBuffers before passing to the browser API.
      const cred = await navigator.credentials.create({ publicKey: prepareRegistrationOptions(options) })
      // 3. POST the credential + token back to finish-passkey, which verifies + binds.
      await postJson('/api/auth/finish-passkey', {
        token,
        nickname: nickname || 'Device 1',
        response: serializeCred(cred),
      })
      authenticated.value = true
      await loadStatus()
      view.value = 'authenticated'
      return true
    } catch (e) {
      error.value = e.body?.error === 'invalid_token' ? 'Invalid bootstrap token' : (e.message || String(e))
      return false
    } finally {
      busy.value = false
    }
  }

  // ---------------- normal biometric login ----------------

  async function login() {
    error.value = ''
    busy.value = true
    try {
      const { options } = await postJson('/api/auth/begin-login', {})
      const cred = await navigator.credentials.get({ publicKey: prepareAuthenticationOptions(options) })
      await postJson('/api/auth/finish-login', { response: serializeCred(cred) })
      authenticated.value = true
      await loadStatus()
      view.value = 'authenticated'
      return true
    } catch (e) {
      // navigator.credentials.get throws AbortError when the user cancels — surface that gently.
      if (e?.name === 'AbortError') error.value = ''
      else error.value = e.message || String(e)
      return false
    } finally {
      busy.value = false
    }
  }

  async function logout() {
    error.value = ''
    try { await postJson('/api/auth/logout', {}) } catch { /* ignore */ }
    authenticated.value = false
    session.value = null
    status.value = null
    view.value = 'login'
  }

  // ---------------- device management (requires session) ----------------

  async function addPasskey({ nickname } = {}) {
    error.value = ''
    busy.value = true
    try {
      const { options } = await postJson('/api/auth/begin-passkey', {})
      const cred = await navigator.credentials.create({ publicKey: prepareRegistrationOptions(options) })
      await postJson('/api/auth/finish-passkey-session', {
        nickname: nickname || `Device ${Date.now() % 1000}`,
        response: serializeCred(cred),
      })
      await loadStatus()
      return true
    } catch (e) {
      if (e?.name === 'AbortError') error.value = ''
      else error.value = e.message || String(e)
      return false
    } finally {
      busy.value = false
    }
  }

  async function removePasskey(id) {
    error.value = ''
    try {
      await postJson('/api/auth/remove-passkey', { id })
      await loadStatus()
      return true
    } catch (e) {
      error.value = e.body?.error || e.message || String(e)
      return false
    }
  }

  async function generateOneTimeLink() {
    error.value = ''
    try {
      const out = await postJson('/api/auth/one-time-link', {})
      // Build the full URL the operator copies to a new device.
      const origin = typeof window !== 'undefined' ? window.location.origin : ''
      return { token: out.token, url: `${origin}/admin?otp=${out.token}`, expiresAt: out.expiresAt }
    } catch (e) {
      error.value = e.message || String(e)
      return null
    }
  }

  // Used by the route guard when the page is opened with ?otp=xxx — redeem the one-time link,
  // which establishes a session and lets the new device add its own passkey.
  async function redeemOneTimeLink(token) {
    error.value = ''
    busy.value = true
    try {
      await postJson('/api/auth/redeem-one-time', { token })
      authenticated.value = true
      await loadStatus()
      view.value = 'authenticated'
      return true
    } catch (e) {
      error.value = 'Invalid or expired one-time link'
      return false
    } finally {
      busy.value = false
    }
  }

  // ---------------- admin actions (NCM cookie, IP allowlist) ----------------

  async function setNcmCookie(cookie) {
    error.value = ''
    try {
      await postJson('/api/admin/ncm-cookie', { cookie })
      await loadStatus()
      return true
    } catch (e) {
      error.value = e.body?.error || e.message || String(e)
      return false
    }
  }

  async function clearNcmCookie() {
    error.value = ''
    try {
      await fetch('/api/admin/ncm-cookie', { method: 'DELETE', credentials: 'include' })
      await loadStatus()
      return true
    } catch (e) {
      error.value = e.message || String(e)
      return false
    }
  }

  async function setIpAllowlist(ips) {
    error.value = ''
    try {
      await postJson('/api/admin/ip-allowlist', { ips })
      await loadStatus()
      return true
    } catch (e) {
      error.value = e.body?.error || e.message || String(e)
      return false
    }
  }

  // ---- derived ----
  const hasPasskeys = computed(() => (status.value?.passkeyCount || 0) > 0)
  const needsBootstrap = computed(() => view.value === 'no-setup')

  return {
    // state
    authenticated, session, view, status, error, busy,
    // derived
    hasPasskeys, needsBootstrap,
    // lifecycle
    probe, loadStatus,
    // auth flows
    bootstrap, login, logout,
    // device management
    addPasskey, removePasskey, generateOneTimeLink, redeemOneTimeLink,
    // admin actions
    setNcmCookie, clearNcmCookie, setIpAllowlist,
  }
}
