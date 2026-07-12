// @vitest-environment node
import { describe, it, expect } from 'vitest'
import {
  weapi, linuxapi, eapi,
  aesEncrypt, rsaEncrypt, md5,
  presetKey, linuxapiKey, eapiKey,
} from '../../lib/ncm/crypto.js'

describe('weapi', () => {
  it('returns { params, encSecKey } with the right shape', () => {
    const out = weapi({ hello: 'world' })
    expect(out).toHaveProperty('params')
    expect(out).toHaveProperty('encSecKey')
    // params is base64 of doubly-CBC-encrypted JSON (always > a few bytes).
    expect(typeof out.params).toBe('string')
    expect(out.params.length).toBeGreaterThan(20)
    // encSecKey is RSA(256 bytes for a 2048-bit modulus) → hex of length 512.
    expect(out.encSecKey).toMatch(/^[0-9a-f]{256}$/)
  })

  it('produces a DIFFERENT ciphertext on each call (random secretKey)', () => {
    const a = weapi({ x: 1 })
    const b = weapi({ x: 1 })
    expect(a.params).not.toBe(b.params)
    expect(a.encSecKey).not.toBe(b.encSecKey)
  })

  it('accepts nested objects', () => {
    const out = weapi({ ids: '[1,2,3]', offset: 0, meta: { a: true } })
    expect(out.encSecKey).toMatch(/^[0-9a-f]{256}$/)
  })
})

describe('linuxapi', () => {
  it('returns { eparams } as uppercase hex', () => {
    const out = linuxapi({ method: 'POST', url: '/api/test', params: { a: 1 } })
    expect(out).toHaveProperty('eparams')
    expect(out.eparams).toMatch(/^[0-9A-F]+$/)
  })
})

describe('eapi', () => {
  it('returns { params } as uppercase hex', () => {
    const out = eapi('/api/test', { foo: 'bar' })
    expect(out).toHaveProperty('params')
    expect(out.params).toMatch(/^[0-9A-F]+$/)
    // Eapi body is `<url>-36cd479b6b5-<json>-36cd479b6b5-<md5>` → AES-ECB; long enough.
    expect(out.params.length).toBeGreaterThan(64)
  })

  it('accepts a pre-stringified body', () => {
    const out = eapi('/api/test', JSON.stringify({ a: 1 }))
    expect(out.params).toMatch(/^[0-9A-F]+$/)
  })
})

describe('aesEncrypt', () => {
  it('CBC mode → base64 output', () => {
    const out = aesEncrypt('hello', 'cbc', presetKey, '0102030405060708')
    expect(out).toMatch(/^[A-Za-z0-9+/=]+$/)
  })
  it('ECB mode with hex format → uppercase hex', () => {
    const out = aesEncrypt('hello', 'ecb', eapiKey, '', 'hex')
    expect(out).toMatch(/^[0-9A-F]+$/)
  })
  it('case-insensitive mode argument (cbc / CBC equivalent)', () => {
    const a = aesEncrypt('payload', 'cbc', linuxapiKey, '0102030405060708')
    const b = aesEncrypt('payload', 'CBC', linuxapiKey, '0102030405060708')
    expect(a).toBe(b)
  })
})

describe('rsaEncrypt', () => {
  it('produces 256-byte hex (2048-bit modulus)', () => {
    const out = rsaEncrypt('0123456789abcdef') // 16 chars, NCM's reversed secretKey length
    expect(out).toMatch(/^[0-9a-f]{256}$/)
  })
})

describe('md5', () => {
  it('matches the well-known MD5 of empty string', () => {
    expect(md5('')).toBe('d41d8cd98f00b204e9800998ecf8427e')
  })
  it('matches the well-known MD5 of "abc"', () => {
    expect(md5('abc')).toBe('900150983cd24fb0d6963f7d28e17f72')
  })
})

// Sanity: the well-known NCM keys are unchanged from upstream. If these ever drift, every
// upstream NCM call fails with cryptic errors — fail loudly here instead.
describe('NCM key constants', () => {
  it('exposes the expected weapi/linuxapi/eapi keys', () => {
    expect(presetKey).toBe('0CoJUm6Qyw8W8jud')
    expect(linuxapiKey).toBe('rFgB&h#%2?^eDg:Q')
    expect(eapiKey).toBe('e82ckenh8dichen8')
  })
})
