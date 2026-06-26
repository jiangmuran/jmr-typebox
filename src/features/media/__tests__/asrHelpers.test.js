import { describe, it, expect } from 'vitest'
import {
  secToSrtTime, secToVttTime,
  normalizeSegment, extractSegments, offsetSegments, stitchChunks, joinChunkText,
  planChunks, needsExtraction,
  segmentsToTXT, segmentsToSRT, segmentsToVTT, serializeTranscript,
} from '../asrHelpers'

describe('asr — time formatting', () => {
  it('SRT uses comma, VTT uses dot, both HH:MM:SS.mmm', () => {
    expect(secToSrtTime(0)).toBe('00:00:00,000')
    expect(secToVttTime(0)).toBe('00:00:00.000')
    expect(secToSrtTime(3661.5)).toBe('01:01:01,500')
    expect(secToVttTime(3661.5)).toBe('01:01:01.500')
    expect(secToSrtTime(75.25)).toBe('00:01:15,250')
  })
  it('clamps negatives and rounds milliseconds (carry)', () => {
    expect(secToSrtTime(-3)).toBe('00:00:00,000')
    // 1.9996s rounds to 2000ms → carries to the next second.
    expect(secToVttTime(1.9996)).toBe('00:00:02.000')
  })
})

describe('asr — segment normalization', () => {
  it('coerces times/text and drops empties', () => {
    expect(normalizeSegment({ start: 1, end: 3, text: ' hi ' })).toEqual({ start: 1, end: 3, text: 'hi' })
    expect(normalizeSegment({ start: 1, end: 3, text: '   ' })).toBeNull()
    expect(normalizeSegment(null)).toBeNull()
    // end <= start → end clamped up to start.
    expect(normalizeSegment({ start: 5, end: 2, text: 'x' })).toEqual({ start: 5, end: 5, text: 'x' })
    // non-finite start → 0.
    expect(normalizeSegment({ start: NaN, end: 2, text: 'x' })).toMatchObject({ start: 0 })
  })

  it('extractSegments handles verbose_json, plain text, and strings', () => {
    const v = extractSegments({ text: 'full', segments: [{ start: 0, end: 1, text: 'a' }, { start: 1, end: 2, text: '' }] })
    expect(v).toEqual([{ start: 0, end: 1, text: 'a' }]) // blank dropped
    expect(extractSegments({ text: 'just text' })).toEqual([{ start: 0, end: 0, text: 'just text' }])
    expect(extractSegments('a string')).toEqual([{ start: 0, end: 0, text: 'a string' }])
    expect(extractSegments(null)).toEqual([])
    expect(extractSegments({ text: '' })).toEqual([])
  })
})

describe('asr — chunk stitching & offsets', () => {
  it('offsets segment times by a window start', () => {
    const segs = [{ start: 0, end: 2, text: 'a' }, { start: 2, end: 4, text: 'b' }]
    expect(offsetSegments(segs, 600)).toEqual([
      { start: 600, end: 602, text: 'a' },
      { start: 602, end: 604, text: 'b' },
    ])
  })

  it('stitchChunks applies each chunk offset and sorts by start', () => {
    const stitched = stitchChunks([
      { offset: 0, segments: [{ start: 0, end: 5, text: 'first' }] },
      { offset: 600, segments: [{ start: 0, end: 5, text: 'second' }] },
    ])
    expect(stitched).toEqual([
      { start: 0, end: 5, text: 'first' },
      { start: 600, end: 605, text: 'second' },
    ])
  })

  it('joinChunkText concatenates plain text in order, collapsing whitespace', () => {
    expect(joinChunkText([{ text: 'hello ' }, { text: ' world' }, { text: '' }])).toBe('hello world')
  })
})

describe('asr — chunk planning', () => {
  it('a short/unknown file is one window', () => {
    expect(planChunks({ durationSec: 300, windowSec: 600 })).toEqual([{ index: 0, start: 0, dur: 300 }])
    expect(planChunks({ durationSec: 0 })).toEqual([{ index: 0, start: 0, dur: 0 }])
  })
  it('splits long media into contiguous windows that cover the whole duration', () => {
    const chunks = planChunks({ durationSec: 1500, windowSec: 600 })
    expect(chunks.length).toBe(3) // 0-600, 600-1200, 1200-1500
    expect(chunks[0]).toMatchObject({ start: 0, dur: 600 })
    expect(chunks[1]).toMatchObject({ start: 600, dur: 600 })
    expect(chunks[2]).toMatchObject({ start: 1200, dur: 300 })
    const covered = chunks.reduce((a, c) => a + c.dur, 0)
    expect(covered).toBe(1500)
  })
  it('exactly one window when duration == window', () => {
    expect(planChunks({ durationSec: 600, windowSec: 600 })).toEqual([{ index: 0, start: 0, dur: 600 }])
  })

  it('needsExtraction: always for video; for audio only over the size cap', () => {
    expect(needsExtraction({ isVideo: true, sizeBytes: 1000 })).toBe(true)
    expect(needsExtraction({ isVideo: false, sizeBytes: 1000 })).toBe(false)
    expect(needsExtraction({ isVideo: false, sizeBytes: 30 * 1024 * 1024 })).toBe(true)
    expect(needsExtraction({ isVideo: false, sizeBytes: 5 * 1024 * 1024, maxBytes: 1024 })).toBe(true)
  })
})

describe('asr — serialization', () => {
  const segs = [
    { start: 0, end: 2.5, text: 'Hello there.' },
    { start: 2.5, end: 5, text: 'General Kenobi.' },
  ]

  it('TXT is one line per segment', () => {
    expect(segmentsToTXT(segs)).toBe('Hello there.\nGeneral Kenobi.')
  })

  it('SRT: numbered cues, comma timestamps, blank-line separated', () => {
    const srt = segmentsToSRT(segs)
    expect(srt).toContain('1\n00:00:00,000 --> 00:00:02,500\nHello there.')
    expect(srt).toContain('2\n00:00:02,500 --> 00:00:05,000\nGeneral Kenobi.')
    // cue blocks separated by a blank line
    expect(srt.split('\n\n').length).toBe(2)
  })

  it('VTT: WEBVTT header + dot timestamps', () => {
    const vtt = segmentsToVTT(segs)
    expect(vtt.startsWith('WEBVTT')).toBe(true)
    expect(vtt).toContain('00:00:00.000 --> 00:00:02.500\nHello there.')
  })

  it('zero-length cues get a 2s tail so players show them', () => {
    const srt = segmentsToSRT([{ start: 10, end: 10, text: 'x' }])
    expect(srt).toContain('00:00:10,000 --> 00:00:12,000')
  })

  it('serializeTranscript picks the right format + mime/ext', () => {
    expect(serializeTranscript(segs, 'txt')).toMatchObject({ mime: 'text/plain', ext: 'txt' })
    expect(serializeTranscript(segs, 'srt')).toMatchObject({ mime: 'application/x-subrip', ext: 'srt' })
    expect(serializeTranscript(segs, 'vtt')).toMatchObject({ mime: 'text/vtt', ext: 'vtt' })
    expect(serializeTranscript(segs, 'srt').text).toContain('-->')
  })
})
