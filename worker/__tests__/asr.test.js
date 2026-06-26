// @vitest-environment node
import { describe, it, expect, vi, afterEach } from 'vitest'
import { asrTranscribe, buildAsrUrl } from '../api/asr.js'

afterEach(() => { vi.restoreAllMocks() })

// Build a multipart /api/asr request with file + model + __base (and an optional Authorization).
function asrReq({
  type = 'audio/mpeg', bytes = 100, name = 'a.mp3',
  model = 'whisper-1', base = 'https://api.openai.com/v1',
  responseFormat = 'verbose_json', auth = 'Bearer sk-user',
  omitFile = false, omitModel = false, omitBase = false, stringFile = false,
} = {}) {
  const form = new FormData()
  if (stringFile) form.append('file', 'not-a-file')
  else if (!omitFile) form.append('file', new Blob([new Uint8Array(bytes)], { type }), name)
  if (!omitModel) form.append('model', model)
  if (!omitBase) form.append('__base', base)
  if (responseFormat) form.append('response_format', responseFormat)
  const headers = auth ? { authorization: auth } : {}
  return new Request('https://x/api/asr', { method: 'POST', body: form, headers })
}

describe('buildAsrUrl', () => {
  it('joins a base ending in /v1 with the transcriptions path', () => {
    expect(buildAsrUrl('https://api.openai.com/v1')).toBe('https://api.openai.com/v1/audio/transcriptions')
  })
  it('strips trailing slashes', () => {
    expect(buildAsrUrl('https://api.openai.com/v1/')).toBe('https://api.openai.com/v1/audio/transcriptions')
  })
  it('respects a base already pointing at the endpoint', () => {
    expect(buildAsrUrl('https://h/v1/audio/transcriptions')).toBe('https://h/v1/audio/transcriptions')
  })
  it('returns empty for blank input', () => {
    expect(buildAsrUrl('')).toBe('')
  })
})

describe('/api/asr validation', () => {
  it('answers CORS preflight (OPTIONS)', async () => {
    const res = await asrTranscribe(new Request('https://x/api/asr', { method: 'OPTIONS' }), {})
    expect(res.status).toBe(204)
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
    // Authorization must be allowed so the client can forward its key.
    expect(res.headers.get('access-control-allow-headers')).toContain('authorization')
  })
  it('405s on GET', async () => {
    const res = await asrTranscribe(new Request('https://x/api/asr', { method: 'GET' }), {})
    expect(res.status).toBe(405)
  })
  it('400s when the file is missing', async () => {
    const res = await asrTranscribe(asrReq({ omitFile: true }), {})
    expect(res.status).toBe(400)
  })
  it('400s when the file is a plain string', async () => {
    const res = await asrTranscribe(asrReq({ stringFile: true }), {})
    expect(res.status).toBe(400)
  })
  it('400s when the model is missing', async () => {
    const res = await asrTranscribe(asrReq({ omitModel: true }), {})
    expect(res.status).toBe(400)
  })
  it('400s when the provider base is missing', async () => {
    const res = await asrTranscribe(asrReq({ omitBase: true }), {})
    expect(res.status).toBe(400)
  })
  it('403s on a blocked (loopback) provider host', async () => {
    const res = await asrTranscribe(asrReq({ base: 'http://localhost:1234/v1' }), {})
    expect(res.status).toBe(403)
  })
  it('400s on a non-http protocol', async () => {
    const res = await asrTranscribe(asrReq({ base: 'ftp://h/v1' }), {})
    expect(res.status).toBe(400)
  })
  it('413s on audio over the 25 MB cap', async () => {
    const res = await asrTranscribe(asrReq({ bytes: 26 * 1024 * 1024 + 1 }), {})
    expect(res.status).toBe(413)
  })
})

describe('/api/asr forwarding', () => {
  it('relays the multipart to <base>/audio/transcriptions with file+model and the client key, passing JSON back', async () => {
    const captured = {}
    globalThis.fetch = vi.fn(async (url, init) => {
      captured.url = url
      captured.auth = init.headers.authorization
      captured.isForm = init.body instanceof FormData
      // Inspect the forwarded form: file + model present, __base stripped.
      captured.hasFile = init.body.get('file') != null
      captured.model = init.body.get('model')
      captured.responseFormat = init.body.get('response_format')
      captured.base = init.body.get('__base')
      return new Response(JSON.stringify({ text: 'hello', segments: [{ start: 0, end: 1, text: 'hello' }] }), {
        status: 200, headers: { 'content-type': 'application/json' },
      })
    })
    const res = await asrTranscribe(asrReq(), {})
    expect(res.status).toBe(200)
    expect(captured.url).toBe('https://api.openai.com/v1/audio/transcriptions')
    expect(captured.auth).toBe('Bearer sk-user')          // client key forwarded, not a server secret
    expect(captured.isForm).toBe(true)
    expect(captured.hasFile).toBe(true)
    expect(captured.model).toBe('whisper-1')
    expect(captured.responseFormat).toBe('verbose_json')
    expect(captured.base).toBeNull()                       // internal __base stripped from the upstream form
    const body = await res.json()
    expect(body.segments[0].text).toBe('hello')
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
  })

  it('passes the provider status + body through on an upstream error', async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ error: { message: 'bad model' } }), {
      status: 400, headers: { 'content-type': 'application/json' },
    }))
    const res = await asrTranscribe(asrReq(), {})
    expect(res.status).toBe(400)
    expect((await res.json()).error.message).toBe('bad model')
  })

  it('502s when the upstream fetch throws (network)', async () => {
    globalThis.fetch = vi.fn(async () => { throw new Error('down') })
    const res = await asrTranscribe(asrReq(), {})
    expect(res.status).toBe(502)
  })
})
