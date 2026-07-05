import { describe, it, expect } from 'vitest'
import { generateRsaKeys, rsaEncrypt, rsaDecrypt, rsaSign, rsaVerify, toPem, fromPem } from '../rsa'

describe('rsa', () => {
  it('generates PEM key pairs', async () => {
    const { publicKey, privateKey } = await generateRsaKeys('encrypt', 2048)
    expect(publicKey).toMatch(/-----BEGIN PUBLIC KEY-----[\s\S]+-----END PUBLIC KEY-----/)
    expect(privateKey).toMatch(/-----BEGIN PRIVATE KEY-----[\s\S]+-----END PRIVATE KEY-----/)
  })

  it('encrypt → decrypt round-trips (OAEP), incl. CJK', async () => {
    const { publicKey, privateKey } = await generateRsaKeys('encrypt', 2048)
    const ct = await rsaEncrypt('hello 你好 🔒', publicKey)
    expect(ct).not.toContain('hello')
    expect(await rsaDecrypt(ct, privateKey)).toBe('hello 你好 🔒')
  })

  it('sign → verify (PSS): valid passes, tampered fails', async () => {
    const { publicKey, privateKey } = await generateRsaKeys('sign', 2048)
    const sig = await rsaSign('sign this message', privateKey)
    expect(await rsaVerify('sign this message', sig, publicKey)).toBe(true)
    expect(await rsaVerify('sign this messagX', sig, publicKey)).toBe(false)
  })

  it('PEM ↔ bytes round-trips', () => {
    const bytes = new Uint8Array([0, 1, 2, 65, 128, 250, 255]).buffer
    expect(new Uint8Array(fromPem(toPem(bytes, 'TEST KEY')))).toEqual(new Uint8Array(bytes))
  })
})
