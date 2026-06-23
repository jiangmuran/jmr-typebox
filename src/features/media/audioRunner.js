// High-level media operations, built on the ffmpeg.wasm engine (./ffmpegRunner). Client-only:
// these functions touch Blob/Worker via the engine, but the module has no top-level side effects
// and is always reached through a dynamic import() from event handlers / converter run() calls.
import {
  buildConvertArgs, buildHardSubArgs, buildSoftSubArgs, buildEditArgs, buildCustomArgs,
  safeInputName, extForFormat, mimeForFormat, normalizeFormat, isVideoInput, extOf,
} from './mediaHelpers'
import { runFFmpeg } from './ffmpegRunner'

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
