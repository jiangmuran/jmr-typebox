// POST /api/asr — speech-to-text (ASR) proxy. Browsers calling a provider's
// /audio/transcriptions endpoint directly are blocked by CORS, so the frontend posts the multipart
// upload here and we forward it upstream and return the provider's JSON verbatim.
//
// Like /api/ai, this takes the provider base + key FROM THE REQUEST (it is NOT a server secret) and
// is only useful for hosts that gate on that key. The request is multipart/form-data carrying:
//   file        — the (downsampled) audio to transcribe (required)
//   model       — the ASR model id, e.g. 'whisper-1' (required)
//   response_format, language, prompt, temperature — optional OpenAI passthrough fields
//   __base      — the OpenAI-compatible base, e.g. 'https://api.openai.com/v1' (required; stripped
//                 from the forwarded form)
// The key is sent in the Authorization header (Bearer …) by the client and forwarded as-is.
//
// SSRF posture: forwards a user-supplied key to a user-supplied host; we still block loopback/
// private ranges (same guard as fetch.js / ai.js) so the Worker can't probe Cloudflare's internals.
//
// Wiring (integrator, in worker/index.js):
//   import { asrTranscribe } from './api/asr.js'
//   if (url.pathname === '/api/asr') return asrTranscribe(request, env)
// …and add it to RATE_CFG (e.g. { name: 'asr', limit: 20 }) so it's rate-limited.
import { isBlockedHost } from './fetch.js'

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type, authorization',
}

function json(obj, status = 200) {
  return Response.json(obj, { status, headers: { ...cors, 'cache-control': 'no-store' } })
}

// Max upload we relay (provider caps are typically ~25 MB; the client downsamples/chunks to fit).
const MAX_BYTES = 26 * 1024 * 1024

// Join a base like '.../v1' with '/audio/transcriptions' without doubling/dropping slashes. If the
// caller already pointed at a full transcriptions endpoint, respect it.
export function buildAsrUrl(baseUrl, path = '/audio/transcriptions') {
  const base = String(baseUrl || '').trim().replace(/\/+$/, '')
  if (!base) return ''
  if (/\/audio\/transcriptions$/.test(base)) return base
  return base + (path.startsWith('/') ? path : '/' + path)
}

export async function asrTranscribe(request, env) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
  if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405)

  // Parse the multipart upload (throws on a non-multipart body).
  let form
  try {
    form = await request.formData()
  } catch {
    return json({ error: 'expected multipart/form-data with file + model + __base fields' }, 400)
  }

  const file = form.get('file')
  if (!file || typeof file === 'string' || typeof file.arrayBuffer !== 'function') {
    return json({ error: 'missing file field' }, 400)
  }
  const model = form.get('model')
  if (!model || typeof model !== 'string') {
    return json({ error: 'missing model field' }, 400)
  }
  const base = form.get('__base')
  if (!base || typeof base !== 'string') {
    return json({ error: 'missing provider base (__base)' }, 400)
  }

  if (typeof file.size === 'number' && file.size > MAX_BYTES) {
    return json({ error: 'audio too large (max 25 MB) — the client should downsample or chunk it' }, 413)
  }
  const buf = await file.arrayBuffer()
  if (buf.byteLength > MAX_BYTES) {
    return json({ error: 'audio too large (max 25 MB) — the client should downsample or chunk it' }, 413)
  }

  const upstreamUrl = buildAsrUrl(base)
  let u
  try { u = new URL(upstreamUrl) } catch { return json({ error: 'invalid provider base' }, 400) }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return json({ error: 'protocol not allowed' }, 400)
  if (isBlockedHost(u.hostname)) return json({ error: 'host not allowed' }, 403)

  // Rebuild the upstream form: re-attach the file + every passthrough field EXCEPT our internal
  // __base. Forward the client's Authorization header (the user's key) as-is.
  const out = new FormData()
  out.append('file', new Blob([buf], { type: file.type || 'application/octet-stream' }), file.name || 'audio.mp3')
  for (const [k, v] of form.entries()) {
    if (k === 'file' || k === '__base') continue
    if (typeof v === 'string') out.append(k, v)
  }

  const headers = {}
  const auth = request.headers.get('authorization')
  if (auth) headers['authorization'] = auth

  // Transcription can take a while for longer audio; allow up to ~120s.
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 120000)

  let upstream
  try {
    upstream = await fetch(u.toString(), { method: 'POST', headers, body: out, signal: controller.signal })
  } catch (e) {
    clearTimeout(timer)
    return json({ error: 'upstream request failed', detail: String((e && e.message) || e) }, 502)
  }
  clearTimeout(timer)

  // Pass the provider's body straight back with its status + content-type. Most providers return
  // JSON (verbose_json → segments + timestamps); some return text/plain for response_format=text.
  const contentType = upstream.headers.get('content-type') || 'application/json'
  const text = await upstream.text().catch(() => '')
  return new Response(text, {
    status: upstream.status,
    headers: { ...cors, 'content-type': contentType, 'cache-control': 'no-store' },
  })
}
