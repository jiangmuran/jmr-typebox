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
