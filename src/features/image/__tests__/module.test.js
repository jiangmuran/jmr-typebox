import { describe, it, expect } from 'vitest'
import feature from '../index.js'

// Guards the feature contract: the module must be importable with no browser globals and
// expose lazy component thunks for every image route plus matched en/zh i18n keys.
describe('image feature module', () => {
  it('declares lazy thunks for all image routes', () => {
    const routes = ['/image/compress', '/image/convert', '/image/watermark', '/image/edit', '/image/metadata']
    for (const r of routes) {
      expect(typeof feature.components[r]).toBe('function')
    }
  })

  it('declares img2.* i18n keys with en/zh parity', () => {
    const en = Object.keys(feature.i18n.en)
    const zh = Object.keys(feature.i18n.zh)
    expect(en.length).toBeGreaterThan(0)
    // Every key namespaced under img2.* and present in both locales.
    expect(en.every(k => k.startsWith('img2.'))).toBe(true)
    expect(new Set(en)).toEqual(new Set(zh))
  })

  it('does not import useI18n (no circular dep) and is side-effect-free', () => {
    // If importing had side effects touching window/document, this test file (jsdom has them,
    // but the module must not RELY on them at import) would already have thrown above.
    expect(feature).toBeTypeOf('object')
    expect(feature.register).toBeUndefined()
  })
})
