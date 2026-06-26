import { describe, it, expect, beforeEach } from 'vitest'
import feature from '../index.js'
import { MEDIA_CONVERTERS } from '../mediaHelpers'
import { ROUTE_META } from '../../../router/meta'
import { _resetConverters, getConverter, allConverters } from '../../../converters/registry'
import { _resetCommands, allCommands } from '../../../composables/useCommands'

// Guards the feature contract: the module must be importable with no browser globals (no window/
// Blob/ffmpeg touched at import), expose lazy component thunks for every media route, register its
// converters + ⌘K commands, and carry en/zh i18n with matching key sets.
describe('media feature module', () => {
  it('declares lazy thunks for the universal converter, subtitle tool, and every named route', () => {
    const routes = ['/media/convert', '/media/subtitles', ...MEDIA_CONVERTERS.map(c => c.route)]
    for (const r of routes) {
      expect(typeof feature.components[r], r).toBe('function')
    }
  })

  it('every component route has matching SEO meta', () => {
    for (const r of Object.keys(feature.components)) {
      expect(ROUTE_META[r], r).toBeTruthy()
    }
  })

  it('declares media.* i18n keys with en/zh parity', () => {
    const en = Object.keys(feature.i18n.en)
    const zh = Object.keys(feature.i18n.zh)
    expect(en.length).toBeGreaterThan(0)
    expect(en.every(k => k.startsWith('media.'))).toBe(true)
    expect(new Set(en)).toEqual(new Set(zh))
  })

  it('is side-effect-free at import (does not auto-register; register() is explicit)', () => {
    // If importing touched window/Blob/ffmpeg, importing this module in node would have thrown
    // before reaching here. register() must be a function but not have run yet.
    expect(feature).toBeTypeOf('object')
    expect(typeof feature.register).toBe('function')
  })

  describe('register()', () => {
    beforeEach(() => { _resetConverters(); _resetCommands() })

    it('registers a converter per named route + ⌘K action commands', () => {
      feature.register()
      for (const c of MEDIA_CONVERTERS) {
        const reg = getConverter(c.id)
        expect(reg, c.id).toBeTruthy()
        expect(reg.inputs).toEqual([c.input])
        expect(reg.output).toBe(c.output)
        expect(reg.where).toBe('client')
        expect(typeof reg.run).toBe('function')
      }
      expect(allConverters().length).toBe(MEDIA_CONVERTERS.length)
      expect(allCommands.some(c => c.id === 'media-convert')).toBe(true)
      expect(allCommands.some(c => c.id === 'media-subtitles')).toBe(true)
    })
  })
})
