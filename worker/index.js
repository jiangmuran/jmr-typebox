import { health } from './api/health.js'
import { proxyFetch } from './api/fetch.js'
import { preview } from './api/preview.js'
import { proxyAI } from './api/ai.js'
import { uploadImage } from './api/upload.js'
import { asrTranscribe } from './api/asr.js'
import { watermark } from './api/watermark.js'
import { music, adminNcm } from './api/music.js'
import { auth } from './api/auth.js'
import { admin } from './api/admin.js'
import { stats } from './api/stats.js'
import { clientIp, rateLimit, tooManyRequests } from './lib/rateLimit.js'
import { parseAllowlist, isAllowed, forbidden } from './lib/ipGuard.js'
import { callAuth, MusicAuth } from './lib/musicAuth.js'
import { verifySession, readSessionCookie } from './lib/jwt.js'
import { recordRequest, logEvent } from './lib/metrics.js'

// Re-export the MusicAuth DO class so wrangler's `class_name = "MusicAuth"` can resolve it from
// the main entry (Workers requires DO classes to be exported from the entry module).
export { MusicAuth }

// Per-IP request budget (requests / 60s) for the abuse-prone proxy endpoints. The open URL
// fetch + OG preview are the prime "刷接口" targets; the AI relay is more generous since the
// editor's inline completion can call it in bursts. Enforced via Cloudflare's globally-consistent
// rate-limiting bindings (configured in wrangler.toml); falls back to a per-isolate in-memory
// limiter when the binding is absent (local dev / tests).
const RATE_CFG = {
  '/api/fetch': { name: 'fetch', limit: 40 },
  '/api/preview': { name: 'preview', limit: 40 },
  '/api/ai': { name: 'ai', limit: 60 },
  '/api/upload': { name: 'upload', limit: 20 },
  '/api/asr': { name: 'asr', limit: 20 },
  '/api/watermark': { name: 'watermark', limit: 20 },
}
const RATE_WINDOW_MS = 60_000

// Strongly-consistent per-IP rate limit via a Durable Object (one instance per `name:ip`), with a
// per-isolate in-memory fallback when the DO binding is absent (local dev / unit tests).
async function checkLimit(env, cfg, key) {
  const ns = env?.RATE_LIMITER
  if (ns && typeof ns.idFromName === 'function') {
    try {
      const stub = ns.get(ns.idFromName(`${cfg.name}:${key}`))
      const res = await stub.fetch('https://rl/', { method: 'POST', body: JSON.stringify({ limit: cfg.limit, windowMs: RATE_WINDOW_MS }) })
      const data = await res.json()
      return { limited: !data.ok, retryAfter: data.retryAfter || 60 }
    } catch { /* fall through to in-memory */ }
  }
  const rl = rateLimit(`${cfg.name}:${key}`, cfg.limit, RATE_WINDOW_MS)
  return { limited: !rl.ok, retryAfter: rl.retryAfter || 60 }
}

// 401 JSON helper for the session guard.
function unauthorized(reason) {
  return Response.json(
    { error: 'unauthorized', reason },
    { status: 401, headers: { 'access-control-allow-origin': '*', 'cache-control': 'no-store' } }
  )
}

// Phase 4: wrap every admin/music/auth handler in this so the dashboard's counters + recent
// request list stay current. Records the final HTTP status (including 403/429/401 from the gates)
// + latency. Fire-and-forget on the metrics side; never throws.
async function withMetrics(path, ip, fn) {
  const start = Date.now()
  try {
    const res = await fn()
    recordRequest(path, ip, res.status, Date.now() - start)
    return res
  } catch (e) {
    recordRequest(path, ip, 500, Date.now() - start)
    logEvent('error', 'handler threw', { path, error: String(e && e.message || e).slice(0, 200) })
    throw e
  }
}

// Durable Object: a sliding-window counter keyed by its id (`name:ip`). Strongly consistent across
// the edge, so parallel/distributed bursts from one IP are counted together. Storage is bounded
// (at most `limit` recent timestamps) and self-cleans when the window empties.
export class RateLimiter {
  constructor(state) { this.state = state }
  async fetch(request) {
    const { limit, windowMs } = await request.json()
    const now = Date.now()
    const cutoff = now - windowMs
    let hits = (await this.state.storage.get('h')) || []
    hits = hits.filter((t) => t > cutoff)
    if (hits.length >= limit) {
      return Response.json({ ok: false, retryAfter: Math.max(1, Math.ceil((hits[0] + windowMs - now) / 1000)) })
    }
    hits.push(now)
    await this.state.storage.put('h', hits)
    return Response.json({ ok: true })
  }
}

// Single Cloudflare Worker: serves the static SSG frontend via the ASSETS binding and
// handles optional /api/* routes. All /api features are optional — the frontend degrades
// gracefully when they are absent or disabled.
export default {
  async fetch(request, env) {
    const url = new URL(request.url)

    if (url.pathname === '/api/health') return health()

    // Per-IP rate limit the proxy endpoints (skip CORS preflight, which carries no work).
    const cfg = RATE_CFG[url.pathname]
    if (cfg && request.method !== 'OPTIONS') {
      const { limited, retryAfter } = await checkLimit(env, cfg, clientIp(request))
      if (limited) return tooManyRequests(retryAfter)
    }

    if (url.pathname === '/api/fetch') return proxyFetch(request)
    if (url.pathname === '/api/preview') return preview(request)
    if (url.pathname === '/api/ai') return proxyAI(request)
    if (url.pathname === '/api/upload') return uploadImage(request, env)
    if (url.pathname === '/api/asr') return asrTranscribe(request, env)
    if (url.pathname === '/api/watermark' || url.pathname.startsWith('/api/watermark/')) return watermark(request, env)

    // ---- /api/auth/* (WebAuthn bootstrap / login / one-time-link / logout) ----
    // IP allowlist still applies (auth routes are admin-tier); no session needed (these routes
    // are what ESTABLISH the session). Rate-limited under the 'auth' bucket.
    if (url.pathname.startsWith('/api/auth/')) {
      return withMetrics(url.pathname, clientIp(request), async () => {
        const allowlist = parseAllowlist(env?.ALLOWED_IPS)
        if (!isAllowed(request, allowlist, 'admin')) return forbidden(clientIp(request))
        if (request.method !== 'OPTIONS') {
          const { limited, retryAfter } = await checkLimit(env, { name: 'auth', limit: 30 }, clientIp(request))
          if (limited) return tooManyRequests(retryAfter)
        }
        return auth(request, env)
      })
    }

    // ---- /api/admin/* (dashboard data + NCM QR login + stats) ----
    // Triple gate: IP allowlist → valid session cookie → rate limit. The DO-stored NCM cookie
    // (set via QR login) takes precedence over env.NCM_COOKIE here so adminNcm sees the freshest
    // token. Falls back to env.NCM_COOKIE when the DO has none (deploy-time secret path).
    if (url.pathname.startsWith('/api/admin/')) {
      return withMetrics(url.pathname, clientIp(request), async () => {
        const allowlist = parseAllowlist(env?.ALLOWED_IPS)
        if (!isAllowed(request, allowlist, 'admin')) return forbidden(clientIp(request))

        // Session check — ALL /api/admin/* requires a valid session (read AND write).
        const token = readSessionCookie(request)
        const v = await verifySession(env, token)
        if (!v.ok) return unauthorized(v.reason)

        // Resolve effective NCM cookie: DO > env. Copy env so we don't mutate the original.
        let adminEnv = env
        try {
          const doCookie = await callAuth(env, 'getNcmCookie')
          if (doCookie.cookie && doCookie.cookie !== env?.NCM_COOKIE) {
            adminEnv = { ...env, NCM_COOKIE: doCookie.cookie }
          }
        } catch { /* DO unavailable — fall back to env */ }

        if (request.method !== 'OPTIONS') {
          const mCfg = url.pathname.startsWith('/api/admin/ncm/qrcode/check/')
            ? { name: 'admin_qr_check', limit: 30 }   // polled every ~2s during QR scan
            : { name: 'admin', limit: 30 }
          const { limited, retryAfter } = await checkLimit(env, mCfg, clientIp(request))
          if (limited) return tooManyRequests(retryAfter)
        }

        // Dispatch within /api/admin/. Stats routes go to the stats handler; NCM QR routes to
        // adminNcm; everything else to admin.
        if (url.pathname.startsWith('/api/admin/stats')) return stats(request, env)
        // /api/admin/ncm/probe is a liveness handler that lives in admin.js, not adminNcm.
        // Route it (and only it) to admin; the rest of /api/admin/ncm/* is QR login → adminNcm.
        if (url.pathname === '/api/admin/ncm/probe') return admin(request, adminEnv)
        if (url.pathname.startsWith('/api/admin/ncm/')) return adminNcm(request, adminEnv)
        return admin(request, adminEnv)
      })
    }

    // ---- /api/music/* (public-ish music data + stream) ----
    // IP gate (optional). Cookie resolution: DO-stored cookie (from QR login) takes precedence
    // over env.NCM_COOKIE (deploy-time secret). WITHOUT this, a user who logged in via the admin
    // QR scan would see all VIP songs fail with 502 — because the music routes would carry NO
    // cookie at all (env.NCM_COOKIE was never set via `wrangler secret put`).
    if (url.pathname.startsWith('/api/music/')) {
      return withMetrics(url.pathname, clientIp(request), async () => {
        const allowlist = parseAllowlist(env?.ALLOWED_IPS)
        if (!isAllowed(request, allowlist, 'music')) return forbidden(clientIp(request))

        // Resolve effective NCM cookie: DO > env.
        let musicEnv = env
        try {
          const doCookie = await callAuth(env, 'getNcmCookie')
          if (doCookie.cookie && doCookie.cookie !== env?.NCM_COOKIE) {
            musicEnv = { ...env, NCM_COOKIE: doCookie.cookie }
          }
        } catch { /* DO unavailable — fall back to env */ }

        if (request.method !== 'OPTIONS') {
          const mCfg = url.pathname.startsWith('/api/music/stream/')
            ? { name: 'music_stream', limit: 20 }
            : { name: 'music', limit: 60 }
          const { limited, retryAfter } = await checkLimit(env, mCfg, clientIp(request))
          if (limited) return tooManyRequests(retryAfter)
        }
        return music(request, musicEnv)
      })
    }

    if (url.pathname.startsWith('/api/')) {
      return new Response('Not found', { status: 404 })
    }

    return env.ASSETS.fetch(request)
  },
}
