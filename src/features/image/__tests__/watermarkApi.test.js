import { describe, it, expect, vi, afterEach } from 'vitest'
import { registerRecords, resolveWatermark } from '../watermarkApi'

afterEach(() => { vi.restoreAllMocks() })

describe('registerRecords', () => {
  it('POSTs the records and returns ids', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ids: ['ABC0000001'] }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const ids = await registerRecords([{ content: 'x', timestamp: 1, version: 1 }])
    expect(ids).toEqual(['ABC0000001'])
    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/watermark')
    expect(opts.method).toBe('POST')
    expect(JSON.parse(opts.body)).toEqual({ records: [{ content: 'x', timestamp: 1, version: 1 }] })
  })
  it('throws when the server errors or the id count mismatches', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 503 })))
    await expect(registerRecords([{ content: 'x' }])).rejects.toThrow()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ids: [] }), { status: 200 })))
    await expect(registerRecords([{ content: 'x' }])).rejects.toThrow()
  })
})

describe('resolveWatermark', () => {
  it('returns the record on 200', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ content: 'hi', version: 1 }), { status: 200 })))
    expect(await resolveWatermark('ABC0000001')).toEqual({ content: 'hi', version: 1 })
  })
  it('returns null on 404 and throws on 500', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })))
    expect(await resolveWatermark('missing0000')).toBeNull()
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 500 })))
    await expect(resolveWatermark('x')).rejects.toThrow()
  })
})
