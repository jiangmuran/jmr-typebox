import { health } from './api/health.js'

// Single Cloudflare Worker: serves the static SSG frontend via the ASSETS binding and
// handles optional /api/* routes. All /api features are optional — the frontend degrades
// gracefully when they are absent or disabled.
export default {
  async fetch(request, env) {
    const url = new URL(request.url)

    if (url.pathname === '/api/health') return health()
    // Future (Phase 1 E): /api/fetch (CORS proxy), /api/preview (OG)
    if (url.pathname.startsWith('/api/')) {
      return new Response('Not found', { status: 404 })
    }

    return env.ASSETS.fetch(request)
  },
}
