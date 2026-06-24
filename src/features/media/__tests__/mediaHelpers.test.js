import { describe, it, expect } from 'vitest'
import {
  AUDIO_FORMATS, AUDIO_OUTPUT_FORMATS,
  mimeForFormat, extForFormat, codecForFormat, isLossyFormat, audioFormatDef,
  normalizeFormat, extOf, baseName, buildOutputName, buildOutputNameWithSuffix,
  formatSize, formatDuration, normalizeBitrate,
  isVideoInput, isAudioInput, isSubtitleInput, isMediaInput, safeInputName,
  buildConvertArgs, buildHardSubArgs, buildSoftSubArgs, escapeSubtitlePath,
  buildAudioFilters, buildEditArgs, tokenizeArgs, buildCustomArgs, clampNum, secToFFTime,
  buildTagArgs, MEDIA_CONVERTERS, converterForRoute,
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

describe('media helpers — small math utils', () => {
  it('clampNum clamps and falls back on non-finite', () => {
    expect(clampNum(5, 0, 10)).toBe(5)
    expect(clampNum(-3, 0, 10)).toBe(0)
    expect(clampNum(99, 0, 10)).toBe(10)
    expect(clampNum('x', 0, 10, 7)).toBe(7)
    expect(clampNum(undefined, 1, 10, 3)).toBe(3)
  })

  it('secToFFTime renders plain seconds with ms precision', () => {
    expect(secToFFTime(3)).toBe('3')
    expect(secToFFTime(3.5)).toBe('3.5')
    expect(secToFFTime(3.12345)).toBe('3.123')
    expect(secToFFTime(-1)).toBe('0')
  })
})

describe('media helpers — audio edit filter builder', () => {
  it('empty edit yields no filter', () => {
    expect(buildAudioFilters({})).toBe('')
    expect(buildAudioFilters({ gainDb: 0, fadeIn: 0, fadeOut: 0, normalize: false })).toBe('')
  })

  it('gain in dB', () => {
    expect(buildAudioFilters({ gainDb: 3 })).toBe('volume=3dB')
    expect(buildAudioFilters({ gainDb: -6.5 })).toBe('volume=-6.5dB')
  })

  it('fade in/out anchored to clip duration', () => {
    expect(buildAudioFilters({ fadeIn: 2 })).toBe('afade=t=in:st=0:d=2')
    expect(buildAudioFilters({ fadeOut: 3, clipDuration: 10 })).toBe('afade=t=out:st=7:d=3')
  })

  it('fade out without known duration still applies', () => {
    const f = buildAudioFilters({ fadeOut: 3 })
    expect(f).toContain('afade=t=out')
    expect(f).toContain('d=3')
  })

  it('normalize adds loudnorm', () => {
    expect(buildAudioFilters({ normalize: true })).toContain('loudnorm=')
  })

  it('chains multiple filters in order', () => {
    const f = buildAudioFilters({ gainDb: 2, fadeIn: 1, fadeOut: 1, normalize: true, clipDuration: 10 })
    expect(f.split(',')).toEqual([
      'volume=2dB', 'afade=t=in:st=0:d=1', 'afade=t=out:st=9:d=1', 'loudnorm=I=-16:TP=-1.5:LRA=11',
    ])
  })
})

describe('media helpers — buildEditArgs', () => {
  it('plain re-encode with no edits', () => {
    const args = buildEditArgs({ input: 'input.wav', output: 'output.mp3', format: 'mp3' })
    expect(args).toEqual(['-i', 'input.wav', '-c:a', 'libmp3lame', '-b:a', '192k', 'output.mp3'])
  })

  it('trim uses -ss before -i and -t for duration', () => {
    const args = buildEditArgs({ input: 'i.mp3', output: 'o.mp3', format: 'mp3', trimStart: 5, trimEnd: 12 })
    expect(args[0]).toBe('-ss'); expect(args[1]).toBe('5')
    expect(args[2]).toBe('-i'); expect(args[3]).toBe('i.mp3')
    expect(args).toContain('-t'); expect(args[args.indexOf('-t') + 1]).toBe('7') // 12 - 5
  })

  it('trim end only (no start) uses -t = end', () => {
    const args = buildEditArgs({ input: 'i.mp3', output: 'o.mp3', format: 'mp3', trimEnd: 8 })
    expect(args[0]).toBe('-i')
    expect(args[args.indexOf('-t') + 1]).toBe('8')
  })

  it('gain + fades produce an -af chain', () => {
    const args = buildEditArgs({ input: 'i.wav', output: 'o.wav', format: 'wav', gainDb: -3, fadeIn: 1, clipDuration: 20 })
    expect(args).toContain('-af')
    const af = args[args.indexOf('-af') + 1]
    expect(af).toContain('volume=-3dB')
    expect(af).toContain('afade=t=in')
    // wav is lossless → no -b:a
    expect(args).not.toContain('-b:a')
  })

  it('fade-out anchors to the trimmed clip length, not the original', () => {
    const args = buildEditArgs({ input: 'i.mp3', output: 'o.mp3', format: 'mp3', trimStart: 10, trimEnd: 20, fadeOut: 2, clipDuration: 100 })
    const af = args[args.indexOf('-af') + 1]
    // clip is 10s long (20-10), fade-out 2s → starts at 8s
    expect(af).toContain('afade=t=out:st=8:d=2')
  })

  it('stripVideo + resample + channels', () => {
    const args = buildEditArgs({ input: 'i.mp4', output: 'o.mp3', format: 'mp3', stripVideo: true, sampleRate: 44100, channels: 1 })
    expect(args).toContain('-vn')
    expect(args[args.indexOf('-ar') + 1]).toBe('44100')
    expect(args[args.indexOf('-ac') + 1]).toBe('1')
  })

  it('throws on unknown output format', () => {
    expect(() => buildEditArgs({ format: 'zzz' })).toThrow(/Unsupported output format/)
  })
})

describe('media helpers — custom command tokenizer', () => {
  it('splits on whitespace', () => {
    expect(tokenizeArgs('-ar 44100 -ac 1')).toEqual(['-ar', '44100', '-ac', '1'])
  })
  it('honors double quotes', () => {
    expect(tokenizeArgs('-af "volume=2dB"')).toEqual(['-af', 'volume=2dB'])
  })
  it('honors single quotes', () => {
    expect(tokenizeArgs("-af 'aresample=async=1'")).toEqual(['-af', 'aresample=async=1'])
  })
  it('keeps quoted spaces together', () => {
    expect(tokenizeArgs('-metadata "title=My Song"')).toEqual(['-metadata', 'title=My Song'])
  })
  it('empty / whitespace → []', () => {
    expect(tokenizeArgs('')).toEqual([])
    expect(tokenizeArgs('   ')).toEqual([])
  })
})

describe('media helpers — buildCustomArgs', () => {
  it('wires -i input and appends default output when user gives only filters', () => {
    const { args, output } = buildCustomArgs({ raw: '-af loudnorm', input: 'input.mp3', defaultOutput: 'output.mp3' })
    expect(args).toEqual(['-i', 'input.mp3', '-af', 'loudnorm', 'output.mp3'])
    expect(output).toBe('output.mp3')
  })

  it('respects an explicit output filename in the user command', () => {
    const { args, output } = buildCustomArgs({ raw: '-af loudnorm out.wav', input: 'input.mp3', defaultOutput: 'output.mp3' })
    expect(output).toBe('out.wav')
    expect(args[args.length - 1]).toBe('out.wav')
    // still injects the input
    expect(args.slice(0, 2)).toEqual(['-i', 'input.mp3'])
  })

  it('does not double-inject -i when the user already supplied one', () => {
    const { args } = buildCustomArgs({ raw: '-i input.mp3 -af loudnorm out.mp3', input: 'input.mp3', defaultOutput: 'output.mp3' })
    expect(args.filter(a => a === '-i').length).toBe(1)
  })

  it('expands {input}/{output} placeholders', () => {
    const { args, output } = buildCustomArgs({ raw: '-i {input} -af loudnorm {output}', input: 'input.mp3', defaultOutput: 'output.wav' })
    expect(args).toContain('input.mp3')
    expect(output).toBe('output.wav')
    expect(args[args.length - 1]).toBe('output.wav')
  })

  // Regression: a filter value like `atempo=2.0` ends with ".0" and used to be mistaken for an
  // output filename, leaving the command with NO output → "At least one output file must be
  // specified". A real output must always be appended.
  it('does NOT treat a filter value (atempo=2.0) as an output filename', () => {
    const { args, output } = buildCustomArgs({ raw: '-af atempo=2.0', input: 'input.mp3', defaultOutput: 'output.mp3' })
    expect(output).toBe('output.mp3')
    expect(args).toEqual(['-i', 'input.mp3', '-af', 'atempo=2.0', 'output.mp3'])
  })

  it('does NOT treat volume=0.5 / equals-bearing tokens as filenames', () => {
    const { args, output } = buildCustomArgs({ raw: "-af 'volume=0.5' -b:a 320k", input: 'input.mp3', defaultOutput: 'output.mp3' })
    expect(output).toBe('output.mp3')
    expect(args[args.length - 1]).toBe('output.mp3')
    expect(args).toContain('volume=0.5')
  })

  it('still honors an explicit real output extension even after a filter value', () => {
    const { args, output } = buildCustomArgs({ raw: '-af atempo=2.0 out.wav', input: 'input.mp3', defaultOutput: 'output.mp3' })
    expect(output).toBe('out.wav')
    expect(args[args.length - 1]).toBe('out.wav')
  })

  it('treats a lone -i input (no filter) correctly (input not mistaken for output)', () => {
    const { args, output } = buildCustomArgs({ raw: '-i input.mp3 -ar 44100', input: 'input.mp3', defaultOutput: 'output.mp3' })
    expect(args.filter(a => a === '-i').length).toBe(1)
    expect(output).toBe('output.mp3')
    expect(args[args.length - 1]).toBe('output.mp3')
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

describe('media helpers — buildTagArgs (player metadata rewrite)', () => {
  it('copies streams and writes only the provided non-empty tags', () => {
    const args = buildTagArgs({ input: 'input.mp3', output: 'output.mp3', title: 'T', artist: 'A', album: '' })
    expect(args).toContain('-c')
    expect(args[args.indexOf('-c') + 1]).toBe('copy')
    expect(args).toContain('-metadata')
    expect(args.join(' ')).toContain('title=T')
    expect(args.join(' ')).toContain('artist=A')
    // empty album is skipped (no album= token)
    expect(args.join(' ')).not.toContain('album=')
    // output is last
    expect(args[args.length - 1]).toBe('output.mp3')
  })
  it('skips all tags when none provided (still copies through)', () => {
    const args = buildTagArgs({ input: 'i.mp3', output: 'o.mp3' })
    expect(args).not.toContain('-metadata')
    expect(args).toEqual(['-i', 'i.mp3', '-map', '0', '-c', 'copy', '-id3v2_version', '3', 'o.mp3'])
  })
})
