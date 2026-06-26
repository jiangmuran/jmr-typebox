import { describe, it, expect, beforeEach } from 'vitest'
import { load, save } from '../storage'

describe('storage', () => {
  beforeEach(() => localStorage.clear())

  it('round-trips a value with the tb- prefix', () => {
    save('phase0', 'ok')
    expect(load('phase0')).toBe('ok')
  })

  it('returns fallback for missing keys', () => {
    expect(load('nope', 'fallback')).toBe('fallback')
  })
})
