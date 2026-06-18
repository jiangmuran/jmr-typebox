import { describe, it, expect } from 'vitest'
import { sha256, hmac } from '../hash'
import { aesEncrypt, aesDecrypt } from '../crypto'

describe('hash', () => {
  it('sha256 matches the known digest of "abc"', async () => {
    expect(await sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })
  it('hmac is deterministic for the same key+message', async () => {
    const a = await hmac('msg', 'key')
    const b = await hmac('msg', 'key')
    expect(a).toBe(b)
    expect(a).toHaveLength(64)
  })
})

describe('aes-gcm', () => {
  it('round-trips with the right passphrase', async () => {
    const ct = await aesEncrypt('secret 文本', 'hunter2')
    expect(await aesDecrypt(ct, 'hunter2')).toBe('secret 文本')
  })
  it('fails with the wrong passphrase', async () => {
    const ct = await aesEncrypt('secret', 'right')
    await expect(aesDecrypt(ct, 'wrong')).rejects.toBeTruthy()
  })
})
