// IndexedDB persistence for the music PLAYER — stores track BLOBS (the audio you own/uploaded),
// their metadata records, named playlists, and small key/value settings (volume, last track,
// per-track resume position, lyrics). Survives reload/offline.
//
// SSG-SAFETY: this module has NO top-level side effects and never touches `indexedDB` at import.
// Every function opens the DB lazily (the connection is created on first call, only ever from a
// client event handler / onMounted), and degrades gracefully if IndexedDB is unavailable (private
// mode, SSR) by resolving to empty/no-ops so the player still runs in-memory.

const DB_NAME = 'tb-player'
const DB_VERSION = 1
const STORE_TRACKS = 'tracks'       // { id, blob, ...trackRecord }  (the heavy store)
const STORE_PLAYLISTS = 'playlists' // { id, name, trackIds }
const STORE_KV = 'kv'               // { key, value }

let _dbPromise = null

function hasIDB() {
  return typeof indexedDB !== 'undefined' && !!indexedDB
}

// Open (and upgrade) the database once. Resolves to null when IndexedDB is unavailable so callers
// can degrade to in-memory behavior without special-casing everywhere.
function openDb() {
  if (!hasIDB()) return Promise.resolve(null)
  if (_dbPromise) return _dbPromise
  _dbPromise = new Promise((resolve) => {
    let req
    try { req = indexedDB.open(DB_NAME, DB_VERSION) } catch { return resolve(null) }
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_TRACKS)) db.createObjectStore(STORE_TRACKS, { keyPath: 'id' })
      if (!db.objectStoreNames.contains(STORE_PLAYLISTS)) db.createObjectStore(STORE_PLAYLISTS, { keyPath: 'id' })
      if (!db.objectStoreNames.contains(STORE_KV)) db.createObjectStore(STORE_KV, { keyPath: 'key' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => resolve(null)
    req.onblocked = () => resolve(req.result || null)
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

// Delete a track (and its blob) by id.
export async function deleteTrack(id) {
  return withStore(STORE_TRACKS, 'readwrite', (store) => reqToPromise(store.delete(id)), false)
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

// Lyrics are stored per track id under a kv map (small text, fine in kv).
export async function getLyrics(trackId) {
  const map = (await kvGet('lyrics', {})) || {}
  return map[trackId] || ''
}
export async function setLyrics(trackId, text) {
  const map = (await kvGet('lyrics', {})) || {}
  if (text) map[trackId] = text; else delete map[trackId]
  return kvSet('lyrics', map)
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

export const PLAYER_DB_INFO = { name: DB_NAME, version: DB_VERSION, stores: { tracks: STORE_TRACKS, playlists: STORE_PLAYLISTS, kv: STORE_KV } }
