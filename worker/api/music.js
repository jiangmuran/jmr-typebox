// /api/music/*  and  /api/admin/ncm/*  — the music player's entire backend surface.
//
// Two exported handlers:
//   music(request, env)      — public-ish music data (search / detail / lyric / stream). IP-
//                              allowlist-gated when ALLOWED_IPS is set; carries the server-side
//                              NCM_COOKIE secret for VIP-track playback.
//   adminNcm(request, env)   — QR-code login + logged-in account profile. IP-allowlist-gated
//                              AND (in phase 3) biometric-session-gated. For phase 1, the IP
//                              allowlist is the only gate, so deploy behind ALLOWED_IPS.
//
// Routing convention: the dispatcher in worker/index.js checks `pathname.startsWith('/api/music/')`
// (or '/api/admin/ncm/') and delegates here; we then dispatch by exact path or by
// `/api/music/<prefix>/<id>` shape. This is the FIRST parameterized-path convention in the
// worker — kept local to this file so the global dispatcher stays a flat if-chain.
//
// Error model: NCM upstream errors are surfaced as JSON { error, code, detail } with the
// upstream's own status (so the client can distinguish "VIP-only track" from "network down").
// All non-stream responses carry our standard `cors` block + `cache-control: no-store`.

import { call } from '../lib/ncm/index.js'
import { SEARCH_TYPES } from '../lib/ncm/config.js'

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type, range',
  // Range: audio streaming needs it so the <audio> element can byte-seek.
  'access-control-expose-headers': 'content-length, content-range, accept-ranges',
}

function json(obj, status = 200) {
  return Response.json(obj, { status, headers: { ...cors, 'cache-control': 'no-store' } })
}

function badRequest(msg) {
  return json({ error: 'bad_request', message: msg }, 400)
}

function notFound() {
  return json({ error: 'not_found' }, 404)
}

function upstreamError(detail, status = 502) {
  return json({ error: 'upstream_error', detail: String(detail).slice(0, 500) }, status)
}

/** Lift NCM's answer into our Response shape, preserving its status code when sensible. */
function passthrough(answer) {
  if (!answer || typeof answer !== 'object') return upstreamError('empty upstream answer')
  const status = answer.status && answer.status >= 200 && answer.status < 600 ? answer.status : 502
  return json(answer.body ?? answer, status)
}

// ---------------------------------------------------------------- public routes

export async function music(request, env) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })

  const url = new URL(request.url)
  const path = url.pathname
  const sp = url.searchParams

  // Server-side cookie: the shared-account MUSIC_U secret. Injected into every module call.
  const baseQuery = env && env.NCM_COOKIE ? { cookie: env.NCM_COOKIE } : {}

  try {
    // --- /api/music/search -----------------------------------------------------
    if (path === '/api/music/search') {
      const keywords = sp.get('keywords') || ''
      if (!keywords.trim()) return badRequest('missing keywords')
      const type = parseInt(sp.get('type'), 10) || 1
      if (!SEARCH_TYPES.has(type)) return badRequest(`invalid type ${type}`)
      const limit = Math.min(parseInt(sp.get('limit'), 10) || 30, 100)
      const offset = parseInt(sp.get('offset'), 10) || 0
      return passthrough(await call('cloudsearch', { keywords, type, limit, offset, ...baseQuery }))
    }

    // --- /api/music/playlist/:id (detail) --------------------------------------
    let m = path.match(/^\/api\/music\/playlist\/(\d+)\/tracks$/)
    if (m) {
      const limit = Math.min(parseInt(sp.get('limit'), 10) || 1000, 1000)
      const offset = parseInt(sp.get('offset'), 10) || 0
      return passthrough(await call('playlistTrackAll', { id: m[1], limit, offset, ...baseQuery }))
    }
    m = path.match(/^\/api\/music\/playlist\/(\d+)$/)
    if (m) {
      return passthrough(await call('playlistDetail', { id: m[1], ...baseQuery }))
    }

    // --- /api/music/song/detail/:ids (one or more, comma-sep) -------------------
    m = path.match(/^\/api\/music\/song\/detail\/([\d,]+)$/)
    if (m) {
      return passthrough(await call('songDetail', { ids: m[1], ...baseQuery }))
    }

    // --- /api/music/song/url/:id (JSON metadata + temporary URL) ----------------
    m = path.match(/^\/api\/music\/song\/url\/([\d,]+)$/)
    if (m) {
      const br = parseInt(sp.get('br'), 10) || 320000
      return passthrough(await call('songUrl', { id: m[1], br, ...baseQuery }))
    }

    // --- /api/music/stream/:id (streamed audio bytes, proxied through Worker) --
    // Hides the upstream NCM CDN URL from the browser, lets us inject random-CN-IP upstream
    // (handled inside createRequest), and lets the browser Range-request via fetch passthrough.
    m = path.match(/^\/api\/music\/stream\/(\d+)$/)
    if (m) {
      const br = parseInt(sp.get('br'), 10) || 320000
      const ans = await call('songUrl', { id: m[1], br, ...baseQuery })
      const track = ans?.body?.data?.[0]
      if (!track) return upstreamError('no track data')
      if (!track.url) {
        // VIP-only / region-locked / taken-down — pass the upstream code through.
        return json({ error: 'no_stream_url', code: track.code || 0, fee: track.fee }, 502)
      }
      // NCM sometimes hands back an http:// URL; Workers only allow https subrequests, so upgrade.
      const upstreamUrl = track.url.replace(/^http:\/\//i, 'https://')
      const range = request.headers.get('range')
      const upstreamHeaders = {}
      if (range) upstreamHeaders['range'] = range

      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 120000) // 2 min max per stream chunk
      let upstream
      try {
        upstream = await fetch(upstreamUrl, { headers: upstreamHeaders, signal: controller.signal })
      } catch (e) {
        clearTimeout(timer)
        return upstreamError(e && e.message || e)
      }
      clearTimeout(timer)

      // Only cache SUCCESSFUL responses long-term. NCM CDN URLs expire, and an expired URL returns
      // a 403 (or other non-2xx); caching that for a year would permanently break the track in the
      // client. Non-2xx responses get no-store so a retry re-fetches a fresh signed URL. (200 full
      // and 206 partial/range responses are both in [200,300) and safe to cache.)
      const cacheable = upstream.status >= 200 && upstream.status < 300
      const outHeaders = {
        ...cors,
        'content-type': upstream.headers.get('content-type') || 'audio/mpeg',
        // Audio bytes are immutable for a given track id → cache aggressively at the edge, but only
        // when the upstream actually served bytes (2xx). Errors must not be cached.
        'cache-control': cacheable
          ? 'public, max-age=31536000, immutable'
          : 'no-store',
      }
      // Forward audio-range headers so <audio>.seek works.
      for (const h of ['content-length', 'content-range', 'accept-ranges']) {
        const v = upstream.headers.get(h)
        if (v) outHeaders[h] = v
      }
      return new Response(upstream.body, { status: upstream.status, headers: outHeaders })
    }

    // --- /api/music/lyric/:id --------------------------------------------------
    m = path.match(/^\/api\/music\/lyric\/(\d+)$/)
    if (m) {
      return passthrough(await call('lyricNew', { id: m[1], ...baseQuery }))
    }

    // --- /api/music/album/:id --------------------------------------------------
    m = path.match(/^\/api\/music\/album\/(\d+)$/)
    if (m) {
      return passthrough(await call('album', { id: m[1], ...baseQuery }))
    }

    // --- /api/music/artist/:id/songs ------------------------------------------
    m = path.match(/^\/api\/music\/artist\/(\d+)\/songs$/)
    if (m) {
      const order = sp.get('order') === 'time' ? 'time' : 'hot'
      const limit = Math.min(parseInt(sp.get('limit'), 10) || 50, 200)
      const offset = parseInt(sp.get('offset'), 10) || 0
      return passthrough(await call('artistSongs', { id: m[1], order, limit, offset, ...baseQuery }))
    }

    return notFound()
  } catch (e) {
    return upstreamError(e && e.message || e)
  }
}

// ----------------------------------------------------- /api/admin/ncm/* routes
// (Phase 1 gate: IP allowlist only. Phase 3 will require a biometric session cookie on top.)

export async function adminNcm(request, env) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })

  const url = new URL(request.url)
  const path = url.pathname

  try {
    // POST /api/admin/ncm/qrcode/key  — request a fresh unikey for QR login.
    if (path === '/api/admin/ncm/qrcode/key' && request.method === 'POST') {
      return passthrough(await call('loginQrKey', {}))
    }

    // GET /api/admin/ncm/qrcode/:key  — build the QR URL the client renders into an image.
    let m = path.match(/^\/api\/admin\/ncm\/qrcode\/([A-Za-z0-9_-]{8,128})$/)
    if (m && request.method === 'GET') {
      // qrimg=true would have us render the image server-side; we explicitly DON'T (see module),
      // so we just return qrurl and let the frontend render via its own `qrcode` dep.
      return passthrough(await call('loginQrCreate', { key: m[1] }))
    }

    // GET /api/admin/ncm/qrcode/check/:key  — poll the login state every ~2s from the client.
    m = path.match(/^\/api\/admin\/ncm\/qrcode\/check\/([A-Za-z0-9_-]{8,128})$/)
    if (m && request.method === 'GET') {
      return passthrough(await call('loginQrCheck', { key: m[1] }))
    }

    // GET /api/admin/ncm/account  — show the public profile of whoever owns env.NCM_COOKIE.
    // NOTE: in phase 1 the cookie is set via the NCM_COOKIE worker secret directly (paste from
    // devtools). The phase-3 QR-login flow will write the cookie into an encrypted Durable
    // Object instead, and adminNcm will read it from there rather than env.
    if (path === '/api/admin/ncm/account' && request.method === 'GET') {
      if (!env || !env.NCM_COOKIE) return json({ error: 'no_ncm_cookie_configured' }, 503)
      // Pull userId out of the cookie: MUSIC_U's payload is a base64url JSON with `userId`.
      const userId = extractUserIdFromCookie(env.NCM_COOKIE)
      if (!userId) return json({ error: 'cannot_extract_uid_from_cookie' }, 502)
      return passthrough(await call('userDetail', { uid: userId, cookie: env.NCM_COOKIE }))
    }

    return notFound()
  } catch (e) {
    return upstreamError(e && e.message || e)
  }
}

/**
 * Decode the MUSIC_U JWT-ish cookie payload and pull out the userId.
 * MUSIC_U value is a JWT (header.payload.signature) where payload is base64url JSON
 * containing { "userId": 1234567, ... }. Returns the userId as a string, or null on failure.
 */
function extractUserIdFromCookie(cookieStr) {
  try {
    const musicU = (cookieStr.match(/MUSIC_U=([^;]+)/) || [])[1]
    if (!musicU) return null
    const parts = musicU.split('.')
    if (parts.length < 2) return null
    // base64url → base64 → JSON
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
    const json = JSON.parse(atob(padded))
    return json.userId != null ? String(json.userId) : null
  } catch {
    return null
  }
}
