import { health } from './api/health.js'
import { proxyFetch } from './api/fetch.js'
import { preview } from './api/preview.js'
import { proxyAI } from './api/ai.js'
import { uploadImage } from './api/upload.js'
import { asrTranscribe } from './api/asr.js'
import { clientIp, rateLimit, tooManyRequests } from './lib/rateLimit.js'

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
    if (url.pathname.startsWith('/api/')) {
      return new Response('Not found', { status: 404 })
    }

    return env.ASSETS.fetch(request)
  },
}
