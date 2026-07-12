// @vitest-environment node
import { describe, it, expect } from 'vitest'
import {
  signSession, verifySession, readSessionCookie,
  sessionCookieHeader, clearSessionCookieHeader,
  sha256Hex, randomToken, COOKIE_NAME,
} from '../../lib/jwt.js'

const SECRET = 'test-secret-32-chars-minimum-aaa-bbbb'

function env(secret = SECRET) { return { AUTH_SECRET: secret } }

describe('sha256Hex', () => {
  it('matches the well-known empty-string hash', async () => {
    expect(await sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
  })
  it('produces a 64-char lowercase hex', async () => {
    const h = await sha256Hex('anything')
    expect(h).toMatch(/^[0-9a-f]{64}$/)
  })
  it('is stable for the same input', async () => {
    expect(await sha256Hex('token-x')).toBe(await sha256Hex('token-x'))
  })
})

describe('randomToken', () => {
  it('returns base64url of the requested byte length (default 32 → 43 chars)', () => {
    const t = randomToken()
    expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })
  it('is random', () => {
    const seen = new Set()
    for (let i = 0; i < 50; i++) seen.add(randomToken(16))
    expect(seen.size).toBe(50)
  })
})

describe('signSession / verifySession', () => {
  it('round-trips a valid session', async () => {
    const token = await signSession(env())
    const v = await verifySession(env(), token)
    expect(v.ok).toBe(true)
    expect(v.payload.sub).toBe('admin')
    expect(v.payload.exp).toBeGreaterThan(Date.now())
  })

  it('fails when AUTH_SECRET is missing', async () => {
    await expect(signSession({})).rejects.toThrow(/AUTH_SECRET/)
  })

  it('fails when AUTH_SECRET is too short', async () => {
    await expect(signSession({ AUTH_SECRET: 'short' })).rejects.toThrow(/too short/)
  })

  it('rejects a token signed with a different secret', async () => {
    const token = await signSession(env('secret-A-32-chars-minimum-aaaa'))
    const v = await verifySession(env('secret-B-32-chars-minimum-aaaa'), token)
    expect(v.ok).toBe(false)
    expect(v.reason).toBe('bad_sig')
  })

  it('rejects a malformed token', async () => {
    // 'not.a.jwt' has 3 parts so it PASSES the structural check; the signature is garbage so we
    // get bad_sig (the verify path runs before the JSON parse). Use a 2-part string to hit
    // the actual 'malformed' branch.
    const v2 = await verifySession(env(), 'only-two-parts')
    expect(v2.ok).toBe(false)
    expect(v2.reason).toBe('malformed')
    // And a 3-part junk token surfaces as bad_sig (the more common attack shape).
    const v3 = await verifySession(env(), 'not.a.jwt')
    expect(v3.ok).toBe(false)
    expect(['bad_sig', 'malformed']).toContain(v3.reason)
  })

  it('rejects an empty token', async () => {
    const v = await verifySession(env(), '')
    expect(v.ok).toBe(false)
    expect(v.reason).toBe('no_token')
  })

  it('caches the derived key per-env (WeakMap)', async () => {
    // Two sign calls against the same env should reuse the same CryptoKey (we can't observe it
    // directly, but we can verify sign+verify still round-trip — i.e. caching didn't corrupt).
    const e = env()
    await signSession(e)
    await signSession(e)
    const t = await signSession(e)
    expect((await verifySession(e, t)).ok).toBe(true)
  })
})

describe('readSessionCookie', () => {
  it('reads tb-admin from a Cookie header', () => {
    const req = new Request('https://x/', { headers: { cookie: `foo=bar; ${COOKIE_NAME}=abc.def.ghi; baz=qux` } })
    expect(readSessionCookie(req)).toBe('abc.def.ghi')
  })
  it('returns "" when the cookie is absent', () => {
    const req = new Request('https://x/')
    expect(readSessionCookie(req)).toBe('')
  })
})

describe('sessionCookieHeader', () => {
  it('produces an HttpOnly + SameSite=Strict cookie', () => {
    const h = sessionCookieHeader('tok', { request: new Request('https://box.example.com/') })
    expect(h).toContain(`${COOKIE_NAME}=tok`)
    expect(h).toContain('HttpOnly')
    expect(h).toContain('SameSite=Strict')
    expect(h).toContain('Secure') // non-localhost → Secure
    expect(h).toContain('Max-Age=')
  })
  it('omits Secure on localhost (so dev over http works)', () => {
    const h = sessionCookieHeader('tok', { request: new Request('http://localhost:8787/') })
    expect(h).not.toContain('Secure')
  })
})

describe('clearSessionCookieHeader', () => {
  it('sets Max-Age=0 to expire the cookie', () => {
    const h = clearSessionCookieHeader({ request: new Request('https://box.example.com/') })
    expect(h).toContain('Max-Age=0')
    expect(h).toContain('HttpOnly')
  })
})
