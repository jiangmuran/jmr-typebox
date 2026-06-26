import { describe, it, expect } from 'vitest'
import { parseLrc, activeLineIndex, looksLikeLrc } from '../lrc'

describe('lrc parser', () => {
  it('parses a basic synced lyric with mm:ss.xx stamps, sorted by time', () => {
    const text = [
      '[ti:Test Song]',
      '[ar:Test Artist]',
      '[00:12.50]first line',
      '[00:05.00]earlier line',
      '[01:00.00]later line',
    ].join('\n')
    const r = parseLrc(text)
    expect(r.synced).toBe(true)
    expect(r.meta.ti).toBe('Test Song')
    expect(r.meta.ar).toBe('Test Artist')
    expect(r.lines.map((l) => l.text)).toEqual(['earlier line', 'first line', 'later line'])
    expect(r.lines.map((l) => l.time)).toEqual([5, 12.5, 60])
  })

  it('handles multiple timestamps on one line (repeated lyric)', () => {
    const r = parseLrc('[00:01.00][00:03.00][00:05.00]chorus')
    expect(r.synced).toBe(true)
    expect(r.lines).toEqual([
      { time: 1, text: 'chorus' },
      { time: 3, text: 'chorus' },
      { time: 5, text: 'chorus' },
    ])
  })

  it('supports 1, 2 and 3 digit fractional seconds', () => {
    const r = parseLrc(['[00:10.5]a', '[00:10.25]b', '[00:10.250]c'].join('\n'))
    const byText = Object.fromEntries(r.lines.map((l) => [l.text, l.time]))
    expect(byText.a).toBeCloseTo(10.5, 5)
    expect(byText.b).toBeCloseTo(10.25, 5)
    expect(byText.c).toBeCloseTo(10.25, 5)
  })

  it('applies [offset:] in milliseconds (seconds, sign preserved)', () => {
    const r = parseLrc(['[offset:+500]', '[00:10.00]x'].join('\n'))
    expect(r.offset).toBeCloseTo(0.5, 5)
    const r2 = parseLrc(['[offset:-250]', '[00:10.00]x'].join('\n'))
    expect(r2.offset).toBeCloseTo(-0.25, 5)
  })

  it('keeps blank lyric text for timed lines (faithful scrolling)', () => {
    const r = parseLrc(['[00:01.00]', '[00:02.00]words'].join('\n'))
    expect(r.lines[0]).toEqual({ time: 1, text: '' })
    expect(r.lines[1]).toEqual({ time: 2, text: 'words' })
  })

  it('falls back to plain text when there are no timestamps', () => {
    const r = parseLrc('just some\nplain lyrics\nwith no timing')
    expect(r.synced).toBe(false)
    expect(r.lines.map((l) => l.text)).toEqual(['just some', 'plain lyrics', 'with no timing'])
    expect(r.lines.every((l) => l.time === -1)).toBe(true)
  })

  it('tolerates empty / nullish input', () => {
    expect(parseLrc('').lines).toEqual([])
    expect(parseLrc(null).lines).toEqual([])
    expect(parseLrc(undefined).synced).toBe(false)
  })

  it('does not mistake an [mm:ss] line for an id tag', () => {
    const r = parseLrc('[01:02.00]hello')
    expect(r.meta).toEqual({})
    expect(r.lines).toEqual([{ time: 62, text: 'hello' }])
  })

  it('normalizes CRLF line endings', () => {
    const r = parseLrc('[ti:X]\r\n[00:01.00]a\r\n[00:02.00]b')
    expect(r.meta.ti).toBe('X')
    expect(r.lines.length).toBe(2)
  })
})

describe('activeLineIndex', () => {
  const lines = [
    { time: 0, text: 'a' },
    { time: 5, text: 'b' },
    { time: 10, text: 'c' },
    { time: 20, text: 'd' },
  ]
  it('returns -1 before the first line', () => {
    expect(activeLineIndex(lines, -1)).toBe(-1)
  })
  it('returns the last line whose time <= t', () => {
    expect(activeLineIndex(lines, 0)).toBe(0)
    expect(activeLineIndex(lines, 4.9)).toBe(0)
    expect(activeLineIndex(lines, 5)).toBe(1)
    expect(activeLineIndex(lines, 12)).toBe(2)
    expect(activeLineIndex(lines, 999)).toBe(3)
  })
  it('respects an offset shift', () => {
    // With +2s offset, line at t=5 becomes active at t=7.
    expect(activeLineIndex(lines, 6, 2)).toBe(0)
    expect(activeLineIndex(lines, 7, 2)).toBe(1)
  })
  it('handles empty input', () => {
    expect(activeLineIndex([], 5)).toBe(-1)
    expect(activeLineIndex(null, 5)).toBe(-1)
  })
})

describe('looksLikeLrc', () => {
  it('detects a timestamp', () => {
    expect(looksLikeLrc('[00:12.34]hi')).toBe(true)
    expect(looksLikeLrc('[01:02]hi')).toBe(true)
  })
  it('is false for plain text', () => {
    expect(looksLikeLrc('no stamps here')).toBe(false)
    expect(looksLikeLrc('')).toBe(false)
  })
})
