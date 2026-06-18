// Client-only audio conversion engine: Web Audio decode + WAV writer + lamejs (MP3).
// Imported lazily from converters' run() / the page on convert — never at module top level.
// Fully local (no CDN); no large wasm core, so it deploys within Cloudflare's 25MB limit.
import { loadLibrary } from '../../utils/loadLibrary'
import { encodeWav, floatToInt16, normalizeFormat, parseBitrate } from './mediaHelpers'

async function decode(file) {
  const buf = await file.arrayBuffer()
  const AC = window.AudioContext || window.webkitAudioContext
  const ctx = new AC()
  try {
    return await ctx.decodeAudioData(buf)
  } finally {
    ctx.close?.()
  }
}

function channelsOf(audioBuffer) {
  const chs = []
  for (let c = 0; c < audioBuffer.numberOfChannels; c++) chs.push(audioBuffer.getChannelData(c))
  return chs.length ? chs : [new Float32Array(0)]
}

async function encodeMp3(channels, sampleRate, kbps, onProgress) {
  const mod = await loadLibrary('lamejs', () => import('@breezystack/lamejs'), { sizeMB: 0.1 })
  const lame = mod.default || mod
  const numCh = Math.min(2, channels.length)
  const enc = new lame.Mp3Encoder(numCh, sampleRate, kbps)
  const left = floatToInt16(channels[0])
  const right = numCh > 1 ? floatToInt16(channels[1]) : null
  const BLOCK = 1152
  const out = []
  for (let i = 0; i < left.length; i += BLOCK) {
    const l = left.subarray(i, i + BLOCK)
    const r = right ? right.subarray(i, i + BLOCK) : undefined
    const chunk = numCh > 1 ? enc.encodeBuffer(l, r) : enc.encodeBuffer(l)
    if (chunk.length) out.push(chunk)
    if (onProgress && i % (BLOCK * 64) === 0) onProgress({ progress: left.length ? i / left.length : 0 })
  }
  const end = enc.flush()
  if (end.length) out.push(end)
  onProgress?.({ progress: 1 })
  return new Blob(out, { type: 'audio/mpeg' })
}

// convertAudio(file, { outputFormat, options:{bitrate}, onProgress }) -> Blob
export async function convertAudio(file, { outputFormat, options = {}, onProgress } = {}) {
  const audio = await decode(file)
  const channels = channelsOf(audio)
  const fmt = normalizeFormat(outputFormat)

  if (fmt === 'wav') {
    onProgress?.({ progress: 0.5 })
    const blob = new Blob([encodeWav(channels, audio.sampleRate)], { type: 'audio/wav' })
    onProgress?.({ progress: 1 })
    return blob
  }
  if (fmt === 'mp3') {
    return encodeMp3(channels, audio.sampleRate, parseBitrate(options.bitrate), onProgress)
  }
  throw new Error(`Unsupported output format: ${outputFormat}`)
}
