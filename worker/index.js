import { health } from './api/health.js'
import { proxyFetch } from './api/fetch.js'
import { preview } from './api/preview.js'
import { proxyAI } from './api/ai.js'

// Single Cloudflare Worker: serves the static SSG frontend via the ASSETS binding and
// handles optional /api/* routes. All /api features are optional — the frontend degrades
// gracefully when they are absent or disabled.
export default {
  async fetch(request, env) {
    const url = new URL(request.url)

    if (url.pathname === '/api/health') return health()
    if (url.pathname === '/api/fetch') return proxyFetch(request)
    if (url.pathname === '/api/preview') return preview(request)
    if (url.pathname === '/api/ai') return proxyAI(request)
    if (url.pathname.startsWith('/api/')) {
      return new Response('Not found', { status: 404 })
    }

    return env.ASSETS.fetch(request)
  },
}
