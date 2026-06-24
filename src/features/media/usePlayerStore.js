// The music PLAYER store — a module-singleton composable holding all reactive player state and
// orchestrating the audio engine + IndexedDB persistence + metadata + lyrics. Shared across the
// mini-player, Now-Playing, library/queue and lyrics views so playback is continuous across the
// audio sub-tabs.
//
// SSG-SAFETY: only `ref()`s are created at module scope (safe). Nothing touches Audio/IndexedDB/
// window until init() is called from a client onMounted. All heavy modules (engine, db, metadata)
// are reached via dynamic import() inside actions.
import { ref, computed } from 'vue'
import {
  makeTrack, makePlaylist, moveItem, nextIndex as calcNext, prevIndex as calcPrev,
  totalSize, exceedsCap, DEFAULT_CACHE_CAP, addToPlaylist as addId, removeFromList,
  titleFromName, uid,
} from './playerHelpers'
import { isAudioInput } from './mediaHelpers'
import { parseEmbed } from './embed'

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
const lyricsText = ref('')          // raw .lrc/text for the current track
const coverUrl = ref('')            // object URL of current track cover (or '')
const cacheBytes = ref(0)
const cacheCap = ref(DEFAULT_CACHE_CAP)
const ready = ref(false)            // init() finished (IndexedDB hydrated)
const busy = ref(false)             // a long op (metadata read / import) in flight

// ONLINE entries: official-embed players (NetEase/Bilibili/YouTube). These are NOT files — they are
// just the platform's own iframe URL + a user label. They can't be edited/cached/converted; we only
// store the embed descriptor. currentEmbedId selects one to show its official iframe player.
const embeds = ref([])              // [{ id, platform, kind, embedId, embedUrl, title, addedAt }]
const currentEmbedId = ref('')      // id of the selected online entry ('' = none)

let _engine = null
let _initPromise = null
let _positions = {}                 // trackId -> seconds (resume points), mirrored to db

// ---- derived ----
const currentTrack = computed(() => tracks.value.find((t) => t.id === currentId.value) || null)
const currentIndex = computed(() => queue.value.indexOf(currentId.value))
const activeTracks = computed(() => {
  if (!activePlaylistId.value) return tracks.value
  const pl = playlists.value.find((p) => p.id === activePlaylistId.value)
  if (!pl) return tracks.value
  const byId = new Map(tracks.value.map((t) => [t.id, t]))
  return pl.trackIds.map((id) => byId.get(id)).filter(Boolean)
})
const cacheUsedPct = computed(() => Math.min(100, Math.round((cacheBytes.value / (cacheCap.value || 1)) * 100)))
const currentEmbed = computed(() => embeds.value.find((e) => e.id === currentEmbedId.value) || null)

export function usePlayerStore() {
  // ---------------- init / hydrate ----------------
  async function init() {
    if (_initPromise) return _initPromise
    _initPromise = (async () => {
      const engineMod = await import('./audioEngine')
      _engine = engineMod.getEngine()
      const db = await import('./mediaDb')

      // Hydrate persisted state.
      tracks.value = await db.listTrackRecords()
      playlists.value = await db.listPlaylists()
      _positions = await db.getPositions()
      cacheBytes.value = totalSize(tracks.value)
      const savedVol = await db.kvGet('volume', 1)
      volume.value = typeof savedVol === 'number' ? savedVol : 1
      const savedRate = await db.kvGet('rate', 1)
      rate.value = typeof savedRate === 'number' ? savedRate : 1
      shuffle.value = !!(await db.kvGet('shuffle', false))
      repeat.value = (await db.kvGet('repeat', 'off')) || 'off'
      const cap = await db.kvGet('cacheCap', DEFAULT_CACHE_CAP)
      cacheCap.value = typeof cap === 'number' ? cap : DEFAULT_CACHE_CAP
      embeds.value = (await db.kvGet('embeds', [])) || []

      // Wire the engine.
      if (_engine) {
        _engine.setVolume(volume.value)
        _engine.setRate(rate.value)
        _engine.on('time', (t, d) => {
          currentTime.value = t || 0
          if (d && isFinite(d)) duration.value = d
          enforceAB(t)
        })
        _engine.on('play', () => { isPlaying.value = true })
        _engine.on('pause', () => { isPlaying.value = false; persistPosition() })
        _engine.on('ended', () => { onEnded() })
        _engine.on('loaded', (d) => { if (d && isFinite(d)) duration.value = d; _engine.setPositionState() })
        wireSession()
      }

      // Default the queue to the library order; restore last track (paused).
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
  // Add a File to the library: read metadata, persist blob+record to IndexedDB, update state.
  // Returns the new track record (or null if rejected / over cap).
  async function addFile(file, { autoplay = false } = {}) {
    if (!file) return null
    if (!isAudioInput(file.name, file.type) && !String(file.type).startsWith('audio')) {
      // Allow anything audio-ish; reject obvious non-audio silently-ish (caller can toast).
      if (!String(file.type).startsWith('audio') && !isAudioInput(file.name, file.type)) return null
    }
    if (exceedsCap(cacheBytes.value, file.size, cacheCap.value)) return { error: 'cap' }

    busy.value = true
    try {
      let meta = {}
      try {
        const { readTags } = await import('./metadata')
        const tags = await readTags(file)
        meta = { title: tags.title, artist: tags.artist, album: tags.album, hasCover: tags.hasCover }
        if (tags.coverUrl) { try { URL.revokeObjectURL(tags.coverUrl) } catch { /* ignore */ } }
      } catch { /* metadata best-effort */ }
      if (!meta.title) meta.title = titleFromName(file.name)

      const rec = makeTrack({ name: file.name, size: file.size, type: file.type, meta })
      const db = await import('./mediaDb')
      await db.putTrack(rec, file)
      tracks.value = [...tracks.value, rec]
      cacheBytes.value = totalSize(tracks.value)
      // Keep queue in sync if we're on the library view.
      if (!activePlaylistId.value) queue.value = [...queue.value, rec.id]
      if (autoplay) await loadTrack(rec.id, { autoplay: true })
      return rec
    } finally {
      busy.value = false
    }
  }

  // Add several files (drag-drop multiple). Returns the records added.
  async function addFiles(fileList, opts = {}) {
    const added = []
    let first = true
    for (const f of Array.from(fileList || [])) {
      const rec = await addFile(f, { autoplay: opts.autoplay && first })
      if (rec && !rec.error) { added.push(rec); first = false }
    }
    return added
  }

  async function removeTrack(id) {
    const db = await import('./mediaDb')
    await db.deleteTrack(id)
    tracks.value = tracks.value.filter((t) => t.id !== id)
    cacheBytes.value = totalSize(tracks.value)
    queue.value = removeFromList(queue.value, id)
    // Drop from playlists too.
    let changed = false
    playlists.value = playlists.value.map((p) => {
      if (p.trackIds.includes(id)) { changed = true; return { ...p, trackIds: removeFromList(p.trackIds, id) } }
      return p
    })
    if (changed) for (const p of playlists.value) await db.putPlaylist(p)
    if (currentId.value === id) { stop(); currentId.value = '' }
  }

  async function clearCache() {
    const db = await import('./mediaDb')
    await db.clearTracks()
    stop()
    tracks.value = []
    queue.value = []
    currentId.value = ''
    cacheBytes.value = 0
    // Clear playlists' track references (keep the playlists themselves empty).
    playlists.value = playlists.value.map((p) => ({ ...p, trackIds: [] }))
    for (const p of playlists.value) await db.putPlaylist(p)
  }

  async function setCacheCap(bytes) {
    cacheCap.value = Math.max(50 * 1024 * 1024, Number(bytes) || DEFAULT_CACHE_CAP)
    const db = await import('./mediaDb')
    await db.kvSet('cacheCap', cacheCap.value)
  }

  // ---------------- playback ----------------
  // Load a track by id into the engine. Optionally autoplay / restore its saved position.
  async function loadTrack(id, { autoplay = true, restorePosition = false } = {}) {
    const rec = tracks.value.find((t) => t.id === id)
    if (!rec || !_engine) return
    // Ensure this id is in the active queue (so prev/next work from the library or a playlist).
    if (!queue.value.includes(id)) {
      queue.value = activeTracks.value.map((t) => t.id)
      if (!queue.value.includes(id)) queue.value = [...queue.value, id]
    }
    persistPosition() // save the OUTGOING track's position first
    currentEmbedId.value = '' // switching to a local file → leave any online (iframe) view
    const db = await import('./mediaDb')
    const blob = await db.getTrackBlob(id)
    if (!blob) return
    currentId.value = id
    duration.value = rec.duration || 0
    currentTime.value = 0
    abStart.value = null; abEnd.value = null
    _engine.setSource(blob)
    await loadCoverAndLyrics(id, blob)
    await db.kvSet('lastTrack', id)
    updateSessionMetadata()
    const startAt = restorePosition ? (_positions[id] || 0) : 0
    if (startAt > 0) { const onLoaded = _engine.on('loaded', () => { _engine.seek(startAt); onLoaded() }) }
    if (autoplay) { _engine.play(); isPlaying.value = true }
  }

  async function loadCoverAndLyrics(id, blob) {
    // Cover from ID3 (best-effort); revoke any previous URL.
    if (coverUrl.value) { try { URL.revokeObjectURL(coverUrl.value) } catch { /* ignore */ } coverUrl.value = '' }
    try {
      const { readTags } = await import('./metadata')
      const tags = await readTags(blob)
      if (tags.coverUrl) coverUrl.value = tags.coverUrl
      // Backfill duration/title if missing.
      const rec = tracks.value.find((t) => t.id === id)
      if (rec && tags && (tags.title || tags.artist || tags.album)) {
        // don't overwrite user edits silently; only fill blanks
      }
    } catch { /* ignore */ }
    // Lyrics from db.
    try {
      const db = await import('./mediaDb')
      lyricsText.value = await db.getLyrics(id)
    } catch { lyricsText.value = '' }
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
    // If we're more than 3s in, restart the current track (familiar behavior); else go back.
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
  function playFromActive(id) {
    // Start playing `id`, using the active view (library/playlist) as the queue.
    queue.value = activeTracks.value.map((t) => t.id)
    loadTrack(id, { autoplay: true })
  }

  // ---------------- playlists ----------------
  async function createPlaylist(name) {
    const pl = makePlaylist({ name: name || 'New Playlist' })
    playlists.value = [...playlists.value, pl]
    const db = await import('./mediaDb')
    await db.putPlaylist(pl)
    return pl
  }
  async function renamePlaylist(id, name) {
    playlists.value = playlists.value.map((p) => (p.id === id ? { ...p, name } : p))
    const pl = playlists.value.find((p) => p.id === id)
    if (pl) { const db = await import('./mediaDb'); await db.putPlaylist(pl) }
  }
  async function deletePlaylistById(id) {
    playlists.value = playlists.value.filter((p) => p.id !== id)
    if (activePlaylistId.value === id) activePlaylistId.value = ''
    const db = await import('./mediaDb')
    await db.deletePlaylist(id)
  }
  async function addTrackToPlaylist(playlistId, trackId) {
    playlists.value = playlists.value.map((p) => (p.id === playlistId ? { ...p, trackIds: addId(p.trackIds, trackId) } : p))
    const pl = playlists.value.find((p) => p.id === playlistId)
    if (pl) { const db = await import('./mediaDb'); await db.putPlaylist(pl) }
  }
  async function removeTrackFromPlaylist(playlistId, trackId) {
    playlists.value = playlists.value.map((p) => (p.id === playlistId ? { ...p, trackIds: removeFromList(p.trackIds, trackId) } : p))
    const pl = playlists.value.find((p) => p.id === playlistId)
    if (pl) { const db = await import('./mediaDb'); await db.putPlaylist(pl) }
  }
  function setActivePlaylist(id) {
    activePlaylistId.value = id || ''
    queue.value = activeTracks.value.map((t) => t.id)
  }

  // ---------------- metadata editing ----------------
  async function updateMetadata(id, patch) {
    tracks.value = tracks.value.map((t) => (t.id === id ? { ...t, ...patch } : t))
    const db = await import('./mediaDb')
    await db.updateTrackRecord(id, patch)
    if (id === currentId.value) updateSessionMetadata()
  }

  // Export a tagged copy of a track (re-encode via ffmpeg with new ID3 tags). Returns a Blob.
  async function exportTagged(id) {
    const rec = tracks.value.find((t) => t.id === id)
    const db = await import('./mediaDb')
    const blob = await db.getTrackBlob(id)
    if (!rec || !blob) return null
    const file = new File([blob], rec.name, { type: rec.type || blob.type })
    const { writeTags } = await import('./audioRunner')
    return writeTags(file, { title: rec.title, artist: rec.artist, album: rec.album })
  }

  // ---------------- lyrics ----------------
  async function setLyricsForCurrent(text) {
    lyricsText.value = text || ''
    if (!currentId.value) return
    const db = await import('./mediaDb')
    await db.setLyrics(currentId.value, lyricsText.value)
  }

  // ---------------- session metadata ----------------
  function updateSessionMetadata() {
    if (!_engine) return
    const t = currentTrack.value
    if (!t) return
    _engine.setMetadata({ title: t.title, artist: t.artist, album: t.album, artworkUrl: coverUrl.value || '' })
  }

  // ---------------- ONLINE entries (official embeds) ----------------
  // Add an online entry from a pasted share link. Validates + parses to an OFFICIAL embed URL only
  // (parseEmbed returns null for anything unsupported). No file/blob — just the iframe descriptor.
  // Returns the new entry, or { error:'unsupported' } / { error:'dup' }.
  async function addEmbed(link, label) {
    const parsed = parseEmbed(link)
    if (!parsed) return { error: 'unsupported' }
    if (embeds.value.some((e) => e.embedUrl === parsed.embedUrl)) {
      const existing = embeds.value.find((e) => e.embedUrl === parsed.embedUrl)
      selectEmbed(existing.id)
      return { error: 'dup', entry: existing }
    }
    const entry = {
      id: uid('emb'),
      platform: parsed.platform,
      kind: parsed.kind,
      embedId: parsed.id,
      embedUrl: parsed.embedUrl,
      title: (label && label.trim()) || parsed.title,
      addedAt: Date.now(),
    }
    embeds.value = [...embeds.value, entry]
    await persistKv('embeds', embeds.value)
    selectEmbed(entry.id)
    return entry
  }
  function selectEmbed(id) {
    // Showing an online (iframe) player: pause our own audio so the two don't talk over each other.
    if (id) { pause(); currentEmbedId.value = id }
    else currentEmbedId.value = ''
  }
  async function removeEmbed(id) {
    embeds.value = embeds.value.filter((e) => e.id !== id)
    if (currentEmbedId.value === id) currentEmbedId.value = ''
    await persistKv('embeds', embeds.value)
  }
  async function renameEmbed(id, title) {
    embeds.value = embeds.value.map((e) => (e.id === id ? { ...e, title } : e))
    await persistKv('embeds', embeds.value)
  }

  // ---------------- persistence helpers ----------------
  async function persistKv(key, value) { try { const db = await import('./mediaDb'); await db.kvSet(key, value) } catch { /* ignore */ } }
  async function persistPosition(forced) {
    if (!currentId.value) return
    const pos = forced != null ? forced : currentTime.value
    _positions[currentId.value] = pos
    try { const db = await import('./mediaDb'); await db.setPosition(currentId.value, pos) } catch { /* ignore */ }
  }

  return {
    // state
    tracks, playlists, activePlaylistId, queue, currentId, isPlaying, currentTime, duration,
    volume, rate, shuffle, repeat, abStart, abEnd, search, lyricsText, coverUrl, cacheBytes,
    cacheCap, ready, busy, embeds, currentEmbedId,
    // derived
    currentTrack, currentIndex, activeTracks, cacheUsedPct, currentEmbed,
    // lifecycle
    init,
    // library
    addFile, addFiles, removeTrack, clearCache, setCacheCap,
    // online embeds
    addEmbed, selectEmbed, removeEmbed, renameEmbed,
    // playback
    loadTrack, play, pause, toggle, stop, seek, seekRatio, setVolume, setRate,
    toggleShuffle, cycleRepeat, next, prev,
    setA, setB, clearAB,
    // queue
    reorderQueue, playFromActive,
    // playlists
    createPlaylist, renamePlaylist, deletePlaylistById, addTrackToPlaylist, removeTrackFromPlaylist, setActivePlaylist,
    // metadata + lyrics
    updateMetadata, exportTagged, setLyricsForCurrent,
  }
}
