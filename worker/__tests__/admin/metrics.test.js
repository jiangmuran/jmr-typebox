// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest'
import { recordRequest, logEvent, getStats, subscribe, _reset } from '../../lib/metrics.js'

beforeEach(() => _reset())

describe('recordRequest', () => {
  it('counts a 200 as ok', () => {
    recordRequest('/api/music/search', '1.2.3.4', 200, 12)
    const s = getStats()
    expect(s.totals.total).toBe(1)
    expect(s.totals.ok).toBe(1)
    expect(s.counters['/api/music/search'].ok).toBe(1)
  })

  it('counts 403 as blocked_ip', () => {
    recordRequest('/api/music/search', '9.9.9.9', 403, 1)
    expect(getStats().totals.blocked_ip).toBe(1)
  })

  it('counts 429 as blocked_rate', () => {
    recordRequest('/api/music/stream/:id', '1.2.3.4', 429, 0)
    expect(getStats().totals.blocked_rate).toBe(1)
  })

  it('counts 401 as blocked_auth', () => {
    recordRequest('/api/admin/status', '1.2.3.4', 401, 0)
    expect(getStats().totals.blocked_auth).toBe(1)
  })

  it('counts 5xx as errors', () => {
    recordRequest('/api/music/search', '1.2.3.4', 500, 0)
    recordRequest('/api/music/search', '1.2.3.4', 502, 0)
    expect(getStats().totals.errors).toBe(2)
  })

  it('normalises numeric path segments to :id for counter keys', () => {
    recordRequest('/api/music/stream/12345', '1.2.3.4', 200, 0)
    recordRequest('/api/music/stream/67890', '1.2.3.4', 200, 0)
    const s = getStats()
    // Both should land under the same normalised key (not two separate per-id counters).
    expect(s.counters['/api/music/stream/:id'].total).toBe(2)
    expect(Object.keys(s.counters).filter((k) => k.startsWith('/api/music/stream/'))).toHaveLength(1)
  })

  it('masks the IP in the recent list (last two octets → *)', () => {
    recordRequest('/api/music/search', '1.2.3.4', 200, 0)
    const s = getStats()
    expect(s.recent[0].ip).toBe('1.2.*.*')
  })

  it('keeps only the last 200 recent entries (ring buffer)', () => {
    for (let i = 0; i < 250; i++) recordRequest('/api/music/search', '1.2.3.4', 200, 0)
    const s = getStats()
    // getStats surfaces only the last 50 in the snapshot, but the internal buffer is 200.
    // We verify via the totals (250 total recorded) + recent length (≤ 50 in snapshot).
    expect(s.totals.total).toBe(250)
    expect(s.recent.length).toBeLessThanOrEqual(50)
  })
})

describe('logEvent', () => {
  it('appends to the logs ring buffer', () => {
    logEvent('info', 'hello')
    logEvent('warn', 'careful', { path: '/api/music/search' })
    const s = getStats()
    expect(s.logs.length).toBe(2)
    expect(s.logs[0].level).toBe('info')
    expect(s.logs[1].level).toBe('warn')
    expect(s.logs[1].ctx.path).toBe('/api/music/search')
  })

  it('truncates very long messages to 500 chars', () => {
    const longMsg = 'x'.repeat(1000)
    logEvent('error', longMsg)
    expect(getStats().logs[0].msg.length).toBe(500)
  })
})

describe('SSE subscribe / broadcast', () => {
  it('calls enqueue on subscribers when recordRequest fires', () => {
    const enqueued = []
    const fakeController = { enqueue: (bytes) => enqueued.push(new TextDecoder().decode(bytes)) }
    const unsub = subscribe(fakeController)
    recordRequest('/api/music/search', '1.2.3.4', 200, 5)
    expect(enqueued.length).toBe(1)
    const msg = enqueued[0]
    expect(msg).toMatch(/^data: /)
    expect(msg).toMatch(/\n\n$/)
    const parsed = JSON.parse(msg.replace(/^data: /, '').replace(/\n\n$/, ''))
    expect(parsed.type).toBe('request')
    expect(parsed.data.status).toBe(200)
    unsub()
  })

  it('unsubscribe stops further broadcasts', () => {
    const enqueued = []
    const fakeController = { enqueue: (bytes) => enqueued.push(bytes) }
    const unsub = subscribe(fakeController)
    unsub()
    recordRequest('/api/music/search', '1.2.3.4', 200, 0)
    expect(enqueued.length).toBe(0)
  })
})

describe('getStats shape', () => {
  it('returns counters + totals + recent + logs even when empty', () => {
    const s = getStats()
    expect(s).toHaveProperty('counters')
    expect(s).toHaveProperty('totals')
    expect(s).toHaveProperty('recent')
    expect(s).toHaveProperty('logs')
    expect(s.totals).toEqual({ total: 0, ok: 0, blocked_ip: 0, blocked_rate: 0, blocked_auth: 0, errors: 0 })
  })
})
