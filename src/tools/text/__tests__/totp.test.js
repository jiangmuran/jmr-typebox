import { describe, it, expect } from 'vitest'
import { base32Decode, totp, totpRemaining, parseOtpauth } from '../totp'

// RFC 6238 test seed: ASCII "12345678901234567890" → base32.
const SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'

describe('totp', () => {
  it('base32 decodes to the raw bytes', () => {
    expect([...base32Decode('GEZDGNBVGY3TQOJQ')]).toEqual([...new TextEncoder().encode('1234567890')])
  })

  it('tolerates lowercase, spaces and padding', () => {
    expect([...base32Decode('gez dgn bvg y3t qojq=')]).toEqual([...base32Decode('GEZDGNBVGY3TQOJQ')])
  })

  it('matches RFC 6238 vectors (SHA1, 6 digits)', async () => {
    expect(await totp(SECRET, { time: 59_000, step: 30, digits: 6, algorithm: 'SHA1' })).toBe('287082')
    expect(await totp(SECRET, { time: 1_111_111_109_000, step: 30, digits: 6, algorithm: 'SHA1' })).toBe('081804')
    expect(await totp(SECRET, { time: 1_234_567_890_000, step: 30, digits: 6, algorithm: 'SHA1' })).toBe('005924')
  })

  it('throws on an empty/invalid secret', async () => {
    await expect(totp('', {})).rejects.toThrow()
    expect(() => base32Decode('0189!')).toThrow()
  })

  it('computes seconds remaining in the window', () => {
    expect(totpRemaining(30, 0)).toBe(30)
    expect(totpRemaining(30, 5_000)).toBe(25)
    expect(totpRemaining(60, 70_000)).toBe(50)
  })

  it('parses an otpauth:// URI', () => {
    const p = parseOtpauth('otpauth://totp/Acme:alice@acme.com?secret=JBSWY3DPEHPK3PXP&period=60&digits=8&algorithm=SHA256')
    expect(p.secret).toBe('JBSWY3DPEHPK3PXP')
    expect(p.step).toBe(60)
    expect(p.digits).toBe(8)
    expect(p.algorithm).toBe('SHA256')
    expect(parseOtpauth('https://example.com')).toBe(null)
  })
})
