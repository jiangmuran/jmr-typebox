// High-level media operations, built on the ffmpeg.wasm engine (./ffmpegRunner). Client-only:
// these functions touch Blob/Worker via the engine, but the module has no top-level side effects
// and is always reached through a dynamic import() from event handlers / converter run() calls.
import {
  buildConvertArgs, buildHardSubArgs, buildSoftSubArgs, buildEditArgs, buildCustomArgs, buildTagArgs,
  buildVideoConvertArgs, buildVideoCompressArgs, buildAudioCompressArgs, buildAsrExtractArgs,
  safeInputName, extForFormat, mimeForFormat, normalizeFormat, isVideoInput, isVideoOutputFormat, extOf,
} from './mediaHelpers'
import {
  parseFFMetadata, serializeFFMetadata, splitTags, buildWriteMetadataArgs, buildStripMetadataArgs,
  parseDurationInfo, parseAudioStreamInfo, parseVideoStreamInfo, hasAttachedPicture, hasLimitedTagSupport,
} from './ffmetadata'
import { runFFmpeg, probeMetadata } from './ffmpegRunner'

// Re-tag an audio file (title/artist/album) WITHOUT re-encoding (`-c copy`) — fast + lossless.
// Keeps the source container/extension. Returns a Blob of the tagged file.
//   writeTags(file, { title, artist, album }) -> Blob
export async function writeTags(file, { title, artist, album } = {}) {
  const ext = extOf(file?.name) || 'mp3'
  const inName = `input.${ext}`
  const outName = `output.${ext}`
  const args = buildTagArgs({ input: inName, output: outName, title, artist, album })
  return runFFmpeg({
    files: [{ name: inName, data: file }],
    args,
    outName,
    outMime: mimeForFormat(ext) === 'application/octet-stream' ? (file?.type || 'application/octet-stream') : mimeForFormat(ext),
  })
}

// Convert any audio/video input into an audio file of `outputFormat`. When the input is a video
// container, the video stream is dropped (-vn) so we extract the audio track.
//   convertAudio(file, { outputFormat, options:{ bitrate, sampleRate, channels, quality }, onProgress }) -> Blob
export async function convertAudio(file, { outputFormat, options = {}, onProgress } = {}) {
  const fmt = normalizeFormat(outputFormat)
  const inName = safeInputName(file?.name, 'mp3')
  const outName = `output.${extForFormat(fmt)}`
  const stripVideo = isVideoInput(file?.name, file?.type)

  const args = buildConvertArgs({
    input: inName,
    output: outName,
    format: fmt,
    bitrate: options.bitrate,
    quality: options.quality,
    sampleRate: options.sampleRate,
    channels: options.channels,
    stripVideo,
  })

  return runFFmpeg({
    files: [{ name: inName, data: file }],
    args,
    outName,
    outMime: mimeForFormat(fmt),
    durationSec: options.durationSec,
    onProgress,
  })
}

// Convert a VIDEO input into another video container (mp4/webm/mov/mkv/gif) with optional scaling,
// quality (CRF), fps, and bitrate caps. Re-encodes the video stream.
//   convertVideo(file, { outputFormat, options:{ height, crf, fps, videoBitrate, audioBitrate, vcodec, durationSec }, onProgress }) -> Blob
export async function convertVideo(file, { outputFormat, options = {}, onProgress } = {}) {
  const fmt = normalizeFormat(outputFormat)
  const inName = safeInputName(file?.name, 'mp4')
  const outName = `output.${extForFormat(fmt)}`

  const args = buildVideoConvertArgs({
    input: inName,
    output: outName,
    format: fmt,
    height: options.height,
    crf: options.crf,
    fps: options.fps,
    videoBitrate: options.videoBitrate,
    audioBitrate: options.audioBitrate,
    vcodec: options.vcodec,
  })

  return runFFmpeg({
    files: [{ name: inName, data: file }],
    args,
    outName,
    outMime: mimeForFormat(fmt),
    durationSec: options.durationSec,
    onProgress,
  })
}

// Compress a VIDEO or AUDIO file. For video: CRF-driven quality + optional scale/fps/max-bitrate +
// re-encoded audio. For audio: re-encode to a lossy format at a target bitrate. Output container is
// mp4 (video) / the chosen audio format. Returns a Blob.
//   compressMedia(file, { kind, format, options, onProgress }) -> Blob
//     kind 'video': options { vcodec, crf, height, fps, maxBitrate, audioBitrate, durationSec }
//     kind 'audio': options { bitrate, channels, sampleRate, durationSec }
export async function compressMedia(file, { kind, format, options = {}, onProgress } = {}) {
  const isVideo = kind === 'video'
  const inName = safeInputName(file?.name, isVideo ? 'mp4' : 'mp3')
  if (isVideo) {
    const outFmt = normalizeFormat(format || 'mp4')
    const outName = `output.${extForFormat(outFmt)}`
    const args = buildVideoCompressArgs({
      input: inName,
      output: outName,
      vcodec: options.vcodec,
      crf: options.crf,
      height: options.height,
      fps: options.fps,
      maxBitrate: options.maxBitrate,
      audioBitrate: options.audioBitrate,
    })
    return runFFmpeg({
      files: [{ name: inName, data: file }],
      args,
      outName,
      outMime: mimeForFormat(outFmt),
      durationSec: options.durationSec,
      onProgress,
    })
  }
  // Audio compression.
  const outFmt = normalizeFormat(format || 'mp3')
  const outName = `output.${extForFormat(outFmt)}`
  const args = buildAudioCompressArgs({
    input: inName,
    output: outName,
    format: outFmt,
    bitrate: options.bitrate,
    channels: options.channels,
    sampleRate: options.sampleRate,
  })
  return runFFmpeg({
    files: [{ name: inName, data: file }],
    args,
    outName,
    outMime: mimeForFormat(outFmt),
    durationSec: options.durationSec,
    onProgress,
  })
}

// Extract + downsample an audio track for ASR upload (mono 16 kHz low-bitrate). Optionally a time
// window [startSec, durSec) for chunked long-media transcription. Returns a Blob (small mp3/opus).
//   extractAudioForAsr(file, { format, startSec, durSec, sampleRate, bitrate, durationSec, onProgress }) -> Blob
export async function extractAudioForAsr(file, { format = 'mp3', startSec, durSec, sampleRate = 16000, bitrate = '48k', durationSec, onProgress } = {}) {
  const fmt = normalizeFormat(format)
  const inName = safeInputName(file?.name, isVideoInput(file?.name, file?.type) ? 'mp4' : 'mp3')
  const outName = `asr.${extForFormat(fmt)}`
  const args = buildAsrExtractArgs({ input: inName, output: outName, format: fmt, startSec, durSec, sampleRate, bitrate })
  return runFFmpeg({
    files: [{ name: inName, data: file }],
    args,
    outName,
    outMime: mimeForFormat(fmt),
    durationSec: durationSec || durSec,
    onProgress,
  })
}

// Edit an audio file with the workbench controls (trim / gain / fade / resample / channels /
// normalize) and re-encode to `outputFormat`. Video inputs are reduced to their audio track.
//   editAudio(file, { outputFormat, edit:{ trimStart, trimEnd, gainDb, fadeIn, fadeOut, normalize,
//                     sampleRate, channels, bitrate, durationSec }, onProgress }) -> Blob
export async function editAudio(file, { outputFormat, edit = {}, onProgress } = {}) {
  const fmt = normalizeFormat(outputFormat)
  const inName = safeInputName(file?.name, 'mp3')
  const outName = `output.${extForFormat(fmt)}`
  const stripVideo = isVideoInput(file?.name, file?.type)

  const args = buildEditArgs({
    input: inName,
    output: outName,
    format: fmt,
    trimStart: edit.trimStart,
    trimEnd: edit.trimEnd,
    gainDb: edit.gainDb,
    fadeIn: edit.fadeIn,
    fadeOut: edit.fadeOut,
    normalize: edit.normalize,
    sampleRate: edit.sampleRate,
    channels: edit.channels,
    bitrate: edit.bitrate,
    stripVideo,
    clipDuration: edit.durationSec,
  })

  return runFFmpeg({
    files: [{ name: inName, data: file }],
    args,
    outName,
    outMime: mimeForFormat(fmt),
    durationSec: edit.durationSec,
    onProgress,
  })
}

// Run a RAW user-supplied ffmpeg command against the loaded file (advanced mode). We splice the
// real input/output filenames in; the output extension defaults to the chosen format (or the
// input's extension). Returns { blob, outName }.
//   runCustomCommand(file, { raw, outputFormat, durationSec, onProgress }) -> { blob, name }
export async function runCustomCommand(file, { raw, outputFormat, durationSec, onProgress } = {}) {
  const inExt = extOf(file?.name) || 'mp3'
  const inName = `input.${inExt}`
  // Default output extension: an explicit chosen format wins; else mirror the input container.
  const outExt = outputFormat ? extForFormat(outputFormat) : inExt
  const defaultOutput = `output.${outExt}`

  const { args, output } = buildCustomArgs({ raw, input: inName, defaultOutput })
  // MIME best-effort from the resolved output extension.
  const outExtFinal = (output.match(/\.([^.]+)$/)?.[1] || outExt).toLowerCase()
  const outMime = mimeForFormat(outExtFinal)

  const blob = await runFFmpeg({
    files: [{ name: inName, data: file }],
    args,
    outName: output,
    outMime,
    durationSec,
    onProgress,
  })
  return { blob, name: output, ext: outExtFinal }
}

// Burn (hardcode) subtitles into a video — re-encodes the video stream so the subs are pixels.
//   burnSubtitles({ video, subtitle, options:{ crf, preset, fontName, fontSize }, onProgress }) -> Blob
export async function burnSubtitles({ video, subtitle, options = {}, onProgress } = {}) {
  const vName = safeInputName(video?.name, 'mp4')
  const subExt = (subtitle?.name || 'subs.srt').toLowerCase().endsWith('.ass') ? 'ass' : 'srt'
  const sName = `subs.${subExt}`
  // Hardsub output is always mp4 (H.264 + copied audio) for maximum compatibility.
  const outName = 'output.mp4'

  const args = buildHardSubArgs({
    video: vName,
    subtitle: sName,
    output: outName,
    crf: options.crf,
    preset: options.preset,
    fontName: options.fontName,
    fontSize: options.fontSize,
    audioCopy: true,
  })

  return runFFmpeg({
    files: [{ name: vName, data: video }, { name: sName, data: subtitle }],
    args,
    outName,
    outMime: 'video/mp4',
    onProgress,
  })
}

// Mux (soft-embed) subtitles as a selectable track — no A/V re-encode, fast and lossless.
// Output keeps the source container when possible (mp4/mov → mov_text; mkv → srt).
//   muxSubtitles({ video, subtitle, options:{ container, language }, onProgress }) -> Blob
export async function muxSubtitles({ video, subtitle, options = {}, onProgress } = {}) {
  const srcExt = (video?.name || '').toLowerCase().match(/\.([^.]+)$/)?.[1] || 'mp4'
  const container = options.container || (srcExt === 'mkv' ? 'mkv' : 'mp4')
  const vName = safeInputName(video?.name, 'mp4')
  const subExt = (subtitle?.name || 'subs.srt').toLowerCase().endsWith('.ass') ? 'ass' : 'srt'
  const sName = `subs.${subExt}`
  const outName = `output.${container}`

  const args = buildSoftSubArgs({
    video: vName,
    subtitle: sName,
    output: outName,
    container,
    language: options.language,
  })

  return runFFmpeg({
    files: [{ name: vName, data: video }, { name: sName, data: subtitle }],
    args,
    outName,
    outMime: container === 'mkv' ? 'video/x-matroska' : 'video/mp4',
    onProgress,
  })
}

// ---------------------------------------------------------------------------
// METADATA editor — read ALL tags + technical info, write edited tags, strip all (no re-encode).
// ---------------------------------------------------------------------------

// Read EVERY format-level tag from an audio file via ffmpeg's canonical ffmetadata dump
// (`-i input -f ffmetadata meta.txt`), plus stream/technical info parsed from the log, plus the
// embedded cover (decoded by the dependency-free ./metadata reader). Fully client-side; never throws
// — degrades to whatever it could read.
//   readAllMetadata(file) -> {
//     tags:{k:v}, order:[k], common:[{key,value}], custom:[{key,value}], tail,
//     info:{ codec, durationSec, bitrateKbps, sampleRate, channels, channelLayout, hasCover },
//     cover?:{ mime, bytes }, coverUrl?, ext, limitedTags
//   }
export async function readAllMetadata(file) {
  const ext = extOf(file?.name) || 'mp3'
  const inName = `input.${ext}`
  // Canonical full-tag dump. -f ffmetadata writes every global tag (and [CHAPTER]/[STREAM] tails).
  const { text, log } = await probeMetadata({
    files: [{ name: inName, data: file }],
    args: ['-i', inName, '-f', 'ffmetadata', '-y', 'meta.txt'],
    textOut: 'meta.txt',
  })

  const parsed = parseFFMetadata(text)
  const { common, custom } = splitTags(parsed)

  const info = {
    ...parseDurationInfo(log),
    ...parseAudioStreamInfo(log),
    ...parseVideoStreamInfo(log), // resolution/codec/fps for real video files (no-op for audio)
    hasCover: hasAttachedPicture(log),
  }

  const out = {
    tags: parsed.tags,
    order: parsed.order,
    common,
    custom,
    tail: parsed.tail,
    info,
    ext,
    limitedTags: hasLimitedTagSupport(ext),
  }

  // Embedded cover art (mp3/flac/m4a) via the existing reader — gives us bytes + an object URL for
  // display without a second ffmpeg pass. Safe/empty on failure.
  try {
    const { readTags } = await import('./metadata')
    const t = await readTags(file)
    if (t?.cover) { out.cover = t.cover; out.coverUrl = t.coverUrl; out.info.hasCover = true }
    else if (t?.coverUrl) { try { URL.revokeObjectURL(t.coverUrl) } catch { /* ignore */ } }
  } catch { /* no cover */ }

  return out
}

// Write edited metadata into a downloadable copy WITHOUT re-encoding the audio (`-c copy`), using the
// ffmetadata-file approach so ANY/all keys (common + custom) are supported. `entries` is the ordered
// [{ key, value }] list to persist (omit a key to remove it). Cover handling:
//   • newCover (File/Blob)  → embed it as the artwork (replaces any existing).
//   • removeCover: true     → drop any embedded cover.
//   • otherwise             → preserve the existing embedded cover.
// `tail` carries through preserved [CHAPTER]/[STREAM] blocks from the read step. Returns a Blob.
//   writeAllMetadata(file, { entries, tail, newCover, removeCover }) -> Blob
export async function writeAllMetadata(file, { entries = [], tail = '', newCover = null, removeCover = false } = {}) {
  const ext = extOf(file?.name) || 'mp3'
  const isMp3 = ext === 'mp3'
  const inName = `input.${ext}`
  const outName = `output.${ext}`
  const metaName = 'meta.txt'

  const metaText = serializeFFMetadata(entries, { tail })

  const files = [
    { name: inName, data: file },
    { name: metaName, data: new Blob([metaText], { type: 'text/plain' }) },
  ]
  let coverName = null
  if (newCover) {
    const cExt = extOf(newCover?.name) || (String(newCover?.type || '').includes('png') ? 'png' : 'jpg')
    coverName = `cover.${cExt}`
    files.push({ name: coverName, data: newCover })
  }

  const args = buildWriteMetadataArgs({
    input: inName,
    metaFile: metaName,
    output: outName,
    cover: coverName,
    keepCover: !removeCover,
    removeCover,
    isMp3,
  })

  return runFFmpeg({
    files,
    args,
    outName,
    outMime: mimeForFormat(ext) === 'application/octet-stream' ? (file?.type || 'application/octet-stream') : mimeForFormat(ext),
  })
}

// Strip ALL metadata (and chapters) from an audio file WITHOUT re-encoding. `keepCover` decides
// whether the embedded artwork (a stream, not a tag) survives. Returns a Blob.
//   stripAllMetadata(file, { keepCover }) -> Blob
export async function stripAllMetadata(file, { keepCover = false } = {}) {
  const ext = extOf(file?.name) || 'mp3'
  const isMp3 = ext === 'mp3'
  const inName = `input.${ext}`
  const outName = `output.${ext}`

  const args = buildStripMetadataArgs({ input: inName, output: outName, keepCover, isMp3 })

  return runFFmpeg({
    files: [{ name: inName, data: file }],
    args,
    outName,
    outMime: mimeForFormat(ext) === 'application/octet-stream' ? (file?.type || 'application/octet-stream') : mimeForFormat(ext),
  })
}
