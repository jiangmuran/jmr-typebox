// The music PLAYER store — a module-singleton composable holding all reactive player state and
// orchestrating the audio engine + IndexedDB persistence + NCM streaming + lyrics.
//
// PHASE 2 redesign (vs the v1 store):
//   • Track records carry a `source` field ('local' | 'ncm'). Local tracks play straight from
//     IndexedDB bytes; NCM tracks may or may not have been cached yet — `ensurePlayable()`
//     materialises them on demand (fetch /api/music/song/url → stream bytes → store blob).
//   • The EMBED surface (NetEase/Bilibili/YouTube iframes) is GONE — the player is now a real
//     music player, not an iframe host. Use the search panel to find music.
//   • Lyrics live in a structured bundle per track (original / translation / romaji / yrc); the
//     reactive `liveLyrics` ref exposes the parsed views so the lyrics panel can switch between
//     them without re-parsing.
//   • Prefetch (the next track in the queue + its lyrics) is wired into the currentId watcher.
//
// SSG-SAFETY: only `ref()`s are created at module scope (safe). Nothing touches Audio/IndexedDB/
// window/fetch until init() is called from a client onMounted.
import { ref, computed } from 'vue'
import {
  makeTrack, makeNcmTrack, makePlaylist, moveItem,
  nextIndex as calcNext, prevIndex as calcPrev,
  totalSize, exceedsCap, DEFAULT_CACHE_CAP,
  addToPlaylist as addId, removeFromList, titleFromName, uid,
} from './playerHelpers'
import { isAudioInput } from './mediaHelpers'
// STATIC imports — these used to be dynamic `await import(...)` inside every function, but that
// caused intermittent chunk-load failures in production (the dynamic-import chunks sometimes 404'd
// or never resolved, freezing the entire player with no error). mediaDb + ncmClient are both
// SSG-safe (no top-level side effects), so importing them statically is correct.
import * as db from './mediaDb'

// ---- reactive state (singletons) ----
const tracks = ref([])              // track records (no blobs) — the library
const playlists = ref([])           // [{ id, name, trackIds }]
const activePlaylistId = ref('')    // '' = library (all tracks)
const queue = ref([])               // ordered track ids currently playing through
const currentId = ref('')           // id of the now-playing track
const isPlaying = ref(false)
const currentTime = ref(0)
const duration = ref(0)
const volume = ref(1)
const rate = ref(1)
const shuffle = ref(false)
const repeat = ref('off')           // 'off' | 'one' | 'all'
const abStart = ref(null)           // A–B repeat (seconds)
const abEnd = ref(null)
const search = ref('')
const coverUrl = ref('')            // object URL or NCM picUrl for the current track
const cacheBytes = ref(0)
const cacheCap = ref(DEFAULT_CACHE_CAP)
const ready = ref(false)
const busy = ref(false)
const buffering = ref(false)        // audio is waiting on data (slow stream / mid-track stall)
// Global background-import task (caching a whole online playlist). Lives in the store — NOT in the
// playlist drawer — so it survives closing the drawer / leaving the page, stays visible in the
// mini-player, and is cancellable from anywhere. Runs with bounded concurrency so it neither
// blocks the UI (the old foreground loop) nor hammers the network invisibly.
const importState = ref({ running: false, total: 0, done: 0, ok: 0, failed: 0, currentTitle: '', playlistName: '' })
let _importCancel = false

// PHASE 2: NCM live lyric bundle for the current track. Fields update atomically on track change.
// Parsed views are recomputed by the lyrics panel; the store only holds the raw strings.
const liveLyrics = ref({
  original: '', translation: '', romaji: '', yrc: '',
})
// True while lyrics for the current track are being fetched — lets the lyrics views show a
// loading state instead of prematurely flashing "no lyrics" before the fetch resolves.
const lyricsLoading = ref(false)

// PHASE 2: prefetch status, surfaced in MiniPlayer so the user knows the next track is warming.
// 'idle' | 'fetching' | 'cached' | 'error'
const prefetchState = ref('idle')

let _engine = null
let _initPromise = null
let _loadSeq = 0                    // click-spam guard: only the LATEST loadTrack may commit
let _positions = {}                 // trackId -> seconds (resume points), mirrored to db
const _prefetching = new Set()      // trackIds currently being prefetched (dedupe)
// PHASE 4: in-memory blob cache — fallback when IndexedDB is unavailable (e.g. the v1→v2 upgrade
// is blocked by another tab). Without this, a NCM track that was just streamed would vanish on
// the next getTrackBlob call (which returns null when IDB is down), making playback impossible.
// With this cache, playback works in-memory even when persistence is offline.
const _blobCache = new Map()
// Preview track: when the user clicks ▶ on a search result, we play WITHOUT adding to the library.
// This ref holds that temporary record so currentTrack / MediaSession / lyrics still work.
const previewRec = ref(null)
// Library pane UI state — shared across ALL PlayerLibrary instances (desktop split view,
// desktop library view and the mobile deck each mount one), so the tab/drawer stays
// consistent between them and deep links (?playlist=<id>) can drive it from PlayerPage.
const libSource = ref('files')          // 'files' | 'ncm'
const libNcmPlaylist = ref('')          // NCM playlist id whose detail drawer is open ('' = closed)

// ---- derived ----
const currentTrack = computed(() => tracks.value.find((t) => t.id === currentId.value) || (previewRec.value && previewRec.value.id === currentId.value ? previewRec.value : null))
const currentIndex = computed(() => queue.value.indexOf(currentId.value))
// The "library" (no playlist) shows only tracks whose bytes actually live on the device: local
// uploads (always) + NCM songs that were downloaded (cached). Metadata-only NCM records — e.g.
// dumped in by "play all" on an online playlist — are excluded so the local library isn't
// polluted with online tracks. A named playlist shows exactly what the user put in it.
const libraryTracks = computed(() => tracks.value.filter((t) => t.source === 'local' || t.inLibrary))
const activeTracks = computed(() => {
  if (!activePlaylistId.value) return libraryTracks.value
  const pl = playlists.value.find((p) => p.id === activePlaylistId.value)
  if (!pl) return libraryTracks.value
  const byId = new Map(tracks.value.map((t) => [t.id, t]))
  return pl.trackIds.map((id) => byId.get(id)).filter(Boolean)
})
const cacheUsedPct = computed(() => Math.min(100, Math.round((cacheBytes.value / (cacheCap.value || 1)) * 100)))
const isCurrentNcm = computed(() => currentTrack.value?.source === 'ncm')

export function usePlayerStore() {
  // ---------------- init / hydrate ----------------
  async function init() {
    if (_initPromise) return _initPromise
    _initPromise = (async () => {
      const engineMod = await import('./audioEngine')
      _engine = engineMod.getEngine()

      tracks.value = await db.listTrackRecords()
      // Legacy rows predate the inLibrary flag: the old code only ever persisted NCM records
      // the user had added to the library, so a missing flag means "in the library". Backfill
      // it once so the new libraryTracks filter doesn't hide their music after the upgrade.
      tracks.value = tracks.value.map((t) => {
        if (t.source === 'ncm' && t.inLibrary === undefined) {
          db.updateTrackRecord(t.id, { inLibrary: true }).catch(() => {})
          return { ...t, inLibrary: true }
        }
        return t
      })
      // Apply the user's custom drag order (ids not in the saved order sort last, by addedAt).
      const order = await db.kvGet('trackOrder', null)
      if (Array.isArray(order) && order.length) {
        const pos = new Map(order.map((tid, i) => [tid, i]))
        tracks.value = tracks.value.slice().sort((a, b) =>
          (pos.has(a.id) ? pos.get(a.id) : Infinity) - (pos.has(b.id) ? pos.get(b.id) : Infinity))
      }
      playlists.value = await db.listPlaylists()
      _positions = await db.getPositions()
      cacheBytes.value = totalSize(tracks.value)
      volume.value = (await db.kvGet('volume', 1)) ?? 1
      rate.value = (await db.kvGet('rate', 1)) ?? 1
      shuffle.value = !!(await db.kvGet('shuffle', false))
      repeat.value = (await db.kvGet('repeat', 'off')) || 'off'
      cacheCap.value = (await db.kvGet('cacheCap', DEFAULT_CACHE_CAP)) || DEFAULT_CACHE_CAP

      if (_engine) {
        _engine.setVolume(volume.value)
        _engine.setRate(rate.value)
        let lastPosPersist = 0
        _engine.on('time', (t, d) => {
          currentTime.value = t || 0
          if (d && isFinite(d)) duration.value = d
          enforceAB(t)
          // Throttled resume-point persistence: positions used to be saved only on pause /
          // track change, so a mid-play reload "resumed" at the LAST pause point, not where
          // the user actually was.
          const now = Date.now()
          if (t > 0 && now - lastPosPersist > 5000) { lastPosPersist = now; persistPosition() }
        })
        _engine.on('play', () => { isPlaying.value = true })
        _engine.on('pause', () => { isPlaying.value = false; buffering.value = false; persistPosition() })
        _engine.on('ended', () => { buffering.value = false; onEnded() })
        _engine.on('buffering', (b) => { buffering.value = !!b })
        _engine.on('loaded', (d) => { if (d && isFinite(d)) duration.value = d; _engine.setPositionState() })
        wireSession()
      }

      queue.value = tracks.value.map((t) => t.id)
      const last = await db.kvGet('lastTrack', '')
      if (last && tracks.value.some((t) => t.id === last)) {
        await loadTrack(last, { autoplay: false, restorePosition: true })
      }
      ready.value = true
    })()
    return _initPromise
  }

  function wireSession() {
    if (!_engine) return
    _engine.setActionHandlers({
      play: () => play(),
      pause: () => pause(),
      prev: () => prev(),
      next: () => next(),
      seekTo: (t) => seek(t),
    })
  }

  // ---------------- library: add / remove ----------------
  async function addFile(file, { autoplay = false } = {}) {
    if (!file) return null
    if (!isAudioInput(file.name, file.type) && !String(file.type).startsWith('audio')) {
      if (!String(file.type).startsWith('audio') && !isAudioInput(file.name, file.type)) return null
    }
    if (exceedsCap(cacheBytes.value, file.size, cacheCap.value)) return { error: 'cap' }

    busy.value = true
    try {
      let meta = {}
      try {
        const { readTags } = await import('./metadata')
        const tags = await readTags(file)
        meta = { title: tags.title, artist: tags.artist, album: tags.album, hasCover: tags.hasCover, coverUrl: tags.coverUrl }
      } catch { /* metadata best-effort */ }
      if (!meta.title) meta.title = titleFromName(file.name)

      const rec = makeTrack({ name: file.name, size: file.size, type: file.type, meta })
      // Seed the in-memory blob cache — loadTrack reads memory first, and without this a
      // freshly added local file had NO playable bytes anywhere in memory (the IDB write
      // below is fire-and-forget for playback purposes).
      _blobCache.set(rec.id, file)
      await db.putTrack(rec, file)
      tracks.value = [...tracks.value, rec]
      cacheBytes.value = totalSize(tracks.value)
      if (!activePlaylistId.value) queue.value = [...queue.value, rec.id]
      if (autoplay) await loadTrack(rec.id, { autoplay: true })
      return rec
    } finally {
      busy.value = false
    }
  }

  async function addFiles(fileList, opts = {}) {
    const added = []
    let first = true
    for (const f of Array.from(fileList || [])) {
      const rec = await addFile(f, { autoplay: opts.autoplay && first })
      if (rec && !rec.error) { added.push(rec); first = false }
    }
    return added
  }

  // PHASE 2: register a NCM song as a track record (metadata only — no bytes yet). `toLibrary`
  // marks it as an explicit library member: only "+"/import/download set it, so "play all" (which
  // registers records just to build a queue) leaves them out of the Files view. Re-adding an
  // existing track with toLibrary=true promotes it into the library.
  // Dedupes by ncmId in-memory (fast, no IDB round-trip that could hang).
  async function addNcmTrack(ncmSong, { toLibrary = false } = {}) {
    if (!ncmSong?.id) return null
    // Check in-memory tracks first (no IDB await — IDB can hang on v1→v2 upgrade blocked).
    const existing = tracks.value.find((t) => t.ncmId === String(ncmSong.id))
    if (existing) {
      if (toLibrary && !existing.inLibrary) {
        tracks.value = tracks.value.map((t) => (t.id === existing.id ? { ...t, inLibrary: true } : t))
        const promoted = tracks.value.find((t) => t.id === existing.id)
        // Flag-only update: putTrack would overwrite the whole row, and after a reload
        // _blobCache is empty — passing blob:null here used to wipe already-cached audio
        // bytes from IDB. updateTrackRecord preserves the stored blob; fall back to a
        // full put only when the row doesn't exist in IDB yet.
        db.updateTrackRecord(existing.id, { inLibrary: true })
          .then((ok) => { if (!ok) return db.putTrack({ ...promoted }, _blobCache.get(existing.id) || null) })
          .catch(() => {})
        return promoted
      }
      return existing
    }
    const rec = makeNcmTrack(ncmSong)
    if (!rec) return null
    if (toLibrary) rec.inLibrary = true
    tracks.value = [...tracks.value, rec]
    if (!activePlaylistId.value) queue.value = [...queue.value, rec.id]
    // Fire-and-forget persist — NEVER await.
    db.putTrack(rec, null).catch(() => {})
    return rec
  }

  // Resolve playable bytes for ANY track: memory cache first, then IndexedDB (local uploads and
  // previously cached NCM audio live there across reloads). The IDB read is guarded by a timeout
  // so a blocked v1→v2 upgrade degrades to "no bytes" instead of freezing the player. This is the
  // missing read-path that made every local track silently unplayable (loadTrack only ever looked
  // at the in-memory cache, which nothing populated for local files).
  async function getBlobFor(id) {
    const hit = _blobCache.get(id)
    if (hit) return hit
    try {
      const blob = await Promise.race([
        db.getTrackBlob(id),
        new Promise((resolve) => setTimeout(() => resolve(null), 4000)),
      ])
      if (blob) { _blobCache.set(id, blob); return blob }
    } catch { /* degrade to null */ }
    return null
  }

  // PHASE 2: ensure a track has bytes. For NCM tracks it fetches the audio stream into a Blob.
  // IMPORTANT: this function MUST NOT do any `await db.*` calls — IDB operations (openDb,
  // getTrackBlob, putTrack) can hang indefinitely when the v1→v2 upgrade is blocked by another
  // tab, which freezes the entire player. We use a pure in-memory blob cache instead. IDB
  // persistence happens fire-and-forget (`.catch(()=>{})`) so it never blocks playback.
  async function ensurePlayable(id, { background = false, br = 320000 } = {}) {
    const rec = tracks.value.find((t) => t.id === id)
    if (!rec) return false
    if (rec.source !== 'ncm') return !!_blobCache.get(id)
    if (_blobCache.has(id)) return true
    if (_prefetching.has(id)) return false
    _prefetching.add(id)
    if (!background) busy.value = true
    try {
      const resp = await fetch(`/api/music/stream/${rec.ncmId}?br=${br}`)
      if (!resp.ok) throw new Error(`stream failed (${resp.status})`)
      const blob = await resp.blob()
      if (!blob || !blob.size) throw new Error('empty blob')
      _blobCache.set(id, blob)
      // Bytes are on the device now (for resume/offline), but this does NOT put the track in the
      // library — only an explicit add does. So playing/prefetching an online song never pollutes
      // the local "Files" view. Persist the blob keyed to whatever inLibrary the record already has.
      tracks.value = tracks.value.map((t) => (t.id === id ? { ...t, size: blob.size } : t))
      cacheBytes.value = totalSize(tracks.value)
      const cur = tracks.value.find((t) => t.id === id) || rec
      // Fire-and-forget persist — NEVER await this (IDB may be blocked)
      db.putTrack({ ...cur, size: blob.size, blob }, blob).catch(() => {})
      return true
    } catch {
      return false
    } finally {
      _prefetching.delete(id)
      if (!background) busy.value = false
    }
  }

  // Import (download + add to library) a batch of NCM songs in the background. Bounded concurrency
  // (3 at a time) keeps it responsive without flooding the network; progress is reactive via
  // importState and it's cancellable via cancelImport(). Returns when done or cancelled.
  async function importNcmSongs(ncmSongs, { name = '', concurrency = 3 } = {}) {
    const songs = (ncmSongs || []).filter((s) => s?.id)
    if (!songs.length || importState.value.running) return
    _importCancel = false
    importState.value = { running: true, total: songs.length, done: 0, ok: 0, failed: 0, currentTitle: '', playlistName: name }
    let idx = 0
    async function worker() {
      while (!_importCancel && idx < songs.length) {
        const s = songs[idx++]
        importState.value = { ...importState.value, currentTitle: s.name || '' }
        try {
          const rec = await addNcmTrack(s, { toLibrary: true })
          const ok = rec && await ensurePlayable(rec.id, { background: true })
          importState.value = { ...importState.value, done: importState.value.done + 1, ok: importState.value.ok + (ok ? 1 : 0), failed: importState.value.failed + (ok ? 0 : 1) }
        } catch {
          importState.value = { ...importState.value, done: importState.value.done + 1, failed: importState.value.failed + 1 }
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, songs.length) }, worker))
    importState.value = { ...importState.value, running: false, currentTitle: '' }
  }
  function cancelImport() { _importCancel = true }

  async function removeTrack(id) {
    await db.deleteTrack(id)
    _blobCache.delete(id)
    tracks.value = tracks.value.filter((t) => t.id !== id)
    cacheBytes.value = totalSize(tracks.value)
    queue.value = removeFromList(queue.value, id)
    let changed = false
    playlists.value = playlists.value.map((p) => {
      if (p.trackIds.includes(id)) { changed = true; return { ...p, trackIds: removeFromList(p.trackIds, id) } }
      return p
    })
    if (changed) for (const p of playlists.value) await db.putPlaylist(p)
    if (currentId.value === id) {
      // Fully detach the deleted track: source, artwork, duration — not just pause.
      stop()
      if (_engine) _engine.setSource(null)
      currentId.value = ''
      duration.value = 0
      if (coverUrl.value.startsWith('blob:')) { try { URL.revokeObjectURL(coverUrl.value) } catch { /* ignore */ } }
      coverUrl.value = ''
    }
  }

  async function clearCache() {
    await db.clearTracks()
    stop()
    if (_engine) _engine.setSource(null)
    _blobCache.clear()
    tracks.value = []
    queue.value = []
    currentId.value = ''
    duration.value = 0
    if (coverUrl.value.startsWith('blob:')) { try { URL.revokeObjectURL(coverUrl.value) } catch { /* ignore */ } }
    coverUrl.value = ''
    cacheBytes.value = 0
    playlists.value = playlists.value.map((p) => ({ ...p, trackIds: [] }))
    for (const p of playlists.value) await db.putPlaylist(p)
  }

  async function setCacheCap(bytes) {
    cacheCap.value = Math.max(50 * 1024 * 1024, Number(bytes) || DEFAULT_CACHE_CAP)
    await db.kvSet('cacheCap', cacheCap.value)
  }

  // Play an NCM song as a PREVIEW — NOT added to the library. Used when the user clicks ▶ on a
  // search result. Only an explicit "add to library" action persists the record.
  async function playNcmPreview(ncmSong, br = 320000) {
    if (!_engine) return false
    const rec = makeNcmTrack(ncmSong)
    if (!rec) return false
    const seq = ++_loadSeq   // same rapid-click guard as loadTrack — the latest request wins
    // Commit the track IDENTITY up-front (before the network fetch) so the mini player + now-playing
    // appear INSTANTLY with a buffering spinner, cover, and title — instead of nothing until the
    // whole blob has downloaded. Playback starts once the bytes arrive.
    persistPosition()
    previewRec.value = rec
    currentId.value = rec.id
    duration.value = rec.duration || 0
    currentTime.value = 0
    abStart.value = null; abEnd.value = null
    buffering.value = true
    isPlaying.value = true            // optimistic: the transport reads as "playing (buffering)"
    if (_engine) _engine.setSource(null)
    coverUrl.value = rec.coverUrl || ''
    updateSessionMetadata()
    loadCoverAndLyrics(rec.id, null, rec).catch(() => {})
    try {
      const resp = await fetch(`/api/music/stream/${rec.ncmId}?br=${br}`)
      if (!resp.ok) { if (seq === _loadSeq) { buffering.value = false; isPlaying.value = false } return false }
      const blob = await resp.blob()
      if (!blob?.size) { if (seq === _loadSeq) { buffering.value = false; isPlaying.value = false } return false }
      if (seq !== _loadSeq) return true // superseded while streaming — drop silently, no failure toast
      _blobCache.set(rec.id, blob)
      _engine.setSource(blob)
      _engine.play()
      isPlaying.value = true
      schedulePrefetch()
      return true
    } catch {
      if (seq === _loadSeq) { buffering.value = false; isPlaying.value = false }
      return false
    }
  }

  // ---------------- playback ----------------
  // Returns true when playback (or a paused load) actually started, false when no bytes could be
  // resolved — callers surface a toast on false instead of failing silently.
  async function loadTrack(id, { autoplay = true, restorePosition = false } = {}) {
    const rec = tracks.value.find((t) => t.id === id)
    if (!rec || !_engine) return false
    // Rapid-click guard: every call claims a sequence number; anything awaited below may lose
    // the race to a newer click, in which case the stale call must NOT commit (otherwise a slow
    // NCM fetch that resolves late flips playback back to the earlier track).
    const seq = ++_loadSeq
    if (!queue.value.includes(id)) {
      queue.value = activeTracks.value.map((t) => t.id)
      if (!queue.value.includes(id)) queue.value = [...queue.value, id]
    }
    persistPosition() // fire-and-forget (NOT awaited — IDB can hang)

    // Bytes: memory → IndexedDB (local uploads / cached NCM) → NCM stream fetch.
    let blob = await getBlobFor(id)
    if (!blob && rec.source === 'ncm') {
      busy.value = true
      const ok = await ensurePlayable(id, { background: false })
      busy.value = false
      if (!ok) return false
      blob = _blobCache.get(id)
    }
    if (!blob) return false
    // Superseded by a newer click, or the track was deleted while its bytes loaded.
    if (seq !== _loadSeq || !tracks.value.some((t) => t.id === id)) return false

    currentId.value = id
    duration.value = rec.duration || 0
    currentTime.value = 0
    abStart.value = null; abEnd.value = null
    buffering.value = true               // cleared by the engine's 'canplay'/'playing' event
    _engine.setSource(blob)
    // Cover + lyrics: fire-and-forget, never block playback.
    loadCoverAndLyrics(id, blob, rec).catch(() => {})
    db.kvSet('lastTrack', id).catch(() => {})
    updateSessionMetadata()
    const startAt = restorePosition ? (_positions[id] || 0) : 0
    if (startAt > 0) {
      // One-shot resume seek, guarded against a track change racing the 'loaded' event —
      // without the guard the stale handler seeked the NEXT track to the old position.
      const onLoaded = _engine.on('loaded', () => { if (currentId.value === id) _engine.seek(startAt); onLoaded() })
    }
    if (autoplay) { _engine.play(); isPlaying.value = true }
    schedulePrefetch()
    return true
  }

  async function loadCoverAndLyrics(id, blob, rec) {
    // Cover
    if (coverUrl.value && coverUrl.value.startsWith('blob:')) {
      try { URL.revokeObjectURL(coverUrl.value) } catch { /* ignore */ }
      coverUrl.value = ''
    }
    if (rec?.source === 'ncm' && rec.coverUrl) {
      coverUrl.value = rec.coverUrl
    } else if (blob) {
      // Local: ID3 best-effort (don't block)
      import('./metadata').then(({ readTags }) => readTags(blob).then(tags => { if (tags.coverUrl) coverUrl.value = tags.coverUrl }).catch(() => {})).catch(() => {})
    }

    // Lyrics: for NCM tracks, fetch DIRECTLY from the API (skip IDB read — it can hang).
    liveLyrics.value = { original: '', translation: '', romaji: '', yrc: '' }
    lyricsLoading.value = true
    if (rec?.source === 'ncm' && rec.ncmId) {
      try {
        const resp = await fetch(`/api/music/lyric/${rec.ncmId}`)
        if (resp.ok) {
          const fresh = await resp.json()
          const fields = {
            original: fresh?.lrc?.lyric || '',
            translation: fresh?.tlyric?.lyric || '',
            romaji: fresh?.romalrc?.lyric || '',
            yrc: fresh?.yrc?.lyric || '',
          }
          liveLyrics.value = fields
          db.setLyricsField(id, fields).catch(() => {})
        }
      } catch { /* best-effort */ } finally { lyricsLoading.value = false }
    } else {
      // Local track: try IDB lyrics (fire-and-forget)
      db.getLyricsBundle(id).then(bundle => {
        if (bundle?.original) liveLyrics.value = { ...liveLyrics.value, original: bundle.original }
      }).catch(() => {}).finally(() => { lyricsLoading.value = false })
    }
  }

  function play() { if (_engine) { _engine.play(); isPlaying.value = true } }
  function pause() { if (_engine) { _engine.pause(); isPlaying.value = false } }
  function toggle() { if (isPlaying.value) pause(); else if (currentId.value) play(); else if (queue.value.length) loadTrack(queue.value[0]) }
  function stop() { if (_engine) { _engine.pause(); } isPlaying.value = false; currentTime.value = 0 }
  function seek(sec) { if (_engine) { _engine.seek(sec); currentTime.value = Math.max(0, sec) } }
  function seekRatio(r) { const d = duration.value; if (d) seek(Math.max(0, Math.min(1, r)) * d) }

  function setVolume(v) {
    volume.value = Math.max(0, Math.min(1, Number(v) || 0))
    if (_engine) _engine.setVolume(volume.value)
    persistKv('volume', volume.value)
  }
  function setRate(r) {
    rate.value = Number(r) || 1
    if (_engine) _engine.setRate(rate.value)
    persistKv('rate', rate.value)
  }
  function toggleShuffle() { shuffle.value = !shuffle.value; persistKv('shuffle', shuffle.value) }
  function cycleRepeat() {
    repeat.value = repeat.value === 'off' ? 'all' : repeat.value === 'all' ? 'one' : 'off'
    persistKv('repeat', repeat.value)
  }

  function next() {
    const i = calcNext({ length: queue.value.length, current: currentIndex.value, repeat: repeat.value, shuffle: shuffle.value })
    if (i < 0) { stop(); return }
    loadTrack(queue.value[i], { autoplay: true })
  }
  function prev() {
    if (currentTime.value > 3 && currentId.value) { seek(0); return }
    const i = calcPrev({ length: queue.value.length, current: currentIndex.value, repeat: repeat.value, shuffle: shuffle.value })
    if (i < 0) return
    loadTrack(queue.value[i], { autoplay: true })
  }
  function onEnded() {
    persistPosition(0)
    next()
  }

  // ---- A–B repeat ----
  function setA() { abStart.value = currentTime.value }
  function setB() { if (abStart.value != null && currentTime.value > abStart.value) abEnd.value = currentTime.value }
  function clearAB() { abStart.value = null; abEnd.value = null }
  function enforceAB(t) {
    if (abStart.value != null && abEnd.value != null && t >= abEnd.value) seek(abStart.value)
  }

  // ---------------- queue / reorder ----------------
  function reorderQueue(from, to) { queue.value = moveItem(queue.value, from, to) }
  // Reorder the VISIBLE collection (library drag & drop). The old code reordered the play queue,
  // which the list doesn't render — the drag appeared to do nothing. In a playlist this reorders
  // its trackIds (persisted); in the full library it reorders tracks + persists the custom order.
  // The play queue follows the new order.
  function reorderTracks(from, to) {
    if (activePlaylistId.value) {
      const pl = playlists.value.find((p) => p.id === activePlaylistId.value)
      if (!pl) return
      const ids = moveItem(pl.trackIds, from, to)
      playlists.value = playlists.value.map((p) => (p.id === pl.id ? { ...p, trackIds: ids } : p))
      db.putPlaylist({ ...pl, trackIds: ids }).catch(() => {})
    } else {
      tracks.value = moveItem(tracks.value, from, to)
      persistKv('trackOrder', tracks.value.map((t) => t.id))
    }
    queue.value = activeTracks.value.map((t) => t.id)
  }
  function playFromActive(id) {
    queue.value = activeTracks.value.map((t) => t.id)
    return loadTrack(id, { autoplay: true })
  }
  // PHASE 2: play an arbitrary track id, ensuring it's in the queue first. Used by the NCM
  // search panel ("play this search hit now") without forcing it into the library.
  function playTrack(id, { contextQueue } = {}) {
    if (contextQueue && Array.isArray(contextQueue)) queue.value = contextQueue.slice()
    else if (!queue.value.includes(id)) queue.value = [...queue.value, id]
    loadTrack(id, { autoplay: true })
  }

  // ---------------- playlists ----------------
  async function createPlaylist(name) {
    const pl = makePlaylist({ name: name || 'New Playlist' })
    playlists.value = [...playlists.value, pl]
    await db.putPlaylist(pl)
    return pl
  }
  async function renamePlaylist(id, name) {
    playlists.value = playlists.value.map((p) => (p.id === id ? { ...p, name } : p))
    const pl = playlists.value.find((p) => p.id === id)
    if (pl) { await db.putPlaylist(pl) }
  }
  async function deletePlaylistById(id) {
    playlists.value = playlists.value.filter((p) => p.id !== id)
    if (activePlaylistId.value === id) activePlaylistId.value = ''
    await db.deletePlaylist(id)
  }
  async function addTrackToPlaylist(playlistId, trackId) {
    playlists.value = playlists.value.map((p) => (p.id === playlistId ? { ...p, trackIds: addId(p.trackIds, trackId) } : p))
    const pl = playlists.value.find((p) => p.id === playlistId)
    if (pl) { await db.putPlaylist(pl) }
  }
  async function removeTrackFromPlaylist(playlistId, trackId) {
    playlists.value = playlists.value.map((p) => (p.id === playlistId ? { ...p, trackIds: removeFromList(p.trackIds, trackId) } : p))
    const pl = playlists.value.find((p) => p.id === playlistId)
    if (pl) { await db.putPlaylist(pl) }
  }
  function setActivePlaylist(id) {
    activePlaylistId.value = id || ''
    queue.value = activeTracks.value.map((t) => t.id)
  }

  // ---------------- metadata editing ----------------
  async function updateMetadata(id, patch) {
    tracks.value = tracks.value.map((t) => (t.id === id ? { ...t, ...patch } : t))
    await db.updateTrackRecord(id, patch)
    if (id === currentId.value) updateSessionMetadata()
  }

  async function exportTagged(id) {
    const rec = tracks.value.find((t) => t.id === id)
    const blob = await db.getTrackBlob(id)
    if (!rec || !blob) return null
    const file = new File([blob], rec.name, { type: rec.type || blob.type })
    const { writeTags } = await import('./audioRunner')
    return writeTags(file, { title: rec.title, artist: rec.artist, album: rec.album })
  }

  // ---------------- lyrics ----------------
  async function setLyricsForCurrent(text) {
    if (!currentId.value) return
    await db.setLyrics(currentId.value, text || '')
    liveLyrics.value = { ...liveLyrics.value, original: text || '' }
  }

  // PHASE 2: persist a structured lyric field for the current track (translation / romaji / yrc).
  async function setLyricsField(field, text) {
    if (!currentId.value) return
    await db.setLyricsField(currentId.value, { [field]: text || '' })
    liveLyrics.value = { ...liveLyrics.value, [field]: text || '' }
  }

  // ---------------- session metadata ----------------
  function updateSessionMetadata() {
    if (!_engine) return
    const t = currentTrack.value
    if (!t) return
    _engine.setMetadata({ title: t.title, artist: t.artist, album: t.album, artworkUrl: coverUrl.value || '' })
  }

  // ---------------- PHASE 2: prefetch the next track + lyrics ----------------
  // Called after every successful loadTrack. Finds the next track in the queue and warms its
  // bytes + lyrics in the background so the user gets instant playback + instant lyrics.
  function schedulePrefetch() {
    const i = calcNext({ length: queue.value.length, current: currentIndex.value, repeat: repeat.value, shuffle: shuffle.value })
    if (i < 0) { prefetchState.value = 'idle'; return }
    const nextId = queue.value[i]
    const nextRec = tracks.value.find((t) => t.id === nextId)
    if (!nextRec) { prefetchState.value = 'idle'; return }
    if (nextRec.source !== 'ncm') { prefetchState.value = 'cached'; return } // local tracks already have bytes
    ;(async () => {
      try {
        // Memory cache only (skip IDB — it can hang).
        if (_blobCache.has(nextId)) { prefetchState.value = 'cached'; return }
        prefetchState.value = 'fetching'
        // Pre-cache lyrics via direct API fetch (skip IDB).
        try {
          const lrcResp = await fetch(`/api/music/lyric/${nextRec.ncmId}`)
          if (lrcResp.ok) {
            const fresh = await lrcResp.json()
            db.setLyricsField(nextId, {
              original: fresh?.lrc?.lyric || '',
              translation: fresh?.tlyric?.lyric || '',
              romaji: fresh?.romalrc?.lyric || '',
              yrc: fresh?.yrc?.lyric || '',
            }).catch(() => {})
          }
        } catch { /* lyrics prefetch is best-effort */ }
        const ok = await ensurePlayable(nextId, { background: true })
        prefetchState.value = ok ? 'cached' : 'error'
      } catch {
        prefetchState.value = 'error'
      }
    })()
  }

  // Fire-and-forget persistence helpers — NEVER await these (IDB can hang on blocked upgrade).
  function persistKv(key, value) { db.kvSet(key, value).catch(() => {}) }
  function persistPosition(forced) {
    if (!currentId.value) return
    const pos = forced != null ? forced : currentTime.value
    _positions[currentId.value] = pos
    db.setPosition(currentId.value, pos).catch(() => {})
  }

  return {
    // state
    tracks, playlists, activePlaylistId, queue, currentId, isPlaying, currentTime, duration,
    volume, rate, shuffle, repeat, abStart, abEnd, search, coverUrl, cacheBytes,
    cacheCap, ready, busy, buffering, importState, liveLyrics, lyricsLoading, prefetchState, previewRec,
    libSource, libNcmPlaylist,
    // derived
    currentTrack, currentIndex, activeTracks, libraryTracks, cacheUsedPct, isCurrentNcm,
    // lifecycle
    init,
    // library
    addFile, addFiles, addNcmTrack, playNcmPreview, ensurePlayable, getBlobFor, removeTrack, clearCache, setCacheCap,
    importNcmSongs, cancelImport,
    // playback
    loadTrack, play, pause, toggle, stop, seek, seekRatio, setVolume, setRate,
    toggleShuffle, cycleRepeat, next, prev, playTrack,
    setA, setB, clearAB,
    // queue
    reorderQueue, reorderTracks, playFromActive,
    // playlists
    createPlaylist, renamePlaylist, deletePlaylistById, addTrackToPlaylist, removeTrackFromPlaylist, setActivePlaylist,
    // metadata + lyrics
    updateMetadata, exportTagged, setLyricsForCurrent, setLyricsField,
  }
}
