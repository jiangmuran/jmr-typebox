import { describe, it, expect } from 'vitest'
import {
  AUDIO_FORMATS,
  normalizeFormat,
  mimeForFormat,
  extForFormat,
  baseName,
  buildOutputName,
  virtualNames,
  buildFfmpegArgs,
  formatSize,
  formatDuration,
  isLossyFormat,
  BITRATE_PRESETS,
  MEDIA_CONVERTERS,
  converterForRoute,
} from '../mediaHelpers'
import { ALL_PATHS } from '../../../router/meta'

describe('normalizeFormat', () => {
  it('lowercases, trims, and strips a leading dot', () => {
    expect(normalizeFormat('  MP3 ')).toBe('mp3')
    expect(normalizeFormat('.WAV')).toBe('wav')
  })
  it('handles empty/nullish', () => {
    expect(normalizeFormat('')).toBe('')
    expect(normalizeFormat(undefined)).toBe('')
  })
})

describe('mimeForFormat', () => {
  it('maps known audio formats to MIME types', () => {
    expect(mimeForFormat('mp3')).toBe('audio/mpeg')
    expect(mimeForFormat('wav')).toBe('audio/wav')
    expect(mimeForFormat('OGG')).toBe('audio/ogg')
    expect(mimeForFormat('flac')).toBe('audio/flac')
  })
  it('falls back for unknown formats', () => {
    expect(mimeForFormat('xyz')).toBe('application/octet-stream')
  })
})

describe('extForFormat', () => {
  it('returns the canonical extension', () => {
    expect(extForFormat('mp3')).toBe('mp3')
    expect(extForFormat('.WAV')).toBe('wav')
  })
  it('echoes unknown tokens (normalized) as a best-effort extension', () => {
    expect(extForFormat('opus')).toBe('opus')
  })
})

describe('baseName', () => {
  it('strips the extension', () => {
    expect(baseName('song.mp3')).toBe('song')
    expect(baseName('my.track.name.wav')).toBe('my.track.name')
  })
  it('handles no extension and empty input', () => {
    expect(baseName('noext')).toBe('noext')
    expect(baseName('')).toBe('audio')
  })
})

describe('buildOutputName', () => {
  it('swaps the extension to the target format', () => {
    expect(buildOutputName('song.mp3', 'wav')).toBe('song.wav')
    expect(buildOutputName('clip.wav', 'mp3')).toBe('clip.mp3')
  })
  it('preserves dotted basenames', () => {
    expect(buildOutputName('a.b.c.mp3', 'wav')).toBe('a.b.c.wav')
  })
  it('defaults a missing name', () => {
    expect(buildOutputName('', 'mp3')).toBe('audio.mp3')
  })
})

describe('virtualNames', () => {
  it('produces distinct input/output FS names by extension', () => {
    expect(virtualNames('mp3', 'wav')).toEqual({ input: 'input.mp3', output: 'output.wav' })
    expect(virtualNames('wav', 'mp3')).toEqual({ input: 'input.wav', output: 'output.mp3' })
  })
})

describe('buildFfmpegArgs', () => {
  it('builds mp3 -> wav with PCM codec', () => {
    const args = buildFfmpegArgs({ inputFile: 'input.mp3', outputFile: 'output.wav', outputFormat: 'wav' })
    expect(args).toEqual(['-i', 'input.mp3', '-c:a', 'pcm_s16le', 'output.wav'])
  })

  it('builds wav -> mp3 with libmp3lame default quality', () => {
    const args = buildFfmpegArgs({ inputFile: 'input.wav', outputFile: 'output.mp3', outputFormat: 'mp3' })
    expect(args).toEqual(['-i', 'input.wav', '-c:a', 'libmp3lame', '-q:a', '2', 'output.mp3'])
  })

  it('starts with -i input and ends with the output file', () => {
    const args = buildFfmpegArgs({ inputFile: 'in.wav', outputFile: 'out.mp3', outputFormat: 'mp3' })
    expect(args[0]).toBe('-i')
    expect(args[1]).toBe('in.wav')
    expect(args[args.length - 1]).toBe('out.mp3')
  })

  it('an explicit bitrate replaces the default -q:a quality for lossy output', () => {
    const args = buildFfmpegArgs({
      inputFile: 'input.wav', outputFile: 'output.mp3', outputFormat: 'mp3',
      options: { bitrate: '128k' },
    })
    expect(args).toContain('-b:a')
    expect(args).toContain('128k')
    expect(args).not.toContain('-q:a')
    // sanity: the dropped value '2' should not linger
    expect(args).not.toContain('2')
  })

  it('appends sample rate and channels when provided', () => {
    const args = buildFfmpegArgs({
      inputFile: 'input.mp3', outputFile: 'output.wav', outputFormat: 'wav',
      options: { sampleRate: 44100, channels: 1 },
    })
    expect(args).toContain('-ar'); expect(args).toContain('44100')
    expect(args).toContain('-ac'); expect(args).toContain('1')
    // output file stays last
    expect(args[args.length - 1]).toBe('output.wav')
  })

  it('throws on unknown output format or missing files', () => {
    expect(() => buildFfmpegArgs({ inputFile: 'a', outputFile: 'b', outputFormat: 'zzz' })).toThrow()
    expect(() => buildFfmpegArgs({ outputFile: 'b', outputFormat: 'mp3' })).toThrow()
    expect(() => buildFfmpegArgs({ inputFile: 'a', outputFormat: 'mp3' })).toThrow()
  })

  it('every registered AUDIO_FORMATS entry produces a valid arg vector', () => {
    for (const fmt of Object.keys(AUDIO_FORMATS)) {
      const args = buildFfmpegArgs({ inputFile: 'in.wav', outputFile: `out.${fmt}`, outputFormat: fmt })
      expect(Array.isArray(args)).toBe(true)
      expect(args[0]).toBe('-i')
      expect(args[args.length - 1]).toBe(`out.${fmt}`)
      // a codec must always be selected
      expect(args).toContain('-c:a')
    }
  })
})

describe('isLossyFormat', () => {
  it('flags lossy codecs', () => {
    expect(isLossyFormat('mp3')).toBe(true)
    expect(isLossyFormat('ogg')).toBe(true)
    expect(isLossyFormat('aac')).toBe(true)
  })
  it('treats wav/flac as not lossy', () => {
    expect(isLossyFormat('wav')).toBe(false)
    expect(isLossyFormat('flac')).toBe(false)
  })
})

describe('formatSize', () => {
  it('formats bytes, KB, and MB', () => {
    expect(formatSize(512)).toBe('512 B')
    expect(formatSize(2048)).toBe('2.0 KB')
    expect(formatSize(5 * 1024 * 1024)).toBe('5.00 MB')
  })
  it('handles nullish', () => {
    expect(formatSize(undefined)).toBe('0 B')
  })
})

describe('formatDuration', () => {
  it('formats seconds as m:ss with zero padding', () => {
    expect(formatDuration(0)).toBe('0:00')
    expect(formatDuration(5)).toBe('0:05')
    expect(formatDuration(65)).toBe('1:05')
    expect(formatDuration(3725)).toBe('62:05')
  })
})

describe('BITRATE_PRESETS', () => {
  it('are ascending kbps strings', () => {
    expect(BITRATE_PRESETS).toContain('128k')
    expect(BITRATE_PRESETS[0]).toBe('96k')
  })
})

describe('MEDIA_CONVERTERS / converterForRoute', () => {
  it('covers exactly the /media/* routes declared in the router meta', () => {
    const routeMediaPaths = ALL_PATHS.filter(p => p.startsWith('/media/')).sort()
    const declared = MEDIA_CONVERTERS.map(c => c.route).sort()
    expect(declared).toEqual(routeMediaPaths)
  })

  it('each converter has a known input and output format', () => {
    for (const c of MEDIA_CONVERTERS) {
      expect(AUDIO_FORMATS[c.input], `input ${c.input}`).toBeTruthy()
      expect(AUDIO_FORMATS[c.output], `output ${c.output}`).toBeTruthy()
      expect(c.id).toBe(`${c.input}-to-${c.output}`)
    }
  })

  it('looks up a converter by route path', () => {
    expect(converterForRoute('/media/mp3-to-wav')).toMatchObject({ input: 'mp3', output: 'wav' })
    expect(converterForRoute('/media/wav-to-mp3')).toMatchObject({ input: 'wav', output: 'mp3' })
    expect(converterForRoute('/media/nope')).toBe(null)
  })
})
