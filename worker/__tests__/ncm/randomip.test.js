// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { generateRandomChineseIP, isChineseCuratedIP } from '../../lib/ncm/randomip.js'

describe('generateRandomChineseIP', () => {
  it('returns a valid IPv4 dotted-quad', () => {
    for (let i = 0; i < 50; i++) {
      const ip = generateRandomChineseIP()
      expect(ip).toMatch(/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/)
      const parts = ip.split('.').map(Number)
      for (const p of parts) expect(p).toBeGreaterThanOrEqual(0), expect(p).toBeLessThanOrEqual(255)
    }
  })

  it('is random (distribution sanity check)', () => {
    const seen = new Set()
    for (let i = 0; i < 100; i++) seen.add(generateRandomChineseIP())
    // 100 draws from ~10^9 IPs — virtually impossible to collide twice.
    expect(seen.size).toBeGreaterThan(90)
  })

  it('always lands inside one of the curated mainland-China ranges', () => {
    // Authoritative check against the same CIDR table the generator uses — no parallel list
    // to fall out of sync with.
    for (let i = 0; i < 200; i++) {
      const ip = generateRandomChineseIP()
      expect(isChineseCuratedIP(ip), `${ip} not in curated CN ranges`).toBe(true)
    }
  })
})

describe('isChineseCuratedIP', () => {
  it('returns true for a known CN address (8.8.8.8 is US → false)', () => {
    expect(isChineseCuratedIP('8.8.8.8')).toBe(false)
    expect(isChineseCuratedIP('1.0.0.1')).toBe(false)
  })
  it('returns true for a CN telecom address', () => {
    expect(isChineseCuratedIP('61.128.0.1')).toBe(true) // 61.128.0.0/10 China Telecom
    expect(isChineseCuratedIP('123.4.0.1')).toBe(true) // 123.4.0.0/14
  })
  it('returns false for loopback / private', () => {
    expect(isChineseCuratedIP('127.0.0.1')).toBe(false)
    expect(isChineseCuratedIP('192.168.1.1')).toBe(false)
  })
  it('returns false on malformed input', () => {
    expect(isChineseCuratedIP('not.an.ip')).toBe(false)
    expect(isChineseCuratedIP('')).toBe(false)
  })
})
