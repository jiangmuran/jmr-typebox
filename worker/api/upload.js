// POST /api/upload — image-host (图床) upload proxy. The Markdown editor uploads a pasted/
// dropped image here; we attach the upstream Bearer key SERVER-SIDE (a Cloudflare secret,
// `IMAGE_HOST_KEY`, never exposed to the browser) and forward the file to the image host.
//
// Request: multipart/form-data with a single `file` field (an image, ≤ 5 MB).
// Response: JSON `{ url }` — the public URL of the stored image (CORS-permissive).
//
// Optional backend feature. Users who configure their own host in Settings upload to it
// directly from the browser instead (their key, their URL); this proxy is the default path
// so the shared host's key stays secret.
//
// Wiring (integrator, in worker/index.js):
//   import { uploadImage } from './api/upload.js'
//   if (url.pathname === '/api/upload') return uploadImage(request, env)
// …and add it to RATE_CFG (e.g. { name: 'upload', limit: 20 }) so it's rate-limited.

const MAX_BYTES = 5 * 1024 * 1024 // 5 MB
const DEFAULT_UPSTREAM = 'https://files.muran.tech/api/upload'

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
}

function json(obj, status = 200) {
  return Response.json(obj, { status, headers: { ...cors, 'cache-control': 'no-store' } })
}

// Pull a public URL out of the various shapes image hosts return: {url}, {data:{url}},
// {link}, {data:{link}}, {result:{url}}. Returns '' when none is found.
export function parseUploadUrl(data) {
  if (!data || typeof data !== 'object') return ''
  const cands = [
    data.url,
    data.link,
    data.src,
    data.data?.url,
    data.data?.link,
    data.data?.src,
    data.result?.url,
    Array.isArray(data.data) ? data.data[0]?.url : undefined,
  ]
  for (const c of cands) {
    if (typeof c === 'string' && c) return c
  }
  return ''
}

export async function uploadImage(request, env) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
  if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405)

  // The form parser throws on a non-multipart body; treat that as a bad request.
  let form
  try {
    form = await request.formData()
  } catch {
    return json({ error: 'expected multipart/form-data with a "file" field' }, 400)
  }

  const file = form.get('file')
  // A real upload is a File/Blob; a stray string field is not acceptable.
  if (!file || typeof file === 'string' || typeof file.arrayBuffer !== 'function') {
    return json({ error: 'missing file field' }, 400)
  }

  const type = file.type || ''
  if (!type.startsWith('image/')) {
    return json({ error: 'only image files are allowed' }, 415)
  }
  if (typeof file.size === 'number' && file.size > MAX_BYTES) {
    return json({ error: 'file too large (max 5 MB)' }, 413)
  }

  // Re-validate the actual byte length (size can be absent/spoofed on some Blobs).
  const buf = await file.arrayBuffer()
  if (buf.byteLength > MAX_BYTES) {
    return json({ error: 'file too large (max 5 MB)' }, 413)
  }

  const upstreamUrl = env?.IMAGE_HOST_URL || DEFAULT_UPSTREAM
  const key = env?.IMAGE_HOST_KEY
  if (!key) {
    return json({ error: 'image host is not configured on the server' }, 503)
  }

  const out = new FormData()
  out.append('file', new Blob([buf], { type }), file.name || 'image.png')

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 30000)

  let upstream
  try {
    upstream = await fetch(upstreamUrl, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}` },
      body: out,
      signal: controller.signal,
    })
  } catch (e) {
    clearTimeout(timer)
    return json({ error: 'upload failed', detail: String((e && e.message) || e) }, 502)
  }
  clearTimeout(timer)

  let data = null
  try { data = await upstream.json() } catch { /* non-JSON upstream body */ }

  if (!upstream.ok) {
    const detail = (data && (data.error || data.message)) || `upstream returned ${upstream.status}`
    return json({ error: 'upload failed', detail }, 502)
  }

  const url = parseUploadUrl(data)
  if (!url) return json({ error: 'upstream did not return a url' }, 502)

  return json({ url })
}
