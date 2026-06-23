import { computed } from 'vue'
import { useSettings } from './useSettings'
import { SSEParser, DeltaAccumulator, extractErrorMessage } from '../ai/stream'

// OpenAI-compatible chat client. Streams /chat/completions, supports tool/function calling,
// and routes through the same-origin Worker proxy by default (so it works regardless of the
// upstream's CORS policy). A setting lets advanced users call the endpoint directly.
//
// Singleton-style (mirrors the other composables) — no per-call state held at module scope.

const PROXY_PATH = '/api/ai'

export class AIError extends Error {
  constructor(message, { status, cause } = {}) {
    super(message)
    this.name = 'AIError'
    this.status = status
    if (cause) this.cause = cause
  }
}

export function useAI() {
  const { settings } = useSettings()

  const ready = computed(() =>
    !!settings.aiEnabled &&
    !!(settings.aiKey || '').trim() &&
    !!(settings.aiBaseUrl || '').trim() &&
    !!(settings.aiModel || '').trim()
  )

  // Build the request body for /chat/completions.
  function buildBody(messages, opts = {}) {
    const body = {
      model: opts.model || settings.aiModel || 'gpt-4o-mini',
      messages,
      stream: opts.stream !== false,
    }
    const temp = opts.temperature ?? settings.aiTemperature
    if (typeof temp === 'number' && !Number.isNaN(temp)) body.temperature = temp
    if (opts.tools && opts.tools.length) {
      body.tools = opts.tools
      if (opts.tool_choice) body.tool_choice = opts.tool_choice
    }
    if (opts.max_tokens) body.max_tokens = opts.max_tokens
    if (opts.stop && opts.stop.length) body.stop = opts.stop
    return body
  }

  // Resolve where to POST and with what payload, honouring the proxy/direct toggle.
  // Direct mode talks to `<baseUrl>/chat/completions` with an Authorization header.
  // Proxy mode wraps {baseUrl,key,body} for the Worker, which adds the header upstream.
  function buildRequest(body) {
    const baseUrl = (settings.aiBaseUrl || 'https://api.openai.com/v1').trim().replace(/\/+$/, '')
    const key = (settings.aiKey || '').trim()
    if (settings.aiDirect) {
      const url = /\/chat\/completions$/.test(baseUrl) ? baseUrl : `${baseUrl}/chat/completions`
      return {
        url,
        init: {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(key ? { authorization: `Bearer ${key}` } : {}),
          },
          body: JSON.stringify(body),
        },
      }
    }
    return {
      url: PROXY_PATH,
      init: {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ baseUrl, key, body }),
      },
    }
  }

  async function readErrorBody(resp) {
    let text = ''
    try { text = await resp.text() } catch {}
    return extractErrorMessage(text, resp.status)
  }

  // Core streaming chat. Resolves with the final assistant message:
  //   { role, content, tool_calls?, finish_reason }
  // `onToken(deltaText)` fires for each content token. Pass `signal` (AbortController) to cancel.
  async function chat(messages, opts = {}) {
    if (!ready.value) {
      throw new AIError('AI is not configured. Open Settings → AI to add your API key and endpoint.', { status: 0 })
    }
    const wantStream = opts.stream !== false
    const body = buildBody(messages, opts)
    const { url, init } = buildRequest(body)
    init.signal = opts.signal

    let resp
    try {
      resp = await fetch(url, init)
    } catch (e) {
      if (e?.name === 'AbortError') throw e
      throw new AIError(
        settings.aiDirect
          ? 'Could not reach the AI endpoint. If this is a CORS error, turn off "Call AI endpoint directly" in Settings.'
          : 'Could not reach the AI proxy. Make sure the backend is enabled / deployed.',
        { cause: e }
      )
    }

    if (!resp.ok) {
      throw new AIError(await readErrorBody(resp), { status: resp.status })
    }

    // Non-streaming path (used by some callers / endpoints without SSE).
    const ctype = resp.headers.get('content-type') || ''
    if (!wantStream || (!ctype.includes('text/event-stream') && !resp.body)) {
      const data = await resp.json().catch(() => null)
      const msg = data?.choices?.[0]?.message
      if (!msg) throw new AIError('Empty response from AI endpoint.', { status: resp.status })
      if (msg.content) opts.onToken?.(msg.content)
      return { ...msg, finish_reason: data.choices[0].finish_reason }
    }

    // Streaming path: read the body, parse SSE, accumulate deltas.
    const reader = resp.body.getReader()
    const decoder = new TextDecoder()
    const parser = new SSEParser()
    const acc = new DeltaAccumulator()
    let upstreamError = null

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const chunk = decoder.decode(value, { stream: true })
        for (const evt of parser.push(chunk)) {
          if (evt === '[DONE]') continue
          if (evt?.error) { upstreamError = evt.error; continue }
          acc.add(evt, { onToken: opts.onToken })
        }
      }
      for (const evt of parser.flush()) {
        if (evt === '[DONE]' || !evt) continue
        if (evt.error) { upstreamError = evt.error; continue }
        acc.add(evt, { onToken: opts.onToken })
      }
    } catch (e) {
      try { reader.cancel() } catch {}
      if (e?.name === 'AbortError') throw e
      throw new AIError('Streaming connection failed.', { cause: e })
    }

    if (upstreamError) {
      throw new AIError(extractErrorMessage(upstreamError), { status: resp.status })
    }
    return acc.result()
  }

  // Convenience: collect a full completion to a string (no tools).
  async function complete(messages, opts = {}) {
    const msg = await chat(messages, opts)
    return msg.content || ''
  }

  // Inline "ghost text" autocomplete: a SHORT one-shot continuation tuned for low latency.
  // Non-streaming, low max_tokens, a low temperature, and stop sequences so it can't ramble.
  // `messages` is a prepared chat array (see useAiComplete.buildCompletionMessages). Returns the
  // raw continuation string (callers sanitize). Throws on failure — the inline-complete composable
  // swallows it (shows no ghost).
  async function completeInline(messages, { signal } = {}) {
    return complete(messages, {
      stream: false,
      signal,
      temperature: 0.3,
      max_tokens: 64,
      stop: ['\n\n'],
    })
  }

  return { ready, chat, complete, completeInline, buildBody, AIError }
}
