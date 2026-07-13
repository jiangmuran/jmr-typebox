// POST /api/ai — streaming AI proxy. Browsers calling api.openai.com (and most OpenAI-
// compatible hosts) directly are blocked by CORS, so the frontend posts the request here
// and we forward it upstream and stream the response body straight back (SSE pass-through).
//
// Body: { baseUrl, key, body } where:
//   baseUrl — the OpenAI-compatible base, e.g. "https://api.openai.com/v1"
//   key     — the user's API key (sent as Authorization: Bearer; never logged/stored)
//   body    — the verbatim /chat/completions payload (model, messages, stream, tools, ...)
//
// This is an optional backend feature. The frontend can also call the upstream directly
// (Settings → "Call AI endpoint directly") for CORS-enabled / local endpoints.
//
// SSRF posture: this endpoint forwards a user-supplied key to a user-supplied host, so it is
// only useful for hosts that gate on that key. We still block loopback/private ranges (same
// guard as fetch.js) so the Worker can't be used to probe Cloudflare's internal network.
import { isBlockedHost } from './fetch.js'

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
}

function json(obj, status = 200) {
  return Response.json(obj, { status, headers: { ...cors, 'cache-control': 'no-store' } })
}

// Join a base like ".../v1" with "/chat/completions" without doubling or dropping slashes.
export function buildUpstreamUrl(baseUrl, path = '/chat/completions') {
  const base = String(baseUrl || '').trim().replace(/\/+$/, '')
  if (!base) return ''
  // If the caller already pointed at a full endpoint, respect it.
  if (/\/chat\/completions$/.test(base)) return base
  return base + (path.startsWith('/') ? path : '/' + path)
}

export async function proxyAI(request) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
  if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405)

  let payload
  try { payload = await request.json() } catch { return json({ error: 'invalid json body' }, 400) }
  const { baseUrl, key, body, path } = payload || {}
  if (!baseUrl) return json({ error: 'missing baseUrl' }, 400)
  if (!body || typeof body !== 'object') return json({ error: 'missing body' }, 400)
  // `path` is optional (buildUpstreamUrl defaults it). But if the caller sends a non-string path,
  // buildUpstreamUrl's `path.startsWith` would throw a TypeError → bubble up as a 500. Reject it
  // as a client error instead.
  if (path != null && typeof path !== 'string') return json({ error: 'invalid path' }, 400)

  // Normalize null → undefined so buildUpstreamUrl's default param kicks in (a literal null would
  // otherwise slip past the default and throw inside path.startsWith).
  const upstreamUrl = buildUpstreamUrl(baseUrl, path ?? undefined)
  let u
  try { u = new URL(upstreamUrl) } catch { return json({ error: 'invalid baseUrl' }, 400) }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return json({ error: 'protocol not allowed' }, 400)
  if (isBlockedHost(u.hostname)) return json({ error: 'host not allowed' }, 403)

  const headers = { 'content-type': 'application/json' }
  if (key) headers['authorization'] = `Bearer ${key}`

  // Long-running streamed completions: allow up to ~120s before giving up.
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 120000)

  let upstream
  try {
    upstream = await fetch(u.toString(), {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    })
  } catch (e) {
    clearTimeout(timer)
    return json({ error: 'upstream request failed', detail: String(e && e.message || e) }, 502)
  }

  // Pass the upstream status + body straight through. For streaming responses the body is a
  // ReadableStream which we forward unbuffered so tokens arrive incrementally. Clear the
  // abort timer once the stream finishes (or errors).
  const contentType = upstream.headers.get('content-type') || 'application/json'
  const outHeaders = {
    ...cors,
    'content-type': contentType,
    'cache-control': 'no-store',
    'x-accel-buffering': 'no',
  }

  if (!upstream.body) {
    clearTimeout(timer)
    const text = await upstream.text().catch(() => '')
    return new Response(text, { status: upstream.status, headers: outHeaders })
  }

  const reader = upstream.body.getReader()
  const stream = new ReadableStream({
    async pull(ctrl) {
      try {
        const { done, value } = await reader.read()
        if (done) { ctrl.close(); clearTimeout(timer); return }
        ctrl.enqueue(value)
      } catch (err) {
        clearTimeout(timer)
        ctrl.error(err)
      }
    },
    cancel(reason) {
      clearTimeout(timer)
      try { reader.cancel(reason) } catch {}
      try { controller.abort() } catch {}
    },
  })

  return new Response(stream, { status: upstream.status, headers: outHeaders })
}
