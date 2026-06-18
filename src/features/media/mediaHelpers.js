// Pure, SSG-safe helpers for the Media (audio) suite. NO window/document/ffmpeg/Blob
// access here — these operate on plain values so they can be unit-tested in node and
// imported anywhere (including index.js, which must stay side-effect-free).

// Audio format registry. Each token maps to a canonical extension, a MIME type (for the
// downloaded Blob), and the ffmpeg encoder + extra args used when it is the OUTPUT format.
// To add OGG/AAC/FLAC/etc., just add an entry here and a converter route — nothing else
// in the run pipeline needs to change.
export const AUDIO_FORMATS = {
  mp3: {
    ext: 'mp3',
    mime: 'audio/mpeg',
    // libmp3lame is bundled in @ffmpeg/core. -q:a 2 ≈ ~190kbps VBR (good default).
    encodeArgs: ['-c:a', 'libmp3lame', '-q:a', '2'],
  },
  wav: {
    ext: 'wav',
    mime: 'audio/wav',
    // 16-bit signed little-endian PCM — the most compatible WAV flavor.
    encodeArgs: ['-c:a', 'pcm_s16le'],
  },
  ogg: {
    ext: 'ogg',
    mime: 'audio/ogg',
    encodeArgs: ['-c:a', 'libvorbis', '-q:a', '5'],
  },
  aac: {
    // ffmpeg's native AAC encoder writes to an ADTS/.aac stream cleanly.
    ext: 'aac',
    mime: 'audio/aac',
    encodeArgs: ['-c:a', 'aac', '-b:a', '192k'],
  },
  flac: {
    ext: 'flac',
    mime: 'audio/flac',
    encodeArgs: ['-c:a', 'flac'],
  },
  m4a: {
    ext: 'm4a',
    mime: 'audio/mp4',
    encodeArgs: ['-c:a', 'aac', '-b:a', '192k'],
  },
}

// Normalize an arbitrary format token (case/whitespace, leading dot) to a known key.
export function normalizeFormat(format) {
  const f = String(format || '').trim().toLowerCase().replace(/^\./, '')
  if (f === 'jpeg') return 'mp3' // defensive; not an audio format
  return f
}

// MIME type for a format token. Falls back to a generic audio type.
export function mimeForFormat(format) {
  const def = AUDIO_FORMATS[normalizeFormat(format)]
  return def ? def.mime : 'application/octet-stream'
}

// Canonical file extension for a format token.
export function extForFormat(format) {
  const def = AUDIO_FORMATS[normalizeFormat(format)]
  return def ? def.ext : normalizeFormat(format) || 'bin'
}

// Strip any extension to get a clean basename for download naming.
export function baseName(name) {
  return String(name || 'audio').replace(/\.[^./\\]+$/, '') || 'audio'
}

// Build the OUTPUT filename: swap the source basename's extension to the target format.
//   buildOutputName('song.mp3', 'wav') -> 'song.wav'
export function buildOutputName(inputName, outputFormat) {
  return `${baseName(inputName)}.${extForFormat(outputFormat)}`
}

// The in-memory filenames written into ffmpeg's virtual FS. Kept distinct from the
// user-facing download name and unique-ish to avoid clobbering across runs.
export function virtualNames(inputFormat, outputFormat) {
  return {
    input: `input.${extForFormat(inputFormat)}`,
    output: `output.${extForFormat(outputFormat)}`,
  }
}

// Build the ffmpeg argument vector for a conversion.
//   buildFfmpegArgs({ inputFile, outputFile, outputFormat, options })
// Options (all optional):
//   bitrate  — override audio bitrate, e.g. '128k' (applies to lossy outputs)
//   sampleRate — output sample rate in Hz, e.g. 44100
//   channels — output channel count (1 mono / 2 stereo)
// Returns a flat string[] suitable for ffmpeg.exec(args).
export function buildFfmpegArgs({ inputFile, outputFile, outputFormat, options = {} } = {}) {
  const fmt = normalizeFormat(outputFormat)
  const def = AUDIO_FORMATS[fmt]
  if (!inputFile || !outputFile || !def) {
    throw new Error(`Unsupported or incomplete conversion (output="${outputFormat}")`)
  }
  const args = ['-i', inputFile]

  // Codec / quality args for the target format.
  let codecArgs = def.encodeArgs.slice()

  // An explicit bitrate overrides the format's default quality setting for lossy codecs.
  if (options.bitrate) {
    // Drop any default -q:a / -b:a pairs, then append the explicit bitrate.
    codecArgs = stripArg(stripArg(codecArgs, '-q:a'), '-b:a')
    codecArgs.push('-b:a', String(options.bitrate))
  }
  args.push(...codecArgs)

  if (options.sampleRate) args.push('-ar', String(options.sampleRate))
  if (options.channels) args.push('-ac', String(options.channels))

  args.push(outputFile)
  return args
}

// Remove a flag and its following value from an arg array (returns a new array).
function stripArg(args, flag) {
  const out = []
  for (let i = 0; i < args.length; i++) {
    if (args[i] === flag) { i++; continue } // skip flag + its value
    out.push(args[i])
  }
  return out
}

// Human-readable byte size (mirrors the image suite for visual consistency).
export function formatSize(bytes) {
  const b = Number(bytes) || 0
  if (b < 1024) return b + ' B'
  if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB'
  return (b / (1024 * 1024)).toFixed(2) + ' MB'
}

// Format seconds as m:ss (for showing audio duration if known).
export function formatDuration(seconds) {
  const s = Math.max(0, Math.round(Number(seconds) || 0))
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${m}:${String(r).padStart(2, '0')}`
}

// Bitrate presets offered in the UI for lossy outputs.
export const BITRATE_PRESETS = ['96k', '128k', '192k', '256k', '320k']

// Is the given output format lossy (i.e. bitrate selection is meaningful)?
export function isLossyFormat(format) {
  const f = normalizeFormat(format)
  return f === 'mp3' || f === 'ogg' || f === 'aac' || f === 'm4a'
}

// The converters this suite registers. Single source of truth shared by index.js
// (registration) and the page (looking up the active conversion by route).
// where:'client' + needsBackend:false — everything runs in the browser via wasm.
export const MEDIA_CONVERTERS = [
  { id: 'mp3-to-wav', route: '/media/mp3-to-wav', input: 'mp3', output: 'wav' },
  { id: 'wav-to-mp3', route: '/media/wav-to-mp3', input: 'wav', output: 'mp3' },
]

// Look up the conversion descriptor for a given route path.
export function converterForRoute(path) {
  return MEDIA_CONVERTERS.find(c => c.route === path) || null
}
