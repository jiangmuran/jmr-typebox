import { describe, it, expect } from 'vitest'
import {
  parseTimestamp, secToLrcTime, parseSrtVtt, parseLrcToSegments, segmentsFromPlainText,
  detectSubtitleFormat, parseSubtitles, segmentsToLRC, serializeSubtitles, splitTextByFraction,
  splitSegment, mergeSegments, addSegmentAfter, deleteSegment, updateSegment, applyOffset,
  normalizeSegments, activeSegmentIndex, fadeAlpha, wrapLines, resolveStyle, renderSizeById,
  STYLE_PRESETS, RENDER_SIZES,
} from '../subtitleStudio'

describe('timestamp parsing / formatting', () => {
  it('parses HH:MM:SS,mmm and HH:MM:SS.mmm', () => {
    expect(parseTimestamp('00:00:01,500')).toBeCloseTo(1.5, 5)
    expect(parseTimestamp('01:02:03.250')).toBeCloseTo(3723.25, 5)
    expect(parseTimestamp('00:05.00')).toBeCloseTo(5, 5) // MM:SS
    expect(Number.isNaN(parseTimestamp('nonsense'))).toBe(true)
    expect(Number.isNaN(parseTimestamp(''))).toBe(true)
  })
  it('formats seconds → LRC mm:ss.xx and carries rounding', () => {
    expect(secToLrcTime(0)).toBe('00:00.00')
    expect(secToLrcTime(5.5)).toBe('00:05.50')
    expect(secToLrcTime(62.34)).toBe('01:02.34')
    expect(secToLrcTime(9.999)).toBe('00:10.00') // centisecond carry
    expect(secToLrcTime(-3)).toBe('00:00.00')    // negatives clamp
  })
})

describe('parseSrtVtt', () => {
  it('parses a standard SRT with index lines', () => {
    const srt = ['1', '00:00:00,000 --> 00:00:02,000', 'Hello world', '', '2', '00:00:02,500 --> 00:00:04,000', 'second line'].join('\n')
    const segs = parseSrtVtt(srt)
    expect(segs).toEqual([
      { start: 0, end: 2, text: 'Hello world' },
      { start: 2.5, end: 4, text: 'second line' },
    ])
  })
  it('parses WebVTT (header, cue ids, settings, inline tags)', () => {
    const vtt = ['WEBVTT', '', 'cue-1', '00:00:00.000 --> 00:00:01.500 align:middle', '<c>Styled</c> text', '', 'NOTE this is a note', '', '00:00:02.000 --> 00:00:03.000', 'plain'].join('\n')
    const segs = parseSrtVtt(vtt)
    expect(segs).toEqual([
      { start: 0, end: 1.5, text: 'Styled text' },
      { start: 2, end: 3, text: 'plain' },
    ])
  })
  it('keeps multi-line cue text and gives zero-length cues start=end', () => {
    const srt = ['00:00:01,000 --> 00:00:01,000', 'a', 'b'].join('\n')
    expect(parseSrtVtt(srt)).toEqual([{ start: 1, end: 1, text: 'a\nb' }])
  })
  it('sorts out-of-order cues by start', () => {
    const srt = ['00:00:05,000 --> 00:00:06,000', 'late', '', '00:00:01,000 --> 00:00:02,000', 'early'].join('\n')
    expect(parseSrtVtt(srt).map((s) => s.text)).toEqual(['early', 'late'])
  })
})

describe('LRC parse → segments', () => {
  it('turns timed lines into segments (end = next start, tail on last)', () => {
    const lrc = ['[ti:Song]', '[00:01.00]first', '[00:03.50]second'].join('\n')
    const segs = parseLrcToSegments(lrc)
    expect(segs[0]).toEqual({ start: 1, end: 3.5, text: 'first' })
    expect(segs[1].start).toBe(3.5)
    expect(segs[1].end).toBeGreaterThan(3.5) // tail
    expect(segs[1].text).toBe('second')
  })
  it('uses a blank timed line as a terminator (no empty segment)', () => {
    const lrc = ['[00:01.00]words', '[00:02.00]'].join('\n')
    const segs = parseLrcToSegments(lrc)
    expect(segs).toEqual([{ start: 1, end: 2, text: 'words' }])
  })
})

describe('segmentsFromPlainText', () => {
  it('makes one sequential segment per non-empty line', () => {
    const segs = segmentsFromPlainText('one\n\ntwo\nthree', { perLineSec: 2 })
    expect(segs).toEqual([
      { start: 0, end: 2, text: 'one' },
      { start: 2, end: 4, text: 'two' },
      { start: 4, end: 6, text: 'three' },
    ])
  })
})

describe('format detection + parseSubtitles dispatch', () => {
  it('detects by extension then content', () => {
    expect(detectSubtitleFormat('anything', 'a.srt')).toBe('srt')
    expect(detectSubtitleFormat('anything', 'a.vtt')).toBe('vtt')
    expect(detectSubtitleFormat('anything', 'a.lrc')).toBe('lrc')
    expect(detectSubtitleFormat('WEBVTT\n\n00:00.000 --> 00:01.000\nhi')).toBe('vtt')
    expect(detectSubtitleFormat('1\n00:00:00,000 --> 00:00:01,000\nhi')).toBe('srt')
    expect(detectSubtitleFormat('[00:01.00]hi')).toBe('lrc')
    expect(detectSubtitleFormat('just words')).toBe('txt')
  })
  it('parseSubtitles routes to the right parser', () => {
    expect(parseSubtitles('[00:01.00]hi', { name: 'x.lrc' })[0].text).toBe('hi')
    expect(parseSubtitles('00:00:01,000 --> 00:00:02,000\nhi')[0]).toEqual({ start: 1, end: 2, text: 'hi' })
  })
})

describe('serialization + round-trips', () => {
  const segs = [
    { start: 0, end: 2, text: 'Hello world' },
    { start: 2.5, end: 4.25, text: '你好世界' },
  ]
  it('SRT round-trips exactly', () => {
    const { text, ext, mime } = serializeSubtitles(segs, 'srt')
    expect(ext).toBe('srt')
    expect(mime).toBe('application/x-subrip')
    expect(parseSrtVtt(text)).toEqual(segs)
  })
  it('VTT round-trips exactly', () => {
    const { text, ext } = serializeSubtitles(segs, 'vtt')
    expect(ext).toBe('vtt')
    expect(text.startsWith('WEBVTT')).toBe(true)
    expect(parseSrtVtt(text)).toEqual(segs)
  })
  it('LRC round-trips starts + text (ends derived from next start)', () => {
    const { text, ext } = serializeSubtitles(segs, 'lrc', { ti: 'T', ar: 'A' })
    expect(ext).toBe('lrc')
    expect(text).toContain('[ti:T]')
    expect(text).toContain('[ar:A]')
    const back = parseLrcToSegments(text)
    expect(back.map((s) => s.start)).toEqual(segs.map((s) => s.start))
    expect(back.map((s) => s.text)).toEqual(segs.map((s) => s.text))
    // The trailing end marker recovers the LAST segment's end exactly.
    expect(back[back.length - 1].end).toBeCloseTo(4.25, 5)
  })
})

describe('segment editing', () => {
  it('splitTextByFraction prefers a nearby space, else cuts a CJK run mid-char', () => {
    expect(splitTextByFraction('hello world', 0.5)).toEqual({ first: 'hello', second: 'world' })
    expect(splitTextByFraction('你好世界', 0.5)).toEqual({ first: '你好', second: '世界' })
  })
  it('splitSegment splits time + text at the midpoint', () => {
    const out = splitSegment([{ start: 0, end: 4, text: 'hello world' }], 0)
    expect(out).toHaveLength(2)
    expect(out[0]).toEqual({ start: 0, end: 2, text: 'hello' })
    expect(out[1]).toEqual({ start: 2, end: 4, text: 'world' })
  })
  it('splitSegment honors an explicit split time', () => {
    const out = splitSegment([{ start: 0, end: 10, text: 'a b' }], 0, 3)
    expect(out[0].end).toBe(3)
    expect(out[1].start).toBe(3)
  })
  it('mergeSegments joins a cue with the next', () => {
    const out = mergeSegments([{ start: 0, end: 2, text: 'a' }, { start: 2, end: 5, text: 'b' }, { start: 6, end: 7, text: 'c' }], 0)
    expect(out).toHaveLength(2)
    expect(out[0]).toEqual({ start: 0, end: 5, text: 'a b' })
    expect(out[1].text).toBe('c')
  })
  it('addSegmentAfter fits a new cue into the gap', () => {
    const out = addSegmentAfter([{ start: 0, end: 2, text: 'a' }, { start: 6, end: 8, text: 'b' }], 0, { dur: 2 })
    expect(out).toHaveLength(3)
    expect(out[1].start).toBe(2)
    expect(out[1].end).toBe(4)
    expect(out[1].text).toBe('')
  })
  it('addSegmentAfter at the end appends', () => {
    const out = addSegmentAfter([{ start: 0, end: 2, text: 'a' }], 0, { dur: 3 })
    expect(out[1]).toEqual({ start: 2, end: 5, text: '' })
  })
  it('deleteSegment removes by index', () => {
    expect(deleteSegment([{ start: 0, end: 1, text: 'a' }, { start: 1, end: 2, text: 'b' }], 0)).toEqual([{ start: 1, end: 2, text: 'b' }])
  })
  it('updateSegment patches + clamps start ≤ end and keeps other refs', () => {
    const a = { start: 0, end: 2, text: 'a' }
    const b = { start: 2, end: 4, text: 'b' }
    const out = updateSegment([a, b], 1, { text: 'B', start: 3 })
    expect(out[0]).toBe(a) // untouched ref preserved
    expect(out[1]).toEqual({ start: 3, end: 4, text: 'B' })
    // pushing start past end drags end up
    expect(updateSegment([a], 0, { start: 5 })[0]).toEqual({ start: 5, end: 5, text: 'a' })
  })
  it('applyOffset shifts + clamps to 0 and re-sorts', () => {
    const out = applyOffset([{ start: 1, end: 2, text: 'a' }, { start: 3, end: 4, text: 'b' }], -2)
    expect(out[0]).toEqual({ start: 0, end: 0, text: 'a' })
    expect(out[1]).toEqual({ start: 1, end: 2, text: 'b' })
  })
})

describe('normalizeSegments', () => {
  it('coerces, clamps and sorts, preserving extra props', () => {
    const out = normalizeSegments([{ start: 5, end: 6, text: 'b', id: 9 }, { start: -1, end: 'x', text: 2 }])
    expect(out[0]).toEqual({ start: 0, end: 0, text: '2' })
    expect(out[1]).toEqual({ start: 5, end: 6, text: 'b', id: 9 })
  })
})

describe('activeSegmentIndex', () => {
  const segs = [{ start: 0, end: 2 }, { start: 2, end: 4 }, { start: 6, end: 8 }]
  it('finds the containing segment; end is exclusive', () => {
    expect(activeSegmentIndex(segs, 0)).toBe(0)
    expect(activeSegmentIndex(segs, 1.9)).toBe(0)
    expect(activeSegmentIndex(segs, 2)).toBe(1)
    expect(activeSegmentIndex(segs, 7)).toBe(2)
  })
  it('returns -1 in a gap or before the first / after the last', () => {
    expect(activeSegmentIndex(segs, 5)).toBe(-1)
    expect(activeSegmentIndex(segs, 9)).toBe(-1)
    expect(activeSegmentIndex([], 1)).toBe(-1)
  })
  it('on overlap picks the latest-starting segment', () => {
    const ov = [{ start: 0, end: 10 }, { start: 3, end: 5 }]
    expect(activeSegmentIndex(ov, 4)).toBe(1)
    expect(activeSegmentIndex(ov, 6)).toBe(0)
  })
})

describe('fadeAlpha', () => {
  it('is 0 outside the window and 1 inside with no fade', () => {
    expect(fadeAlpha(0.5, 1, 3, 0)).toBe(0)
    expect(fadeAlpha(2, 1, 3, 0)).toBe(1)
    expect(fadeAlpha(4, 1, 3, 0)).toBe(0)
  })
  it('ramps in and out over the fade duration', () => {
    expect(fadeAlpha(1, 1, 5, 1)).toBe(0)     // start edge
    expect(fadeAlpha(1.5, 1, 5, 1)).toBe(0.5) // mid fade-in
    expect(fadeAlpha(3, 1, 5, 1)).toBe(1)     // fully in
    expect(fadeAlpha(4.5, 1, 5, 1)).toBe(0.5) // mid fade-out
  })
})

describe('wrapLines', () => {
  // Fake measure: 1px per character.
  const measure = (s) => s.length
  it('wraps latin text on spaces', () => {
    expect(wrapLines('one two three four', 8, measure)).toEqual(['one two', 'three', 'four'])
  })
  it('character-breaks a space-less run wider than the line (CJK)', () => {
    expect(wrapLines('你好世界朋友', 2, measure)).toEqual(['你好', '世界', '朋友'])
  })
  it('honors explicit newlines as hard breaks', () => {
    expect(wrapLines('a\nb', 80, measure)).toEqual(['a', 'b'])
  })
  it('never loops on a zero/negative width', () => {
    expect(wrapLines('a b c', 0, measure)).toEqual(['a b c'])
  })
})

describe('style presets + render sizes', () => {
  it('exposes minimal + lyric presets with the required knobs', () => {
    for (const id of ['minimal', 'lyric']) {
      const p = STYLE_PRESETS[id]
      expect(p.fontFamily).toContain('sans-serif')
      expect(typeof p.fontSize).toBe('number')
      expect(p.position).toMatch(/lower|center|top/)
    }
    expect(STYLE_PRESETS.minimal.position).toBe('lower')
    expect(STYLE_PRESETS.lyric.position).toBe('center')
  })
  it('resolveStyle merges overrides but ignores undefined', () => {
    const s = resolveStyle('minimal', { color: '#ff0000', fontSize: undefined })
    expect(s.color).toBe('#ff0000')
    expect(s.fontSize).toBe(STYLE_PRESETS.minimal.fontSize) // undefined ignored
  })
  it('renderSizeById falls back to the first size', () => {
    expect(renderSizeById('portrait').height).toBe(1280)
    expect(renderSizeById('nope')).toBe(RENDER_SIZES[0])
  })
})
