// Browser-side NCM API client — thin wrapper over the worker's /api/music/* surface. Every call
// is a same-origin fetch (no CORS, no API key in the browser), so this module is just URL
// building + JSON parsing + light normalisation.
//
// The worker handles: cookie injection (server-side MUSIC_U secret), random-CN-IP forging, rate
// limiting, and the entire weapi/eapi crypto envelope. From the browser's perspective these are
// plain JSON GETs.
//
// Error model: throws NcmError({ code, message }) on non-2xx or when the upstream returns a
// body with code != 200. Callers should try/catch and surface a toast.

const BASE = '/api/music'

export class NcmError extends Error {
  constructor(message, code = 0, status = 0) {
    super(message)
    this.name = 'NcmError'
    this.code = code
    this.status = status
  }
}

async function getJson(path, { expect = 'result' } = {}) {
  const res = await fetch(path, { headers: { 'accept': 'application/json' } })
  const text = await res.text()
  let body
  try { body = text ? JSON.parse(text) : {} } catch { body = { _raw: text } }
  if (!res.ok) {
    throw new NcmError(body?.message || body?.error || `HTTP ${res.status}`, body?.code || 0, res.status)
  }
  // NCM "soft errors" come back as HTTP 200 with body.code != 200 (e.g. code:301 for VIP-only).
  if (body && typeof body === 'object' && body.code != null && body.code !== 200) {
    throw new NcmError(body.msg || body.message || `NCM code ${body.code}`, body.code, 200)
  }
  // Some endpoints nest under `result`, others under `data`, others are flat.
  if (expect && body[expect] !== undefined) return body[expect]
  return body
}

// ─── search ──────────────────────────────────────────────────────────────────
// type: 1 song · 10 album · 100 artist · 1000 playlist · 1004 MV · 1006 lyric · 1014 video
// Returns the raw NCM result object (songs / playlists / albums / ... depending on type).
export function search(keywords, { type = 1, limit = 30, offset = 0 } = {}) {
  const q = new URLSearchParams({ keywords, type: String(type), limit: String(limit), offset: String(offset) })
  return getJson(`${BASE}/search?${q}`, { expect: 'result' })
}

// ─── playlist ────────────────────────────────────────────────────────────────
// Returns the playlist detail (first ~10 tracks inline + the full trackIds list).
export function playlistDetail(id) {
  return getJson(`${BASE}/playlist/${id}`, { expect: 'playlist' })
}

// Returns the FULL track list of a playlist (paged via limit/offset on the trackIds array).
export function playlistTracks(id, { limit = 1000, offset = 0 } = {}) {
  const q = new URLSearchParams({ limit: String(limit), offset: String(offset) })
  return getJson(`${BASE}/playlist/${id}/tracks?${q}`, { expect: 'songs' })
}

// ─── song ────────────────────────────────────────────────────────────────────
// Fetch metadata for one or more songs (comma-separated ids).
export function songDetail(ids) {
  return getJson(`${BASE}/song/detail/${Array.isArray(ids) ? ids.join(',') : ids}`, { expect: 'songs' })
}

// Fetch a temporary playback URL for a song. `br` controls bitrate:
//   128000 standard · 192000 high · 320000 exhigh · 999000 lossless (VIP) · 1999000 hires (VIP).
// Returns the upstream data array; pick [0] for the single-song case.
export function songUrl(id, { br = 320000 } = {}) {
  const q = new URLSearchParams({ br: String(br) })
  return getJson(`${BASE}/song/url/${id}?${q}`, { expect: 'data' })
}

// Build the same-origin streaming URL for an <audio src=...> binding. The worker handles the
// upstream audio fetch + Range request forwarding + edge caching. Pass br to control quality.
export function streamUrl(id, { br = 320000 } = {}) {
  return `${BASE}/stream/${id}?br=${br}`
}

// ─── lyric ───────────────────────────────────────────────────────────────────
// Returns the full lyric bundle: { lrc, tlyric, romalrc, yrc } each with a `.lyric` string field,
// plus a few minor fields. Anonymous (no cookie needed) — safe to call for any song id.
export function lyric(id) {
  return getJson(`${BASE}/lyric/${id}`)
}

// ─── album / artist ──────────────────────────────────────────────────────────
export function album(id) {
  return getJson(`${BASE}/album/${id}`, { expect: 'album' })
}

export function artistSongs(id, { order = 'hot', limit = 50, offset = 0 } = {}) {
  const q = new URLSearchParams({ order, limit: String(limit), offset: String(offset) })
  return getJson(`${BASE}/artist/${id}/songs?${q}`, { expect: 'songs' })
}

// ─── helpers used by the UI ─────────────────────────────────────────────────
// Parse a pasted NCM share link or bare id into a { kind, id } pair, or null if not NCM-shaped.
// Accepts:
//   • https://music.163.com/#/playlist?id=12345       → { kind: 'playlist', id: '12345' }
//   • https://music.163.com/playlist/12345            → { kind: 'playlist', id: '12345' }
//   • https://music.163.com/song?id=999               → { kind: 'song', id: '999' }
//   • https://music.163.com/album?id=777              → { kind: 'album', id: '777' }
//   • 123456                                         → null (no kind disambiguator)
export function parseNcmLink(input) {
  const s = String(input || '').trim()
  if (!s) return null
  // Try URL parse first.
  try {
    const u = new URL(s.startsWith('http') ? s : `https://music.163.com/${s}`)
    const hash = u.hash || ''
    const hashParams = new URLSearchParams(hash.split('?')[1] || '')
    const pathParts = u.pathname.split('/').filter(Boolean)
    // /playlist/123  /song/123  /album/123  /artist/123
    const kindFromPath = ['playlist', 'song', 'album', 'artist'].find((k) => pathParts[0] === k || pathParts.includes(k))
    const idFromPath = pathParts[pathParts.length - 1]
    if (kindFromPath && /^\d+$/.test(idFromPath)) return { kind: kindFromPath, id: idFromPath }
    // #/playlist?id=123  #/song?id=123  ...
    const idFromHash = hashParams.get('id')
    if (kindFromPath && idFromHash) return { kind: kindFromPath, id: idFromHash }
    // Also recognise the query string on the main URL: ?id=123 + a path containing /playlist/.
    if (kindFromPath && u.searchParams.get('id')) return { kind: kindFromPath, id: u.searchParams.get('id') }
  } catch { /* not a URL — fall through */ }
  return null
}
