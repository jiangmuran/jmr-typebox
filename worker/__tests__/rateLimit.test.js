// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest'
import { rateLimit, clientIp, tooManyRequests, _reset } from '../lib/rateLimit.js'

describe('rateLimit', () => {
  beforeEach(() => _reset())

  it('allows up to the limit then blocks within the window', () => {
    const now = 1_000_000
    for (let i = 0; i < 3; i++) expect(rateLimit('k', 3, 1000, now).ok).toBe(true)
    const blocked = rateLimit('k', 3, 1000, now)
    expect(blocked.ok).toBe(false)
    expect(blocked.retryAfter).toBeGreaterThan(0)
  })

  it('allows again after the window slides past', () => {
    expect(rateLimit('k', 1, 1000, 0).ok).toBe(true)
    expect(rateLimit('k', 1, 1000, 500).ok).toBe(false)
    expect(rateLimit('k', 1, 1000, 1001).ok).toBe(true) // first timestamp expired
  })

  it('counts keys independently', () => {
    expect(rateLimit('a', 1, 1000, 0).ok).toBe(true)
    expect(rateLimit('b', 1, 1000, 0).ok).toBe(true)
    expect(rateLimit('a', 1, 1000, 0).ok).toBe(false)
  })

  it('clientIp prefers CF-Connecting-IP', () => {
    expect(clientIp(new Request('https://x/', { headers: { 'CF-Connecting-IP': '1.2.3.4' } }))).toBe('1.2.3.4')
    expect(clientIp(new Request('https://x/', { headers: { 'X-Forwarded-For': '5.6.7.8, 9.9.9.9' } }))).toBe('5.6.7.8')
  })

  it('tooManyRequests is a 429 with Retry-After', () => {
    const r = tooManyRequests(5)
    expect(r.status).toBe(429)
    expect(r.headers.get('retry-after')).toBe('5')
  })
})
