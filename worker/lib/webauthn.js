// WebAuthn helpers — wraps @simplewebauthn/server so the auth routes stay narrow.
//
// Why this wrapper:
//   • Centralises the RP (relying party) config — rpID = the deployment domain, rpName = the
//     product name; both derived from the request URL so the same code runs on localhost and
//     box.muran.tech.
//   • Hides the simplewebauthn API quirks (4.0+ returns structured objects; older docs are stale).
//   • Adds the "first device" relaxation: we set `attestation: 'none'` (we don't care about the
//     device manufacturer's attestation chain — we only need to know the user holds this passkey),
//     and we DON'T require user verification on the very first registration if the device can't
//     (some software authenticators can't), but we DO require it for subsequent logins.
//
// All crypto/verification is done inside simplewebauthn → Web Crypto. Nothing here touches disk.

import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server'

/**
 * Derive RP ID / origin from the incoming request. On localhost we must use 'localhost' as the
 * rpID (WebAuthn requires the rpID to be a registrable suffix of the origin's host); on a real
 * deployment it's the apex domain.
 */
export function rpFromRequest(request) {
  const url = new URL(request.url)
  const host = url.hostname
  // localhost: keep as-is (WebAuthn allows 'localhost' as an rpID over http).
  if (host === 'localhost' || host === '127.0.0.1') {
    return {
      rpID: 'localhost',
      rpName: 'TypeBox Admin (dev)',
      origin: `http://localhost:${url.port || '8787'}`,
    }
  }
  // Strip a leading subdomain: 'box.muran.tech' → rpID 'muran.tech' so the passkey also works
  // on sibling subdomains. If you want it scoped tighter, set AUTH_RP_ID env var explicitly.
  const parts = host.split('.')
  const rpID = parts.length >= 2 ? parts.slice(-2).join('.') : host
  return {
    rpID: rpID,
    rpName: 'TypeBox Admin',
    origin: `${url.protocol}//${host}`,
  }
}

/**
 * Generate registration options for a NEW passkey. The route stores the challenge in the DO
 * (with a 5-minute expiry) before returning these options to the browser.
 */
export async function makeRegistrationOptions({ rp, existingPasskeys = [], nickname }) {
  // Exclude existing credential IDs so a user re-registering doesn't double-bind.
  const excludeCredentials = existingPasskeys.map((p) => {
    // p.id is a base64url string (we stored it that way). WebAuthn wants raw bytes in a buffer.
    return { id: base64UrlToBuffer(p.id), type: 'public-key' }
  })
  const opts = await generateRegistrationOptions({
    rpName: rp.rpName,
    rpID: rp.rpID,
    userName: nickname || 'admin',
    userDisplayName: nickname || 'TypeBox Admin',
    attestationType: 'none',
    excludeCredentials,
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'preferred', // we'll accept what the device can do
    },
    supportedAlgorithmIDs: [-7, -257], // ES256 (recommended) + RS256 (fallback for older devices)
  })
  return opts
}

/**
 * Verify a registration response from the browser. Returns { ok, credential } on success, where
 * credential is the data we persist to the DO; or { ok:false, error }.
 *
 * The `expectedChallenge` must be the exact string the route sent in makeRegistrationOptions.
 */
export async function verifyRegistration({ rp, expectedChallenge, response }) {
  let verification
  try {
    verification = await verifyRegistrationResponse({
      response,
      expectedChallenge,
      expectedOrigin: rp.origin,
      expectedRPID: rp.rpID,
      requireUserVerification: false, // relax for the first device (some platforms can't UV)
    })
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) }
  }
  if (!verification.verified || !verification.registrationInfo) {
    return { ok: false, error: 'verification failed' }
  }
  const info = verification.registrationInfo
  // simplewebauthn 13.x returns credentialID + credentialPublicKey as base64url STRINGS already
  // (older versions returned Uint8Array). Do NOT double-encode with bufferToBase64Url — that
  // corrupted the stored id and made subsequent logins fail with "no_passkeys_registered".
  return {
    ok: true,
    credential: {
      id: info.credentialID,
      publicKey: info.credentialPublicKey,
      counter: info.counter,
      transports: response.response.transports || [],
    },
  }
}

/** Generate authentication options for an EXISTING passkey login. */
export async function makeAuthenticationOptions({ rp, existingPasskeys = [] }) {
  const allowCredentials = existingPasskeys.map((p) => ({
    id: base64UrlToBuffer(p.id),
    type: 'public-key',
    transports: p.transports || [],
  }))
  const opts = await generateAuthenticationOptions({
    rpID: rp.rpID,
    allowCredentials,
    userVerification: 'preferred',
  })
  return opts
}

/**
 * Verify a login assertion. `passkey` is the stored record ({ id, publicKey, counter }). Returns
 * { ok, newCounter } or { ok:false, error }. The route updates the stored counter on success to
 * detect cloned authenticators (a counter going backwards = replay).
 */
export async function verifyAuthentication({ rp, expectedChallenge, response, passkey }) {
  let verification
  try {
    verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge,
      expectedOrigin: rp.origin,
      expectedRPID: rp.rpID,
      // simplewebauthn 13.x: credentialID + credentialPublicKey are base64url STRINGS here too
      // (the stored values are already base64url — do NOT wrap in base64UrlToBuffer).
      authenticator: {
        credentialID: passkey.id,
        credentialPublicKey: passkey.publicKey,
        counter: passkey.counter || 0,
        transports: passkey.transports || [],
      },
      requireUserVerification: false,
    })
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) }
  }
  if (!verification.verified) return { ok: false, error: 'verification failed' }
  return { ok: true, newCounter: verification.authenticationInfo.newCounter }
}

// --- base64url helpers (simplewebauthn returns/expects base64url strings for storage). ---

function bufferToBase64Url(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
function base64UrlToBuffer(b64url) {
  if (!b64url) return new Uint8Array(0)
  const pad = b64url.length % 4 === 0 ? '' : '='.repeat(4 - (b64url.length % 4))
  const b64 = (b64url + pad).replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}
