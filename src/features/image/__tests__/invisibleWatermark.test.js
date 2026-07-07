import { describe, it, expect } from 'vitest'
import { crc16, bytesToBits, bitsToBytes } from '../invisibleWatermark'

describe('crc16 (CCITT-FALSE)', () => {
  it('matches the standard check vector for "123456789"', () => {
    const bytes = new TextEncoder().encode('123456789')
    expect(crc16(bytes)).toBe(0x29b1)
  })
  it('changes when a byte flips', () => {
    const a = crc16(new Uint8Array([1, 2, 3]))
    const b = crc16(new Uint8Array([1, 2, 4]))
    expect(a).not.toBe(b)
  })
})

describe('bit packing', () => {
  it('round-trips bytes → bits → bytes (MSB-first)', () => {
    const bytes = new Uint8Array([0b10110001, 0x00, 0xff, 0x1d])
    const bits = bytesToBits(bytes)
    expect(bits.slice(0, 8)).toEqual(new Uint8Array([1, 0, 1, 1, 0, 0, 0, 1]))
    expect(bitsToBytes(bits)).toEqual(bytes)
  })
})

import {
  SYNC, FORMAT_VERSION, CONTENT_MAX, RECORD_BYTES, RECORD_BITS,
  contentByteLength, fitContent, packRecord, unpackRecord,
} from '../invisibleWatermark'

describe('content helpers', () => {
  it('measures UTF-8 byte length', () => {
    expect(contentByteLength('abc')).toBe(3)
    expect(contentByteLength('中文')).toBe(6) // 3 bytes each
  })
  it('fits content to a byte budget on a char boundary', () => {
    expect(fitContent('abcdefghijklmnopqrstuvwxyz', 16)).toBe('abcdefghijklmnop')
    // 5 CJK chars = 15 bytes fit; a 6th (→18) does not.
    expect(contentByteLength(fitContent('一二三四五六', 16))).toBeLessThanOrEqual(16)
    expect(fitContent('一二三四五六', 16)).toBe('一二三四五')
  })
})

describe('record pack/unpack', () => {
  it('round-trips ASCII content at a fixed record size', () => {
    const rec = packRecord({ version: FORMAT_VERSION, timestamp: 1_700_000_000, content: 'batch-01' })
    expect(rec.length).toBe(RECORD_BYTES)
    expect(RECORD_BITS).toBe(RECORD_BYTES * 8)
    const got = unpackRecord(rec)
    expect(got).toMatchObject({ ok: true, version: FORMAT_VERSION, timestamp: 1_700_000_000, content: 'batch-01' })
  })
  it('round-trips CJK content', () => {
    const rec = packRecord({ version: 1, timestamp: 1_700_000_000, content: '甲乙丙' })
    expect(unpackRecord(rec).content).toBe('甲乙丙')
  })
  it('carries flags', () => {
    const rec = packRecord({ version: 1, flags: 1, timestamp: 42, content: 'x' })
    expect(unpackRecord(rec).flags).toBe(1)
  })
  it('rejects an unmarked buffer (bad SYNC)', () => {
    expect(unpackRecord(new Uint8Array(RECORD_BYTES)).ok).toBe(false)
  })
  it('rejects a corrupted record (CRC fails)', () => {
    const rec = packRecord({ version: 1, timestamp: 42, content: 'x' })
    rec[10] ^= 0xff
    expect(unpackRecord(rec).ok).toBe(false)
  })
  it('throws when content exceeds CONTENT_MAX bytes', () => {
    expect(() => packRecord({ version: 1, timestamp: 0, content: 'x'.repeat(17) })).toThrow()
  })
})
