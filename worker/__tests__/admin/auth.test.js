// @vitest-environment node
import { describe, it, expect, vi, afterEach } from 'vitest'
import worker from '../../index.js'
import { signSession } from '../../lib/jwt.js'
import { adminEnv, mockAuthNs, TEST_AUTH_SECRET } from './helpers.js'

afterEach(() => vi.restoreAllMocks())

// Helper: build a Request + env pair with a valid session cookie, hitting the given path.
async function authed(path, init = {}, envOverrides = {}, authHandlers = {}) {
  const env = adminEnv({
    MUSIC_AUTH: mockAuthNs(authHandlers),
    NCM_COOKIE: 'MUSIC_U=fake',
    ...envOverrides,
  })
  const token = await signSession(env)
  const headers = new Headers(init.headers || {})
  headers.set('cookie', `tb-admin=${token}`)
  headers.set('CF-Connecting-IP', '1.2.3.4')
  return { req: new Request(path, { ...init, headers }), env }
}

describe('session guard on /api/admin/*', () => {
  it('401s when no session cookie is present', async () => {
    const env = adminEnv({ MUSIC_AUTH: mockAuthNs() })
    const res = await worker.fetch(
      new Request('https://x/api/admin/status', { headers: { 'CF-Connecting-IP': '1.2.3.4' } }),
      env
    )
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toBe('unauthorized')
    expect(body.reason).toBe('no_token')
  })

  it('401s when the session cookie is invalid', async () => {
    const env = adminEnv({ MUSIC_AUTH: mockAuthNs() })
    const res = await worker.fetch(
      new Request('https://x/api/admin/status', {
        headers: { 'CF-Connecting-IP': '1.2.3.4', cookie: 'tb-admin=garbage.token.here' },
      }),
      env
    )
    expect(res.status).toBe(401)
  })

  it('403s when the caller IP is not on the allowlist (before session is even checked)', async () => {
    const env = adminEnv({ MUSIC_AUTH: mockAuthNs() })
    const res = await worker.fetch(
      new Request('https://x/api/admin/status', {
        headers: { 'CF-Connecting-IP': '9.9.9.9', cookie: 'tb-admin=anything' },
      }),
      env
    )
    expect(res.status).toBe(403) // IP guard fires first
  })

  it('lets a valid session through to /api/admin/status', async () => {
    const { req, env } = await authed('https://x/api/admin/status', {}, {}, {
      status: () => ({
        ok: true,
        bootstrap: { hasToken: true, used: true },
        passkeys: [{ id: 'pk1', nickname: 'Mac', addedAt: 1, transports: ['internal'] }],
        passkeyCount: 1,
        hasNcmCookie: true,
        ipAllowlist: ['1.2.3.4'],
        pendingOneTimeLinks: 0,
      }),
      getNcmCookie: () => ({ ok: true, cookie: 'MUSIC_U=from-do' }),
    })
    const res = await worker.fetch(req, env)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.bootstrap.used).toBe(true)
    expect(body.passkeys[0].nickname).toBe('Mac')
    expect(body.cookieSource).toBe('qr-login') // DO had a cookie
  })

  it('falls back to env.NCM_COOKIE when the DO has none', async () => {
    const { req, env } = await authed('https://x/api/admin/status', {}, {}, {
      status: () => ({ ok: true, bootstrap: { hasToken: true, used: true }, passkeys: [], passkeyCount: 0, hasNcmCookie: false, ipAllowlist: [], pendingOneTimeLinks: 0 }),
      getNcmCookie: () => ({ ok: true, cookie: '' }),
    })
    const res = await worker.fetch(req, env)
    const body = await res.json()
    expect(body.cookieSource).toBe('env-secret')
    expect(body.hasNcmCookie).toBe(true)
  })
})

describe('/api/admin/ncm-cookie', () => {
  it('POST writes a valid cookie to the DO', async () => {
    let written = null
    const { req, env } = await authed('https://x/api/admin/ncm-cookie', {
      method: 'POST',
      body: JSON.stringify({ cookie: 'MUSIC_U=newtoken; os=pc;' }),
    }, {}, {
      setNcmCookie: (b) => { written = b.cookie; return { ok: true } },
    })
    const res = await worker.fetch(req, env)
    expect(res.status).toBe(200)
    expect(written).toContain('MUSIC_U=newtoken')
  })

  it('POST 400s when the cookie is missing MUSIC_U', async () => {
    const { req, env } = await authed('https://x/api/admin/ncm-cookie', {
      method: 'POST',
      body: JSON.stringify({ cookie: 'something_else=foo' }),
    }, {}, { setNcmCookie: () => ({ ok: true }) })
    const res = await worker.fetch(req, env)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('cookie_missing_MUSIC_U')
  })

  it('DELETE clears the cookie', async () => {
    let cleared = false
    const { req, env } = await authed('https://x/api/admin/ncm-cookie', { method: 'DELETE' }, {}, {
      clearNcmCookie: () => { cleared = true; return { ok: true } },
    })
    const res = await worker.fetch(req, env)
    expect(res.status).toBe(200)
    expect(cleared).toBe(true)
  })
})

describe('/api/admin/ip-allowlist', () => {
  it('POST rejects malformed IPs', async () => {
    const { req, env } = await authed('https://x/api/admin/ip-allowlist', {
      method: 'POST',
      body: JSON.stringify({ ips: ['1.2.3.4', 'not.an.ip'] }),
    }, {}, { setIpAllowlist: () => ({ ok: true }) })
    const res = await worker.fetch(req, env)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('invalid_ip')
  })

  it('POST accepts a clean list and writes it', async () => {
    let written = null
    const { req, env } = await authed('https://x/api/admin/ip-allowlist', {
      method: 'POST',
      body: JSON.stringify({ ips: ['1.2.3.4', '5.6.7.8'] }),
    }, {}, {
      setIpAllowlist: (b) => { written = b.ips; return { ok: true } },
    })
    const res = await worker.fetch(req, env)
    expect(res.status).toBe(200)
    expect(written).toEqual(['1.2.3.4', '5.6.7.8'])
  })
})

describe('/api/auth/session + logout', () => {
  it('session probe returns authenticated:true for a valid session', async () => {
    const { req, env } = await authed('https://x/api/auth/session')
    const res = await worker.fetch(req, env)
    expect(res.status).toBe(200)
    expect((await res.json()).authenticated).toBe(true)
  })

  it('session probe returns authenticated:false without a cookie', async () => {
    const env = adminEnv({ MUSIC_AUTH: mockAuthNs() })
    const res = await worker.fetch(
      new Request('https://x/api/auth/session', { headers: { 'CF-Connecting-IP': '1.2.3.4' } }),
      env
    )
    expect(res.status).toBe(200)
    expect((await res.json()).authenticated).toBe(false)
  })

  it('logout returns a Set-Cookie that expires the session', async () => {
    const env = adminEnv({ MUSIC_AUTH: mockAuthNs() })
    const res = await worker.fetch(
      new Request('https://x/api/auth/logout', {
        method: 'POST',
        headers: { 'CF-Connecting-IP': '1.2.3.4' },
      }),
      env
    )
    expect(res.status).toBe(200)
    const sc = res.headers.get('set-cookie')
    expect(sc).toContain('Max-Age=0')
    expect(sc).toContain('tb-admin=')
  })
})

describe('/api/auth/bootstrap', () => {
  it('409s when bootstrap is already used', async () => {
    const env = adminEnv({ MUSIC_AUTH: mockAuthNs({
      getBootstrap: () => ({ ok: true, hash: 'somehash', used: true }),
    }) })
    const res = await worker.fetch(
      new Request('https://x/api/auth/bootstrap', {
        method: 'POST',
        headers: { 'CF-Connecting-IP': '1.2.3.4', 'content-type': 'application/json' },
        body: JSON.stringify({ token: 'whatever' }),
      }),
      env
    )
    expect(res.status).toBe(409)
  })

  it('503s when no bootstrap token is set in the DO', async () => {
    const env = adminEnv({ MUSIC_AUTH: mockAuthNs({
      getBootstrap: () => ({ ok: true, hash: null, used: false }),
    }) })
    const res = await worker.fetch(
      new Request('https://x/api/auth/bootstrap', {
        method: 'POST',
        headers: { 'CF-Connecting-IP': '1.2.3.4', 'content-type': 'application/json' },
        body: JSON.stringify({ token: 'whatever' }),
      }),
      env
    )
    expect(res.status).toBe(503)
  })

  it('401s when the supplied token does NOT hash to the stored hash', async () => {
    // Store a hash that's NOT the sha256 of 'wrong-token'.
    const env = adminEnv({ MUSIC_AUTH: mockAuthNs({
      getBootstrap: () => ({ ok: true, hash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', used: false }),
    }) })
    const res = await worker.fetch(
      new Request('https://x/api/auth/bootstrap', {
        method: 'POST',
        headers: { 'CF-Connecting-IP': '1.2.3.4', 'content-type': 'application/json' },
        body: JSON.stringify({ token: 'wrong-token' }),
      }),
      env
    )
    expect(res.status).toBe(401)
  })
})

describe('/api/auth/one-time-link', () => {
  it('401s without a session', async () => {
    const env = adminEnv({ MUSIC_AUTH: mockAuthNs() })
    const res = await worker.fetch(
      new Request('https://x/api/auth/one-time-link', {
        method: 'POST',
        headers: { 'CF-Connecting-IP': '1.2.3.4' },
      }),
      env
    )
    expect(res.status).toBe(401)
  })

  it('issues a one-time token with an expiry when authenticated', async () => {
    let createdHash = null
    const { req, env } = await authed('https://x/api/auth/one-time-link', { method: 'POST' }, {}, {
      createOneTimeLink: (b) => { createdHash = b.tokenHash; return { ok: true, expiresAt: Date.now() + 600000 } },
    })
    const res = await worker.fetch(req, env)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.token).toMatch(/^[A-Za-z0-9_-]{30,}$/)  // randomToken(24) → 32 base64url chars
    expect(body.expiresAt).toBeGreaterThan(Date.now())
    expect(createdHash).toMatch(/^[0-9a-f]{64}$/) // sha256 hex of the token
  })
})
