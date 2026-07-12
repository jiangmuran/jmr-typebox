// song_url — the LEGACY weapi endpoint /api/song/enhance/player/url (NOT the v1 xeapi variant).
// We deliberately use this version because the v1 path requires the xeapi crypto scheme
// (X25519/AES-GCM), which we don't ship in the Worker. The legacy endpoint accepts a bitrate
// `br` (default 999000 = highest available non-HiRes) and returns the same {url, br, size, ...}
// shape the v1 endpoint does, just without the level-based naming.
//
// Pass `br` to control quality: 128000 (standard) · 192000 (high) · 320000 (exhigh) ·
// 999000 (lossless when account allows) · 1999000 (hires, requires VIP).
import { createOption } from '../option.js'

export default async function song_url(query, request) {
  const ids = String(query.id).split(',')
  const data = {
    ids: JSON.stringify(ids),
    br: parseInt(query.br) || 999000,
  }
  const res = await request('/api/song/enhance/player/url', data, createOption(query))
  // Preserve upstream's id-order on the response.
  const result = (res.body && res.body.data) || []
  result.sort((a, b) => ids.indexOf(String(a.id)) - ids.indexOf(String(b.id)))
  return { status: 200, body: { code: 200, data: result }, cookie: res.cookie }
}
