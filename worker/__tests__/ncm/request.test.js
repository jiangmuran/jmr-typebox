// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRequest, cookieToJson, cookieObjToString } from '../../lib/ncm/request.js'

let captured
beforeEach(() => {
  captured = null
  globalThis.fetch = vi.fn(async (url, opts) => {
    captured = { url, opts }
    return new Response(JSON.stringify({ code: 200, data: [], msg: 'ok' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  })
})
afterEach(() => vi.restoreAllMocks())

describe('cookieToJson / cookieObjToString', () => {
  it('round-trips a typical cookie string', () => {
    const obj = cookieToJson('MUSIC_U=abc; __csrf=xyz; os=pc')
    expect(obj.MUSIC_U).toBe('abc')
    expect(obj.__csrf).toBe('xyz')
    expect(obj.os).toBe('pc')
  })
  it('encodes cookie values safely', () => {
    const s = cookieObjToString({ a: 'b/c', d: 'e f' })
    // HTTP Cookie header uses "; " (semicolon + space) as the field separator (RFC 6265).
    expect(s).toBe('a=b%2Fc; d=e%20f')
  })
  it('returns {} on empty / falsy input', () => {
    expect(cookieToJson('')).toEqual({})
    expect(cookieToJson(null)).toEqual({})
  })
})

describe('createRequest — header forging', () => {
  it('ALWAYS injects a forged mainland-China X-Real-IP + X-Forwarded-For', async () => {
    await createRequest('/api/cloudsearch/pc', { s: 'jay' }, {
      crypto: 'weapi',
      cookie: { MUSIC_U: 'token123' },
    })
    const headers = new Headers(captured.opts.headers)
    const ip = headers.get('X-Real-IP')
    const xff = headers.get('X-Forwarded-For')
    expect(ip).toBeTruthy()
    expect(xff).toBe(ip)
    expect(ip).toMatch(/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/)
  })

  it('honours a caller-pinned realIP over the random default', async () => {
    await createRequest('/api/cloudsearch/pc', {}, {
      crypto: 'weapi',
      cookie: {},
      realIP: '1.2.3.4',
    })
    const headers = new Headers(captured.opts.headers)
    expect(headers.get('X-Real-IP')).toBe('1.2.3.4')
    expect(headers.get('X-Forwarded-For')).toBe('1.2.3.4')
  })

  it('attaches the MUSIC_U token + client-identification fields to Cookie', async () => {
    await createRequest('/api/cloudsearch/pc', {}, {
      crypto: 'weapi',
      cookie: { MUSIC_U: 'TOKEN_X' },
    })
    const headers = new Headers(captured.opts.headers)
    const cookie = headers.get('Cookie')
    expect(cookie).toContain('MUSIC_U=TOKEN_X')
    // processCookieObject injects these defaults (caller's cookie wins on conflict).
    expect(cookie).toContain('__remember_me=true')
    expect(cookie).toMatch(/_ntes_nuid=/)
    expect(cookie).toContain('os=pc')
    expect(cookie).toContain('appver=3.1.17.204416')
  })
})

describe('createRequest — routing per crypto scheme', () => {
  it('weapi → POSTs to https://music.163.com/weapi/<uri-slice-5>', async () => {
    await createRequest('/api/cloudsearch/pc', { s: 'jay' }, { crypto: 'weapi', cookie: {} })
    expect(captured.opts.method).toBe('POST')
    expect(captured.url).toBe('https://music.163.com/weapi/cloudsearch/pc')
    const headers = new Headers(captured.opts.headers)
    expect(headers.get('Referer')).toBe('https://music.163.com')
    expect(headers.get('User-Agent')).toMatch(/Mozilla.*Chrome/)
    expect(headers.get('Content-Type')).toMatch(/application\/x-www-form-urlencoded/)
    // body is the encrypted envelope (params=...&encSecKey=...).
    expect(captured.opts.body).toMatch(/^(params|encSecKey)=/)
  })

  it('eapi → POSTs to https://interface.music.163.com/eapi/<uri-slice-5> as hex params', async () => {
    await createRequest('/api/song/lyric/v1', { id: 1 }, { crypto: 'eapi', cookie: {} })
    expect(captured.url).toBe('https://interface.music.163.com/eapi/song/lyric/v1')
    expect(captured.opts.body).toMatch(/^params=[0-9A-F]+$/)
  })

  it('linuxapi → POSTs to https://music.163.com/api/linux/forward', async () => {
    await createRequest('/api/test', { a: 1 }, { crypto: 'linuxapi', cookie: {} })
    expect(captured.url).toBe('https://music.163.com/api/linux/forward')
    expect(captured.opts.body).toMatch(/^eparams=[0-9A-F]+$/)
  })

  it('api (plaintext) → POSTs to https://interface.music.163.com<uri>', async () => {
    await createRequest('/api/v1/album/123', {}, { crypto: 'api', cookie: {} })
    expect(captured.url).toBe('https://interface.music.163.com/api/v1/album/123')
  })

  it('defaults to weapi when crypto is empty', async () => {
    await createRequest('/api/cloudsearch/pc', { s: 'x' }, { crypto: '', cookie: {} })
    expect(captured.url).toBe('https://music.163.com/weapi/cloudsearch/pc')
  })
})

describe('createRequest — response parsing', () => {
  it('returns { status, body, cookie } with code coerced to Number', async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ code: '200', data: [1] }), {
      status: 200, headers: { 'content-type': 'application/json' },
    }))
    const res = await createRequest('/api/x', {}, { crypto: 'api', cookie: {} })
    expect(res.status).toBe(200)
    expect(res.body.code).toBe(200) // not '200'
    expect(res.body.data).toEqual([1])
    expect(Array.isArray(res.cookie)).toBe(true)
  })

  it('remaps NCM "soft" codes (800/801/802/803) to HTTP 200 so the body still surfaces', async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ code: 801, message: 'scanned' }), {
      status: 200, headers: { 'content-type': 'application/json' },
    }))
    const res = await createRequest('/api/x', {}, { crypto: 'api', cookie: {} })
    expect(res.status).toBe(200)
    expect(res.body.code).toBe(801)
  })

  it('returns 502 on fetch throw (network/timeout)', async () => {
    globalThis.fetch = vi.fn(async () => { throw new Error('boom') })
    const res = await createRequest('/api/x', {}, { crypto: 'api', cookie: {} })
    expect(res.status).toBe(502)
    expect(res.body.code).toBe(502)
    expect(res.body.msg).toBe('boom')
  })

  it('falls back to raw text when body is not JSON', async () => {
    globalThis.fetch = vi.fn(async () => new Response('not json', { status: 200 }))
    const res = await createRequest('/api/x', {}, { crypto: 'api', cookie: {} })
    expect(res.body).toBe('not json')
  })
})
