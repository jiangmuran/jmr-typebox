// Pure helpers for parsing OpenAI-compatible streaming Server-Sent Events.
// Kept dependency-free and side-effect-free so they can be unit-tested directly.

// Incrementally splits a byte/string stream into SSE `data:` payload objects. SSE frames are
// separated by a blank line; each frame has one or more `data:` lines. We buffer partial
// frames across chunks (network reads don't respect frame boundaries) and emit parsed JSON.
//
// Usage:
//   const sp = new SSEParser()
//   for await (const chunk of reader) for (const evt of sp.push(chunk)) handle(evt)
//   for (const evt of sp.flush()) handle(evt)   // drain any trailing frame
//
// Each emitted event is either a parsed JSON object, or the sentinel string '[DONE]'.
export class SSEParser {
  constructor() { this.buffer = '' }

  push(text) {
    this.buffer += text
    const events = []
    // Frames are delimited by a blank line. Normalise CRLF first.
    const normalized = this.buffer.replace(/\r\n/g, '\n')
    const parts = normalized.split('\n\n')
    // The last element is an incomplete frame (no trailing blank line yet) — keep it buffered.
    this.buffer = parts.pop() ?? ''
    for (const frame of parts) {
      const evt = parseFrame(frame)
      if (evt !== undefined) events.push(evt)
    }
    return events
  }

  // Drain a final frame that may not end in a blank line (some servers omit it).
  flush() {
    const events = []
    const frame = this.buffer.trim()
    this.buffer = ''
    if (frame) {
      const evt = parseFrame(frame)
      if (evt !== undefined) events.push(evt)
    }
    return events
  }
}

// Parse one SSE frame (its `data:` lines). Returns a parsed object, the '[DONE]' sentinel,
// or undefined when there's nothing useful (comments / empty).
function parseFrame(frame) {
  const dataLines = []
  for (const raw of frame.split('\n')) {
    const line = raw.replace(/^﻿/, '')
    if (!line || line.startsWith(':')) continue // comment / keep-alive
    if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart())
  }
  if (!dataLines.length) return undefined
  const data = dataLines.join('\n')
  if (data === '[DONE]') return '[DONE]'
  try { return JSON.parse(data) } catch { return undefined }
}

// Accumulates streaming chat-completion deltas into a final assistant message. OpenAI streams
// content token-by-token and tool calls argument-by-argument (each delta carries an `index`
// and partial JSON for `function.arguments`), so we stitch them back together here.
//
//   const acc = new DeltaAccumulator()
//   acc.add(chunk, { onToken })   // for each SSE JSON object
//   const msg = acc.result()      // { role, content, tool_calls? }
export class DeltaAccumulator {
  constructor() {
    this.content = ''
    this.role = 'assistant'
    this.toolCalls = [] // [{ id, type, function: { name, arguments } }]
    this.finishReason = null
  }

  add(chunk, { onToken } = {}) {
    const choice = chunk?.choices?.[0]
    if (!choice) return
    if (choice.finish_reason) this.finishReason = choice.finish_reason
    const delta = choice.delta || {}
    if (delta.role) this.role = delta.role
    if (typeof delta.content === 'string' && delta.content.length) {
      this.content += delta.content
      onToken?.(delta.content)
    }
    if (Array.isArray(delta.tool_calls)) {
      for (const tc of delta.tool_calls) {
        const i = tc.index ?? 0
        const slot = (this.toolCalls[i] ||= { id: '', type: 'function', function: { name: '', arguments: '' } })
        if (tc.id) slot.id = tc.id
        if (tc.type) slot.type = tc.type
        if (tc.function?.name) slot.function.name += tc.function.name
        if (typeof tc.function?.arguments === 'string') slot.function.arguments += tc.function.arguments
      }
    }
  }

  result() {
    const msg = { role: this.role, content: this.content }
    const calls = this.toolCalls.filter(Boolean)
    if (calls.length) msg.tool_calls = calls
    msg.finish_reason = this.finishReason
    return msg
  }
}

// Parse a tool call's `arguments` (a JSON string) defensively — models occasionally emit
// trailing junk or an empty string. Returns {} on failure rather than throwing.
export function parseToolArguments(args) {
  if (args == null) return {}
  if (typeof args === 'object') return args
  const s = String(args).trim()
  if (!s) return {}
  try { return JSON.parse(s) } catch {}
  // Last resort: grab the outermost {...} block.
  const a = s.indexOf('{'); const b = s.lastIndexOf('}')
  if (a >= 0 && b > a) { try { return JSON.parse(s.slice(a, b + 1)) } catch {} }
  return {}
}

// Pull a human-readable message out of an OpenAI-style error body (string or object).
export function extractErrorMessage(body, status) {
  if (!body) return status ? `Request failed (${status})` : 'Request failed'
  let obj = body
  if (typeof body === 'string') {
    const s = body.trim()
    try { obj = JSON.parse(s) } catch { return s.slice(0, 400) || (status ? `Request failed (${status})` : 'Request failed') }
  }
  const msg = obj?.error?.message || obj?.error || obj?.message
  if (typeof msg === 'string') return msg
  if (msg && typeof msg === 'object' && typeof msg.message === 'string') return msg.message
  return status ? `Request failed (${status})` : 'Request failed'
}
