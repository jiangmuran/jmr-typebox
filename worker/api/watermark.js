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
