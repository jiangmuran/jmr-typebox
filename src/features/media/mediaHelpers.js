// Pure, SSG-safe helpers for the Media toolkit. NO window/document/Blob/ffmpeg access here —
// everything operates on plain values so it can be unit-tested in node and imported anywhere
// (including index.js, which must stay side-effect-free).
//
// Engine note: the actual transcoding is done by ffmpeg.wasm (see ./ffmpegRunner.js). The big
// ffmpeg-core wasm (~31MB) is loaded at runtime from the official CDN (it exceeds Cloudflare's
// 25MB static-asset limit). This file only builds the *arguments* and metadata ffmpeg needs.

// ---------------------------------------------------------------------------
// Format catalogs
// ---------------------------------------------------------------------------

// Output audio formats the converter can produce. Each entry knows its container extension,
// MIME type, whether it is lossy (so we can offer a bitrate/quality control) and the ffmpeg
// codec + default arguments used to encode it with the single-threaded core.
export const AUDIO_FORMATS = {
  mp3:  { ext: 'mp3',  mime: 'audio/mpeg',  lossy: true,  codec: 'libmp3lame', label: 'MP3' },
  wav:  { ext: 'wav',  mime: 'audio/wav',   lossy: false, codec: 'pcm_s16le',  label: 'WAV' },
  flac: { ext: 'flac', mime: 'audio/flac',  lossy: false, codec: 'flac',       label: 'FLAC' },
  ogg:  { ext: 'ogg',  mime: 'audio/ogg',   lossy: true,  codec: 'libvorbis',  label: 'OGG (Vorbis)' },
  opus: { ext: 'opus', mime: 'audio/opus',  lossy: true,  codec: 'libopus',    label: 'Opus' },
  aac:  { ext: 'aac',  mime: 'audio/aac',   lossy: true,  codec: 'aac',        label: 'AAC' },
  m4a:  { ext: 'm4a',  mime: 'audio/mp4',   lossy: true,  codec: 'aac',        label: 'M4A (AAC)' },
}

export const AUDIO_OUTPUT_FORMATS = Object.keys(AUDIO_FORMATS)

// Extensions we accept as *input*. ffmpeg decodes far more than this, but the picker/validator
// uses this list (plus a generic audio/* or video/* MIME check) to give friendly feedback.
export const AUDIO_INPUT_EXTS = [
  'mp3', 'wav', 'flac', 'ogg', 'opus', 'aac', 'm4a', 'mp4', 'm4b',
  'wma', 'aiff', 'aif', 'amr', 'mpga', 'wave', 'oga', 'weba', 'caf', '3gp',
]

export const VIDEO_INPUT_EXTS = ['mp4', 'mov', 'webm', 'mkv', 'avi', 'm4v', 'mpg', 'mpeg', 'ts', 'flv', 'wmv', '3gp', 'ogv']

export const SUBTITLE_EXTS = ['srt', 'ass', 'ssa', 'vtt', 'sub']

// Quality presets for the lossy encoders, expressed as ffmpeg bitrate tokens.
export const BITRATE_PRESETS = ['96k', '128k', '160k', '192k', '256k', '320k']
export const DEFAULT_BITRATE = '192k'

// ---------------------------------------------------------------------------
// Small string/number utilities
// ---------------------------------------------------------------------------

export function normalizeFormat(format) {
  return String(format || '').trim().toLowerCase().replace(/^\./, '')
}

// The bare extension of a filename, lowercased and without the dot. '' if none.
export function extOf(name) {
  const m = String(name || '').toLowerCase().match(/\.([^./\\]+)$/)
  return m ? m[1] : ''
}

export function audioFormatDef(format) {
  return AUDIO_FORMATS[normalizeFormat(format)] || null
}

export function mimeForFormat(format) {
  return audioFormatDef(format)?.mime || 'application/octet-stream'
}

export function extForFormat(format) {
  const def = audioFormatDef(format)
  return def ? def.ext : normalizeFormat(format) || 'bin'
}

export function isLossyFormat(format) {
  return !!audioFormatDef(format)?.lossy
}

export function codecForFormat(format) {
  return audioFormatDef(format)?.codec || null
}

export function baseName(name) {
  return String(name || 'output').replace(/\.[^./\\]+$/, '') || 'output'
}

// buildOutputName('song.mp3', 'wav') -> 'song.wav'
export function buildOutputName(inputName, outputFormat) {
  return `${baseName(inputName)}.${extForFormat(outputFormat)}`
}

// Append a suffix before the (swapped) extension: ('clip.mp4','mp3','-audio') -> 'clip-audio.mp3'
export function buildOutputNameWithSuffix(inputName, outputFormat, suffix = '') {
  return `${baseName(inputName)}${suffix}.${extForFormat(outputFormat)}`
}

export function formatSize(bytes) {
  const b = Number(bytes) || 0
  if (b < 1024) return b + ' B'
  if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB'
  if (b < 1024 * 1024 * 1024) return (b / (1024 * 1024)).toFixed(2) + ' MB'
  return (b / (1024 * 1024 * 1024)).toFixed(2) + ' GB'
}

export function formatDuration(seconds) {
  const s = Math.max(0, Math.round(Number(seconds) || 0))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const pad = (n) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`
}

// Parse a bitrate token ('192k' / '192') into a normalized ffmpeg token, defaulting sensibly.
export function normalizeBitrate(b, fallback = DEFAULT_BITRATE) {
  const s = String(b ?? '').trim().toLowerCase()
  if (!s) return fallback
  const n = parseInt(s, 10)
  if (!Number.isFinite(n) || n <= 0) return fallback
  // Heuristic: bare numbers below 1000 are kbps, otherwise raw bps.
  return n < 1000 ? `${n}k` : `${n}`
}

// ---------------------------------------------------------------------------
// Input classification
// ---------------------------------------------------------------------------

export function isVideoInput(name, mime = '') {
  if (String(mime).startsWith('video/')) return true
  return VIDEO_INPUT_EXTS.includes(extOf(name))
}

export function isAudioInput(name, mime = '') {
  if (String(mime).startsWith('audio/')) return true
  return AUDIO_INPUT_EXTS.includes(extOf(name))
}

export function isSubtitleInput(name, mime = '') {
  if (String(mime) === 'text/vtt') return true
  return SUBTITLE_EXTS.includes(extOf(name))
}

// Accept any media file the converter knows how to read.
export function isMediaInput(name, mime = '') {
  return isAudioInput(name, mime) || isVideoInput(name, mime)
}

// A safe, ffmpeg-friendly virtual filename for the in-memory FS (avoids spaces/unicode issues
// in arg parsing). Keeps the real extension so ffmpeg can sniff the container.
export function safeInputName(name, fallbackExt = 'bin') {
  const ext = extOf(name) || fallbackExt
  return `input.${ext}`
}

// ---------------------------------------------------------------------------
// ffmpeg argument builders (the unit-tested core)
// ---------------------------------------------------------------------------

// Build args for a pure audio transcode / audio-extraction-from-video.
//   buildConvertArgs({ input, output, format, bitrate, quality, sampleRate, channels, stripVideo })
// Returns a string[] suitable for ffmpeg.exec(). `stripVideo` adds -vn (used when the source is
// a video and we only want the audio track).
export function buildConvertArgs({
  input = 'input.bin',
  output = 'output.mp3',
  format,
  bitrate,
  quality,
  sampleRate,
  channels,
  stripVideo = false,
} = {}) {
  const def = audioFormatDef(format)
  if (!def) throw new Error(`Unsupported output format: ${format}`)

  const args = ['-i', input]
  if (stripVideo) args.push('-vn') // drop any video stream → audio only

  args.push('-c:a', def.codec)

  // Lossy formats take a bitrate; lossless ignore it. WAV/FLAC are governed by sample format.
  if (def.lossy) {
    args.push('-b:a', normalizeBitrate(bitrate))
  } else if (format && normalizeFormat(format) === 'flac' && Number.isFinite(Number(quality))) {
    // FLAC compression level 0–12 (higher = smaller/slower). Optional.
    const lvl = Math.max(0, Math.min(12, Math.round(Number(quality))))
    args.push('-compression_level', String(lvl))
  }

  if (Number.isFinite(Number(sampleRate)) && Number(sampleRate) > 0) {
    args.push('-ar', String(Math.round(Number(sampleRate))))
  }
  if (Number.isFinite(Number(channels)) && Number(channels) > 0) {
    args.push('-ac', String(Math.round(Number(channels))))
  }

  args.push(output)
  return args
}

// Build args to (re)write ID3/container metadata tags onto an audio file WITHOUT re-encoding the
// audio (`-c copy`), so it's fast and lossless. Only title/artist/album are exposed (the player's
// editable fields). Empty/blank values are skipped so we don't clobber existing tags with "".
//   buildTagArgs({ input, output, title, artist, album }) -> string[]
export function buildTagArgs({ input = 'input.mp3', output = 'output.mp3', title, artist, album } = {}) {
  const args = ['-i', input, '-map', '0', '-c', 'copy', '-id3v2_version', '3']
  const add = (key, val) => {
    if (val != null && String(val).length) args.push('-metadata', `${key}=${String(val)}`)
  }
  add('title', title)
  add('artist', artist)
  add('album', album)
  args.push(output)
  return args
}

// Escape a path for use inside ffmpeg's -vf subtitles= filter. Within an in-memory FS we use a
// plain ascii filename, but colons/backslashes/quotes still need escaping for the filtergraph.
export function escapeSubtitlePath(path) {
  return String(path)
    .replace(/\\/g, '\\\\')
    .replace(/:/g, '\\:')
    .replace(/'/g, "\\'")
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
}

// Build args to HARD-burn subtitles into a video (re-encodes the video stream).
//   buildHardSubArgs({ video, subtitle, output, crf, preset, audioCopy, fontName, fontSize })
export function buildHardSubArgs({
  video = 'input.mp4',
  subtitle = 'subs.srt',
  output = 'output.mp4',
  crf = 23,
  preset = 'veryfast',
  audioCopy = true,
  fontName,
  fontSize,
} = {}) {
  // force_style lets us override font/size for SRT (ASS carries its own styling).
  const styleParts = []
  if (fontName) styleParts.push(`FontName=${fontName}`)
  if (Number.isFinite(Number(fontSize)) && Number(fontSize) > 0) styleParts.push(`FontSize=${Math.round(Number(fontSize))}`)
  let filter = `subtitles=${escapeSubtitlePath(subtitle)}`
  if (styleParts.length) filter += `:force_style='${styleParts.join(',')}'`

  const args = ['-i', video, '-vf', filter, '-c:v', 'libx264']
  const c = Math.max(0, Math.min(51, Math.round(Number(crf))))
  args.push('-crf', String(Number.isFinite(c) ? c : 23))
  args.push('-preset', String(preset || 'veryfast'))
  args.push('-c:a', audioCopy ? 'copy' : 'aac')
  args.push(output)
  return args
}

// Build args to SOFT-mux subtitles as a selectable track (no re-encode of A/V).
// mov_text for mp4/mov; for mkv we copy as-is (srt/ass embed natively).
//   buildSoftSubArgs({ video, subtitle, output, container })
export function buildSoftSubArgs({
  video = 'input.mp4',
  subtitle = 'subs.srt',
  output = 'output.mp4',
  container = 'mp4',
  language,
} = {}) {
  const args = ['-i', video, '-i', subtitle, '-map', '0', '-map', '1', '-c', 'copy']
  const cont = normalizeFormat(container)
  // mp4/mov require the timed-text codec mov_text; mkv/webm accept srt/ass directly via copy.
  if (cont === 'mp4' || cont === 'mov' || cont === 'm4v') {
    args.push('-c:s', 'mov_text')
  } else {
    args.push('-c:s', 'srt')
  }
  if (language) args.push('-metadata:s:s:0', `language=${language}`)
  args.push(output)
  return args
}

// ---------------------------------------------------------------------------
// Audio EDITING — pure builders for the workbench (trim / gain / fade / resample / normalize)
// ---------------------------------------------------------------------------

// Clamp a number into [min,max], returning `fallback` if it isn't finite.
export function clampNum(v, min, max, fallback = min) {
  const n = Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, n))
}

// Format seconds for ffmpeg's -ss/-to (plain seconds with ms precision). 3.5 -> '3.5'.
export function secToFFTime(sec) {
  const n = Math.max(0, Number(sec) || 0)
  // Trim trailing zeros but keep up to 3 decimals.
  return String(Math.round(n * 1000) / 1000)
}

// Build the -af filter chain for an edit. Returns a string like 'volume=2.0,afade=t=in:...'
// or '' when no audio filters are requested. Order matters: trim is done via -ss/-to (outside the
// filter), then volume → fades → normalize. Fades are anchored to the *output* clip length.
//   buildAudioFilters({ gainDb, fadeIn, fadeOut, normalize, clipDuration })
export function buildAudioFilters({ gainDb, fadeIn = 0, fadeOut = 0, normalize = false, clipDuration } = {}) {
  const parts = []

  const g = Number(gainDb)
  if (Number.isFinite(g) && Math.abs(g) > 0.0001) {
    // volume filter accepts a dB suffix.
    parts.push(`volume=${Math.round(g * 100) / 100}dB`)
  }

  const fi = clampNum(fadeIn, 0, 1e6, 0)
  if (fi > 0) parts.push(`afade=t=in:st=0:d=${secToFFTime(fi)}`)

  const fo = clampNum(fadeOut, 0, 1e6, 0)
  if (fo > 0) {
    // afade out needs a start time; anchor to the end of the clip when we know its length.
    const dur = Number(clipDuration)
    if (Number.isFinite(dur) && dur > fo) {
      parts.push(`afade=t=out:st=${secToFFTime(dur - fo)}:d=${secToFFTime(fo)}`)
    } else {
      // Unknown/short duration: still apply a fade-out of the requested length from t=0-relative.
      parts.push(`afade=t=out:d=${secToFFTime(fo)}`)
    }
  }

  if (normalize) {
    // EBU R128 loudness normalization (single-pass) — the most useful "make it sound even" knob.
    parts.push('loudnorm=I=-16:TP=-1.5:LRA=11')
  }

  return parts.join(',')
}

// Build ffmpeg args for an audio EDIT → re-encode to `format`. Combines trim (-ss/-to), a filter
// chain, optional resample/channels and a bitrate (for lossy). Pure/string-only so it's unit-tested.
//   buildEditArgs({ input, output, format, trimStart, trimEnd, gainDb, fadeIn, fadeOut, normalize,
//                    sampleRate, channels, bitrate, stripVideo, clipDuration })
export function buildEditArgs({
  input = 'input.bin',
  output = 'output.mp3',
  format,
  trimStart,
  trimEnd,
  gainDb,
  fadeIn,
  fadeOut,
  normalize = false,
  sampleRate,
  channels,
  bitrate,
  stripVideo = false,
  clipDuration,
} = {}) {
  const def = audioFormatDef(format)
  if (!def) throw new Error(`Unsupported output format: ${format}`)

  const args = []
  // Input-side trim: -ss before -i is fast (keyframe seek) and accurate enough for audio.
  const ss = Number(trimStart)
  const hasStart = Number.isFinite(ss) && ss > 0
  if (hasStart) args.push('-ss', secToFFTime(ss))
  args.push('-i', input)
  // -to is relative to the start of the *input*; when we pre-seek with -ss we must use -t (duration)
  // OR convert -to to be relative. Simpler and robust: use -t with (end - start).
  const te = Number(trimEnd)
  if (Number.isFinite(te) && te > (hasStart ? ss : 0)) {
    const dur = te - (hasStart ? ss : 0)
    if (dur > 0) args.push('-t', secToFFTime(dur))
  }

  if (stripVideo) args.push('-vn')

  // Effective clip duration for fade-out anchoring.
  let effDur = Number(clipDuration)
  if (Number.isFinite(te) && te > 0) effDur = te - (hasStart ? ss : 0)
  else if (Number.isFinite(effDur) && hasStart) effDur = effDur - ss

  const af = buildAudioFilters({ gainDb, fadeIn, fadeOut, normalize, clipDuration: effDur })
  if (af) args.push('-af', af)

  args.push('-c:a', def.codec)
  if (def.lossy) {
    args.push('-b:a', normalizeBitrate(bitrate))
  }
  if (Number.isFinite(Number(sampleRate)) && Number(sampleRate) > 0) {
    args.push('-ar', String(Math.round(Number(sampleRate))))
  }
  if (Number.isFinite(Number(channels)) && Number(channels) > 0) {
    args.push('-ac', String(Math.round(Number(channels))))
  }
  args.push(output)
  return args
}

// ---------------------------------------------------------------------------
// CUSTOM ffmpeg command (power users) — tokenize a raw arg string the way a shell would, then
// splice in the real input/output filenames. Client-side & sandboxed (their own browser/in-memory
// FS), so this is about UX correctness, not security.
// ---------------------------------------------------------------------------

// Split a command string into argv, honoring single/double quotes and backslash escapes. Does NOT
// do glob/var expansion. tokenizeArgs(`-af "volume=2dB" -b:a 192k`) -> ['-af','volume=2dB',...]
export function tokenizeArgs(str) {
  const s = String(str || '')
  const out = []
  let cur = ''
  let quote = null // "'" | '"' | null
  let has = false
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (quote) {
      if (c === quote) { quote = null }
      else if (c === '\\' && quote === '"' && i + 1 < s.length) { cur += s[++i] }
      else { cur += c }
      has = true
    } else if (c === "'" || c === '"') {
      quote = c; has = true
    } else if (c === '\\' && i + 1 < s.length) {
      cur += s[++i]; has = true
    } else if (/\s/.test(c)) {
      if (has) { out.push(cur); cur = ''; has = false }
    } else {
      cur += c; has = true
    }
  }
  if (has) out.push(cur)
  return out
}

// Known media file extensions we'll accept as an explicit OUTPUT filename in a raw command. Kept
// deliberately broad (covers our outputs + common containers) but bounded, so filter values like
// `atempo=2.0` / `volume=2.0` are NEVER mistaken for filenames.
const CUSTOM_OUTPUT_EXTS = new Set([
  ...AUDIO_OUTPUT_FORMATS, ...AUDIO_INPUT_EXTS, ...VIDEO_INPUT_EXTS,
  'mp3', 'wav', 'flac', 'ogg', 'opus', 'aac', 'm4a', 'mp4', 'mkv', 'mov', 'webm', 'mka', 'wma',
])

// Decide whether a raw token is a real OUTPUT filename (vs a flag, a flag value, or a filter graph
// like `atempo=2.0`). Rules: not a flag (no leading '-'); contains no '=' (filtergraphs/options do);
// has a dotted extension whose suffix is a KNOWN media extension. This is what stops the
// "atempo=2.0 looks like a file" bug.
function looksLikeOutputFile(tk) {
  if (!tk || tk[0] === '-') return false
  if (tk.includes('=')) return false
  const ext = (tk.match(/\.([A-Za-z0-9]{1,5})$/)?.[1] || '').toLowerCase()
  return !!ext && CUSTOM_OUTPUT_EXTS.has(ext)
}

// Splice a raw user ffmpeg command into a runnable argv against our in-memory FS. Client-side &
// sandboxed (their own browser), so this is about correctness, not security.
//   buildCustomArgs({ raw, input, defaultOutput }) -> { args, output }
// Behavior:
//   • {input} / {output} placeholders are expanded to the real names first.
//   • If the user already supplied an explicit output filename (a real media filename as the LAST
//     token), we keep it; otherwise we append `defaultOutput`.
//   • If the user didn't pass `-i`, we prepend `-i <input>` so their filters run against the file.
export function buildCustomArgs({ raw, input = 'input.bin', defaultOutput = 'output.out' } = {}) {
  let tokens = tokenizeArgs(raw).map(tk =>
    tk.replace(/\{input\}/g, input).replace(/\{output\}/g, defaultOutput)
  )

  const hasInput = tokens.includes('-i')

  // Only the LAST token may be an output, and only if it's a real media filename (not a filter).
  let output = null
  if (tokens.length) {
    const last = tokens[tokens.length - 1]
    // Don't treat the token right after -i (the input filename) as the output.
    const prev = tokens[tokens.length - 2]
    if (looksLikeOutputFile(last) && last !== input && prev !== '-i') output = last
  }

  if (!hasInput) tokens = ['-i', input, ...tokens]
  if (!output) { output = defaultOutput; tokens = [...tokens, output] }
  return { args: tokens, output }
}

// ---------------------------------------------------------------------------
// Converter route registry (single source of truth shared by index.js + pages)
// ---------------------------------------------------------------------------

// The named, SEO-friendly converter routes. The generic /media/convert page also exists; these
// give specific landing pages (and command-palette entries) for popular conversions. Each maps
// to a default input/output pairing used to prefill the universal converter.
export const MEDIA_CONVERTERS = [
  { id: 'mp3-to-wav', route: '/media/mp3-to-wav', input: 'mp3', output: 'wav' },
  { id: 'wav-to-mp3', route: '/media/wav-to-mp3', input: 'wav', output: 'mp3' },
  { id: 'mp4-to-mp3', route: '/media/mp4-to-mp3', input: 'mp4', output: 'mp3' },
  { id: 'm4a-to-mp3', route: '/media/m4a-to-mp3', input: 'm4a', output: 'mp3' },
  { id: 'flac-to-mp3', route: '/media/flac-to-mp3', input: 'flac', output: 'mp3' },
  { id: 'wav-to-flac', route: '/media/wav-to-flac', input: 'wav', output: 'flac' },
  { id: 'ogg-to-mp3', route: '/media/ogg-to-mp3', input: 'ogg', output: 'mp3' },
]

export function converterForRoute(path) {
  return MEDIA_CONVERTERS.find(c => c.route === path) || null
}
