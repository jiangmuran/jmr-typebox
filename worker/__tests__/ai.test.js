// @vitest-environment node
import { describe, it, expect, vi, afterEach } from 'vitest'
import worker from '../index.js'
import { buildUpstreamUrl } from '../api/ai.js'

const env = { ASSETS: { fetch: async () => new Response('static') } }
afterEach(() => { vi.restoreAllMocks() })

function aiReq(body, method = 'POST') {
  return new Request('https://x/api/ai', {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

describe('buildUpstreamUrl', () => {
  it('joins a base ending in /v1 with the chat path', () => {
    expect(buildUpstreamUrl('https://api.openai.com/v1')).toBe('https://api.openai.com/v1/chat/completions')
  })
  it('strips trailing slashes', () => {
    expect(buildUpstreamUrl('https://api.openai.com/v1/')).toBe('https://api.openai.com/v1/chat/completions')
  })
  it('respects a base that already points at the endpoint', () => {
    expect(buildUpstreamUrl('https://host/v1/chat/completions')).toBe('https://host/v1/chat/completions')
  })
  it('returns empty for blank input', () => {
    expect(buildUpstreamUrl('')).toBe('')
  })
})

describe('/api/ai validation', () => {
  it('answers CORS preflight (OPTIONS)', async () => {
    const res = await worker.fetch(aiReq(undefined, 'OPTIONS'), env)
    expect(res.status).toBe(204)
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
  })
  it('400s when baseUrl is missing', async () => {
    const res = await worker.fetch(aiReq({ body: { model: 'x', messages: [] } }), env)
    expect(res.status).toBe(400)
  })
  it('400s when body is missing', async () => {
    const res = await worker.fetch(aiReq({ baseUrl: 'https://api.openai.com/v1' }), env)
    expect(res.status).toBe(400)
  })
  it('403s on a blocked (loopback) host', async () => {
    const res = await worker.fetch(aiReq({ baseUrl: 'http://localhost:1234/v1', body: { messages: [] } }), env)
    expect(res.status).toBe(403)
  })
  it('400s on a non-http protocol', async () => {
    const res = await worker.fetch(aiReq({ baseUrl: ' file:///etc/passwd', body: { messages: [] } }), env)
    expect(res.status).toBe(400)
  })
})

describe('/api/ai forwarding', () => {
  it('forwards to the upstream with the Bearer key and streams the body back', async () => {
    const captured = {}
    globalThis.fetch = vi.fn(async (url, init) => {
      captured.url = url
      captured.auth = init.headers.authorization
      captured.body = JSON.parse(init.body)
      const stream = new ReadableStream({
        start(c) {
          c.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"hi"}}]}\n\n'))
          c.enqueue(new TextEncoder().encode('data: [DONE]\n\n'))
          c.close()
        },
      })
      return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } })
    })

    const res = await worker.fetch(
      aiReq({ baseUrl: 'https://api.openai.com/v1', key: 'sk-test', body: { model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'hi' }], stream: true } }),
      env
    )
    expect(res.status).toBe(200)
    expect(captured.url).toBe('https://api.openai.com/v1/chat/completions')
    expect(captured.auth).toBe('Bearer sk-test')
    expect(captured.body.model).toBe('gpt-4o-mini')
    const text = await res.text()
    expect(text).toContain('"content":"hi"')
    expect(text).toContain('[DONE]')
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
  })

  it('502s when the upstream fetch throws', async () => {
    globalThis.fetch = vi.fn(async () => { throw new Error('network down') })
    const res = await worker.fetch(
      aiReq({ baseUrl: 'https://api.openai.com/v1', body: { messages: [] } }),
      env
    )
    expect(res.status).toBe(502)
  })

  it('passes through a non-streaming JSON body + upstream status', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ error: { message: 'bad key' } }), { status: 401, headers: { 'content-type': 'application/json' } })
    )
    const res = await worker.fetch(
      aiReq({ baseUrl: 'https://api.openai.com/v1', key: 'bad', body: { messages: [] } }),
      env
    )
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: { message: 'bad key' } })
  })
})
