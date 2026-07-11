// POST /api/watermark  — register 1..50 records, returns { ids }. Public, rate-limited in index.js.
// GET  /api/watermark/:id — resolve a record by id. Public, KV-edge-cached.
// Records live in the KV namespace bound as env.WATERMARKS; no image/IP is ever stored.

const ID_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ' // Crockford base32 (no I L O U)
const ID_LEN = 10
export const CONTENT_MAX_BYTES = 2048
export const MAX_RECORDS = 50

// 10 random Crockford chars. 256 % 32 === 0, so byte % 32 is unbiased.
export function makeId() {
  const bytes = new Uint8Array(ID_LEN)
  crypto.getRandomValues(bytes)
  let s = ''
  for (let i = 0; i < ID_LEN; i++) s += ID_ALPHABET[bytes[i] % 32]
  return s
}

export function validateRegisterBody(body) {
  if (!body || !Array.isArray(body.records)) return { ok: false, error: 'records must be an array' }
  const recs = body.records
  if (recs.length < 1 || recs.length > MAX_RECORDS) return { ok: false, error: `records length must be 1..${MAX_RECORDS}` }
  const enc = new TextEncoder()
  const out = []
  for (const r of recs) {
    if (!r || typeof r.content !== 'string') return { ok: false, error: 'content must be a string' }
    if (enc.encode(r.content).length > CONTENT_MAX_BYTES) return { ok: false, error: 'content exceeds 2KB' }
    out.push({
      content: r.content,
      timestamp: Number.isInteger(r.timestamp) ? r.timestamp : 0,
      version: Number.isInteger(r.version) ? r.version : 1,
    })
  }
  return { ok: true, records: out }
}

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
}
function json(obj, status = 200) {
  return Response.json(obj, { status, headers: { ...cors, 'cache-control': status === 200 ? 'public, max-age=60' : 'no-store' } })
}

async function register(request, env) {
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)
  if (!env || !env.WATERMARKS) return json({ error: 'unavailable' }, 503)
  let body
  try { body = await request.json() } catch { return json({ error: 'invalid_json' }, 400) }
  const v = validateRegisterBody(body)
  if (!v.ok) return json({ error: v.error }, 400)
  const now = Date.now()
  const ids = []
  for (const rec of v.records) {
    let id = makeId()
    for (let t = 0; t < 3 && (await env.WATERMARKS.get(id)) !== null; t++) id = makeId()
    await env.WATERMARKS.put(id, JSON.stringify({ v: 1, content: rec.content, timestamp: rec.timestamp, version: rec.version, createdAt: now }))
    ids.push(id)
  }
  return json({ ids })
}

async function resolve(id, env) {
  if (!env || !env.WATERMARKS) return json({ error: 'not_found' }, 404)
  const raw = await env.WATERMARKS.get(id)
  if (raw === null) return json({ error: 'not_found' }, 404)
  let rec
  try { rec = JSON.parse(raw) } catch { return json({ error: 'not_found' }, 404) }
  return json(rec)
}

export async function watermark(request, env) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
  const url = new URL(request.url)
  const rest = url.pathname.slice('/api/watermark'.length) // '' | '/' | '/<id>'
  if (rest === '' || rest === '/') return register(request, env)
  if (request.method !== 'GET') return json({ error: 'method_not_allowed' }, 405)
  // A malformed percent-escape (e.g. /api/watermark/%) makes decodeURIComponent throw URIError;
  // on this public GET that would surface as a 500. Treat an undecodable id as a clean miss.
  let id
  try { id = decodeURIComponent(rest.slice(1)) } catch { return json({ error: 'not_found' }, 404) }
  return resolve(id, env)
}
