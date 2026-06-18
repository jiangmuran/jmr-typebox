// Pure, SSG-safe helpers for the Media (audio) suite. NO window/document/Blob access here —
// these operate on plain values so they can be unit-tested in node and imported anywhere
// (including index.js, which must stay side-effect-free).
//
// Engine note: conversions use the browser's native Web Audio decoder + a WAV writer +
// lamejs (MP3 encoder). This keeps everything local (no CDN) and avoids the 31MB ffmpeg
// core, which exceeds Cloudflare's 25MB static-asset limit. ffmpeg.wasm remains the future
// path for video (needs large-asset hosting such as R2).

export const AUDIO_FORMATS = {
  mp3: { ext: 'mp3', mime: 'audio/mpeg' },
  wav: { ext: 'wav', mime: 'audio/wav' },
}

export function normalizeFormat(format) {
  return String(format || '').trim().toLowerCase().replace(/^\./, '')
}

export function mimeForFormat(format) {
  const def = AUDIO_FORMATS[normalizeFormat(format)]
  return def ? def.mime : 'application/octet-stream'
}

export function extForFormat(format) {
  const def = AUDIO_FORMATS[normalizeFormat(format)]
  return def ? def.ext : normalizeFormat(format) || 'bin'
}

export function baseName(name) {
  return String(name || 'audio').replace(/\.[^./\\]+$/, '') || 'audio'
}

// buildOutputName('song.mp3', 'wav') -> 'song.wav'
export function buildOutputName(inputName, outputFormat) {
  return `${baseName(inputName)}.${extForFormat(outputFormat)}`
}

export function formatSize(bytes) {
  const b = Number(bytes) || 0
  if (b < 1024) return b + ' B'
  if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB'
  return (b / (1024 * 1024)).toFixed(2) + ' MB'
}

export function formatDuration(seconds) {
  const s = Math.max(0, Math.round(Number(seconds) || 0))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export const BITRATE_PRESETS = ['96k', '128k', '192k', '256k', '320k']

export function isLossyFormat(format) {
  return normalizeFormat(format) === 'mp3'
}

// Parse a bitrate token ('192k' / '192') to a kbps number, defaulting to 192.
export function parseBitrate(b) {
  const n = parseInt(String(b ?? ''), 10)
  return Number.isFinite(n) && n > 0 ? n : 192
}

// Encode interleaved 16-bit PCM WAV from Float32 channel data. Pure (DataView + typed
// arrays only) so it is unit-testable in node. `channels` is an array of Float32Array.
export function encodeWav(channels, sampleRate) {
  const numCh = channels.length || 1
  const len = channels[0]?.length || 0
  const bytesPerSample = 2
  const blockAlign = numCh * bytesPerSample
  const dataSize = len * blockAlign
  const buffer = new ArrayBuffer(44 + dataSize)
  const view = new DataView(buffer)
  const writeStr = (off, s) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)) }

  writeStr(0, 'RIFF'); view.setUint32(4, 36 + dataSize, true); writeStr(8, 'WAVE')
  writeStr(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true)
  view.setUint16(22, numCh, true); view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * blockAlign, true); view.setUint16(32, blockAlign, true)
  view.setUint16(34, 8 * bytesPerSample, true)
  writeStr(36, 'data'); view.setUint32(40, dataSize, true)

  let off = 44
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < numCh; c++) {
      const s = Math.max(-1, Math.min(1, channels[c][i] || 0))
      view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true)
      off += 2
    }
  }
  return buffer
}

// Float32 → Int16 PCM (for the MP3 encoder).
export function floatToInt16(f32) {
  const out = new Int16Array(f32.length)
  for (let i = 0; i < f32.length; i++) {
    const s = Math.max(-1, Math.min(1, f32[i]))
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff
  }
  return out
}

// Converters this suite registers — single source of truth shared by index.js + the page.
export const MEDIA_CONVERTERS = [
  { id: 'mp3-to-wav', route: '/media/mp3-to-wav', input: 'mp3', output: 'wav' },
  { id: 'wav-to-mp3', route: '/media/wav-to-mp3', input: 'wav', output: 'mp3' },
]

export function converterForRoute(path) {
  return MEDIA_CONVERTERS.find(c => c.route === path) || null
}
