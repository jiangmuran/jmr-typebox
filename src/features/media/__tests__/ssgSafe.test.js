import { describe, it, expect, vi } from 'vitest'

// SSG-safety: importing the engine + runner modules must NOT touch window/Blob/Worker/ffmpeg at
// module-eval time (that would crash during vite-ssg prerender). We assert they import cleanly and
// expose their public functions without spawning anything. The heavy @ffmpeg packages are only
// reached via dynamic import() inside the functions, so a plain top-level import here is harmless.
describe('media engine modules are SSG/node-safe at import', () => {
  it('ffmpegRunner imports without side effects and exposes its API', async () => {
    // If the module touched Worker/Blob/fetch at top level, this import would throw in node.
    const mod = await import('../ffmpegRunner')
    expect(typeof mod.loadFFmpeg).toBe('function')
    expect(typeof mod.runFFmpeg).toBe('function')
    expect(typeof mod.onEngineEvent).toBe('function')
    expect(typeof mod.isEngineLoaded).toBe('function')
    expect(mod.isEngineLoaded()).toBe(false) // nothing loaded just from importing
    expect(mod.CORE_VERSION).toMatch(/^\d+\.\d+\.\d+$/)
    expect(mod.CORE_CDN_BASE).toContain(mod.CORE_VERSION)
  })

  it('audioRunner imports without side effects and exposes the operations', async () => {
    const mod = await import('../audioRunner')
    expect(typeof mod.convertAudio).toBe('function')
    expect(typeof mod.burnSubtitles).toBe('function')
    expect(typeof mod.muxSubtitles).toBe('function')
  })

  it('onEngineEvent subscribe/unsubscribe is a no-op without a loaded engine', async () => {
    const { onEngineEvent } = await import('../ffmpegRunner')
    const fn = vi.fn()
    const off = onEngineEvent(fn)
    expect(typeof off).toBe('function')
    off() // must not throw
    expect(fn).not.toHaveBeenCalled()
  })
})
