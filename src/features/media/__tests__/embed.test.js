import { describe, it, expect } from 'vitest'
import {
  platformOf, parseEmbed, buildEmbedUrl, isAllowedEmbedUrl, platformLabel, SUPPORTED_PLATFORMS,
} from '../embed'

describe('platformOf', () => {
  it('recognizes the three supported hosts (and subdomains/www)', () => {
    expect(platformOf('https://music.163.com/#/song?id=123')).toBe('netease')
    expect(platformOf('https://y.music.163.com/m/song?id=1')).toBe('netease')
    expect(platformOf('https://www.bilibili.com/video/BV1xx411c7mD')).toBe('bilibili')
    expect(platformOf('https://m.bilibili.com/video/BV1xx411c7mD')).toBe('bilibili')
    expect(platformOf('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('youtube')
    expect(platformOf('https://youtu.be/dQw4w9WgXcQ')).toBe('youtube')
    expect(platformOf('https://music.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('youtube')
  })
  it('accepts a scheme-less link', () => {
    expect(platformOf('music.163.com/song?id=5')).toBe('netease')
  })
  it('rejects unsupported / malicious hosts', () => {
    expect(platformOf('https://evil.com/watch?v=x')).toBeNull()
    expect(platformOf('https://notbilibili.com/video/BV1xx411c7mD')).toBeNull()
    expect(platformOf('javascript:alert(1)')).toBeNull()
    expect(platformOf('')).toBeNull()
    expect(platformOf('not a url')).toBeNull()
    // host-spoofing attempt: youtube.com.evil.com must NOT match
    expect(platformOf('https://youtube.com.evil.com/embed/x')).toBeNull()
  })
})

describe('parseEmbed — NetEase', () => {
  it('parses a song id from the hash route', () => {
    const r = parseEmbed('https://music.163.com/#/song?id=1974443814')
    expect(r).toMatchObject({ platform: 'netease', kind: 'song', id: '1974443814' })
    expect(r.embedUrl).toBe('https://music.163.com/outchain/player?type=2&id=1974443814&auto=0&height=66')
  })
  it('parses a song id from a plain query', () => {
    const r = parseEmbed('https://music.163.com/song?id=5')
    expect(r.kind).toBe('song')
    expect(r.embedUrl).toContain('type=2')
  })
  it('parses a playlist (type=0)', () => {
    const r = parseEmbed('https://music.163.com/#/playlist?id=8888')
    expect(r.kind).toBe('playlist')
    expect(r.embedUrl).toBe('https://music.163.com/outchain/player?type=0&id=8888&auto=0&height=66')
  })
  it('rejects a netease link with no id', () => {
    expect(parseEmbed('https://music.163.com/#/discover')).toBeNull()
  })
})

describe('parseEmbed — Bilibili', () => {
  it('parses a BV id from the path', () => {
    const r = parseEmbed('https://www.bilibili.com/video/BV1GJ411x7h7?p=1')
    expect(r).toMatchObject({ platform: 'bilibili', kind: 'video', id: 'BV1GJ411x7h7' })
    expect(r.embedUrl).toBe('https://player.bilibili.com/player.html?bvid=BV1GJ411x7h7')
  })
  it('rejects an av-only / id-less bilibili link', () => {
    expect(parseEmbed('https://www.bilibili.com/')).toBeNull()
  })
})

describe('parseEmbed — YouTube', () => {
  it('parses v= form', () => {
    const r = parseEmbed('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10s')
    expect(r).toMatchObject({ platform: 'youtube', kind: 'video', id: 'dQw4w9WgXcQ' })
    expect(r.embedUrl).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ')
  })
  it('parses youtu.be short form', () => {
    const r = parseEmbed('https://youtu.be/dQw4w9WgXcQ')
    expect(r.id).toBe('dQw4w9WgXcQ')
  })
  it('parses /shorts/ and /embed/ forms', () => {
    expect(parseEmbed('https://www.youtube.com/shorts/abcDEF12345').id).toBe('abcDEF12345')
    expect(parseEmbed('https://www.youtube.com/embed/abcDEF12345').id).toBe('abcDEF12345')
  })
  it('rejects an id-less youtube link', () => {
    expect(parseEmbed('https://www.youtube.com/feed/trending')).toBeNull()
  })
})

describe('buildEmbedUrl', () => {
  it('builds each official embed URL', () => {
    expect(buildEmbedUrl('netease', { kind: 'song', id: '5' })).toContain('music.163.com/outchain/player')
    expect(buildEmbedUrl('bilibili', { kind: 'video', id: 'BVxxxxxxxxxx' })).toContain('player.bilibili.com/player.html')
    expect(buildEmbedUrl('youtube', { kind: 'video', id: 'abc' })).toContain('youtube-nocookie.com/embed/')
  })
  it('returns null with no id', () => {
    expect(buildEmbedUrl('youtube', { kind: 'video' })).toBeNull()
    expect(buildEmbedUrl('nope', { id: 'x' })).toBeNull()
  })
})

describe('isAllowedEmbedUrl — defense-in-depth iframe-src guard', () => {
  it('allows ONLY the official embed origins/paths', () => {
    expect(isAllowedEmbedUrl('https://music.163.com/outchain/player?type=2&id=5&auto=0&height=66')).toBe(true)
    expect(isAllowedEmbedUrl('https://player.bilibili.com/player.html?bvid=BVxxxxxxxxxx')).toBe(true)
    expect(isAllowedEmbedUrl('https://www.youtube-nocookie.com/embed/abc')).toBe(true)
    expect(isAllowedEmbedUrl('https://www.youtube.com/embed/abc')).toBe(true)
  })
  it('blocks non-embed paths on allowed hosts and any other host', () => {
    expect(isAllowedEmbedUrl('https://music.163.com/#/song?id=5')).toBe(false) // not the outchain path
    expect(isAllowedEmbedUrl('https://www.youtube.com/watch?v=abc')).toBe(false)
    expect(isAllowedEmbedUrl('https://evil.com/outchain/player')).toBe(false)
    expect(isAllowedEmbedUrl('javascript:alert(1)')).toBe(false)
    expect(isAllowedEmbedUrl('')).toBe(false)
  })
  it('round-trips: every parseEmbed result is an allowed url', () => {
    const samples = [
      'https://music.163.com/#/song?id=1',
      'https://music.163.com/#/playlist?id=2',
      'https://www.bilibili.com/video/BV1GJ411x7h7',
      'https://youtu.be/dQw4w9WgXcQ',
    ]
    for (const s of samples) {
      const r = parseEmbed(s)
      expect(r, s).toBeTruthy()
      expect(isAllowedEmbedUrl(r.embedUrl), r.embedUrl).toBe(true)
    }
  })
})

describe('misc', () => {
  it('platformLabel maps keys to names', () => {
    expect(platformLabel('netease')).toBe('NetEase Cloud Music')
    expect(platformLabel('bilibili')).toBe('Bilibili')
    expect(platformLabel('youtube')).toBe('YouTube')
    expect(platformLabel('x')).toBe('')
  })
  it('exports the supported platform list', () => {
    expect(SUPPORTED_PLATFORMS).toEqual(['netease', 'bilibili', 'youtube'])
  })
})
