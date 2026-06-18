// GET /api/fetch?url=... — CORS proxy so the frontend can import remote images/files/markdown
// that browsers block cross-origin. Optional backend feature. Hardened against SSRF/abuse:
// http(s) only, private/loopback hosts blocked, 10s timeout, 25MB cap.
const MAX_BYTES = 25 * 1024 * 1024

function json(obj, status = 200) {
  return Response.json(obj, { status, headers: { 'access-control-allow-origin': '*', 'cache-control': 'no-store' } })
}

export function isBlockedHost(hostname) {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal')) return true
  if (h === '::1' || h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80')) return true
  if (/^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) || /^169\.254\./.test(h) || /^0\./.test(h)) return true
  const m = h.match(/^172\.(\d+)\./)
  if (m && +m[1] >= 16 && +m[1] <= 31) return true
  return false
}

export async function proxyFetch(request) {
  const target = new URL(request.url).searchParams.get('url')
  if (!target) return json({ error: 'missing url' }, 400)
  let t
  try { t = new URL(target) } catch { return json({ error: 'invalid url' }, 400) }
  if (t.protocol !== 'http:' && t.protocol !== 'https:') return json({ error: 'protocol not allowed' }, 400)
  if (isBlockedHost(t.hostname)) return json({ error: 'host not allowed' }, 403)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 10000)
  try {
    const resp = await fetch(t.toString(), { signal: controller.signal, headers: { 'user-agent': 'TypeBox/1.0 (+https://github.com/jiangmuran/jmr-typebox)' }, redirect: 'follow' })
    clearTimeout(timer)
    const len = resp.headers.get('content-length')
    if (len && +len > MAX_BYTES) return json({ error: 'too large' }, 413)
    const buf = await resp.arrayBuffer()
    if (buf.byteLength > MAX_BYTES) return json({ error: 'too large' }, 413)
    return new Response(buf, {
      status: resp.status,
      headers: {
        'content-type': resp.headers.get('content-type') || 'application/octet-stream',
        'access-control-allow-origin': '*',
        'cache-control': 'public, max-age=300',
      },
    })
  } catch {
    clearTimeout(timer)
    return json({ error: 'fetch failed' }, 502)
  }
}
