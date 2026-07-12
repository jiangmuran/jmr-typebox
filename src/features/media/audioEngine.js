// Singleton HTMLAudioElement engine for the player. ONE <audio> element drives all playback (mini-
// player + Now-Playing share it), so audio keeps going across the audio sub-tabs and route changes.
// Also wires the MediaSession API (lock-screen / notification controls + metadata + artwork).
//
// SSG-SAFETY: nothing here runs at import. `getEngine()` lazily creates the element on first call
// (always from a client onMounted/handler). All DOM/Audio/navigator access is inside functions.

let _engine = null

function createEngine() {
  const audio = new Audio()
  audio.preload = 'metadata'
  // Callbacks the store subscribes to (single consumer, but kept as a small fan-out for safety).
  const handlers = {
    time: new Set(),     // (currentTime, duration)
    play: new Set(),     // ()
    pause: new Set(),    // ()
    ended: new Set(),    // ()
    loaded: new Set(),   // (duration)
    error: new Set(),    // (err)
    buffering: new Set(),// (isBuffering) — true on stall/waiting, false once playable
  }
  const fire = (set, ...args) => { for (const fn of set) { try { fn(...args) } catch { /* ignore */ } } }

  audio.addEventListener('timeupdate', () => fire(handlers.time, audio.currentTime, audio.duration))
  audio.addEventListener('durationchange', () => fire(handlers.time, audio.currentTime, audio.duration))
  audio.addEventListener('play', () => { fire(handlers.play); setSessionState('playing') })
  audio.addEventListener('pause', () => { fire(handlers.pause); setSessionState('paused') })
  audio.addEventListener('ended', () => fire(handlers.ended))
  audio.addEventListener('loadedmetadata', () => fire(handlers.loaded, audio.duration))
  audio.addEventListener('error', () => { fire(handlers.buffering, false); fire(handlers.error, audio.error) })
  // Buffering: 'waiting'/'stalled' → the transport is waiting on data; 'playing'/'canplay' → ready.
  // Drives a spinner on the play button so a slow NCM stream / mid-track stall is visible.
  audio.addEventListener('waiting', () => fire(handlers.buffering, true))
  audio.addEventListener('stalled', () => fire(handlers.buffering, true))
  audio.addEventListener('playing', () => fire(handlers.buffering, false))
  audio.addEventListener('canplay', () => fire(handlers.buffering, false))

  let curObjectUrl = null
  function setSource(blobOrUrl) {
    revokeSource()
    if (!blobOrUrl) { audio.removeAttribute('src'); audio.load(); return }
    if (typeof blobOrUrl === 'string') {
      audio.src = blobOrUrl
    } else {
      curObjectUrl = URL.createObjectURL(blobOrUrl)
      audio.src = curObjectUrl
    }
    audio.load()
  }
  function revokeSource() {
    if (curObjectUrl) { try { URL.revokeObjectURL(curObjectUrl) } catch { /* ignore */ } curObjectUrl = null }
  }

  function on(event, fn) {
    const set = handlers[event]
    if (!set) return () => {}
    set.add(fn)
    return () => set.delete(fn)
  }

  // ---- MediaSession (lock screen / media keys) ----
  function hasSession() { return typeof navigator !== 'undefined' && 'mediaSession' in navigator }
  function setSessionState(state) { if (hasSession()) { try { navigator.mediaSession.playbackState = state } catch { /* ignore */ } } }
  function setMetadata({ title, artist, album, artworkUrl } = {}) {
    if (!hasSession() || typeof MediaMetadata === 'undefined') return
    try {
      const artwork = artworkUrl
        ? [96, 192, 512].map((s) => ({ src: artworkUrl, sizes: `${s}x${s}`, type: 'image/png' }))
        : []
      navigator.mediaSession.metadata = new MediaMetadata({ title: title || '', artist: artist || '', album: album || '', artwork })
    } catch { /* ignore */ }
  }
  function setActionHandlers({ play, pause, prev, next, seekTo } = {}) {
    if (!hasSession()) return
    const set = (action, fn) => { try { navigator.mediaSession.setActionHandler(action, fn || null) } catch { /* unsupported action */ } }
    set('play', play)
    set('pause', pause)
    set('previoustrack', prev)
    set('nexttrack', next)
    set('seekto', seekTo ? (d) => seekTo(d.seekTime) : null)
  }
  function setPositionState() {
    if (!hasSession() || typeof navigator.mediaSession.setPositionState !== 'function') return
    const dur = audio.duration
    if (!dur || !isFinite(dur)) return
    try {
      navigator.mediaSession.setPositionState({ duration: dur, playbackRate: audio.playbackRate || 1, position: Math.min(audio.currentTime, dur) })
    } catch { /* ignore */ }
  }

  return {
    audio,
    on,
    setSource,
    revokeSource,
    play: () => audio.play?.().catch(() => {}),
    pause: () => audio.pause(),
    seek: (sec) => { if (isFinite(sec)) { try { audio.currentTime = Math.max(0, sec) } catch { /* ignore */ } } },
    setVolume: (v) => { audio.volume = Math.max(0, Math.min(1, Number(v) || 0)) },
    setRate: (r) => { const n = Number(r); if (isFinite(n) && n > 0) audio.playbackRate = n },
    get currentTime() { return audio.currentTime },
    get duration() { return isFinite(audio.duration) ? audio.duration : 0 },
    get paused() { return audio.paused },
    // MediaSession
    setMetadata, setActionHandlers, setPositionState, setSessionState,
  }
}

// Get (or lazily create) the singleton engine. Returns null only if Audio is unavailable.
export function getEngine() {
  if (_engine) return _engine
  if (typeof window === 'undefined' || typeof Audio === 'undefined') return null
  _engine = createEngine()
  return _engine
}

// Test/teardown helper.
export function _destroyEngine() {
  if (_engine) { try { _engine.pause(); _engine.revokeSource() } catch { /* ignore */ } }
  _engine = null
}
