// @vitest-environment node
// Test helpers for the admin/auth surface: signs real session JWTs against a test AUTH_SECRET
// so route tests can pass a valid Cookie header without mocking verifySession. Keeping the
// signing path REAL (not mocked) catches divergences between the JWT helper and the routes.
//
// Also provides a MUSIC_AUTH DO stub so callAuth() works in tests without a real Durable Object
// binding. The stub is programmable: each op maps to a canned response.
import { signSession } from '../../lib/jwt.js'

export const TEST_AUTH_SECRET = 'test-secret-only-32-chars-minimum-aaaa-bbbb'

/** Build a Request that carries a valid admin session cookie for the given env. */
export async function authedRequest(url, env, init = {}) {
  const token = await signSession(env)
  const headers = new Headers(init.headers || {})
  headers.set('cookie', `tb-admin=${token}`)
  if (init.cfConnectingIp) headers.set('CF-Connecting-IP', init.cfConnectingIp)
  return new Request(url, { ...init, headers })
}

/** An env stub that satisfies the auth + admin requirements: AUTH_SECRET + ALLOWED_IPS + ASSETS. */
export function adminEnv(overrides = {}) {
  return {
    ASSETS: { fetch: async () => new Response('static') },
    AUTH_SECRET: TEST_AUTH_SECRET,
    ALLOWED_IPS: '1.2.3.4',
    ...overrides,
  }
}

/**
 * Build a mock MUSIC_AUTH Durable Object namespace that callAuth() will treat as real. Each op
 * passed in handlers returns the canned response. Unhandled ops return { ok:false, error:'unhandled' }.
 *
 *   const ns = mockAuthNs({ getBootstrap: () => ({ ok:true, hash:'abc', used:false }) })
 *   const env = adminEnv({ MUSIC_AUTH: ns })
 */
export function mockAuthNs(handlers = {}) {
  return {
    idFromName: () => 'mock-stub-id',
    get: () => ({
      fetch: async (url, opts) => {
        let body = {}
        try { body = JSON.parse(opts.body || '{}') } catch { /* empty ok */ }
        const fn = handlers[body.op]
        const out = typeof fn === 'function' ? fn(body) : { ok: false, error: `unhandled op ${body.op}` }
        return new Response(JSON.stringify(out), { headers: { 'content-type': 'application/json' } })
      },
    }),
  }
}
