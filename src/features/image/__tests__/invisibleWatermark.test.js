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
