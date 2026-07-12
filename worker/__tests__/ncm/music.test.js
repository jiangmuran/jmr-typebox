// @vitest-environment node
import { describe, it, expect, vi, afterEach } from 'vitest'
import worker from '../../index.js'
import { signSession } from '../../lib/jwt.js'

const TEST_AUTH_SECRET = 'test-secret-32-chars-minimum-aaa-bbb'

// Mock the upstream NCM fetch — every createRequest() call lands here. Returns a generic
// successful body unless a test overrides globalThis.fetch for a specific case.
function mockNcm(body = { code: 200, data: [], msg: 'ok' }, status = 200) {
  globalThis.fetch = vi.fn(async () => new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  }))
}

// Build an admin env with a valid session cookie already attached to a Request.
async function authedAdminRequest(url, init = {}, env = {}) {
  const fullEnv = { ASSETS: { fetch: async () => new Response('static') }, ALLOWED_IPS: '1.2.3.4', AUTH_SECRET: TEST_AUTH_SECRET, ...env }
  const token = await signSession(fullEnv)
  const headers = new Headers(init.headers || {})
  headers.set('cookie', `tb-admin=${token}`)
  headers.set('CF-Connecting-IP', '1.2.3.4')
  return { req: new Request(url, { ...init, headers }), env: fullEnv }
}

afterEach(() => vi.restoreAllMocks())

describe('/api/music/* dispatch', () => {
  it('searches with valid keywords', async () => {
    mockNcm({ code: 200, result: { songs: [{ id: 1, name: 'Jay' }] } })
    const env = { ASSETS: { fetch: async () => new Response('static') } }
    const res = await worker.fetch(
      new Request('https://x/api/music/search?keywords=jay&type=1&limit=10'),
      env
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.result.songs[0].name).toBe('Jay')
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
  })

  it('400s when keywords missing', async () => {
    const env = { ASSETS: { fetch: async () => new Response('static') } }
    const res = await worker.fetch(new Request('https://x/api/music/search'), env)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('bad_request')
  })

  it('400s on invalid type', async () => {
    const env = { ASSETS: { fetch: async () => new Response('static') } }
    const res = await worker.fetch(new Request('https://x/api/music/search?keywords=x&type=999'), env)
    expect(res.status).toBe(400)
  })

  it('parses /song/url/:id parameterised path', async () => {
    mockNcm({ code: 200, data: [{ id: 12345, url: 'https://m.x.com/a.mp3', br: 320000 }] })
    const env = { ASSETS: { fetch: async () => new Response('static') } }
    const res = await worker.fetch(new Request('https://x/api/music/song/url/12345?br=320000'), env)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data[0].url).toBe('https://m.x.com/a.mp3')
  })

  it('parses /lyric/:id', async () => {
    mockNcm({ code: 200, lrc: { lyric: '[00:01]hi' } })
    const env = { ASSETS: { fetch: async () => new Response('static') } }
    const res = await worker.fetch(new Request('https://x/api/music/lyric/123'), env)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.lrc.lyric).toBe('[00:01]hi')
  })

  it('404s an unknown /api/music/* path', async () => {
    const env = { ASSETS: { fetch: async () => new Response('static') } }
    const res = await worker.fetch(new Request('https://x/api/music/nope'), env)
    expect(res.status).toBe(404)
  })

  it('answers OPTIONS with 204 + CORS', async () => {
    const env = { ASSETS: { fetch: async () => new Response('static') } }
    const res = await worker.fetch(new Request('https://x/api/music/search', { method: 'OPTIONS' }), env)
    expect(res.status).toBe(204)
    expect(res.headers.get('access-control-allow-methods')).toMatch(/GET, POST, OPTIONS/)
  })
})

describe('/api/music/stream/:id', () => {
  it('proxies the upstream audio bytes through the Worker', async () => {
    // First fetch is the /song/url lookup (JSON); second is the audio stream itself.
    let call = 0
    globalThis.fetch = vi.fn(async (url) => {
      call++
      if (call === 1) {
        return new Response(JSON.stringify({
          code: 200,
          data: [{ id: 1, url: 'http://m801.music.126.net/track.mp3' }],
        }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      // Audio stream: verify http→https upgrade happened.
      expect(url).toMatch(/^https:\/\//)
      return new Response('AUDIO_BYTES', {
        status: 200,
        headers: { 'content-type': 'audio/mpeg', 'content-length': '11', 'accept-ranges': 'bytes' },
      })
    })
    const env = { ASSETS: { fetch: async () => new Response('static') } }
    const res = await worker.fetch(new Request('https://x/api/music/stream/1'), env)
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('AUDIO_BYTES')
    expect(res.headers.get('content-type')).toBe('audio/mpeg')
    expect(res.headers.get('cache-control')).toMatch(/immutable/)
    expect(res.headers.get('content-length')).toBe('11')
    expect(res.headers.get('accept-ranges')).toBe('bytes')
  })

  it('returns 502 when the upstream track has no URL (VIP-only / taken down)', async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({
      code: 200,
      data: [{ id: 1, url: null, code: -110, fee: 1 }],
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    const env = { ASSETS: { fetch: async () => new Response('static') } }
    const res = await worker.fetch(new Request('https://x/api/music/stream/1'), env)
    expect(res.status).toBe(502)
    const body = await res.json()
    expect(body.error).toBe('no_stream_url')
  })
})

describe('IP allowlist integration', () => {
  const env = (allowlist) => ({ ASSETS: { fetch: async () => new Response('static') }, ALLOWED_IPS: allowlist })

  it('opens /api/music/* to any IP when ALLOWED_IPS is unset', async () => {
    mockNcm({ code: 200 })
    const res = await worker.fetch(
      new Request('https://x/api/music/search?keywords=test'),
      env(undefined)
    )
    expect(res.status).toBe(200)
  })

  it('403s a music request when ALLOWED_IPS is set and the caller IP misses', async () => {
    const res = await worker.fetch(
      new Request('https://x/api/music/search?keywords=test', {
        headers: { 'CF-Connecting-IP': '9.9.9.9' },
      }),
      env('1.2.3.4')
    )
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toBe('forbidden')
    expect(body.message).toContain('*.*')
  })

  it('allows a music request when the caller IP is on the list', async () => {
    mockNcm({ code: 200 })
    const res = await worker.fetch(
      new Request('https://x/api/music/search?keywords=test', {
        headers: { 'CF-Connecting-IP': '1.2.3.4' },
      }),
      env('1.2.3.4')
    )
    expect(res.status).toBe(200)
  })

  it('lets /api/admin/ncm/account through the IP gate when ALLOWED_IPS is unset (session still required)', async () => {
    // Phase 4: no IP allowlist → admin IP gate is open. The session gate (next in worker/index.js)
    // still fires, so an unauthenticated caller gets 401, not 403.
    const res = await worker.fetch(
      new Request('https://x/api/admin/ncm/account'),
      { ASSETS: { fetch: async () => new Response('static') }, AUTH_SECRET: TEST_AUTH_SECRET }
    )
    expect(res.status).toBe(401)
  })

  it('closes /api/admin/ncm/* when no session cookie is present (even on allowlist)', async () => {
    // IP is on the allowlist, but no session → 401 (phase 3 added the session gate).
    const res = await worker.fetch(
      new Request('https://x/api/admin/ncm/qrcode/key', {
        method: 'POST',
        headers: { 'CF-Connecting-IP': '1.2.3.4' },
      }),
      { ASSETS: { fetch: async () => new Response('static') }, ALLOWED_IPS: '1.2.3.4', AUTH_SECRET: TEST_AUTH_SECRET }
    )
    expect(res.status).toBe(401)
  })
})

describe('/api/admin/ncm/* routes (with valid session)', () => {
  it('returns 503 when NCM_COOKIE is missing on /account', async () => {
    const { req, env } = await authedAdminRequest('https://x/api/admin/ncm/account', { method: 'GET' })
    const res = await worker.fetch(req, env)
    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.error).toBe('no_ncm_cookie_configured')
  })

  it('issues a unikey via POST /qrcode/key', async () => {
    mockNcm({ unikey: 'abc123fakeunikey_realistic_32chars' })
    const { req, env } = await authedAdminRequest('https://x/api/admin/ncm/qrcode/key', { method: 'POST' }, { NCM_COOKIE: 'MUSIC_U=fake' })
    const res = await worker.fetch(req, env)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.unikey).toBe('abc123fakeunikey_realistic_32chars')
  })

  it('returns a qrurl via GET /qrcode/:key', async () => {
    const { req, env } = await authedAdminRequest('https://x/api/admin/ncm/qrcode/abc123fakeunikey_realistic', {}, { NCM_COOKIE: 'MUSIC_U=fake' })
    const res = await worker.fetch(req, env)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.qrurl).toBe('https://music.163.com/login?codekey=abc123fakeunikey_realistic')
    expect(body.data.qrimg).toBe('') // we never render server-side
  })

  it('polls login state via GET /qrcode/check/:key', async () => {
    mockNcm({ code: 801, message: 'waiting' })
    const { req, env } = await authedAdminRequest('https://x/api/admin/ncm/qrcode/check/abc123fakeunikey_realistic', {}, { NCM_COOKIE: 'MUSIC_U=fake' })
    const res = await worker.fetch(req, env)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.code).toBe(801)
  })
})
