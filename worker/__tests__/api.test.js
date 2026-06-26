// @vitest-environment node
import { describe, it, expect, vi, afterEach } from 'vitest'
import worker from '../index.js'
import { isBlockedHost } from '../api/fetch.js'
import { extractMeta } from '../api/preview.js'

const env = { ASSETS: { fetch: async () => new Response('static') } }
afterEach(() => { vi.restoreAllMocks() })

describe('isBlockedHost (SSRF guard)', () => {
  it('blocks loopback/private hosts', () => {
    for (const h of ['localhost', '127.0.0.1', '10.1.2.3', '192.168.0.1', '169.254.1.1', '172.16.0.1', '::1', 'foo.local'])
      expect(isBlockedHost(h), h).toBe(true)
  })
  it('allows public hosts', () => {
    for (const h of ['example.com', '8.8.8.8', 'raw.githubusercontent.com', '172.32.0.1'])
      expect(isBlockedHost(h), h).toBe(false)
  })
})

describe('/api/fetch', () => {
  it('400s when url is missing', async () => {
    const res = await worker.fetch(new Request('https://x/api/fetch'), env)
    expect(res.status).toBe(400)
  })
  it('400s on non-http protocol', async () => {
    const res = await worker.fetch(new Request('https://x/api/fetch?url=ftp://example.com/a'), env)
    expect(res.status).toBe(400)
  })
  it('403s on blocked host', async () => {
    const res = await worker.fetch(new Request('https://x/api/fetch?url=http://localhost/secret'), env)
    expect(res.status).toBe(403)
  })
  it('proxies a public url', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('hello', { headers: { 'content-type': 'text/plain' } }))
    const res = await worker.fetch(new Request('https://x/api/fetch?url=https://example.com/a.txt'), env)
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('hello')
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
  })
})

describe('extractMeta (OG)', () => {
  it('reads og:title + description', () => {
    const html = '<title>fallback</title><meta property="og:title" content="Hi &amp; Bye"><meta name="description" content="d">'
    const m = extractMeta(html, 'https://e.com')
    expect(m.title).toBe('Hi & Bye')
    expect(m.description).toBe('d')
  })
})
