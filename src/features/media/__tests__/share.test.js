import { describe, it, expect, vi, afterEach } from 'vitest'
import { ncmShareUrl, shareOrCopy } from '../mediaDom'

describe('ncmShareUrl', () => {
  it('builds a song deep link on the player route', () => {
    const url = ncmShareUrl('song', 12345)
    expect(url).toContain('/media/player?song=12345')
  })

  it('builds a playlist deep link and encodes the id', () => {
    const url = ncmShareUrl('playlist', 'a b')
    expect(url).toContain('/media/player?playlist=a%20b')
  })
})

describe('shareOrCopy', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('prefers the native share sheet when available', async () => {
    const share = vi.fn().mockResolvedValue()
    vi.stubGlobal('navigator', { share })
    expect(await shareOrCopy('https://x/1', 'title')).toBe('shared')
    expect(share).toHaveBeenCalledWith({ title: 'title', url: 'https://x/1' })
  })

  it('reports cancellation without falling back to the clipboard', async () => {
    const err = Object.assign(new Error('abort'), { name: 'AbortError' })
    const writeText = vi.fn()
    vi.stubGlobal('navigator', { share: vi.fn().mockRejectedValue(err), clipboard: { writeText } })
    expect(await shareOrCopy('https://x/1')).toBe('cancelled')
    expect(writeText).not.toHaveBeenCalled()
  })

  it('falls back to the clipboard when share is unavailable', async () => {
    const writeText = vi.fn().mockResolvedValue()
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    expect(await shareOrCopy('https://x/2')).toBe('copied')
    expect(writeText).toHaveBeenCalledWith('https://x/2')
  })

  it('returns false when both paths fail', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } })
    expect(await shareOrCopy('https://x/3')).toBe(false)
  })
})
