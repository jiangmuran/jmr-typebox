import { describe, it, expect } from 'vitest'
import { SSEParser, DeltaAccumulator, parseToolArguments, extractErrorMessage } from '../stream'

describe('SSEParser', () => {
  it('parses a single data frame', () => {
    const p = new SSEParser()
    const out = p.push('data: {"a":1}\n\n')
    expect(out).toEqual([{ a: 1 }])
  })

  it('buffers across chunk boundaries (split mid-frame)', () => {
    const p = new SSEParser()
    expect(p.push('data: {"a":')).toEqual([])      // incomplete
    expect(p.push('1}\n\n')).toEqual([{ a: 1 }])    // completes
  })

  it('handles multiple frames in one chunk', () => {
    const p = new SSEParser()
    const out = p.push('data: {"a":1}\n\ndata: {"b":2}\n\n')
    expect(out).toEqual([{ a: 1 }, { b: 2 }])
  })

  it('emits the [DONE] sentinel', () => {
    const p = new SSEParser()
    expect(p.push('data: [DONE]\n\n')).toEqual(['[DONE]'])
  })

  it('ignores comments / keep-alive lines', () => {
    const p = new SSEParser()
    expect(p.push(': keep-alive\n\n')).toEqual([])
    expect(p.push('data: {"x":true}\n\n')).toEqual([{ x: true }])
  })

  it('normalises CRLF line endings', () => {
    const p = new SSEParser()
    expect(p.push('data: {"a":1}\r\n\r\n')).toEqual([{ a: 1 }])
  })

  it('flush() drains a frame with no trailing blank line', () => {
    const p = new SSEParser()
    expect(p.push('data: {"a":1}')).toEqual([])
    expect(p.flush()).toEqual([{ a: 1 }])
  })

  it('skips unparseable data without throwing', () => {
    const p = new SSEParser()
    expect(p.push('data: not-json\n\n')).toEqual([])
  })
})

describe('DeltaAccumulator', () => {
  const chunk = (delta, finish = null) => ({ choices: [{ delta, finish_reason: finish }] })

  it('accumulates streamed content and fires onToken', () => {
    const acc = new DeltaAccumulator()
    const tokens = []
    const onToken = t => tokens.push(t)
    acc.add(chunk({ role: 'assistant', content: 'Hel' }), { onToken })
    acc.add(chunk({ content: 'lo' }), { onToken })
    acc.add(chunk({}, 'stop'), { onToken })
    const r = acc.result()
    expect(r.role).toBe('assistant')
    expect(r.content).toBe('Hello')
    expect(r.finish_reason).toBe('stop')
    expect(tokens).toEqual(['Hel', 'lo'])
    expect(r.tool_calls).toBeUndefined()
  })

  it('stitches tool-call argument fragments by index', () => {
    const acc = new DeltaAccumulator()
    acc.add(chunk({ tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'get_', arguments: '{"a"' } }] }))
    acc.add(chunk({ tool_calls: [{ index: 0, function: { name: 'doc', arguments: ':1}' } }] }))
    acc.add(chunk({}, 'tool_calls'))
    const r = acc.result()
    expect(r.tool_calls).toHaveLength(1)
    expect(r.tool_calls[0].id).toBe('call_1')
    expect(r.tool_calls[0].function.name).toBe('get_doc')
    expect(r.tool_calls[0].function.arguments).toBe('{"a":1}')
    expect(r.finish_reason).toBe('tool_calls')
  })

  it('handles parallel tool calls at different indexes', () => {
    const acc = new DeltaAccumulator()
    acc.add(chunk({ tool_calls: [{ index: 0, id: 'a', function: { name: 'one', arguments: '{}' } }] }))
    acc.add(chunk({ tool_calls: [{ index: 1, id: 'b', function: { name: 'two', arguments: '{}' } }] }))
    const r = acc.result()
    expect(r.tool_calls.map(c => c.function.name)).toEqual(['one', 'two'])
  })

  it('ignores chunks with no choices', () => {
    const acc = new DeltaAccumulator()
    acc.add({})
    acc.add({ choices: [] })
    expect(acc.result().content).toBe('')
  })
})

describe('parseToolArguments', () => {
  it('parses valid JSON strings', () => {
    expect(parseToolArguments('{"x":1}')).toEqual({ x: 1 })
  })
  it('returns {} for empty/null', () => {
    expect(parseToolArguments('')).toEqual({})
    expect(parseToolArguments(null)).toEqual({})
  })
  it('passes through objects', () => {
    expect(parseToolArguments({ y: 2 })).toEqual({ y: 2 })
  })
  it('recovers from trailing junk by grabbing the {...} block', () => {
    expect(parseToolArguments('{"a":1} trailing')).toEqual({ a: 1 })
  })
  it('returns {} on hopeless input', () => {
    expect(parseToolArguments('nonsense')).toEqual({})
  })
})

describe('extractErrorMessage', () => {
  it('reads OpenAI-style error objects', () => {
    expect(extractErrorMessage({ error: { message: 'bad key' } })).toBe('bad key')
  })
  it('reads error objects from JSON strings', () => {
    expect(extractErrorMessage('{"error":{"message":"rate limited"}}', 429)).toBe('rate limited')
  })
  it('falls back to raw text', () => {
    expect(extractErrorMessage('Internal Server Error', 500)).toBe('Internal Server Error')
  })
  it('falls back to status when empty', () => {
    expect(extractErrorMessage('', 502)).toBe('Request failed (502)')
  })
})
