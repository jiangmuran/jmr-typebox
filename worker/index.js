import { health } from './api/health.js'
import { proxyFetch } from './api/fetch.js'
import { preview } from './api/preview.js'
import { proxyAI } from './api/ai.js'
import { clientIp, rateLimit, tooManyRequests } from './lib/rateLimit.js'

// Per-IP request budget (requests / 60s) for the abuse-prone proxy endpoints. The open URL
// fetch + OG preview are the prime "刷接口" targets; the AI relay is more generous since the
// editor's inline completion can call it in bursts.
const RATE_LIMITS = {
  '/api/fetch': 40,
  '/api/preview': 40,
  '/api/ai': 60,
}
const RATE_WINDOW_MS = 60_000

// Single Cloudflare Worker: serves the static SSG frontend via the ASSETS binding and
// handles optional /api/* routes. All /api features are optional — the frontend degrades
// gracefully when they are absent or disabled.
export default {
  async fetch(request, env) {
    const url = new URL(request.url)

    if (url.pathname === '/api/health') return health()

    // Per-IP rate limit the proxy endpoints (skip CORS preflight, which carries no work).
    const limit = RATE_LIMITS[url.pathname]
    if (limit && request.method !== 'OPTIONS') {
      const rl = rateLimit(`${url.pathname}:${clientIp(request)}`, limit, RATE_WINDOW_MS)
      if (!rl.ok) return tooManyRequests(rl.retryAfter)
    }

    if (url.pathname === '/api/fetch') return proxyFetch(request)
    if (url.pathname === '/api/preview') return preview(request)
    if (url.pathname === '/api/ai') return proxyAI(request)
    if (url.pathname.startsWith('/api/')) {
      return new Response('Not found', { status: 404 })
    }

    return env.ASSETS.fetch(request)
  },
}
