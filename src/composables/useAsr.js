import { computed } from 'vue'
import { useSettings } from './useSettings'

// OpenAI-compatible ASR (speech-to-text) client. POSTs an /audio/transcriptions multipart request
// (file + model + response_format) and returns the parsed JSON (verbose_json → text + segments with
// timestamps). Routes through the same-origin /api/asr proxy by default (beats CORS, gated on
// backendEnabled); a setting (asrDirect) calls the provider directly.
//
// Config resolution (so ASR can share or differ from the chat provider):
//   base  = settings.asrBaseUrl || settings.aiBaseUrl
//   key   = settings.asrKey     || settings.aiKey
//   model = settings.asrModel             ('' → transcription disabled / not configured)
//
// Singleton-style, no per-call module state.

const PROXY_PATH = '/api/asr'

export class AsrError extends Error {
  // kind: 'notConfigured' | 'tooBig' | 'provider' | 'network' | 'empty'
  constructor(message, { status, kind, cause } = {}) {
    super(message)
    this.name = 'AsrError'
    this.status = status
    this.kind = kind || 'provider'
    if (cause) this.cause = cause
  }
}

export function useAsr() {
  const { settings } = useSettings()

  const base = computed(() => (settings.asrBaseUrl || settings.aiBaseUrl || '').trim().replace(/\/+$/, ''))
  const key = computed(() => (settings.asrKey || settings.aiKey || '').trim())
  const model = computed(() => (settings.asrModel || '').trim())

  // Configured = a model is set, a base resolves, AND we can reach the provider (direct, or the
  // backend proxy is on). An empty model means the user hasn't opted into ASR.
  const configured = computed(() =>
    !!model.value &&
    !!base.value &&
    (!!settings.asrDirect || !!settings.backendEnabled)
  )

  // Why isn't it ready? (drives the empty-state copy). null when configured.
  const unconfiguredReason = computed(() => {
    if (model.value && base.value && !settings.asrDirect && !settings.backendEnabled) return 'backend'
    if (!model.value) return 'model'
    if (!base.value) return 'base'
    return null
  })

  // Build the multipart body + target. Direct mode → '<base>/audio/transcriptions' with an
  // Authorization header. Proxy mode → /api/asr carrying __base + the same Authorization header
  // (the Worker forwards it upstream). `extra` carries optional language/prompt/temperature.
  function buildRequest(fileBlob, fileName, { responseFormat = 'verbose_json', language, prompt, temperature } = {}) {
    const fd = new FormData()
    const blob = fileBlob instanceof File ? fileBlob : new File([fileBlob], fileName || 'audio.mp3', { type: fileBlob?.type || 'audio/mpeg' })
    fd.append('file', blob, fileName || blob.name || 'audio.mp3')
    fd.append('model', model.value)
    if (responseFormat) fd.append('response_format', responseFormat)
    if (language) fd.append('language', language)
    if (prompt) fd.append('prompt', prompt)
    if (typeof temperature === 'number' && !Number.isNaN(temperature)) fd.append('temperature', String(temperature))

    const headers = key.value ? { authorization: `Bearer ${key.value}` } : {}

    if (settings.asrDirect) {
      const url = /\/audio\/transcriptions$/.test(base.value) ? base.value : `${base.value}/audio/transcriptions`
      return { url, init: { method: 'POST', headers, body: fd } }
    }
    // Proxy: carry the provider base inside the form so the Worker knows where to forward.
    fd.append('__base', base.value)
    return { url: PROXY_PATH, init: { method: 'POST', headers, body: fd } }
  }

  async function readError(resp) {
    let text = ''
    try { text = await resp.text() } catch { /* ignore */ }
    let detail = ''
    try {
      const j = JSON.parse(text)
      detail = j?.error?.message || j?.error || j?.detail || j?.message || ''
    } catch { detail = text.slice(0, 300) }
    return detail || `HTTP ${resp.status}`
  }

  // Transcribe one audio file/blob. Returns the parsed provider response object:
  //   { text, segments?: [{ start, end, text }], language?, duration? }
  // Throws AsrError with a specific `kind` on failure. Pass `signal` (AbortController) to cancel.
  async function transcribe(fileBlob, { fileName, responseFormat = 'verbose_json', language, prompt, temperature, signal } = {}) {
    if (!configured.value) {
      throw new AsrError('Transcription is not configured. Open Settings → AI to set an ASR model.', { kind: 'notConfigured', status: 0 })
    }
    const { url, init } = buildRequest(fileBlob, fileName, { responseFormat, language, prompt, temperature })
    init.signal = signal

    let resp
    try {
      resp = await fetch(url, init)
    } catch (e) {
      if (e?.name === 'AbortError') throw e
      throw new AsrError(
        settings.asrDirect
          ? 'Could not reach the transcription endpoint. If this is a CORS error, turn off "Call provider directly" in Settings.'
          : 'Could not reach the transcription proxy. Make sure the backend is enabled / deployed.',
        { kind: 'network', cause: e }
      )
    }

    if (!resp.ok) {
      const detail = await readError(resp)
      const kind = (resp.status === 413) ? 'tooBig' : 'provider'
      throw new AsrError(detail, { kind, status: resp.status })
    }

    // verbose_json → JSON; response_format=text → plain text. Handle both.
    const ctype = resp.headers.get('content-type') || ''
    if (ctype.includes('application/json')) {
      const data = await resp.json().catch(() => null)
      if (!data) throw new AsrError('Empty response from the transcription endpoint.', { kind: 'empty', status: resp.status })
      return data
    }
    const text = await resp.text().catch(() => '')
    if (!text.trim()) throw new AsrError('Empty response from the transcription endpoint.', { kind: 'empty', status: resp.status })
    return { text }
  }

  return { configured, unconfiguredReason, model, base, transcribe, buildRequest, AsrError }
}
