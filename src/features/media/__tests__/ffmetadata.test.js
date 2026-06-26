import { describe, it, expect } from 'vitest'
import {
  FFMETADATA_HEADER,
  escapeMeta, unescapeMeta,
  parseFFMetadata, serializeFFMetadata,
  canonicalTagKey, isCommonTagKey, splitTags, buildEntries,
  buildWriteMetadataArgs, buildStripMetadataArgs,
  parseDurationInfo, parseAudioStreamInfo, parseVideoStreamInfo, hasAttachedPicture, hasLimitedTagSupport,
  COMMON_TAG_KEYS,
} from '../ffmetadata'

describe('ffmetadata — escape / unescape', () => {
  it('escapes the ffmpeg special set (= ; # \\) and newline', () => {
    expect(escapeMeta('a=b')).toBe('a\\=b')
    expect(escapeMeta('a;b')).toBe('a\\;b')
    expect(escapeMeta('a#b')).toBe('a\\#b')
    expect(escapeMeta('a\\b')).toBe('a\\\\b')
    expect(escapeMeta('a\nb')).toBe('a\\\nb')
  })

  it('unescape is the inverse for the special set', () => {
    for (const s of ['plain', 'a=b', 'a;b#c', 'back\\slash', 'multi\nline', 'A\\=B\\;C\\#D\\\\E', 'café 日本語 — ok']) {
      expect(unescapeMeta(escapeMeta(s))).toBe(s)
    }
  })

  it('unescape handles a trailing lone backslash gracefully', () => {
    expect(unescapeMeta('abc\\')).toBe('abc\\')
  })
})

describe('ffmetadata — parse', () => {
  it('parses the canonical dump including a custom key and the encoder line', () => {
    const text = [
      ';FFMETADATA1',
      'title=Hello \\= World',
      'album=A\\;B\\#C\\\\D',
      'comment=naïve café — 日本語',
      'MY_CUSTOM_TAG=custom value 123',
      'track=3/12',
      'encoder=Lavf62.12.101',
    ].join('\n')
    const p = parseFFMetadata(text)
    expect(p.tags.title).toBe('Hello = World')
    expect(p.tags.album).toBe('A;B#C\\D')
    expect(p.tags.comment).toBe('naïve café — 日本語')
    expect(p.tags.my_custom_tag).toBe('custom value 123')
    expect(p.tags.track).toBe('3/12')
    expect(p.tags.encoder).toBe('Lavf62.12.101')
    expect(p.order).toContain('MY_CUSTOM_TAG') // original casing preserved in order/keyCase
    expect(p.keyCase.my_custom_tag).toBe('MY_CUSTOM_TAG')
  })

  it('resolves multi-line (escaped-newline) values', () => {
    // artist=Line1\<newline>Line2  → value is "Line1\nLine2"
    const text = ';FFMETADATA1\nartist=Line1\\\nLine2\ntitle=After'
    const p = parseFFMetadata(text)
    expect(p.tags.artist).toBe('Line1\nLine2')
    expect(p.tags.title).toBe('After')
  })

  it('keeps [SECTION] chapters/streams as an opaque tail, out of the global tags', () => {
    const text = [
      ';FFMETADATA1',
      'title=Global',
      '[CHAPTER]',
      'TIMEBASE=1/1000',
      'START=0',
      'END=500',
      'title=Intro', // a per-chapter title must NOT leak into global tags
    ].join('\n')
    const p = parseFFMetadata(text)
    expect(p.tags.title).toBe('Global')
    expect(p.tail).toContain('[CHAPTER]')
    expect(p.tail).toContain('title=Intro')
    // global `title` is the only title we surface
    expect(Object.keys(p.tags)).toEqual(['title'])
  })

  it('ignores comment lines and a missing header, tolerates CRLF', () => {
    const text = '; a comment\r\n# another\r\ntitle=X\r\nartist=Y\r\n'
    const p = parseFFMetadata(text)
    expect(p.tags).toEqual({ title: 'X', artist: 'Y' })
  })

  it('handles an = inside the value (only the first unescaped = splits)', () => {
    const p = parseFFMetadata(';FFMETADATA1\nurl=http://x/y?a=b&c=d')
    expect(p.tags.url).toBe('http://x/y?a=b&c=d')
  })
})

describe('ffmetadata — serialize + round-trip', () => {
  it('emits the header and key=value lines, escaping specials', () => {
    const out = serializeFFMetadata([
      { key: 'title', value: 'A = B' },
      { key: 'album', value: 'x;y' },
    ])
    expect(out.startsWith(FFMETADATA_HEADER + '\n')).toBe(true)
    expect(out).toContain('title=A \\= B')
    expect(out).toContain('album=x\\;y')
  })

  it('drops blank keys, de-dupes by key, preserves order and the tail', () => {
    const out = serializeFFMetadata([
      { key: 'title', value: 'T' },
      { key: '', value: 'ignored' },
      { key: 'title', value: 'dupe-dropped' },
      { key: 'custom', value: 'C' },
    ], { tail: '[CHAPTER]\nTIMEBASE=1/1000\nSTART=0\nEND=5\ntitle=Intro' })
    const lines = out.split('\n')
    expect(lines[0]).toBe(FFMETADATA_HEADER)
    expect(lines[1]).toBe('title=T')
    expect(lines[2]).toBe('custom=C')
    expect(out).toContain('[CHAPTER]')
  })

  it('round-trips an arbitrary tag set (parse → serialize → parse)', () => {
    const original = [
      { key: 'title', value: 'My = Song' },
      { key: 'artist', value: 'Some;Body' },
      { key: 'weird_key', value: 'has\nnewline and # hash' },
    ]
    const text = serializeFFMetadata(original)
    const reparsed = parseFFMetadata(text)
    expect(reparsed.tags.title).toBe('My = Song')
    expect(reparsed.tags.artist).toBe('Some;Body')
    expect(reparsed.tags.weird_key).toBe('has\nnewline and # hash')
  })
})

describe('ffmetadata — common-tag taxonomy', () => {
  it('canonicalizes well-known aliases', () => {
    expect(canonicalTagKey('YEAR')).toBe('date')
    expect(canonicalTagKey('album-artist')).toBe('album_artist')
    expect(canonicalTagKey('TrackNumber')).toBe('track')
    expect(canonicalTagKey('Unknown_Thing')).toBe('unknown_thing')
  })

  it('isCommonTagKey recognizes canonical + aliased common keys', () => {
    expect(isCommonTagKey('title')).toBe(true)
    expect(isCommonTagKey('year')).toBe(true)        // alias of date
    expect(isCommonTagKey('album_artist')).toBe(true)
    expect(isCommonTagKey('my_custom')).toBe(false)
  })

  it('splitTags separates labeled common fields from custom keys, folding aliases', () => {
    const parsed = parseFFMetadata([
      ';FFMETADATA1',
      'title=T',
      'YEAR=2021',           // alias → date (common)
      'ALBUM ARTIST=AA',     // alias → album_artist (common)
      'MOOD=happy',          // custom
      'encoder=Lavf',        // custom (bookkeeping but editable)
    ].join('\n'))
    const { common, custom } = splitTags(parsed)
    const commonKeys = common.map((c) => c.key)
    expect(commonKeys).toContain('title')
    expect(commonKeys).toContain('date')
    expect(commonKeys).toContain('album_artist')
    expect(common.find((c) => c.key === 'date').value).toBe('2021')
    const customKeys = custom.map((c) => c.key.toLowerCase())
    expect(customKeys).toContain('mood')
    expect(customKeys).toContain('encoder')
    expect(customKeys).not.toContain('title')
  })

  it('buildEntries merges common (non-blank) + custom (keeps order), drops blank keys', () => {
    const entries = buildEntries(
      { title: 'T', artist: '', date: '2020' },
      [{ key: 'MOOD', value: 'calm' }, { key: '', value: 'x' }, { key: 'lyrics', value: 'la la' }],
    )
    expect(entries).toEqual([
      { key: 'title', value: 'T' },
      { key: 'date', value: '2020' },
      { key: 'MOOD', value: 'calm' },
      { key: 'lyrics', value: 'la la' },
    ])
    // artist was blank → omitted (removes the tag)
    expect(entries.find((e) => e.key === 'artist')).toBeUndefined()
  })

  it('COMMON_TAG_KEYS covers the spec-required labeled fields', () => {
    for (const k of ['title', 'artist', 'album', 'album_artist', 'composer', 'genre', 'date', 'track', 'disc', 'comment', 'copyright', 'publisher', 'language', 'lyrics']) {
      expect(COMMON_TAG_KEYS).toContain(k)
    }
  })
})

describe('ffmetadata — write/strip ffmpeg arg builders (no re-encode)', () => {
  it('write keeps every stream + swaps tags via the meta file (-map 0 -map_metadata 1 -c copy)', () => {
    const args = buildWriteMetadataArgs({ input: 'input.flac', metaFile: 'meta.txt', output: 'output.flac' })
    expect(args).toEqual(['-i', 'input.flac', '-i', 'meta.txt', '-map', '0', '-map_metadata', '1', '-c', 'copy', 'output.flac'])
  })

  it('mp3 write adds -id3v2_version 3', () => {
    const args = buildWriteMetadataArgs({ input: 'input.mp3', output: 'output.mp3', isMp3: true })
    expect(args).toContain('-id3v2_version')
    expect(args[args.indexOf('-id3v2_version') + 1]).toBe('3')
    expect(args).toContain('-c'); expect(args).toContain('copy')
  })

  it('removeCover keeps only audio (-map 0:a … -c:a copy), never -map 0 (all streams)', () => {
    const args = buildWriteMetadataArgs({ input: 'i.mp3', output: 'o.mp3', removeCover: true })
    expect(args).toEqual(['-i', 'i.mp3', '-i', 'meta.txt', '-map', '0:a', '-map_metadata', '1', '-c:a', 'copy', 'o.mp3'])
    // must not carry the cover via a whole-input map
    expect(args.filter((a, i) => a === '-map' && args[i + 1] === '0').length).toBe(0)
  })

  it('newCover embeds a replacement picture (mjpeg, attached_pic) without re-encoding audio', () => {
    const args = buildWriteMetadataArgs({ input: 'i.mp3', metaFile: 'meta.txt', output: 'o.mp3', cover: 'cover.png' })
    expect(args).toEqual([
      '-i', 'i.mp3', '-i', 'meta.txt', '-i', 'cover.png',
      '-map', '0:a', '-map', '2:v', '-map_metadata', '1',
      '-c:a', 'copy', '-c:v', 'mjpeg', '-disposition:v', 'attached_pic', 'o.mp3',
    ])
  })

  it('strip drops all metadata + chapters (-map_metadata -1 -map_chapters -1 -c:a copy)', () => {
    const args = buildStripMetadataArgs({ input: 'i.mp3', output: 'o.mp3' })
    expect(args).toContain('-map_metadata'); expect(args[args.indexOf('-map_metadata') + 1]).toBe('-1')
    expect(args).toContain('-map_chapters'); expect(args[args.indexOf('-map_chapters') + 1]).toBe('-1')
    expect(args).toContain('-c:a'); expect(args).toContain('copy')
    expect(args[args.length - 1]).toBe('o.mp3')
  })

  it('strip with keepCover carries all streams (-map 0 -c copy)', () => {
    const args = buildStripMetadataArgs({ input: 'i.mp3', output: 'o.mp3', keepCover: true })
    expect(args.slice(0, 6)).toEqual(['-i', 'i.mp3', '-map', '0', '-c', 'copy'])
  })
})

describe('ffmetadata — technical info parsing (view-only)', () => {
  const log = [
    "Input #0, mp3, from 'input.mp3':",
    '  Duration: 00:03:21.45, start: 0.025057, bitrate: 192 kb/s',
    '  Stream #0:0: Audio: mp3 (mp3float), 44100 Hz, stereo, fltp, 192 kb/s',
    '  Stream #0:1: Video: mjpeg (Baseline), yuvj444p(pc), 600x600 [SAR 1:1 DAR 1:1], 90k tbr (attached pic)',
  ].join('\n')

  it('parseDurationInfo extracts seconds + overall bitrate', () => {
    const d = parseDurationInfo(log)
    expect(d.durationSec).toBeCloseTo(3 * 60 + 21.45, 1)
    expect(d.bitrateKbps).toBe(192)
  })

  it('parseAudioStreamInfo extracts codec / sample rate / channels / bitrate', () => {
    const s = parseAudioStreamInfo(log)
    expect(s.codec).toBe('mp3')
    expect(s.sampleRate).toBe(44100)
    expect(s.channelLayout).toBe('stereo')
    expect(s.channels).toBe(2)
    expect(s.bitrateKbps).toBe(192)
  })

  it('parseAudioStreamInfo handles mono + 5.1', () => {
    expect(parseAudioStreamInfo('Stream #0:0: Audio: aac, 48000 Hz, mono, fltp').channels).toBe(1)
    const s51 = parseAudioStreamInfo('Stream #0:0: Audio: ac3, 48000 Hz, 5.1, fltp, 384 kb/s')
    expect(s51.channels).toBe(6)
  })

  it('hasAttachedPicture detects an embedded cover stream', () => {
    expect(hasAttachedPicture(log)).toBe(true)
    expect(hasAttachedPicture("  Stream #0:0: Audio: mp3, 44100 Hz, stereo")).toBe(false)
  })

  it('parseVideoStreamInfo reads resolution / codec / fps from a real video stream', () => {
    const vlog = [
      "Input #0, mov,mp4,m4a, from 'input.mp4':",
      '  Duration: 00:00:30.00, start: 0.000000, bitrate: 4500 kb/s',
      '  Stream #0:0(und): Video: h264 (High), yuv420p, 1920x1080 [SAR 1:1 DAR 16:9], 4000 kb/s, 30 fps, 30 tbr',
      '  Stream #0:1(und): Audio: aac (LC), 48000 Hz, stereo, fltp, 192 kb/s',
    ].join('\n')
    const v = parseVideoStreamInfo(vlog)
    expect(v.vcodec).toBe('h264')
    expect(v.width).toBe(1920)
    expect(v.height).toBe(1080)
    expect(v.fps).toBe(30)
  })

  it('parseVideoStreamInfo ignores an attached-pic (cover) "video" stream', () => {
    // The audio-file cover art is a Video stream marked "attached pic" — not a real video.
    expect(parseVideoStreamInfo(log)).toEqual({})
  })

  it('hasLimitedTagSupport flags containers with a fixed tag set', () => {
    expect(hasLimitedTagSupport('wav')).toBe(true)
    expect(hasLimitedTagSupport('.WAV')).toBe(true)
    expect(hasLimitedTagSupport('aiff')).toBe(true)
    expect(hasLimitedTagSupport('mp3')).toBe(false)
    expect(hasLimitedTagSupport('flac')).toBe(false)
  })
})
