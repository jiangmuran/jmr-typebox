import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useAI } from '../useAI'
import { useSettings } from '../useSettings'

// Build a Response whose body streams the given SSE string in chunks.
function sseResponse(frames, { status = 200, ctype = 'text/event-stream' } = {}) {
  const enc = new TextEncoder()
  const stream = new ReadableStream({
    start(c) {
      for (const f of frames) c.enqueue(enc.encode(f))
      c.close()
    },
  })
  return new Response(stream, { status, headers: { 'content-type': ctype } })
}

function configure(over = {}) {
  const { settings } = useSettings()
  Object.assign(settings, {
    aiEnabled: true,
    aiBaseUrl: 'https://api.openai.com/v1',
    aiKey: 'sk-test',
    aiModel: 'gpt-4o-mini',
    aiTemperature: 0.5,
    aiDirect: false,
    ...over,
  })
  return settings
}

let fetchMock
beforeEach(() => {
  fetchMock = vi.fn()
  globalThis.fetch = fetchMock
})
afterEach(() => { vi.restoreAllMocks() })

describe('useAI.ready', () => {
  it('is false until enabled + key + baseUrl + model are present', () => {
    const { settings } = useSettings()
    Object.assign(settings, { aiEnabled: false, aiKey: '', aiBaseUrl: '', aiModel: '' })
    const { ready } = useAI()
    expect(ready.value).toBe(false)
    Object.assign(settings, { aiEnabled: true, aiKey: 'k', aiBaseUrl: 'b', aiModel: 'm' })
    expect(ready.value).toBe(true)
  })
})

describe('useAI.chat streaming', () => {
  it('streams tokens via onToken and returns the assembled message', async () => {
    configure()
    fetchMock.mockResolvedValue(sseResponse([
      'data: {"choices":[{"delta":{"role":"assistant","content":"Hel"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"lo"}}]}\n\n',
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
      'data: [DONE]\n\n',
    ]))
    const tokens = []
    const { chat } = useAI()
    const msg = await chat([{ role: 'user', content: 'hi' }], { onToken: t => tokens.push(t) })
    expect(tokens).toEqual(['Hel', 'lo'])
    expect(msg.content).toBe('Hello')
    expect(msg.finish_reason).toBe('stop')
  })

  it('routes through the /api/ai proxy by default with wrapped payload', async () => {
    configure({ aiDirect: false })
    fetchMock.mockResolvedValue(sseResponse(['data: [DONE]\n\n']))
    const { chat } = useAI()
    await chat([{ role: 'user', content: 'x' }])
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/ai')
    const body = JSON.parse(init.body)
    expect(body.baseUrl).toBe('https://api.openai.com/v1')
    expect(body.key).toBe('sk-test')
    expect(body.body.model).toBe('gpt-4o-mini')
    expect(body.body.temperature).toBe(0.5)
    // The proxy payload must NOT carry an Authorization header (the worker adds it).
    expect(init.headers.authorization).toBeUndefined()
  })

  it('calls the endpoint directly with a Bearer header when aiDirect is on', async () => {
    configure({ aiDirect: true })
    fetchMock.mockResolvedValue(sseResponse(['data: [DONE]\n\n']))
    const { chat } = useAI()
    await chat([{ role: 'user', content: 'x' }])
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.openai.com/v1/chat/completions')
    expect(init.headers.authorization).toBe('Bearer sk-test')
  })

  it('parses streamed tool calls', async () => {
    configure()
    fetchMock.mockResolvedValue(sseResponse([
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","type":"function","function":{"name":"get_document","arguments":""}}]}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{}"}}]}}]}\n\n',
      'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n',
      'data: [DONE]\n\n',
    ]))
    const { chat } = useAI()
    const msg = await chat([{ role: 'user', content: 'read doc' }], { tools: [{ type: 'function', function: { name: 'get_document', parameters: {} } }] })
    expect(msg.tool_calls).toHaveLength(1)
    expect(msg.tool_calls[0].function.name).toBe('get_document')
    expect(msg.finish_reason).toBe('tool_calls')
  })

  it('surfaces HTTP error bodies as a readable message', async () => {
    configure()
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: { message: 'invalid api key' } }), { status: 401, headers: { 'content-type': 'application/json' } }))
    const { chat } = useAI()
    await expect(chat([{ role: 'user', content: 'x' }])).rejects.toThrow(/invalid api key/)
  })

  it('throws a configuration error when not ready', async () => {
    const { settings } = useSettings()
    Object.assign(settings, { aiEnabled: false })
    const { chat } = useAI()
    await expect(chat([{ role: 'user', content: 'x' }])).rejects.toThrow(/not configured/i)
  })

  it('handles a non-streaming JSON completion', async () => {
    configure()
    fetchMock.mockResolvedValue(new Response(
      JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'plain' }, finish_reason: 'stop' }] }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    ))
    const { chat } = useAI()
    const msg = await chat([{ role: 'user', content: 'x' }], { stream: false })
    expect(msg.content).toBe('plain')
  })
})
