// Pure, SSG-safe helpers for the music PLAYER mode. NO window/document/IndexedDB/Audio here —
// everything operates on plain values (numbers, strings, plain arrays of track records) so it can
// be unit-tested in node and imported anywhere (including index.js, which must stay light).
//
// A "track record" is a plain object: { id, name, title, artist, album, size, type, duration,
// addedAt, ... }. The audio Blob is stored separately in IndexedDB (see mediaDb.js) keyed by id;
// these helpers never touch the blob.

// ---------------------------------------------------------------------------
// IDs + time
// ---------------------------------------------------------------------------

// Short, collision-resistant id for a track/playlist. Pure (uses a counter + a random suffix); the
// optional `rand`/`now` injectors keep it deterministic in tests.
let _seq = 0
export function uid(prefix = 't', rand = Math.random, now = Date.now) {
  _seq = (_seq + 1) % 1e6
  const r = Math.floor(rand() * 36 ** 4).toString(36).padStart(4, '0')
  return `${prefix}_${now().toString(36)}_${_seq.toString(36)}${r}`
}

// Format seconds as m:ss or h:mm:ss (player transport / lyrics). Negative/NaN → '0:00'.
export function formatTime(seconds) {
  const s = Math.max(0, Math.floor(Number(seconds) || 0))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const pad = (n) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`
}

// Human file size. Mirrors mediaHelpers.formatSize but kept local so this module is standalone.
export function formatBytes(bytes) {
  const b = Number(bytes) || 0
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`
  if (b < 1024 * 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(1)} MB`
  return `${(b / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

// Derive a display title from a filename when ID3 has none. Strips the extension, turns _/- into
// spaces, collapses whitespace. 'My_Song-01.mp3' → 'My Song 01'.
export function titleFromName(name) {
  const base = String(name || '').replace(/\.[^./\\]+$/, '')
  return base.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Untitled'
}

// First visible glyph of a string, uppercased, for the monochrome placeholder art. Handles
// surrogate pairs / CJK; falls back to a music note when empty.
export function initialOf(str) {
  const s = String(str || '').trim()
  if (!s) return '♪' // ♪
  const ch = Array.from(s)[0]
  return ch ? ch.toUpperCase() : '♪'
}

// Deterministic hue (0–359) from a string, for a tasteful per-track placeholder tint. We keep it
// monochrome-friendly by letting the UI desaturate; this just spreads tracks apart visually.
export function hashHue(str) {
  const s = String(str || '')
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return h % 360
}

// ---------------------------------------------------------------------------
// Track + playlist model (immutable-ish helpers returning new arrays)
// ---------------------------------------------------------------------------

// Build a track record from a File-like (name/size/type) + optional parsed metadata. Pure: the
// caller supplies id/now so tests are deterministic; never reads the file bytes.
//
// PHASE 2 extension: the record now carries `source` ('local' | 'ncm') + optional `ncmId` +
// `urlExpiresAt` so the store can decide whether to fetch fresh bytes from NCM or play straight
// from IndexedDB. Local-file records default to source='local' and are byte-for-byte identical to
// the v1 shape — old tests / callers continue to work unchanged.
export function makeTrack({ id, name, size = 0, type = '', meta = {}, addedAt = Date.now(), source = 'local', ncmId = '', urlExpiresAt = 0 } = {}) {
  return {
    id: id || uid('trk'),
    name: name || 'audio',
    size: Number(size) || 0,
    type: type || '',
    title: meta.title || titleFromName(name),
    artist: meta.artist || '',
    album: meta.album || '',
    duration: Number(meta.duration) || 0,
    hasCover: !!meta.hasCover,
    coverUrl: meta.coverUrl || '',
    addedAt,
    // Phase 2: provenance + NCM linkage. Local tracks leave ncmId='' and urlExpiresAt=0.
    source: source === 'ncm' ? 'ncm' : 'local',
    ncmId: ncmId ? String(ncmId) : '',
    urlExpiresAt: Number(urlExpiresAt) || 0,
  }
}

// Build a track record from a NCM song object (the shape /api/music/search and /song/detail
// return). Centralises the field-mapping so the store / search UI / playlist importer all see a
// consistent track shape regardless of which NCM endpoint produced it.
export function makeNcmTrack(ncmSong, { addedAt = Date.now() } = {}) {
  const id = ncmSong?.id != null ? String(ncmSong.id) : ''
  if (!id) return null
  // NCM song objects nest different bitrate/file shapes under h/m/l/sq/hr; pull size/duration
  // from whichever is present. dt is duration in ms; the {h,m,l} objects have {size,br}.
  const dt = Number(ncmSong.dt) || 0
  const sizeFrom = ncmSong.h || ncmSong.m || ncmSong.l || ncmSong.sq || {}
  return makeTrack({
    name: `${ncmSong.name || `ncm_${id}`}.mp3`,
    size: Number(sizeFrom.size) || 0,
    type: 'audio/mpeg',
    meta: {
      title: ncmSong.name || '',
      artist: (ncmSong.ar || []).map((a) => a.name).filter(Boolean).join(' / '),
      album: ncmSong.al?.name || '',
      duration: Math.floor(dt / 1000),
      coverUrl: ncmSong.al?.picUrl || '',
    },
    source: 'ncm',
    ncmId: id,
    addedAt,
  })
}

// Move the item at `from` to `to` within an array (drag reorder). Returns a NEW array; out-of-range
// indices clamp. moveItem(['a','b','c'], 0, 2) → ['b','c','a'].
export function moveItem(arr, from, to) {
  const a = Array.isArray(arr) ? arr.slice() : []
  const n = a.length
  if (!n) return a
  const f = Math.max(0, Math.min(n - 1, from | 0))
  const t = Math.max(0, Math.min(n - 1, to | 0))
  if (f === t) return a
  const [item] = a.splice(f, 1)
  a.splice(t, 0, item)
  return a
}

// Compute the next index in a queue given the repeat/shuffle mode. `order` is the array of track
// ids (or any items); `current` is the current index. Returns the next index, or -1 when playback
// should stop (end of queue with repeat 'off').
//   nextIndex({ length, current, repeat:'off'|'one'|'all', shuffle, rand })
// 'one' returns the same index (repeat-one). 'all' wraps. shuffle picks a random OTHER index.
export function nextIndex({ length, current, repeat = 'off', shuffle = false, rand = Math.random } = {}) {
  const n = length | 0
  if (n <= 0) return -1
  if (n === 1) return repeat === 'off' ? -1 : 0
  if (repeat === 'one') return Math.max(0, Math.min(n - 1, current | 0))
  if (shuffle) {
    // Pick a uniformly random index that isn't the current one.
    let i = Math.floor(rand() * (n - 1))
    if (i >= (current | 0)) i += 1
    return i
  }
  const next = (current | 0) + 1
  if (next >= n) return repeat === 'all' ? 0 : -1
  return next
}

// Previous index (transport ⏮). Wraps under repeat 'all'; clamps at 0 under 'off'. shuffle prev
// behaves like shuffle next (random other), which matches common players.
export function prevIndex({ length, current, repeat = 'off', shuffle = false, rand = Math.random } = {}) {
  const n = length | 0
  if (n <= 0) return -1
  if (n === 1) return 0
  if (shuffle) return nextIndex({ length: n, current, repeat: 'all', shuffle: true, rand })
  const prev = (current | 0) - 1
  if (prev < 0) return repeat === 'all' ? n - 1 : 0
  return prev
}

// ---------------------------------------------------------------------------
// Cache-size accounting (the IndexedDB blob store has a soft cap)
// ---------------------------------------------------------------------------

// Sum the `size` field across track records (bytes). Tolerates missing/garbage sizes.
export function totalSize(tracks) {
  if (!Array.isArray(tracks)) return 0
  return tracks.reduce((sum, t) => sum + (Number(t?.size) || 0), 0)
}

// Default soft cap for the player's IndexedDB store. 500 MB is generous for "music you own" while
// staying well under typical browser origin quotas.
export const DEFAULT_CACHE_CAP = 500 * 1024 * 1024

// Would adding `incomingBytes` to the current set exceed the cap? Pure predicate for the UI guard.
export function exceedsCap(currentBytes, incomingBytes, cap = DEFAULT_CACHE_CAP) {
  return (Number(currentBytes) || 0) + (Number(incomingBytes) || 0) > (Number(cap) || DEFAULT_CACHE_CAP)
}

// Given existing tracks + a cap, return how many MORE bytes can be stored before hitting the cap
// (never negative).
export function remainingCap(tracks, cap = DEFAULT_CACHE_CAP) {
  const used = totalSize(tracks)
  return Math.max(0, (Number(cap) || DEFAULT_CACHE_CAP) - used)
}

// ---------------------------------------------------------------------------
// Search / filter (library)
// ---------------------------------------------------------------------------

// Case-insensitive substring match over title/artist/album/name. Empty query → all.
export function filterTracks(tracks, query) {
  const q = String(query || '').trim().toLowerCase()
  if (!q) return Array.isArray(tracks) ? tracks.slice() : []
  return (tracks || []).filter((t) => {
    const hay = `${t.title || ''} ${t.artist || ''} ${t.album || ''} ${t.name || ''}`.toLowerCase()
    return hay.includes(q)
  })
}

// ---------------------------------------------------------------------------
// Playlist records
// ---------------------------------------------------------------------------

// A playlist is { id, name, trackIds:[...] }. The special "library" playlist (all tracks) is
// implicit and not stored. makePlaylist gives a fresh one.
export function makePlaylist({ id, name = 'New Playlist', trackIds = [] } = {}) {
  return { id: id || uid('pl'), name: String(name || 'New Playlist'), trackIds: trackIds.slice() }
}

// Add a track id to a playlist's id list without duplicates → new array.
export function addToPlaylist(trackIds, id) {
  const list = Array.isArray(trackIds) ? trackIds.slice() : []
  if (id && !list.includes(id)) list.push(id)
  return list
}

// Remove a track id everywhere it appears → new array.
export function removeFromList(trackIds, id) {
  return (Array.isArray(trackIds) ? trackIds : []).filter((x) => x !== id)
}
