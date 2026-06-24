import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useAsr } from '../useAsr'
import { useSettings } from '../useSettings'

// Reset the shared settings singleton to a known ASR-configured baseline before each test.
function configure(over = {}) {
  const { settings } = useSettings()
  Object.assign(settings, {
    backendEnabled: true,
    aiBaseUrl: 'https://api.openai.com/v1',
    aiKey: 'sk-chat',
    asrBaseUrl: '',
    asrKey: '',
    asrModel: 'whisper-1',
    asrDirect: false,
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

function fileOf(name = 'a.mp3', type = 'audio/mpeg') {
  return new File([new Uint8Array([1, 2, 3])], name, { type })
}
function jsonResponse(obj, { status = 200 } = {}) {
  return new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } })
}

describe('useAsr — configuration resolution', () => {
  it('not configured when asrModel is empty (ASR opt-in)', () => {
    configure({ asrModel: '' })
    expect(useAsr().configured.value).toBe(false)
    expect(useAsr().unconfiguredReason.value).toBe('model')
  })

  it('configured when a model + base resolve and the backend is on', () => {
    configure()
    const a = useAsr()
    expect(a.configured.value).toBe(true)
    expect(a.model.value).toBe('whisper-1')
    // Empty asrBaseUrl/asrKey fall back to the chat provider's.
    expect(a.base.value).toBe('https://api.openai.com/v1')
  })

  it('asrBaseUrl / asrKey override the chat provider when set', () => {
    configure({ asrBaseUrl: 'https://asr.host/v1', asrKey: 'sk-asr' })
    const a = useAsr()
    expect(a.base.value).toBe('https://asr.host/v1')
    // (key is private but feeds the Authorization header — asserted in buildRequest below)
  })

  it('not configured in proxy mode when the backend is disabled', () => {
    configure({ backendEnabled: false, asrDirect: false })
    const a = useAsr()
    expect(a.configured.value).toBe(false)
    expect(a.unconfiguredReason.value).toBe('backend')
  })

  it('direct mode does not require the backend', () => {
    configure({ backendEnabled: false, asrDirect: true })
    expect(useAsr().configured.value).toBe(true)
  })
})

describe('useAsr — request shape (multipart)', () => {
  it('proxy mode: POSTs /api/asr with file + model + response_format + __base and the client key header', () => {
    configure({ asrDirect: false, asrKey: 'sk-asr', asrBaseUrl: 'https://asr.host/v1' })
    const { url, init } = useAsr().buildRequest(fileOf(), 'clip.mp3', { responseFormat: 'verbose_json' })
    expect(url).toBe('/api/asr')
    expect(init.method).toBe('POST')
    expect(init.body).toBeInstanceOf(FormData)
    expect(init.body.get('file')).toBeTruthy()
    expect(init.body.get('model')).toBe('whisper-1')
    expect(init.body.get('response_format')).toBe('verbose_json')
    expect(init.body.get('__base')).toBe('https://asr.host/v1')
    // The user's key rides in the Authorization header (the Worker forwards it upstream).
    expect(init.headers.authorization).toBe('Bearer sk-asr')
  })

  it('direct mode: POSTs <base>/audio/transcriptions with a Bearer header and no __base', () => {
    configure({ asrDirect: true })
    const { url, init } = useAsr().buildRequest(fileOf(), 'clip.mp3')
    expect(url).toBe('https://api.openai.com/v1/audio/transcriptions')
    expect(init.headers.authorization).toBe('Bearer sk-chat')
    expect(init.body.get('__base')).toBeNull()
  })

  it('passes optional language / prompt fields through', () => {
    configure()
    const { init } = useAsr().buildRequest(fileOf(), 'clip.mp3', { language: 'en', prompt: 'hi' })
    expect(init.body.get('language')).toBe('en')
    expect(init.body.get('prompt')).toBe('hi')
  })
})

describe('useAsr — transcribe', () => {
  it('returns the parsed verbose_json (text + segments)', async () => {
    configure()
    fetchMock.mockResolvedValue(jsonResponse({
      text: 'Hello there. General Kenobi.',
      segments: [
        { id: 0, start: 0, end: 2.5, text: 'Hello there.' },
        { id: 1, start: 2.5, end: 5, text: 'General Kenobi.' },
      ],
    }))
    const data = await useAsr().transcribe(fileOf(), { fileName: 'a.mp3' })
    expect(data.text).toContain('General Kenobi')
    expect(data.segments).toHaveLength(2)
    expect(data.segments[1].start).toBe(2.5)
    // Verify the request went to the proxy with the right shape.
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/asr')
    expect(init.body.get('model')).toBe('whisper-1')
  })

  it('handles a plain-text (response_format=text) response', async () => {
    configure()
    fetchMock.mockResolvedValue(new Response('just the words', { status: 200, headers: { 'content-type': 'text/plain' } }))
    const data = await useAsr().transcribe(fileOf(), { responseFormat: 'text' })
    expect(data.text).toBe('just the words')
  })

  it('throws a notConfigured error when no model is set', async () => {
    configure({ asrModel: '' })
    await expect(useAsr().transcribe(fileOf())).rejects.toMatchObject({ kind: 'notConfigured' })
  })

  it('maps a 413 to a tooBig error', async () => {
    configure()
    fetchMock.mockResolvedValue(jsonResponse({ error: 'too large' }, { status: 413 }))
    await expect(useAsr().transcribe(fileOf())).rejects.toMatchObject({ kind: 'tooBig', status: 413 })
  })

  it('maps other non-OK statuses to a provider error with the detail message', async () => {
    configure()
    fetchMock.mockResolvedValue(jsonResponse({ error: { message: 'bad model' } }, { status: 400 }))
    await expect(useAsr().transcribe(fileOf())).rejects.toMatchObject({ kind: 'provider', message: 'bad model' })
  })

  it('maps a fetch rejection to a network error', async () => {
    configure()
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(useAsr().transcribe(fileOf())).rejects.toMatchObject({ kind: 'network' })
  })
})
