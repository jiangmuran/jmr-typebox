// @vitest-environment node
import { describe, it, expect, vi, afterEach } from 'vitest'
import { uploadImage, parseUploadUrl } from '../api/upload.js'

const env = { IMAGE_HOST_KEY: 'uf_secret' }
afterEach(() => { vi.restoreAllMocks() })

// Build a multipart upload request with a `file` Blob of the given type/size.
function uploadReq({ type = 'image/png', bytes = 10, name = 'pic.png', omit = false, string = false } = {}) {
  const form = new FormData()
  if (string) form.append('file', 'not-a-file')
  else if (!omit) form.append('file', new Blob([new Uint8Array(bytes)], { type }), name)
  return new Request('https://x/api/upload', { method: 'POST', body: form })
}

describe('parseUploadUrl', () => {
  it('reads {url}', () => expect(parseUploadUrl({ url: 'https://h/a.png' })).toBe('https://h/a.png'))
  it('reads nested {data:{url}}', () => expect(parseUploadUrl({ data: { url: 'https://h/b.png' } })).toBe('https://h/b.png'))
  it('reads {link}', () => expect(parseUploadUrl({ link: 'https://h/c.png' })).toBe('https://h/c.png'))
  it('reads {data:[{url}]}', () => expect(parseUploadUrl({ data: [{ url: 'https://h/d.png' }] })).toBe('https://h/d.png'))
  it('returns empty for unknown shapes', () => expect(parseUploadUrl({ foo: 1 })).toBe(''))
  it('returns empty for non-objects', () => expect(parseUploadUrl(null)).toBe(''))
})

describe('/api/upload validation', () => {
  it('answers CORS preflight (OPTIONS)', async () => {
    const res = await uploadImage(new Request('https://x/api/upload', { method: 'OPTIONS' }), env)
    expect(res.status).toBe(204)
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
  })
  it('405s on GET', async () => {
    const res = await uploadImage(new Request('https://x/api/upload', { method: 'GET' }), env)
    expect(res.status).toBe(405)
  })
  it('400s when the file field is missing', async () => {
    const res = await uploadImage(uploadReq({ omit: true }), env)
    expect(res.status).toBe(400)
  })
  it('400s when the file field is a plain string', async () => {
    const res = await uploadImage(uploadReq({ string: true }), env)
    expect(res.status).toBe(400)
  })
  it('415s on a non-image file', async () => {
    const res = await uploadImage(uploadReq({ type: 'application/pdf' }), env)
    expect(res.status).toBe(415)
  })
  it('413s on a file over 5 MB', async () => {
    const res = await uploadImage(uploadReq({ bytes: 5 * 1024 * 1024 + 1 }), env)
    expect(res.status).toBe(413)
  })
  it('503s when the server key is not configured', async () => {
    const res = await uploadImage(uploadReq(), {})
    expect(res.status).toBe(503)
  })
})

describe('/api/upload forwarding', () => {
  it('forwards multipart to the upstream with the Bearer key and returns {url}', async () => {
    const captured = {}
    globalThis.fetch = vi.fn(async (url, init) => {
      captured.url = url
      captured.auth = init.headers.authorization
      captured.isForm = init.body instanceof FormData
      return new Response(JSON.stringify({ url: 'https://files.muran.tech/x.png' }), {
        status: 200, headers: { 'content-type': 'application/json' },
      })
    })
    const res = await uploadImage(uploadReq(), env)
    expect(res.status).toBe(200)
    expect(captured.url).toBe('https://files.muran.tech/api/upload')
    expect(captured.auth).toBe('Bearer uf_secret')
    expect(captured.isForm).toBe(true)
    expect(await res.json()).toEqual({ url: 'https://files.muran.tech/x.png' })
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
  })

  it('honours env.IMAGE_HOST_URL override', async () => {
    let seen
    globalThis.fetch = vi.fn(async (url) => {
      seen = url
      return new Response(JSON.stringify({ url: 'https://h/y.png' }), { status: 200, headers: { 'content-type': 'application/json' } })
    })
    await uploadImage(uploadReq(), { IMAGE_HOST_KEY: 'k', IMAGE_HOST_URL: 'https://my.host/up' })
    expect(seen).toBe('https://my.host/up')
  })

  it('502s when the upstream errors', async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ error: 'nope' }), { status: 500, headers: { 'content-type': 'application/json' } }))
    const res = await uploadImage(uploadReq(), env)
    expect(res.status).toBe(502)
  })

  it('502s when the upstream returns no url', async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } }))
    const res = await uploadImage(uploadReq(), env)
    expect(res.status).toBe(502)
  })

  it('502s when the upstream fetch throws', async () => {
    globalThis.fetch = vi.fn(async () => { throw new Error('down') })
    const res = await uploadImage(uploadReq(), env)
    expect(res.status).toBe(502)
  })
})
