// High-level media operations, built on the ffmpeg.wasm engine (./ffmpegRunner). Client-only:
// these functions touch Blob/Worker via the engine, but the module has no top-level side effects
// and is always reached through a dynamic import() from event handlers / converter run() calls.
import {
  buildConvertArgs, buildHardSubArgs, buildSoftSubArgs,
  safeInputName, extForFormat, mimeForFormat, normalizeFormat, isVideoInput,
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
    onProgress,
  })
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
