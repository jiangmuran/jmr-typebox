import { describe, it, expect } from 'vitest'
import {
  AUDIO_FORMATS, AUDIO_OUTPUT_FORMATS,
  mimeForFormat, extForFormat, codecForFormat, isLossyFormat, audioFormatDef,
  normalizeFormat, extOf, baseName, buildOutputName, buildOutputNameWithSuffix,
  formatSize, formatDuration, normalizeBitrate,
  isVideoInput, isAudioInput, isSubtitleInput, isMediaInput, safeInputName,
  buildConvertArgs, buildHardSubArgs, buildSoftSubArgs, escapeSubtitlePath,
  MEDIA_CONVERTERS, converterForRoute,
} from '../mediaHelpers'
import { ALL_PATHS } from '../../../router/meta'

describe('media helpers — format catalog', () => {
  it('mime + ext + codec for known formats', () => {
    expect(mimeForFormat('mp3')).toBe('audio/mpeg')
    expect(mimeForFormat('wav')).toBe('audio/wav')
    expect(mimeForFormat('flac')).toBe('audio/flac')
    expect(extForFormat('.MP3')).toBe('mp3')
    expect(extForFormat('m4a')).toBe('m4a')
    expect(codecForFormat('mp3')).toBe('libmp3lame')
    expect(codecForFormat('wav')).toBe('pcm_s16le')
    expect(codecForFormat('opus')).toBe('libopus')
  })

  it('unknown format degrades gracefully', () => {
    expect(mimeForFormat('xyz')).toBe('application/octet-stream')
    expect(audioFormatDef('xyz')).toBeNull()
    expect(extForFormat('xyz')).toBe('xyz')
    expect(codecForFormat('xyz')).toBeNull()
  })

  it('lossy detection', () => {
    expect(isLossyFormat('mp3')).toBe(true)
    expect(isLossyFormat('aac')).toBe(true)
    expect(isLossyFormat('opus')).toBe(true)
    expect(isLossyFormat('wav')).toBe(false)
    expect(isLossyFormat('flac')).toBe(false)
  })

  it('exposes all output formats requested by the spec', () => {
    for (const f of ['mp3', 'wav', 'flac', 'ogg', 'aac', 'm4a', 'opus']) {
      expect(AUDIO_OUTPUT_FORMATS).toContain(f)
      expect(AUDIO_FORMATS[f]).toBeTruthy()
    }
  })
})

describe('media helpers — string/number utils', () => {
  it('extOf', () => {
    expect(extOf('a/b/song.MP3')).toBe('mp3')
    expect(extOf('noext')).toBe('')
    expect(extOf('a.b.c.wav')).toBe('wav')
  })

  it('baseName strips extension', () => {
    expect(baseName('song.mp3')).toBe('song')
    expect(baseName('a.b.wav')).toBe('a.b')
    expect(baseName('')).toBe('output')
  })

  it('output filename swaps extension', () => {
    expect(buildOutputName('song.mp3', 'wav')).toBe('song.wav')
    expect(buildOutputName('a.b.wav', 'flac')).toBe('a.b.flac')
  })

  it('output filename with suffix (audio extraction)', () => {
    expect(buildOutputNameWithSuffix('clip.mp4', 'mp3', '-audio')).toBe('clip-audio.mp3')
    expect(buildOutputNameWithSuffix('clip.mp4', 'mp3', '')).toBe('clip.mp3')
  })

  it('formatSize', () => {
    expect(formatSize(500)).toBe('500 B')
    expect(formatSize(2048)).toBe('2.0 KB')
    expect(formatSize(5 * 1024 * 1024)).toBe('5.00 MB')
    expect(formatSize(3 * 1024 * 1024 * 1024)).toBe('3.00 GB')
  })

  it('formatDuration', () => {
    expect(formatDuration(0)).toBe('0:00')
    expect(formatDuration(65)).toBe('1:05')
    expect(formatDuration(3661)).toBe('1:01:01')
  })

  it('normalizeBitrate', () => {
    expect(normalizeBitrate('192k')).toBe('192k')
    expect(normalizeBitrate('320')).toBe('320k')
    expect(normalizeBitrate('')).toBe('192k')
    expect(normalizeBitrate('garbage')).toBe('192k')
    expect(normalizeBitrate('', '128k')).toBe('128k')
    expect(normalizeBitrate('128000')).toBe('128000')
  })
})

describe('media helpers — input classification', () => {
  it('video detection by extension and mime', () => {
    expect(isVideoInput('clip.mp4')).toBe(true)
    expect(isVideoInput('clip.MKV')).toBe(true)
    expect(isVideoInput('a.webm')).toBe(true)
    expect(isVideoInput('song.mp3')).toBe(false)
    expect(isVideoInput('x', 'video/quicktime')).toBe(true)
  })

  it('audio detection by extension and mime', () => {
    expect(isAudioInput('song.mp3')).toBe(true)
    expect(isAudioInput('a.flac')).toBe(true)
    expect(isAudioInput('x', 'audio/wav')).toBe(true)
    expect(isAudioInput('clip.avi')).toBe(false) // pure video container, not audio
    // mp4/3gp are intentionally ambiguous (can be audio-only); isVideoInput decides the UI path.
    expect(isVideoInput('clip.mp4')).toBe(true)
  })

  it('subtitle detection', () => {
    expect(isSubtitleInput('movie.srt')).toBe(true)
    expect(isSubtitleInput('movie.ass')).toBe(true)
    expect(isSubtitleInput('movie.vtt')).toBe(true)
    expect(isSubtitleInput('movie.mp4')).toBe(false)
  })

  it('isMediaInput accepts audio or video', () => {
    expect(isMediaInput('a.mp3')).toBe(true)
    expect(isMediaInput('a.mp4')).toBe(true)
    expect(isMediaInput('a.srt')).toBe(false)
    expect(isMediaInput('a.txt')).toBe(false)
  })

  it('safeInputName keeps the real extension', () => {
    expect(safeInputName('My Song (final).mp3')).toBe('input.mp3')
    expect(safeInputName('视频.mp4')).toBe('input.mp4')
    expect(safeInputName('noext', 'wav')).toBe('input.wav')
  })
})

describe('media helpers — ffmpeg arg builders', () => {
  it('lossy convert adds codec + bitrate', () => {
    const args = buildConvertArgs({ input: 'input.wav', output: 'output.mp3', format: 'mp3', bitrate: '256k' })
    expect(args).toEqual(['-i', 'input.wav', '-c:a', 'libmp3lame', '-b:a', '256k', 'output.mp3'])
  })

  it('lossy convert defaults bitrate when omitted', () => {
    const args = buildConvertArgs({ input: 'input.wav', output: 'output.mp3', format: 'mp3' })
    expect(args).toContain('-b:a')
    expect(args[args.indexOf('-b:a') + 1]).toBe('192k')
  })

  it('lossless convert (wav) has no bitrate flag', () => {
    const args = buildConvertArgs({ input: 'input.mp3', output: 'output.wav', format: 'wav' })
    expect(args).toEqual(['-i', 'input.mp3', '-c:a', 'pcm_s16le', 'output.wav'])
    expect(args).not.toContain('-b:a')
  })

  it('flac honors compression level via quality', () => {
    const args = buildConvertArgs({ input: 'i.wav', output: 'o.flac', format: 'flac', quality: 8 })
    expect(args).toContain('-compression_level')
    expect(args[args.indexOf('-compression_level') + 1]).toBe('8')
  })

  it('video input strips video with -vn for audio extraction', () => {
    const args = buildConvertArgs({ input: 'input.mp4', output: 'output.mp3', format: 'mp3', stripVideo: true })
    expect(args).toEqual(['-i', 'input.mp4', '-vn', '-c:a', 'libmp3lame', '-b:a', '192k', 'output.mp3'])
  })

  it('sample rate + channels appended when provided', () => {
    const args = buildConvertArgs({ input: 'i.wav', output: 'o.mp3', format: 'mp3', sampleRate: 44100, channels: 1 })
    expect(args).toContain('-ar'); expect(args[args.indexOf('-ar') + 1]).toBe('44100')
    expect(args).toContain('-ac'); expect(args[args.indexOf('-ac') + 1]).toBe('1')
  })

  it('throws on unknown output format', () => {
    expect(() => buildConvertArgs({ format: 'xyz' })).toThrow(/Unsupported output format/)
  })

  it('escapeSubtitlePath escapes filtergraph specials', () => {
    expect(escapeSubtitlePath('C:\\subs:file[1].srt')).toBe("C\\:\\\\subs\\:file\\[1\\].srt")
  })

  it('hardsub args build a subtitles filter + libx264', () => {
    const args = buildHardSubArgs({ video: 'input.mp4', subtitle: 'subs.srt', output: 'output.mp4', crf: 20, preset: 'fast' })
    expect(args[0]).toBe('-i'); expect(args[1]).toBe('input.mp4')
    expect(args).toContain('-vf')
    expect(args[args.indexOf('-vf') + 1]).toBe('subtitles=subs.srt')
    expect(args).toContain('-c:v'); expect(args[args.indexOf('-c:v') + 1]).toBe('libx264')
    expect(args[args.indexOf('-crf') + 1]).toBe('20')
    expect(args[args.indexOf('-preset') + 1]).toBe('fast')
    expect(args[args.indexOf('-c:a') + 1]).toBe('copy')
    expect(args[args.length - 1]).toBe('output.mp4')
  })

  it('hardsub force_style carries font overrides', () => {
    const args = buildHardSubArgs({ subtitle: 'subs.srt', fontSize: 28, fontName: 'Arial' })
    const filter = args[args.indexOf('-vf') + 1]
    expect(filter).toContain('subtitles=subs.srt')
    expect(filter).toContain("force_style='FontName=Arial,FontSize=28'")
  })

  it('softsub mux uses mov_text for mp4', () => {
    const args = buildSoftSubArgs({ video: 'input.mp4', subtitle: 'subs.srt', output: 'output.mp4', container: 'mp4' })
    expect(args).toEqual(['-i', 'input.mp4', '-i', 'subs.srt', '-map', '0', '-map', '1', '-c', 'copy', '-c:s', 'mov_text', 'output.mp4'])
  })

  it('softsub mux uses srt for mkv', () => {
    const args = buildSoftSubArgs({ video: 'input.mkv', subtitle: 'subs.srt', output: 'output.mkv', container: 'mkv' })
    expect(args[args.indexOf('-c:s') + 1]).toBe('srt')
  })

  it('softsub mux attaches language metadata when given', () => {
    const args = buildSoftSubArgs({ container: 'mp4', language: 'eng' })
    expect(args).toContain('-metadata:s:s:0')
    expect(args[args.indexOf('-metadata:s:s:0') + 1]).toBe('language=eng')
  })
})

describe('media helpers — converter registry', () => {
  it('every /media converter route has SEO meta', () => {
    for (const c of MEDIA_CONVERTERS) {
      expect(ALL_PATHS, c.route).toContain(c.route)
    }
  })

  it('converterForRoute resolves and the registry covers the key conversions', () => {
    expect(converterForRoute('/media/mp3-to-wav')).toMatchObject({ input: 'mp3', output: 'wav' })
    expect(converterForRoute('/media/mp4-to-mp3')).toMatchObject({ input: 'mp4', output: 'mp3' })
    expect(converterForRoute('/media/nope')).toBeNull()
    expect(MEDIA_CONVERTERS.length).toBeGreaterThanOrEqual(2)
  })

  it('every converter output is a known format', () => {
    for (const c of MEDIA_CONVERTERS) {
      expect(audioFormatDef(c.output), c.id).toBeTruthy()
    }
  })
})
