// @vitest-environment node
import { describe, it, expect, vi, afterEach } from 'vitest'
import { parseAllowlist, isAllowed, forbidden } from '../../lib/ipGuard.js'

describe('parseAllowlist', () => {
  it('parses comma-separated', () => {
    const set = parseAllowlist('1.2.3.4, 5.6.7.8 ,9.10.11.12')
    expect(set).toBeInstanceOf(Set)
    expect(set.size).toBe(3)
    expect(set.has('1.2.3.4')).toBe(true)
    expect(set.has('5.6.7.8')).toBe(true)
    expect(set.has('9.10.11.12')).toBe(true)
  })
  it('parses newline-separated', () => {
    const set = parseAllowlist('1.2.3.4\n5.6.7.8\n\n9.10.11.12')
    expect(set.size).toBe(3)
  })
  it('returns null when unset/empty', () => {
    expect(parseAllowlist(undefined)).toBeNull()
    expect(parseAllowlist('')).toBeNull()
    expect(parseAllowlist('   ')).toBeNull()
    expect(parseAllowlist(null)).toBeNull()
  })
  it('returns null when only blanks', () => {
    expect(parseAllowlist(' , , ')).toBeNull()
  })
})

describe('isAllowed', () => {
  const req = (ip) => new Request('https://x/api/music/search', {
    headers: ip ? { 'CF-Connecting-IP': ip } : {},
  })

  it('opens music routes when allowlist is unset', () => {
    expect(isAllowed(req('1.2.3.4'), null, 'music')).toBe(true)
  })
  it('opens admin routes when allowlist is unset (admin relies on the WebAuthn session gate, not IP)', () => {
    // Phase 4 change: operator can deploy WITHOUT ALLOWED_IPS — admin access is then gated solely
    // by the session cookie checked in worker/index.js. IP filtering is an optional hardening layer.
    expect(isAllowed(req('1.2.3.4'), null, 'admin')).toBe(true)
  })
  it('allows IPs on the list', () => {
    const set = parseAllowlist('1.2.3.4,5.6.7.8')
    expect(isAllowed(req('1.2.3.4'), set, 'music')).toBe(true)
    expect(isAllowed(req('5.6.7.8'), set, 'admin')).toBe(true)
  })
  it('denies IPs not on the list', () => {
    const set = parseAllowlist('1.2.3.4')
    expect(isAllowed(req('9.9.9.9'), set, 'music')).toBe(false)
    expect(isAllowed(req('9.9.9.9'), set, 'admin')).toBe(false)
  })
  it('denies when no IP can be determined', () => {
    const set = parseAllowlist('1.2.3.4')
    expect(isAllowed(req(null), set, 'music')).toBe(false)
  })
})

describe('forbidden', () => {
  it('returns a 403 with a masked IP', async () => {
    const res = forbidden('1.2.3.4')
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toBe('forbidden')
    expect(body.message).toContain('*.*')
    expect(body.message).not.toContain('1.2.3.4')
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
  })
})
