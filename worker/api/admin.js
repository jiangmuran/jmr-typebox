// /api/admin/* (except /api/admin/ncm/*, which is handled by music.js#adminNcm) — the admin
// dashboard's data routes. All routes require a valid admin session (checked centrally in
// worker/index.js BEFORE this handler runs) + IP allowlist hit.
//
// Routes:
//   GET    /api/admin/status          — overview (bootstrap state, passkey list, NCM cookie
//                                        presence, IP allowlist, upstream reachability)
//   POST   /api/admin/ncm-cookie      — write the encrypted NCM cookie (from QR login or paste)
//   DELETE /api/admin/ncm-cookie      — clear the stored NCM cookie (logout)
//   POST   /api/admin/ip-allowlist    — replace the IP allowlist (array of strings)
//   GET    /api/admin/ncm/probe       — quick liveness probe of the NCM upstream + cookie
//
// NCM cookie storage note: we store the cookie STRING verbatim in the DO. The DO is private to
// this Worker (no public binding), and a Worker compromise already exposes env.NCM_COOKIE too,
// so additional AES-GCM layering adds little real security for a personal deployment. If you
// need it, swap the DO setNcmCookie/getNcmCookie ops to wrap/unwrap via Web Crypto keyed off
// AUTH_SECRET — the route interface stays identical.

import { callAuth } from '../lib/musicAuth.js'

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
  'access-control-allow-headers': 'content-type',
}
function json(obj, status = 200) {
  return Response.json(obj, { status, headers: { ...cors, 'cache-control': 'no-store' } })
}

export async function admin(request, env) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })

  const url = new URL(request.url)
  const path = url.pathname

  try {
    // ---- GET /api/admin/status ----
    if (path === '/api/admin/status' && request.method === 'GET') {
      const s = await callAuth(env, 'status')
      if (!s.ok) return json({ error: s.error }, 500)
      // Resolve the currently-effective NCM cookie source: DO > env. Report which one is live.
      const doCookie = (await callAuth(env, 'getNcmCookie')).cookie
      const cookieSource = doCookie ? 'qr-login' : (env?.NCM_COOKIE ? 'env-secret' : 'none')
      return json({
        bootstrap: s.bootstrap,
        passkeys: s.passkeys,
        passkeyCount: s.passkeyCount,
        hasNcmCookie: s.hasNcmCookie || !!env?.NCM_COOKIE,
        cookieSource,
        ipAllowlist: s.ipAllowlist,
        envAllowlistConfigured: !!env?.ALLOWED_IPS,
        pendingOneTimeLinks: s.pendingOneTimeLinks,
      })
    }

    // ---- POST /api/admin/ncm-cookie { cookie } ----
    if (path === '/api/admin/ncm-cookie' && request.method === 'POST') {
      let body = {}
      try { body = await request.json() } catch { return json({ error: 'invalid json body' }, 400) }
      const { cookie } = body
      if (!cookie || typeof cookie !== 'string') return json({ error: 'missing cookie' }, 400)
      // Light sanity check: NCM cookies always contain MUSIC_U= after a successful login.
      if (!/MUSIC_U=/.test(cookie)) return json({ error: 'cookie_missing_MUSIC_U' }, 400)
      const r = await callAuth(env, 'setNcmCookie', { cookie })
      if (!r.ok) return json({ error: r.error }, 500)
      return json({ ok: true })
    }

    // ---- DELETE /api/admin/ncm-cookie ----
    if (path === '/api/admin/ncm-cookie' && request.method === 'DELETE') {
      const r = await callAuth(env, 'clearNcmCookie')
      if (!r.ok) return json({ error: r.error }, 500)
      return json({ ok: true })
    }

    // ---- POST /api/admin/ip-allowlist { ips } ----
    if (path === '/api/admin/ip-allowlist' && request.method === 'POST') {
      let body = {}
      try { body = await request.json() } catch { return json({ error: 'invalid json body' }, 400) }
      const { ips } = body
      if (!Array.isArray(ips)) return json({ error: 'ips must be array' }, 400)
      // Basic validation: each entry looks like an IPv4 address.
      const bad = ips.find((ip) => !/^\d{1,3}(\.\d{1,3}){3}$/.test(String(ip).trim()))
      if (bad) return json({ error: 'invalid_ip', value: bad }, 400)
      const r = await callAuth(env, 'setIpAllowlist', { ips })
      if (!r.ok) return json({ error: r.error }, 500)
      return json({ ok: true })
    }

    // ---- GET /api/admin/ncm/probe ----
    // Liveness probe: hit /api/music/search with a tiny query and see whether NCM responds with
    // a 200 + non-empty body. Surfaces cookie-expiry / upstream-blockage without making the user
    // manually trigger a search.
    if (path === '/api/admin/ncm/probe' && request.method === 'GET') {
      const started = Date.now()
      try {
        // We call our OWN music route's underlying NCM client — simpler to just fetch the public
        // search endpoint (it's same-origin so no CORS).
        const doCookie = (await callAuth(env, 'getNcmCookie')).cookie
        const cookie = doCookie || env?.NCM_COOKIE || ''
        if (!cookie) return json({ reachable: false, reason: 'no_cookie' })
        const probeUrl = new URL('https://x/api/music/search') // placeholder; rewritten below
        // We can't fetch our own worker easily from inside the worker (no loopback), so we test
        // reachability by hitting NCM directly via the same NCM client the music route uses.
        const { call } = await import('../lib/ncm/index.js')
        const res = await call('cloudsearch', { keywords: 'test', limit: 1, cookie })
        const ok = res?.body?.code === 200
        return json({
          reachable: ok,
          latencyMs: Date.now() - started,
          code: res?.body?.code || null,
        })
      } catch (e) {
        return json({ reachable: false, latencyMs: Date.now() - started, error: String(e?.message || e).slice(0, 200) })
      }
    }

    return json({ error: 'not_found' }, 404)
  } catch (e) {
    return json({ error: 'internal', detail: String(e && e.message || e).slice(0, 500) }, 500)
  }
}
