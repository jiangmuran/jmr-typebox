// Client-only Web Audio helpers for the workbench: decode an audio/video file to PCM and reduce it
// to a fixed number of min/max peaks for canvas rendering. NO top-level side effects (no
// AudioContext at import) — everything is created lazily inside the exported async functions, which
// are only called from event handlers / onMounted. Safe to import during SSG.

// Lazily create a (possibly offline-capable) AudioContext. We reuse one instance to avoid the
// browser's "too many AudioContexts" warning across repeated decodes.
let _ctx = null
function getAudioContext() {
  if (_ctx) return _ctx
  const AC = window.AudioContext || window.webkitAudioContext
  if (!AC) throw new Error('Web Audio API is not available in this browser')
  _ctx = new AC()
  return _ctx
}

// Decode a File/Blob/ArrayBuffer into an AudioBuffer. ffmpeg-decodable containers that the browser
// can't decode (e.g. some flac/opus in older browsers) will reject — callers should treat a
// rejection as "no waveform" and degrade gracefully (the convert/edit flow still works via ffmpeg).
export async function decodeAudio(fileOrBuffer) {
  const ctx = getAudioContext()
  let arrayBuffer
  if (fileOrBuffer instanceof ArrayBuffer) {
    arrayBuffer = fileOrBuffer
  } else if (fileOrBuffer && typeof fileOrBuffer.arrayBuffer === 'function') {
    arrayBuffer = await fileOrBuffer.arrayBuffer()
  } else {
    throw new Error('decodeAudio expects a File/Blob/ArrayBuffer')
  }
  // decodeAudioData copies the buffer; wrap the callback form for Safari compatibility.
  return await new Promise((resolve, reject) => {
    try {
      const p = ctx.decodeAudioData(arrayBuffer.slice(0), resolve, reject)
      if (p && typeof p.then === 'function') p.then(resolve, reject)
    } catch (e) { reject(e) }
  })
}

// Reduce an AudioBuffer (mix of all channels) to `buckets` peaks. Each peak is { min, max } in
// [-1,1]. We average channels into mono first for a representative single waveform.
export function computePeaks(audioBuffer, buckets = 1000) {
  const chCount = audioBuffer.numberOfChannels
  const len = audioBuffer.length
  const n = Math.max(1, Math.min(buckets | 0 || 1000, len))
  const channels = []
  for (let c = 0; c < chCount; c++) channels.push(audioBuffer.getChannelData(c))

  const peaks = new Array(n)
  const step = len / n
  for (let i = 0; i < n; i++) {
    const start = Math.floor(i * step)
    const end = Math.min(len, Math.floor((i + 1) * step)) || start + 1
    let min = 1.0
    let max = -1.0
    for (let j = start; j < end; j++) {
      let sum = 0
      for (let c = 0; c < chCount; c++) sum += channels[c][j]
      const v = sum / chCount
      if (v < min) min = v
      if (v > max) max = v
    }
    if (end <= start) { min = 0; max = 0 }
    peaks[i] = { min, max }
  }
  return peaks
}

// Convenience: decode + compute peaks in one call. Returns { peaks, duration, sampleRate, channels }.
export async function decodeToPeaks(fileOrBuffer, buckets = 1000) {
  const buf = await decodeAudio(fileOrBuffer)
  return {
    peaks: computePeaks(buf, buckets),
    duration: buf.duration,
    sampleRate: buf.sampleRate,
    channels: buf.numberOfChannels,
  }
}

// Draw peaks onto a 2D canvas context. `opts`: { width, height, color, bgColor, playedColor,
// playedRatio (0..1), selStart, selEnd (0..1 selection overlay), selColor }. Pure-ish (only touches
// the passed ctx); the caller owns DPR scaling of the canvas backing store.
export function drawWaveform(ctx, peaks, opts = {}) {
  const {
    width, height,
    color = '#9aa0a6',
    bgColor = null,
    playedColor = null,
    playedRatio = 0,
    selStart = null,
    selEnd = null,
    selColor = 'rgba(99,102,241,0.18)',
  } = opts
  if (!ctx || !peaks?.length || !width || !height) return

  ctx.clearRect(0, 0, width, height)
  if (bgColor) { ctx.fillStyle = bgColor; ctx.fillRect(0, 0, width, height) }

  const mid = height / 2
  const n = peaks.length
  const barW = width / n

  // Selection overlay (behind the bars).
  if (selStart != null && selEnd != null && selEnd > selStart) {
    ctx.fillStyle = selColor
    const x0 = Math.max(0, Math.min(1, selStart)) * width
    const x1 = Math.max(0, Math.min(1, selEnd)) * width
    ctx.fillRect(x0, 0, x1 - x0, height)
  }

  const playedX = Math.max(0, Math.min(1, playedRatio)) * width
  for (let i = 0; i < n; i++) {
    const { min, max } = peaks[i]
    const x = i * barW
    const yTop = mid - Math.max(0.5, max * mid)
    const yBot = mid - Math.min(-0.5, min * mid)
    ctx.fillStyle = (playedColor && x < playedX) ? playedColor : color
    ctx.fillRect(x, yTop, Math.max(0.5, barW - 0.5), Math.max(1, yBot - yTop))
  }
}

// Release the shared AudioContext (tests / teardown).
export function _closeAudioContext() {
  try { _ctx?.close?.() } catch { /* ignore */ }
  _ctx = null
}
