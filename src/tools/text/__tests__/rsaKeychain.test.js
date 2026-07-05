import { describe, it, expect } from 'vitest'
import {
  makeKeyItem, serializeKeychain, parseKeychain,
  encryptKeychain, decryptKeychain, publicKeyFingerprint,
} from '../rsaKeychain'
import { generateRsaKeys } from '../rsa'

describe('rsaKeychain', () => {
  it('makeKeyItem fills defaults, trims label, clamps purpose', () => {
    const it1 = makeKeyItem({ label: '  Alice  ', purpose: 'sign', pub: 'P', priv: 'S', fp: 'FF' })
    expect(it1.label).toBe('Alice')
    expect(it1.purpose).toBe('sign')
    expect(it1.pub).toBe('P')
    expect(it1.priv).toBe('S')
    expect(it1.fp).toBe('FF')
    expect(typeof it1.id).toBe('string')
    expect(it1.id.length).toBeGreaterThan(0)
    expect(typeof it1.created).toBe('number')

    const it2 = makeKeyItem({ purpose: 'bogus' })
    expect(it2.label).toBe('Untitled') // empty label → placeholder
    expect(it2.purpose).toBe('encrypt') // unknown purpose → encrypt
    expect(it2.id).not.toBe(it1.id) // unique ids
  })

  it('serialize → parse round-trips a plain keychain', () => {
    const items = [makeKeyItem({ label: 'A', pub: 'pubA', priv: 'privA' })]
    const parsed = parseKeychain(serializeKeychain(items))
    expect(parsed.enc).toBe(false)
    expect(parsed.items).toEqual(items)
  })

  it('parse is tolerant of garbage / empty / legacy shapes', () => {
    expect(parseKeychain('').items).toEqual([])
    expect(parseKeychain(null).items).toEqual([])
    expect(parseKeychain('not json{').items).toEqual([])
    // legacy bare array
    expect(parseKeychain('[{"id":"x"}]').items).toEqual([{ id: 'x' }])
    // object without items[]
    expect(parseKeychain('{"v":1,"enc":false}').items).toEqual([])
  })

  it('parse flags an encrypted store and exposes the blob', () => {
    const parsed = parseKeychain(JSON.stringify({ v: 1, enc: true, blob: 'abc' }))
    expect(parsed.enc).toBe(true)
    expect(parsed.blob).toBe('abc')
    expect(parsed.items).toEqual([]) // stays empty until decrypted
  })

  it('encrypt → decrypt round-trips with the right passphrase', async () => {
    const items = [
      makeKeyItem({ label: 'A', purpose: 'encrypt', pub: 'pubA', priv: 'privA' }),
      makeKeyItem({ label: 'B', purpose: 'sign', pub: 'pubB', priv: 'privB' }),
    ]
    const wrapper = await encryptKeychain(items, 'correct horse battery staple')
    const parsed = parseKeychain(wrapper)
    expect(parsed.enc).toBe(true)
    expect(wrapper).not.toContain('pubA') // key material is not in plaintext
    const back = await decryptKeychain(parsed, 'correct horse battery staple')
    expect(back).toEqual(items)
  })

  it('decrypt with the wrong passphrase throws (AES-GCM auth failure)', async () => {
    const wrapper = await encryptKeychain([makeKeyItem({ label: 'A' })], 'right')
    const parsed = parseKeychain(wrapper)
    await expect(decryptKeychain(parsed, 'wrong')).rejects.toThrow()
  })

  it('publicKeyFingerprint is stable, formatted, and key-specific', async () => {
    const a = await generateRsaKeys('encrypt', 2048)
    const b = await generateRsaKeys('encrypt', 2048)
    const fpA = await publicKeyFingerprint(a.publicKey)
    const fpA2 = await publicKeyFingerprint(a.publicKey)
    const fpB = await publicKeyFingerprint(b.publicKey)
    expect(fpA).toMatch(/^[0-9A-F]{2}(:[0-9A-F]{2}){31}$/) // 32 colon-separated hex bytes
    expect(fpA).toBe(fpA2) // deterministic
    expect(fpA).not.toBe(fpB) // different key → different fingerprint
    expect(await publicKeyFingerprint('')).toBe('') // empty input → ''
    expect(await publicKeyFingerprint('%%%')).toBe('') // invalid base64 → '' (caught, never throws)
  })
})
