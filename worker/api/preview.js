// GET /api/preview?url=... — fetch a page and extract Open Graph/link-preview metadata.
// Optional backend feature (cross-origin → needs server). Reuses the SSRF guard from fetch.js.
import { isBlockedHost } from './fetch.js'

function json(obj, status = 200) {
  // Only cache successful previews. Caching an error (400/403/502) for 10 minutes would keep a
  // transient upstream failure (or a rejected URL) "stuck" until the TTL expires.
  const cacheControl = status >= 200 && status < 300 ? 'public, max-age=600' : 'no-store'
  return Response.json(obj, { status, headers: { 'access-control-allow-origin': '*', 'cache-control': cacheControl } })
}

function decode(s) {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'")
}

export function extractMeta(html, baseUrl) {
  const pick = re => { const m = html.match(re); return m ? decode(m[1].trim()) : '' }
  const og = p =>
    pick(new RegExp(`<meta[^>]+property=["']og:${p}["'][^>]+content=["']([^"']*)["']`, 'i')) ||
    pick(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+property=["']og:${p}["']`, 'i'))
  const title = og('title') || pick(/<title[^>]*>([^<]*)<\/title>/i)
  const description = og('description') || pick(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i)
  const image = og('image')
  return { title, description, image, url: baseUrl }
}

export async function preview(request) {
  const target = new URL(request.url).searchParams.get('url')
  if (!target) return json({ error: 'missing url' }, 400)
  let t
  try { t = new URL(target) } catch { return json({ error: 'invalid url' }, 400) }
  if (t.protocol !== 'http:' && t.protocol !== 'https:') return json({ error: 'protocol not allowed' }, 400)
  if (isBlockedHost(t.hostname)) return json({ error: 'host not allowed' }, 403)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 8000)
  try {
    const resp = await fetch(t.toString(), { signal: controller.signal, headers: { 'user-agent': 'TypeBox/1.0' } })
    clearTimeout(timer)
    const html = (await resp.text()).slice(0, 200000)
    return json(extractMeta(html, t.toString()))
  } catch {
    clearTimeout(timer)
    return json({ error: 'fetch failed' }, 502)
  }
}
