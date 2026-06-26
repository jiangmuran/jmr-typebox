import { describe, it, expect } from 'vitest'
import {
  uid, formatTime, formatBytes, titleFromName, initialOf, hashHue,
  makeTrack, moveItem, nextIndex, prevIndex,
  totalSize, exceedsCap, remainingCap, DEFAULT_CACHE_CAP,
  filterTracks, makePlaylist, addToPlaylist, removeFromList,
} from '../playerHelpers'

describe('ids + formatting', () => {
  it('uid is unique-ish and prefixed', () => {
    const a = uid('x')
    const b = uid('x')
    expect(a).not.toBe(b)
    expect(a.startsWith('x_')).toBe(true)
  })

  it('formatTime renders m:ss and h:mm:ss', () => {
    expect(formatTime(0)).toBe('0:00')
    expect(formatTime(5)).toBe('0:05')
    expect(formatTime(65)).toBe('1:05')
    expect(formatTime(3661)).toBe('1:01:01')
    expect(formatTime(-3)).toBe('0:00')
    expect(formatTime(NaN)).toBe('0:00')
  })

  it('formatBytes scales units', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB')
    expect(formatBytes(2 * 1024 * 1024 * 1024)).toBe('2.00 GB')
  })

  it('titleFromName strips ext + tidies separators', () => {
    expect(titleFromName('My_Song-01.mp3')).toBe('My Song 01')
    expect(titleFromName('track.flac')).toBe('track')
    expect(titleFromName('')).toBe('Untitled')
  })

  it('initialOf returns an uppercase first glyph or a note', () => {
    expect(initialOf('hello')).toBe('H')
    expect(initialOf('  spaced')).toBe('S')
    expect(initialOf('中文')).toBe('中')
    expect(initialOf('')).toBe('♪')
  })

  it('hashHue is deterministic and bounded 0..359', () => {
    const h = hashHue('Song A')
    expect(h).toBe(hashHue('Song A'))
    expect(h).toBeGreaterThanOrEqual(0)
    expect(h).toBeLessThan(360)
    expect(hashHue('Song A')).not.toBe(hashHue('Completely Different Title'))
  })
})

describe('makeTrack', () => {
  it('builds a record, deriving title from name when meta lacks one', () => {
    const t = makeTrack({ id: 'a1', name: 'Cool_Tune.mp3', size: 1000, type: 'audio/mpeg', addedAt: 42 })
    expect(t).toMatchObject({ id: 'a1', name: 'Cool_Tune.mp3', size: 1000, type: 'audio/mpeg', title: 'Cool Tune', artist: '', album: '', addedAt: 42 })
  })
  it('prefers provided metadata', () => {
    const t = makeTrack({ name: 'x.mp3', meta: { title: 'Real Title', artist: 'A', album: 'B', duration: 123, hasCover: true } })
    expect(t.title).toBe('Real Title')
    expect(t.artist).toBe('A')
    expect(t.album).toBe('B')
    expect(t.duration).toBe(123)
    expect(t.hasCover).toBe(true)
  })
})

describe('moveItem (reorder)', () => {
  it('moves forward and backward, returns a new array', () => {
    const src = ['a', 'b', 'c', 'd']
    expect(moveItem(src, 0, 2)).toEqual(['b', 'c', 'a', 'd'])
    expect(moveItem(src, 3, 0)).toEqual(['d', 'a', 'b', 'c'])
    expect(moveItem(src, 1, 1)).toEqual(['a', 'b', 'c', 'd'])
    expect(src).toEqual(['a', 'b', 'c', 'd']) // unmutated
  })
  it('clamps out-of-range indices', () => {
    expect(moveItem(['a', 'b'], -5, 9)).toEqual(['b', 'a'])
  })
  it('handles empty', () => {
    expect(moveItem([], 0, 1)).toEqual([])
  })
})

describe('nextIndex / prevIndex', () => {
  it('advances and stops at the end with repeat off', () => {
    expect(nextIndex({ length: 3, current: 0, repeat: 'off' })).toBe(1)
    expect(nextIndex({ length: 3, current: 2, repeat: 'off' })).toBe(-1)
  })
  it('wraps with repeat all', () => {
    expect(nextIndex({ length: 3, current: 2, repeat: 'all' })).toBe(0)
  })
  it('repeat one stays put', () => {
    expect(nextIndex({ length: 3, current: 1, repeat: 'one' })).toBe(1)
  })
  it('shuffle never returns the current index', () => {
    for (let i = 0; i < 200; i++) {
      const n = nextIndex({ length: 5, current: 2, shuffle: true, rand: Math.random })
      expect(n).not.toBe(2)
      expect(n).toBeGreaterThanOrEqual(0)
      expect(n).toBeLessThan(5)
    }
  })
  it('single-track queue: stop on off, repeat otherwise', () => {
    expect(nextIndex({ length: 1, current: 0, repeat: 'off' })).toBe(-1)
    expect(nextIndex({ length: 1, current: 0, repeat: 'all' })).toBe(0)
    expect(nextIndex({ length: 1, current: 0, repeat: 'one' })).toBe(0)
  })
  it('prevIndex wraps / clamps', () => {
    expect(prevIndex({ length: 3, current: 1, repeat: 'off' })).toBe(0)
    expect(prevIndex({ length: 3, current: 0, repeat: 'off' })).toBe(0)
    expect(prevIndex({ length: 3, current: 0, repeat: 'all' })).toBe(2)
  })
  it('empty queue → -1', () => {
    expect(nextIndex({ length: 0, current: 0 })).toBe(-1)
    expect(prevIndex({ length: 0, current: 0 })).toBe(-1)
  })
})

describe('cache accounting', () => {
  const tracks = [{ size: 1000 }, { size: 2000 }, { size: 0 }, { size: undefined }]
  it('totalSize sums sizes tolerantly', () => {
    expect(totalSize(tracks)).toBe(3000)
    expect(totalSize(null)).toBe(0)
  })
  it('exceedsCap compares against the cap', () => {
    expect(exceedsCap(100, 50, 200)).toBe(false)
    expect(exceedsCap(100, 150, 200)).toBe(true)
    expect(exceedsCap(0, 0, 200)).toBe(false)
  })
  it('remainingCap never goes negative', () => {
    expect(remainingCap([{ size: 50 }], 200)).toBe(150)
    expect(remainingCap([{ size: 500 }], 200)).toBe(0)
  })
  it('has a sane default cap', () => {
    expect(DEFAULT_CACHE_CAP).toBe(500 * 1024 * 1024)
  })
})

describe('filterTracks', () => {
  const tracks = [
    { title: 'Sunset', artist: 'Aria', album: 'Dawn', name: 'a.mp3' },
    { title: 'Rainfall', artist: 'Beats', album: 'Storm', name: 'b.mp3' },
  ]
  it('returns all on empty query', () => {
    expect(filterTracks(tracks, '')).toHaveLength(2)
    expect(filterTracks(tracks, '  ')).toHaveLength(2)
  })
  it('matches across fields, case-insensitive', () => {
    expect(filterTracks(tracks, 'aria')).toHaveLength(1)
    expect(filterTracks(tracks, 'STORM')).toHaveLength(1)
    expect(filterTracks(tracks, 'fall')[0].title).toBe('Rainfall')
    expect(filterTracks(tracks, 'zzz')).toHaveLength(0)
  })
})

describe('playlist records', () => {
  it('makePlaylist gives a fresh id + copied list', () => {
    const ids = ['x']
    const p = makePlaylist({ name: 'Faves', trackIds: ids })
    expect(p.name).toBe('Faves')
    expect(p.trackIds).toEqual(['x'])
    expect(p.trackIds).not.toBe(ids)
    expect(typeof p.id).toBe('string')
  })
  it('addToPlaylist dedupes', () => {
    expect(addToPlaylist(['a'], 'b')).toEqual(['a', 'b'])
    expect(addToPlaylist(['a', 'b'], 'b')).toEqual(['a', 'b'])
  })
  it('removeFromList strips all occurrences', () => {
    expect(removeFromList(['a', 'b', 'a'], 'a')).toEqual(['b'])
  })
})
