// COMPLIANT online-listening helpers. We ONLY ever build official, first-party EMBED player URLs
// for three platforms and render them in a sandboxed <iframe> for in-page playback. This is NOT a
// downloader/extractor and uses NO unofficial APIs: we parse a share link the user pastes, validate
// the host is one we support, pull the public content id, and hand back the platform's OWN embed
// URL. The platform's player streams the audio/video; nothing is fetched, cached, or saved by us.
//
// Pure + SSG-safe: no window/DOM/network here — just string parsing (we use the global URL parser,
// available in both browsers and node). Every function tolerates junk input and returns null on
// anything it doesn't recognize, so the caller can show a friendly "unsupported link" message.

// Hosts we accept, normalized (lowercased, leading www. stripped) → platform key.
const HOST_MAP = {
  'music.163.com': 'netease',
  'y.music.163.com': 'netease',
  'bilibili.com': 'bilibili',
  'm.bilibili.com': 'bilibili',
  'b23.tv': 'bilibili', // short links resolve client-side only as a hint; we still need a BV id
  'youtube.com': 'youtube',
  'm.youtube.com': 'youtube',
  'music.youtube.com': 'youtube',
  'youtu.be': 'youtube',
}

export const SUPPORTED_PLATFORMS = ['netease', 'bilibili', 'youtube']

// Parse a URL string → { url, host } or null. Accepts bare "music.163.com/..." (no scheme).
function safeUrl(input) {
  const s = String(input || '').trim()
  if (!s) return null
  let u
  try { u = new URL(s) } catch {
    try { u = new URL('https://' + s) } catch { return null }
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
  return u
}

// Normalize a hostname for lookup (lowercase, strip a single leading www.).
function normHost(host) {
  return String(host || '').toLowerCase().replace(/^www\./, '')
}

// Which supported platform does this link belong to? Returns 'netease'|'bilibili'|'youtube'|null.
export function platformOf(input) {
  const u = safeUrl(input)
  if (!u) return null
  const host = normHost(u.hostname)
  if (HOST_MAP[host]) return HOST_MAP[host]
  // Accept subdomains of the known roots (e.g. www.bilibili.com handled above; this catches others).
  for (const [root, key] of Object.entries(HOST_MAP)) {
    if (host === root || host.endsWith('.' + root)) return key
  }
  return null
}

// ---- per-platform id extraction (public content ids only) ----

// NetEase: song or playlist. Returns { kind:'song'|'playlist', id }. The id appears either in the
// query (?id=123) or in the hash route (#/song?id=123, #/playlist?id=456).
function parseNetease(u) {
  const hash = u.hash || ''
  const isPlaylist = /playlist/i.test(u.pathname) || /playlist/i.test(hash)
  // id can live in the search params OR inside the hash's own query string.
  let id = u.searchParams.get('id')
  if (!id && hash.includes('id=')) {
    const m = hash.match(/[?&]id=(\d+)/)
    if (m) id = m[1]
  }
  if (!id) {
    // /song/123 or /playlist/123 style.
    const m = u.pathname.match(/\/(?:song|playlist)\/(\d+)/i)
    if (m) id = m[1]
  }
  if (!id || !/^\d+$/.test(id)) return null
  return { kind: isPlaylist ? 'playlist' : 'song', id }
}

// Bilibili: a BV id (e.g. BV1xx411c7mD). May be in the path (/video/BV...) or a query.
function parseBilibili(u) {
  const text = `${u.pathname} ${u.search} ${u.hash}`
  const m = text.match(/(BV[0-9A-Za-z]{10})/)
  if (m) return { kind: 'video', id: m[1] }
  return null
}

// YouTube: a video id. youtu.be/<id>, /watch?v=<id>, /embed/<id>, /shorts/<id>.
function parseYouTube(u) {
  const host = normHost(u.hostname)
  let id = null
  if (host === 'youtu.be') {
    id = u.pathname.slice(1).split('/')[0]
  } else {
    id = u.searchParams.get('v')
    if (!id) {
      const m = u.pathname.match(/\/(?:embed|shorts|v)\/([^/?#]+)/)
      if (m) id = m[1]
    }
  }
  if (!id || !/^[A-Za-z0-9_-]{6,20}$/.test(id)) return null
  return { kind: 'video', id }
}

// Parse a pasted link into a normalized descriptor of an OFFICIAL embed, or null if unsupported.
//   { platform, kind, id, embedUrl, title }
// `embedUrl` is the platform's own player URL — the only thing we ever put in the iframe src.
export function parseEmbed(input) {
  const u = safeUrl(input)
  if (!u) return null
  const platform = platformOf(input)
  if (!platform) return null

  let info = null
  if (platform === 'netease') info = parseNetease(u)
  else if (platform === 'bilibili') info = parseBilibili(u)
  else if (platform === 'youtube') info = parseYouTube(u)
  if (!info) return null

  const embedUrl = buildEmbedUrl(platform, info)
  if (!embedUrl) return null
  return { platform, kind: info.kind, id: info.id, embedUrl, title: defaultEmbedTitle(platform, info) }
}

// Build the OFFICIAL first-party embed URL for a parsed descriptor. These are the exact, documented
// embed endpoints for each platform — no scraping, no media files.
export function buildEmbedUrl(platform, info) {
  if (!info || !info.id) return null
  if (platform === 'netease') {
    // type=2 → single song player; type=0 → playlist player. auto=0 (no autoplay), fixed height.
    const type = info.kind === 'playlist' ? 0 : 2
    return `https://music.163.com/outchain/player?type=${type}&id=${encodeURIComponent(info.id)}&auto=0&height=66`
  }
  if (platform === 'bilibili') {
    return `https://player.bilibili.com/player.html?bvid=${encodeURIComponent(info.id)}`
  }
  if (platform === 'youtube') {
    // Privacy-enhanced nocookie domain; the official embed player.
    return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(info.id)}`
  }
  return null
}

// A safe default label until the user renames it (we never fetch the real title).
function defaultEmbedTitle(platform, info) {
  const name = platform === 'netease' ? 'NetEase Cloud Music' : platform === 'bilibili' ? 'Bilibili' : 'YouTube'
  const kind = info.kind === 'playlist' ? ' playlist' : ''
  return `${name}${kind} · ${info.id}`
}

// Final guard used right before we set an iframe src: confirm the URL is one of our exact official
// embed origins. Defense-in-depth so a bug elsewhere can never put an arbitrary URL in the iframe.
export function isAllowedEmbedUrl(url) {
  const u = safeUrl(url)
  if (!u) return false
  const host = normHost(u.hostname)
  return (
    (host === 'music.163.com' && u.pathname === '/outchain/player') ||
    (host === 'player.bilibili.com' && u.pathname === '/player.html') ||
    (host === 'youtube-nocookie.com' && u.pathname.startsWith('/embed/')) ||
    (host === 'youtube.com' && u.pathname.startsWith('/embed/'))
  )
}

// Human label for a platform key.
export function platformLabel(platform) {
  return platform === 'netease' ? 'NetEase Cloud Music'
    : platform === 'bilibili' ? 'Bilibili'
    : platform === 'youtube' ? 'YouTube'
    : ''
}
