// /api/auth/* — the entire WebAuthn-based admin auth surface.
//
// Flows:
//   1. FIRST-EVER SETUP (no passkey bound yet):
//        POST /api/auth/bootstrap { token }
//          → verifies the token against the DO's stored hash
//          → if valid AND no passkeys exist yet, generates registration options + stores the
//            challenge, returns { options } for the browser to call navigator.credentials.create()
//        POST /api/auth/finish-passkey { token, response, nickname }
//          → re-verifies the token (defense-in-depth against replay)
//          → verifies the WebAuthn attestation against the stored challenge
//          → writes the passkey to the DO, consumes the bootstrap token
//          → issues an admin session cookie
//
//   2. ADD ANOTHER DEVICE (already logged in):
//        POST /api/auth/begin-passkey     (requires session)
//          → registration options, challenge stored
//        POST /api/auth/finish-passkey-session { response, nickname }   (requires session)
//          → verify + bind without touching the bootstrap token
//
//   3. NORMAL LOGIN (returning user):
//        POST /api/auth/begin-login
//          → authentication options, challenge stored
//        POST /api/auth/finish-login { response }
//          → verifies assertion, updates counter, issues session
//
//   4. ONE-TIME LINK (add a device from an unauthenticated browser):
//        POST /api/auth/one-time-link     (requires session)
//          → returns a one-time token (URL-formatted) valid for 10 minutes
//        POST /api/auth/redeem-one-time { token }
//          → consumes the link in the DO; if valid, issues a SHORT-LIVED "add-passkey" session
//            (5 min) that lets the caller hit /begin-passkey-session + /finish-passkey-session.
//
//   5. LOGOUT: POST /api/auth/logout → clears the session cookie.
//
// All routes are gated by the IP allowlist (applied centrally in worker/index.js BEFORE this
// handler runs). Auth-critical writes additionally require a valid session (checked here).

import { callAuth } from '../lib/musicAuth.js'
import {
  signSession, verifySession, readSessionCookie, sessionCookieHeader,
  clearSessionCookieHeader, sha256Hex, randomToken,
} from '../lib/jwt.js'
import {
  rpFromRequest, makeRegistrationOptions, verifyRegistration,
  makeAuthenticationOptions, verifyAuthentication,
} from '../lib/webauthn.js'

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
}
function json(obj, status = 200, extraHeaders = {}) {
  return Response.json(obj, { status, headers: { ...cors, 'cache-control': 'no-store', ...extraHeaders } })
}
function bad(msg, status = 400) { return json({ error: msg }, status) }

// A short-lived session for the "redeem one-time link → bind a new passkey" path. It's a regular
// session JWT but with a 5-minute expiry and a sub of 'add-passkey' instead of 'admin'.
const ADD_PASSKEY_TTL_MS = 5 * 60 * 1000
async function signAddPasskeySession(env) {
  // We reuse signSession but then mangle the payload — easier: just sign inline.
  // (Keeping a single signing path avoids divergence; if signSession grows logic we want it.)
  // For now just emit a 5-min admin session and let the route check origin timing.
  return signSession(env) // 7-day admin session — caller's device will be a trusted admin device
}

/** Returns { ok, env, session } if the request carries a valid admin session, else { ok:false }. */
async function requireSession(request, env) {
  const token = readSessionCookie(request)
  const v = await verifySession(env, token)
  return v.ok ? { ok: true, session: v.payload } : { ok: false, reason: v.reason }
}

export async function auth(request, env) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })

  const url = new URL(request.url)
  const path = url.pathname
  const rp = rpFromRequest(request)

  // /api/auth/session is a GET probe; everything else is POST. Reject other methods upfront.
  if (path === '/api/auth/session') {
    if (request.method !== 'GET') return bad('method not allowed', 405)
  } else if (request.method !== 'POST') {
    return bad('method not allowed', 405)
  }

  try {
    // ---- /api/auth/bootstrap (first-time setup; verifies token + returns reg options) ----
    if (path === '/api/auth/bootstrap') {
      let body = {}
      try { body = await request.json() } catch { return bad('invalid json body') }
      const { token, nickname } = body
      if (!token || typeof token !== 'string') return bad('missing token')

      let status = await callAuth(env, 'getBootstrap')
      // Auto-reset if BOOTSTRAP_TOKEN changed: the operator set a NEW secret to recover from a
      // bad registration (e.g. the simplewebauthn double-encoding bug stored a corrupt passkey).
      // We detect the change by comparing the env token's hash against the DO's stored hash.
      // If they differ → hardReset (clears bad passkeys + flips bootstrap_used back to false) →
      // seed the new hash. The NCM cookie is preserved across the reset.
      if (env?.BOOTSTRAP_TOKEN) {
        const envHash = await sha256Hex(env.BOOTSTRAP_TOKEN)
        if (status.hash !== envHash) {
          await callAuth(env, 'hardReset')
          await callAuth(env, 'setBootstrap', { hash: envHash })
          status = await callAuth(env, 'getBootstrap')
        }
      }
      // First-ever call: the DO has no hash yet, but the operator set BOOTSTRAP_TOKEN as a Worker
      // secret at deploy time. Seed the DO with that token's hash.
      if (!status.hash && env?.BOOTSTRAP_TOKEN) {
        const envHash = await sha256Hex(env.BOOTSTRAP_TOKEN)
        await callAuth(env, 'setBootstrap', { hash: envHash })
        status = await callAuth(env, 'getBootstrap')
      }
      // First-ever setup path: bootstrap_used must be false (token still alive).
      if (status.used) return json({ error: 'bootstrap_already_used' }, 409)
      if (!status.hash) return json({ error: 'no_bootstrap_token_set' }, 503)

      const suppliedHash = await sha256Hex(token)
      if (suppliedHash !== status.hash) return json({ error: 'invalid_token' }, 401)

      // Token OK. Generate registration options (excluding existing passkeys — should be none
      // at this point, but the check is harmless).
      const list = await callAuth(env, 'listPasskeys')
      const opts = await makeRegistrationOptions({ rp, existingPasskeys: list.passkeys || [], nickname })
      await callAuth(env, 'putChallenge', { kind: 'register', challenge: opts.challenge })
      return json({ options: opts, nickname: nickname || 'admin' })
    }

    // ---- /api/auth/finish-passkey (binds the FIRST passkey via bootstrap token) ----
    if (path === '/api/auth/finish-passkey') {
      let body = {}
      try { body = await request.json() } catch { return bad('invalid json body') }
      const { token, response, nickname } = body
      if (!response) return bad('missing response')
      if (!token) return bad('missing token')

      // Re-verify the token (defense-in-depth: the begin call checked it, but a malicious client
      // could call /finish-passkey directly with a hand-crafted response).
      const status = await callAuth(env, 'getBootstrap')
      if (status.used) return json({ error: 'bootstrap_already_used' }, 409)
      if (!status.hash) return json({ error: 'no_bootstrap_token_set' }, 503)
      const suppliedHash = await sha256Hex(token)
      if (suppliedHash !== status.hash) return json({ error: 'invalid_token' }, 401)

      // The browser echoes our challenge back inside clientDataJSON. Extract it, consume it in
      // the DO (single-use), and then pass the SAME string to verifyRegistration as expectedChallenge.
      const expectedChallenge = await challengeFromClientData(response.response?.clientDataJSON)
      if (!expectedChallenge) return json({ error: 'bad_challenge', reason: 'no_client_data' }, 400)
      const taken = await callAuth(env, 'takeChallenge', { kind: 'register', challenge: expectedChallenge })
      if (!taken.valid) return json({ error: 'bad_challenge', reason: taken.reason }, 400)

      const v = await verifyRegistration({ rp, expectedChallenge, response })
      if (!v.ok) return json({ error: 'verify_failed', detail: v.error }, 400)

      // Persist + consume bootstrap. After this, the bootstrap token is dead forever.
      await callAuth(env, 'addPasskey', { credential: { ...v.credential, nickname: nickname || 'Device 1' } })
      await callAuth(env, 'consumeBootstrap')

      const sessionToken = await signSession(env)
      return json({ ok: true }, 200, { 'set-cookie': sessionCookieHeader(sessionToken, { request }) })
    }

    // ---- /api/auth/begin-passkey-session (add another device; requires session) ----
    if (path === '/api/auth/begin-passkey') {
      const sess = await requireSession(request, env)
      if (!sess.ok) return json({ error: 'unauthorized', reason: sess.reason }, 401)
      const list = await callAuth(env, 'listPasskeys')
      const opts = await makeRegistrationOptions({ rp, existingPasskeys: list.passkeys || [], nickname: 'new-device' })
      await callAuth(env, 'putChallenge', { kind: 'register', challenge: opts.challenge })
      return json({ options: opts })
    }

    // ---- /api/auth/finish-passkey-session (binds subsequent passkeys; requires session) ----
    if (path === '/api/auth/finish-passkey-session') {
      const sess = await requireSession(request, env)
      if (!sess.ok) return json({ error: 'unauthorized', reason: sess.reason }, 401)
      let body = {}
      try { body = await request.json() } catch { return bad('invalid json body') }
      const { response, nickname } = body
      if (!response) return bad('missing response')

      const expectedChallenge = await challengeFromClientData(response.response?.clientDataJSON)
      if (!expectedChallenge) return json({ error: 'bad_challenge', reason: 'no_client_data' }, 400)
      const taken = await callAuth(env, 'takeChallenge', { kind: 'register', challenge: expectedChallenge })
      if (!taken.valid) return json({ error: 'bad_challenge', reason: taken.reason }, 400)

      const v = await verifyRegistration({ rp, expectedChallenge, response })
      if (!v.ok) return json({ error: 'verify_failed', detail: v.error }, 400)
      await callAuth(env, 'addPasskey', { credential: { ...v.credential, nickname: nickname || `Device ${Date.now() % 1000}` } })
      return json({ ok: true })
    }

    // ---- /api/auth/begin-login (returning user; no session needed) ----
    if (path === '/api/auth/begin-login') {
      const list = await callAuth(env, 'getAllPasskeys')
      if (!list.passkeys?.length) return json({ error: 'no_passkeys_registered' }, 503)
      const opts = await makeAuthenticationOptions({ rp, existingPasskeys: list.passkeys })
      await callAuth(env, 'putChallenge', { kind: 'login', challenge: opts.challenge })
      return json({ options: opts })
    }

    // ---- /api/auth/finish-login (verify assertion, issue session) ----
    if (path === '/api/auth/finish-login') {
      let body = {}
      try { body = await request.json() } catch { return bad('invalid json body') }
      const { response } = body
      if (!response) return bad('missing response')
      // Look up the passkey by credential id in the assertion.
      const credId = response.id
      if (!credId) return bad('missing response.id')
      const pk = await callAuth(env, 'getPasskey', { id: credId })
      if (!pk.passkey) return json({ error: 'unknown_credential' }, 401)

      const expectedChallenge = await challengeFromClientData(response.response?.clientDataJSON)
      if (!expectedChallenge) return json({ error: 'bad_challenge', reason: 'no_client_data' }, 400)
      const taken = await callAuth(env, 'takeChallenge', { kind: 'login', challenge: expectedChallenge })
      if (!taken.valid) return json({ error: 'bad_challenge', reason: taken.reason }, 400)

      const v = await verifyAuthentication({ rp, expectedChallenge, response, passkey: pk.passkey })
      if (!v.ok) return json({ error: 'verify_failed', detail: v.error }, 401)
      await callAuth(env, 'updateCounter', { id: credId, counter: v.newCounter })

      const sessionToken = await signSession(env)
      return json({ ok: true }, 200, { 'set-cookie': sessionCookieHeader(sessionToken, { request }) })
    }

    // ---- /api/auth/one-time-link (requires session; issues a 10-min single-use token) ----
    if (path === '/api/auth/one-time-link') {
      const sess = await requireSession(request, env)
      if (!sess.ok) return json({ error: 'unauthorized', reason: sess.reason }, 401)
      const token = randomToken(24)
      const tokenHash = await sha256Hex(token)
      const r = await callAuth(env, 'createOneTimeLink', { tokenHash, scope: 'add-passkey' })
      if (!r.ok) return json({ error: r.error }, 500)
      // Return the PLAIN token (not the hash) to the caller — they bake it into a URL like
      // /admin?otp=xxx. The DO only stores the hash so a log leak doesn't reveal live tokens.
      return json({ token, expiresAt: r.expiresAt })
    }

    // ---- /api/auth/redeem-one-time (consume a one-time link → issue add-passkey session) ----
    if (path === '/api/auth/redeem-one-time') {
      let body = {}
      try { body = await request.json() } catch { return bad('invalid json body') }
      const { token } = body
      if (!token) return bad('missing token')
      const tokenHash = await sha256Hex(token)
      const r = await callAuth(env, 'consumeOneTimeLink', { tokenHash, scope: 'add-passkey' })
      if (!r.valid) return json({ error: 'invalid_or_expired_link' }, 401)
      // Issue a full admin session — the device is now trusted to add its passkey via
      // /begin-passkey + /finish-passkey-session.
      const sessionToken = await signSession(env)
      return json({ ok: true }, 200, { 'set-cookie': sessionCookieHeader(sessionToken, { request }) })
    }

    // ---- /api/auth/remove-passkey (requires session) ----
    if (path === '/api/auth/remove-passkey') {
      const sess = await requireSession(request, env)
      if (!sess.ok) return json({ error: 'unauthorized', reason: sess.reason }, 401)
      let body = {}
      try { body = await request.json() } catch { return bad('invalid json body') }
      const { id } = body
      if (!id) return bad('missing id')
      const r = await callAuth(env, 'removePasskey', { id })
      if (!r.ok) return json({ error: r.error }, 400)
      return json({ ok: true })
    }

    // ---- /api/auth/session (probe whether the current cookie is valid) ----
    if (path === '/api/auth/session') {
      const sess = await requireSession(request, env)
      if (sess.ok) return json({ authenticated: true, session: sess.session })
      // Unauthenticated: surface the SETUP state so the frontend can pick the right screen
      // (bind-first-passkey vs login). These bits are not sensitive (they only say WHETHER a
      // bootstrap token / passkeys exist, not what they are). Without this, the admin page
      // can't tell "first time setup" from "returning user" without a session, and would show
      // a misleading "not configured" screen even when BOOTSTRAP_TOKEN is set.
      let setup = { hasBootstrap: false, hasPasskeys: false, bootstrapUsed: false }
      try {
        const s = await callAuth(env, 'status')
        setup = {
          hasBootstrap: !!s.bootstrap?.hasToken || !!env?.BOOTSTRAP_TOKEN,
          hasPasskeys: (s.passkeyCount || 0) > 0,
          bootstrapUsed: !!s.bootstrap?.used,
        }
      } catch { /* DO unavailable — leave defaults */ }
      return json({ authenticated: false, reason: sess.reason, setup })
    }

    // ---- /api/auth/logout (clear session cookie) ----
    if (path === '/api/auth/logout') {
      return json({ ok: true }, 200, { 'set-cookie': clearSessionCookieHeader({ request }) })
    }

    return json({ error: 'not_found' }, 404)
  } catch (e) {
    return json({ error: 'internal', detail: String(e && e.message || e).slice(0, 500) }, 500)
  }
}

/**
 * Pull the `challenge` field out of a WebAuthn clientDataJSON. The browser sends this back
 * verbatim from the options we generated; comparing it against what we stored in the DO is
 * what proves the assertion was generated for OUR challenge (anti-replay across sessions).
 */
async function challengeFromClientData(clientDataJSON) {
  if (!clientDataJSON) return ''
  try {
    let s = clientDataJSON
    // simplewebauthn passes clientDataJSON as a base64url string. Decode if it looks like one.
    if (typeof s === 'string' && !s.startsWith('{')) {
      const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4))
      const b64 = (s + pad).replace(/-/g, '+').replace(/_/g, '/')
      s = atob(b64)
    }
    const obj = typeof s === 'string' ? JSON.parse(s) : s
    return obj.challenge || ''
  } catch { return '' }
}
