import { describe, it, expect, vi, beforeEach } from 'vitest'
import { loadLibrary, libLoadState, _resetLibraries } from '../loadLibrary'
import { assetCache } from '../assetCache'

beforeEach(() => _resetLibraries())

describe('loadLibrary', () => {
  it('imports once and caches, deduping concurrent calls', async () => {
    const importer = vi.fn().mockResolvedValue({ hello: () => 'hi' })
    const [a, b] = await Promise.all([
      loadLibrary('demo', importer, { sizeMB: 1 }),
      loadLibrary('demo', importer, { sizeMB: 1 }),
    ])
    expect(importer).toHaveBeenCalledTimes(1)
    expect(a).toBe(b)
    expect(libLoadState.demo).toBe('ready')
  })

  it('marks error state on failure (and clears cache for retry)', async () => {
    await expect(loadLibrary('bad', () => Promise.reject(new Error('x')))).rejects.toThrow()
    expect(libLoadState.bad).toBe('error')
    const ok = vi.fn().mockResolvedValue({})
    await loadLibrary('bad', ok)
    expect(ok).toHaveBeenCalledTimes(1)
  })
})

describe('assetCache', () => {
  it('get returns null when Cache API is absent', async () => {
    expect(await assetCache.get('x')).toBe(null)
  })
})
