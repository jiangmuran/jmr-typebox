import { describe, it, expect } from 'vitest'
import { generateRsaKeys, deriveRsaPublicKey, rsaEncrypt, rsaDecrypt, rsaSign, rsaVerify, toPem, fromPem } from '../rsa'

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

  it('derives the public key from the private key (encrypt pair) and round-trips', async () => {
    const { publicKey, privateKey } = await generateRsaKeys('encrypt', 2048)
    const derived = await deriveRsaPublicKey(privateKey)
    expect(derived).toBe(publicKey) // recomputed SPKI PEM is byte-identical to the original
    // encrypt with the derived public key → decrypt with the private key
    const ct = await rsaEncrypt('recover 你好 🔑', derived)
    expect(await rsaDecrypt(ct, privateKey)).toBe('recover 你好 🔑')
  })

  it('derives the same SPKI public key from a SIGN private key', async () => {
    const { publicKey, privateKey } = await generateRsaKeys('sign', 2048)
    // SPKI is algorithm-agnostic for RSA, so deriving via OAEP still matches a PSS pair's public PEM
    expect(await deriveRsaPublicKey(privateKey)).toBe(publicKey)
  })

  it('PEM ↔ bytes round-trips', () => {
    const bytes = new Uint8Array([0, 1, 2, 65, 128, 250, 255]).buffer
    expect(new Uint8Array(fromPem(toPem(bytes, 'TEST KEY')))).toEqual(new Uint8Array(bytes))
  })
})
