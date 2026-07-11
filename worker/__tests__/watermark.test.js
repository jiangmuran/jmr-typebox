// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { makeId, validateRegisterBody, CONTENT_MAX_BYTES, MAX_RECORDS } from '../api/watermark.js'

const CROCKFORD = /^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{10}$/

describe('makeId', () => {
  it('returns 10 Crockford base32 chars', () => {
    for (let i = 0; i < 50; i++) expect(makeId()).toMatch(CROCKFORD)
  })
  it('is not constant', () => {
    expect(makeId()).not.toBe(makeId())
  })
})

describe('validateRegisterBody', () => {
  it('accepts a valid batch and coerces missing ts/version', () => {
    const v = validateRegisterBody({ records: [{ content: 'hi' }, { content: '你好', timestamp: 5, version: 2 }] })
    expect(v.ok).toBe(true)
    expect(v.records).toEqual([{ content: 'hi', timestamp: 0, version: 1 }, { content: '你好', timestamp: 5, version: 2 }])
  })
  it('rejects a non-array', () => {
    expect(validateRegisterBody({ records: 'x' }).ok).toBe(false)
    expect(validateRegisterBody(null).ok).toBe(false)
  })
  it('rejects empty and oversized batches', () => {
    expect(validateRegisterBody({ records: [] }).ok).toBe(false)
    const many = Array.from({ length: MAX_RECORDS + 1 }, () => ({ content: 'x' }))
    expect(validateRegisterBody({ records: many }).ok).toBe(false)
  })
  it('rejects non-string content and content over the byte cap', () => {
    expect(validateRegisterBody({ records: [{ content: 42 }] }).ok).toBe(false)
    const big = 'a'.repeat(CONTENT_MAX_BYTES + 1)
    expect(validateRegisterBody({ records: [{ content: big }] }).ok).toBe(false)
  })
})

import { watermark } from '../api/watermark.js'

function kvMock() {
  const m = new Map()
  return { _m: m, get: async k => (m.has(k) ? m.get(k) : null), put: async (k, v) => { m.set(k, v) } }
}
function req(path, { method = 'GET', body } = {}) {
  return new Request('https://x' + path, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

describe('watermark handler', () => {
  it('answers OPTIONS preflight', async () => {
    const res = await watermark(req('/api/watermark', { method: 'OPTIONS' }), { WATERMARKS: kvMock() })
    expect(res.status).toBe(204)
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
  })
  it('registers records and stores them under returned ids', async () => {
    const env = { WATERMARKS: kvMock() }
    const res = await watermark(req('/api/watermark', { method: 'POST', body: { records: [{ content: 'a', timestamp: 7, version: 1 }, { content: 'b' }] } }), env)
    expect(res.status).toBe(200)
    const { ids } = await res.json()
    expect(ids).toHaveLength(2)
    const stored = JSON.parse(env.WATERMARKS._m.get(ids[0]))
    expect(stored).toMatchObject({ v: 1, content: 'a', timestamp: 7, version: 1 })
    expect(typeof stored.createdAt).toBe('number')
  })
  it('400s an oversized batch and non-JSON', async () => {
    const env = { WATERMARKS: kvMock() }
    const many = Array.from({ length: 51 }, () => ({ content: 'x' }))
    expect((await watermark(req('/api/watermark', { method: 'POST', body: { records: many } }), env)).status).toBe(400)
    const bad = new Request('https://x/api/watermark', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' })
    expect((await watermark(bad, env)).status).toBe(400)
  })
  it('503s register when the binding is absent', async () => {
    expect((await watermark(req('/api/watermark', { method: 'POST', body: { records: [{ content: 'a' }] } }), {})).status).toBe(503)
  })
  it('resolves an existing id and 404s a missing one', async () => {
    const env = { WATERMARKS: kvMock() }
    const { ids } = await (await watermark(req('/api/watermark', { method: 'POST', body: { records: [{ content: 'hello' }] } }), env)).json()
    const hit = await watermark(req('/api/watermark/' + ids[0]), env)
    expect(hit.status).toBe(200)
    expect((await hit.json()).content).toBe('hello')
    expect((await watermark(req('/api/watermark/NOPE0NOPE0'), env)).status).toBe(404)
  })
  it('404s resolve when the binding is absent', async () => {
    expect((await watermark(req('/api/watermark/anything00'), {})).status).toBe(404)
  })
})

import worker from '../index.js'

describe('watermark via worker.fetch', () => {
  const env = { WATERMARKS: kvMock(), ASSETS: { fetch: async () => new Response('static') } }
  it('registers then resolves end-to-end through the router', async () => {
    const reg = await worker.fetch(req('/api/watermark', { method: 'POST', body: { records: [{ content: 'roundtrip', timestamp: 9, version: 1 }] } }), env)
    expect(reg.status).toBe(200)
    const { ids } = await reg.json()
    const got = await worker.fetch(req('/api/watermark/' + ids[0]), env)
    expect(got.status).toBe(200)
    expect((await got.json())).toMatchObject({ content: 'roundtrip', timestamp: 9 })
  })
})
