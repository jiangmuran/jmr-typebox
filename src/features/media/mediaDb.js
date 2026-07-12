// IndexedDB persistence for the music PLAYER — stores track BLOBS (the audio you own/uploaded OR
// cached from NCM), their metadata records, named playlists, per-track lyrics (original +
// translation + romaji + yrc, separately so the lyrics panel can switch between them in O(1)),
// and small key/value settings (volume, last track, per-track resume position).
//
// PHASE 2 schema v2 (vs v1):
//   • tracks store gains an `ncmId` index so `getByNcmId(ncmId)` is O(1) instead of a full scan.
//     This is what lets the player dedupe a search hit against the local cache without paging
//     through every stored blob.
//   • NEW `lyrics` store keyed by trackId. v1 stored lyrics inside the kv map under `lyrics[trackId]`;
//     v2 migrates that map out into its own store and adds columns for translation/romaji/yrc.
//   • tracks record carries `source` / `ncmId` / `urlExpiresAt` (see playerHelpers.makeTrack).
//
// SSG-SAFETY: this module has NO top-level side effects and never touches `indexedDB` at import.
// Every function opens the DB lazily; degrades gracefully if IndexedDB is unavailable.

const DB_NAME = 'tb-player'
const DB_VERSION = 2                    // v2 → ncmId index + dedicated lyrics store
const STORE_TRACKS = 'tracks'          // { id, blob, ...trackRecord }    (the heavy store)
const STORE_PLAYLISTS = 'playlists'    // { id, name, trackIds }
const STORE_KV = 'kv'                  // { key, value }
const STORE_LYRICS = 'lyrics'          // { trackId, original?, translation?, romaji?, yrc?, updatedAt }

let _dbPromise = null

function hasIDB() {
  return typeof indexedDB !== 'undefined' && !!indexedDB
}

// Open (and upgrade) the database once. Resolves to null when IndexedDB is unavailable so callers
// can degrade to in-memory behavior without special-casing everywhere.
//
// CRITICAL: the `onblocked` handler must NOT read `req.result` — at that moment the request is
// still pending (other tabs hold the old version), so accessing `.result` throws
// InvalidStateError, which rejects this promise AND poisons the cached _dbPromise so every
// subsequent call also throws. Instead we clear the cache + resolve null, letting the next call
// retry the open (the user will succeed once they close the other tabs).
function openDb() {
  if (!hasIDB()) return Promise.resolve(null)
  if (_dbPromise) return _dbPromise
  _dbPromise = new Promise((resolve) => {
    let req
    try { req = indexedDB.open(DB_NAME, DB_VERSION) } catch { _dbPromise = null; return resolve(null) }
    req.onupgradeneeded = (event) => {
      const db = req.result
      const oldVersion = event.oldVersion || 0
      // --- v1 baseline ---
      if (!db.objectStoreNames.contains(STORE_TRACKS)) db.createObjectStore(STORE_TRACKS, { keyPath: 'id' })
      if (!db.objectStoreNames.contains(STORE_PLAYLISTS)) db.createObjectStore(STORE_PLAYLISTS, { keyPath: 'id' })
      if (!db.objectStoreNames.contains(STORE_KV)) db.createObjectStore(STORE_KV, { keyPath: 'key' })
      // --- v2 migration ---
      if (oldVersion < 2) {
        const trackStore = req.transaction.objectStore(STORE_TRACKS)
        // Index by ncmId if not already there (idempotent across reinstalls).
        if (!trackStore.indexNames.contains('ncmId')) {
          trackStore.createIndex('ncmId', 'ncmId', { unique: false })
        }
        if (!db.objectStoreNames.contains(STORE_LYRICS)) {
          db.createObjectStore(STORE_LYRICS, { keyPath: 'trackId' })
        }
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => { _dbPromise = null; resolve(null) }
    req.onblocked = () => {
      // Upgrade blocked by another tab holding the old version. DON'T touch req.result (it throws).
      // Clear the cache so the next call retries; resolve null so callers degrade to in-memory.
      _dbPromise = null
      resolve(null)
    }
  })
  return _dbPromise
}

// Promisify a single request inside a transaction.
function reqToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

// Run `fn(store)` in a transaction over `storeName` and await completion. Returns whatever the
// inner promise resolves to. Resolves to `fallback` if the DB is unavailable.
async function withStore(storeName, mode, fn, fallback = null) {
  const db = await openDb()
  if (!db) return fallback
  return new Promise((resolve, reject) => {
    let tx
    try { tx = db.transaction(storeName, mode) } catch (e) { return resolve(fallback) }
    const store = tx.objectStore(storeName)
    let result
    Promise.resolve(fn(store)).then((r) => { result = r }).catch(reject)
    tx.oncomplete = () => resolve(result)
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error || new Error('tx aborted'))
  })
}

// ---------------------------------------------------------------------------
// Tracks (blob + record). The record is everything EXCEPT the blob; we store them together so a
// single get returns playable bytes, but list views read records without forcing blob decode.
// ---------------------------------------------------------------------------

// Persist a track: { ...record, blob }. The blob is a File/Blob of the audio.
export async function putTrack(record, blob) {
  return withStore(STORE_TRACKS, 'readwrite', (store) =>
    reqToPromise(store.put({ ...record, blob })), false)
}

// Get a single stored track entry (record + blob) by id, or null.
export async function getTrack(id) {
  return withStore(STORE_TRACKS, 'readonly', (store) => reqToPromise(store.get(id)), null)
}

// Get just the Blob for a track id (for playback / send-to-edit), or null.
export async function getTrackBlob(id) {
  const entry = await getTrack(id)
  return entry?.blob || null
}

// List all track RECORDS (blob stripped) — cheap metadata for the library/queue, sorted by addedAt.
export async function listTrackRecords() {
  const all = await withStore(STORE_TRACKS, 'readonly', (store) => reqToPromise(store.getAll()), [])
  return (all || [])
    .map(({ blob, ...rec }) => ({ ...rec, size: rec.size || blob?.size || 0 }))
    .sort((a, b) => (a.addedAt || 0) - (b.addedAt || 0))
}

// Delete a track (and its blob) by id. Also drops its lyrics row if present (best-effort).
export async function deleteTrack(id) {
  await deleteLyrics(id)
  return withStore(STORE_TRACKS, 'readwrite', (store) => reqToPromise(store.delete(id)), false)
}

// PHASE 2: look up a cached track by its NCM id (used to dedupe search results against the local
// cache, and by the prefetch logic to decide whether the next track already has bytes). Returns
// the record (no blob) or null.
export async function getTrackByNcmId(ncmId) {
  if (!ncmId) return null
  return withStore(STORE_TRACKS, 'readonly', (store) => {
    const idx = store.index('ncmId')
    return reqToPromise(idx.get(String(ncmId)))
  }, null).then((row) => {
    if (!row) return null
    const { blob, ...rec } = row
    return { ...rec, size: rec.size || blob?.size || 0 }
  })
}

// Update only the record fields of a track (e.g. after editing ID3 tags) without touching the blob.
export async function updateTrackRecord(id, patch) {
  return withStore(STORE_TRACKS, 'readwrite', async (store) => {
    const cur = await reqToPromise(store.get(id))
    if (!cur) return false
    await reqToPromise(store.put({ ...cur, ...patch, id, blob: cur.blob }))
    return true
  }, false)
}

// Total bytes used by stored track blobs (cache-size display). Reads sizes from records.
export async function totalStoredBytes() {
  const recs = await listTrackRecords()
  return recs.reduce((sum, r) => sum + (Number(r.size) || 0), 0)
}

// Wipe ALL stored tracks (the "clear cache" control). Playlists/kv are left intact unless `all`.
export async function clearTracks() {
  return withStore(STORE_TRACKS, 'readwrite', (store) => reqToPromise(store.clear()), false)
}

// ---------------------------------------------------------------------------
// Playlists
// ---------------------------------------------------------------------------

export async function listPlaylists() {
  const all = await withStore(STORE_PLAYLISTS, 'readonly', (store) => reqToPromise(store.getAll()), [])
  return all || []
}

export async function putPlaylist(playlist) {
  return withStore(STORE_PLAYLISTS, 'readwrite', (store) => reqToPromise(store.put(playlist)), false)
}

export async function deletePlaylist(id) {
  return withStore(STORE_PLAYLISTS, 'readwrite', (store) => reqToPromise(store.delete(id)), false)
}

// ---------------------------------------------------------------------------
// Key/value (settings, last track, per-track resume positions, lyrics text)
// ---------------------------------------------------------------------------

export async function kvGet(key, fallback = null) {
  const row = await withStore(STORE_KV, 'readonly', (store) => reqToPromise(store.get(key)), null)
  return row ? row.value : fallback
}

export async function kvSet(key, value) {
  return withStore(STORE_KV, 'readwrite', (store) => reqToPromise(store.put({ key, value })), false)
}

export async function kvDelete(key) {
  return withStore(STORE_KV, 'readwrite', (store) => reqToPromise(store.delete(key)), false)
}

// Convenience for per-track resume positions, namespaced under a single kv map to avoid key sprawl.
export async function getPositions() {
  return (await kvGet('positions', {})) || {}
}
export async function setPosition(trackId, seconds) {
  const map = await getPositions()
  map[trackId] = Math.max(0, Number(seconds) || 0)
  return kvSet('positions', map)
}

// PHASE 2: lyrics now live in their own object store (one row per track) instead of a kv map.
// Each row can hold up to four parallel lyric strings:
//   • original   — the .lrc text (NCM's lrc.lyric field)
//   • translation — translated .lrc (NCM's tlyric.lyric field)
//   • romaji     — romanized lyrics (NCM's romalrc.lyric, or AI-generated fallback)
//   • yrc        — per-syllable KTV timing (NCM's yrc.lyric)
//
// MIGRATION: v1 stored lyrics under the kv map key 'lyrics' as `{ [trackId]: text }`. The first
// time getLyrics/setLyrics is called against a v2 DB, we lazily migrate that map into the new
// store (each trackId's text becomes the `original` field). Migration is idempotent.

let _lyricsMigrated = false
async function migrateLyricsIfNeeded() {
  if (_lyricsMigrated) return
  _lyricsMigrated = true
  try {
    const legacy = await kvGet('lyrics', null)
    if (legacy && typeof legacy === 'object') {
      for (const [trackId, text] of Object.entries(legacy)) {
        if (!text) continue
        const existing = await getLyricsRow(trackId)
        if (!existing) await putLyricsRow(trackId, { original: text })
      }
      await kvDelete('lyrics')
    }
  } catch { /* migration is best-effort */ }
}

async function getLyricsRow(trackId) {
  return withStore(STORE_LYRICS, 'readonly', (store) => reqToPromise(store.get(trackId)), null)
}
async function putLyricsRow(trackId, fields) {
  return withStore(STORE_LYRICS, 'readwrite', (store) => reqToPromise(store.put({ trackId, updatedAt: Date.now(), ...fields })), false)
}

// Public: fetch the ORIGINAL lyric text for a track (back-compat with the v1 caller signature).
// Returns '' when no lyrics are stored for the track.
export async function getLyrics(trackId) {
  await migrateLyricsIfNeeded()
  const row = await getLyricsRow(trackId)
  return row?.original || ''
}

// Public: write the ORIGINAL lyric text for a track. Other fields (translation/romaji/yrc) are
// preserved on update.
export async function setLyrics(trackId, text) {
  await migrateLyricsIfNeeded()
  const row = (await getLyricsRow(trackId)) || {}
  return putLyricsRow(trackId, { ...row, original: text || '' })
}

// PHASE 2: structured access — returns the whole lyric bundle for a track at once so the panel
// can render all four views without four IDB round-trips. Shape: { original, translation, romaji,
// yrc, updatedAt } (any field may be '' if not stored).
export async function getLyricsBundle(trackId) {
  await migrateLyricsIfNeeded()
  const row = await getLyricsRow(trackId)
  if (!row) return { original: '', translation: '', romaji: '', yrc: '', updatedAt: 0 }
  const { original = '', translation = '', romaji = '', yrc = '', updatedAt = 0 } = row
  return { original, translation, romaji, yrc, updatedAt }
}

// PHASE 2: merge-patch setter for the lyric bundle. Pass only the fields you want to write;
// the others stay untouched. e.g. setLyricsField(id, { translation: '...' }) only touches the
// translation column.
export async function setLyricsField(trackId, patch) {
  await migrateLyricsIfNeeded()
  const row = (await getLyricsRow(trackId)) || {}
  return putLyricsRow(trackId, { ...row, ...patch })
}

// Delete the entire lyric row for a track (called from deleteTrack).
export async function deleteLyrics(trackId) {
  return withStore(STORE_LYRICS, 'readwrite', (store) => reqToPromise(store.delete(trackId)), false)
}

// Drop the whole player database (hard reset). Best-effort.
export async function deleteDatabase() {
  _dbPromise = null
  if (!hasIDB()) return false
  return new Promise((resolve) => {
    try {
      const req = indexedDB.deleteDatabase(DB_NAME)
      req.onsuccess = () => resolve(true)
      req.onerror = () => resolve(false)
      req.onblocked = () => resolve(false)
    } catch { resolve(false) }
  })
}

export const PLAYER_DB_INFO = { name: DB_NAME, version: DB_VERSION, stores: { tracks: STORE_TRACKS, playlists: STORE_PLAYLISTS, kv: STORE_KV, lyrics: STORE_LYRICS } }
