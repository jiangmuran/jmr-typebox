import { beforeEach, describe, it, expect, vi } from 'vitest'
import { useSettings } from '../useSettings'
import { useBackend, _resetBackend } from '../useBackend'

beforeEach(() => { localStorage.clear(); _resetBackend(); useSettings().resetSettings() })

describe('useBackend', () => {
  it('is unavailable when the master toggle is off, without probing', async () => {
    useSettings().setSetting('backendEnabled', false)
    const fetchSpy = vi.fn()
    globalThis.fetch = fetchSpy
    const b = useBackend()
    await b.probe()
    expect(b.available.value).toBe(false)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('becomes available after a healthy probe when enabled', async () => {
    useSettings().setSetting('backendEnabled', true)
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) })
    const b = useBackend()
    await b.probe()
    expect(b.available.value).toBe(true)
  })

  it('stays unavailable if the probe throws (offline)', async () => {
    useSettings().setSetting('backendEnabled', true)
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('offline'))
    const b = useBackend()
    await b.probe()
    expect(b.available.value).toBe(false)
  })
})
