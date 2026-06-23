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
    expect(typeof mod.editAudio).toBe('function')
    expect(typeof mod.runCustomCommand).toBe('function')
  })

  it('waveform module imports without creating an AudioContext at top level', async () => {
    // If the module instantiated AudioContext / touched window at import, this would throw in node.
    const mod = await import('../waveform')
    expect(typeof mod.decodeAudio).toBe('function')
    expect(typeof mod.computePeaks).toBe('function')
    expect(typeof mod.decodeToPeaks).toBe('function')
    expect(typeof mod.drawWaveform).toBe('function')
  })

  it('computePeaks reduces an AudioBuffer-like to N {min,max} buckets (pure, no DOM)', async () => {
    const { computePeaks } = await import('../waveform')
    // Minimal fake AudioBuffer: 1 channel, a ramp from -1..1.
    const len = 1000
    const data = new Float32Array(len)
    for (let i = 0; i < len; i++) data[i] = (i / (len - 1)) * 2 - 1
    const fakeBuffer = { numberOfChannels: 1, length: len, getChannelData: () => data }
    const peaks = computePeaks(fakeBuffer, 50)
    expect(peaks.length).toBe(50)
    for (const p of peaks) {
      expect(p.min).toBeLessThanOrEqual(p.max)
      expect(p.min).toBeGreaterThanOrEqual(-1.0001)
      expect(p.max).toBeLessThanOrEqual(1.0001)
    }
    // first bucket near -1, last near +1
    expect(peaks[0].min).toBeLessThan(-0.9)
    expect(peaks[peaks.length - 1].max).toBeGreaterThan(0.9)
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

// Regression guards for the two production bugs. These exercise the EXACT pathological inputs that
// produced "failed to import ffmpeg-core.js" (the CDN/core wiring — see header) and the
// "-604120800%" / ">100%" progress bars (the math below), without needing a browser.
describe('media engine — CDN core wiring (import-failure regression)', () => {
  it('loads the ESM core (not umd) so the module-worker import() path can succeed', async () => {
    const m = await import('../ffmpegRunner')
    // The fix is to point at /dist/esm (a real ES module), NOT /dist/umd (a classic script that
    // import() cannot load inside the wrapper's `{type:"module"}` worker).
    expect(m.CORE_CDN_BASE).toContain('/dist/esm')
    expect(m.CORE_CDN_BASE).not.toContain('/umd')
    expect(m.CORE_CDN_FALLBACK).toContain('/dist/esm')
    // Version is pinned and present in the URL for reproducibility.
    expect(m.CORE_CDN_BASE).toContain(m.CORE_VERSION)
  })
})

describe('media engine — progress math (the -604120800% / >100% regression)', () => {
  it('sanitizeProgress clamps to [0,1] and drops garbage', async () => {
    const { sanitizeProgress } = await import('../ffmpegRunner')
    expect(sanitizeProgress(0.5)).toBe(0.5)
    expect(sanitizeProgress(0)).toBe(0)
    expect(sanitizeProgress(1)).toBe(1)
    expect(sanitizeProgress(1.4)).toBe(1)         // overshoot
    expect(sanitizeProgress(-6041208)).toBe(0)    // the infamous huge-negative ratio → 0, not -604120800%
    expect(sanitizeProgress(42)).toBe(1)
    expect(sanitizeProgress(NaN)).toBeNull()
    expect(sanitizeProgress(Infinity)).toBeNull()
    expect(sanitizeProgress('x')).toBeNull()
    expect(sanitizeProgress(undefined)).toBeNull()
  })

  it('download accumulator never yields a ratio > 1, even when received > total', async () => {
    const { makeDownloadProgress } = await import('../ffmpegRunner')
    const dp = makeDownloadProgress()
    // Two assets (js + wasm). Simulate a server under-reporting Content-Length so received > total.
    dp.update({ url: 'core.js', received: 0, total: 1000 })
    const a = dp.update({ url: 'core.wasm', received: 0, total: 30_000_000 })
    expect(a.ratio).toBe(0)
    // Mid-download.
    const b = dp.update({ url: 'core.wasm', received: 15_000_000, total: 30_000_000 })
    expect(b.ratio).toBeGreaterThan(0)
    expect(b.ratio).toBeLessThan(1)
    // Overshoot on BOTH assets — must still clamp at exactly 1, never 2.66/6.95.
    dp.update({ url: 'core.js', received: 5000, total: 1000 })
    const c = dp.update({ url: 'core.wasm', received: 99_000_000, total: 30_000_000 })
    expect(c.ratio).toBeLessThanOrEqual(1)
    expect(c.ratio).toBe(1)
  })

  it('download accumulator handles missing Content-Length (total unknown) without NaN', async () => {
    const { makeDownloadProgress } = await import('../ffmpegRunner')
    const dp = makeDownloadProgress()
    const r = dp.update({ url: 'core.wasm', received: 1234, total: 0 })
    expect(Number.isFinite(r.ratio)).toBe(true)
    expect(r.ratio).toBe(0) // no known total → 0, not NaN/Infinity
  })

  it('reset() lets the bar restart cleanly on a CDN fallback', async () => {
    const { makeDownloadProgress } = await import('../ffmpegRunner')
    const dp = makeDownloadProgress()
    dp.update({ url: 'core.wasm', received: 30_000_000, total: 30_000_000 })
    dp.reset()
    const r = dp.update({ url: 'core.wasm', received: 0, total: 30_000_000 })
    expect(r.ratio).toBe(0)
  })
})
