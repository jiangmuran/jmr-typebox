import { describe, it, expect, beforeEach } from 'vitest'
import {
  THEMES, DEFAULT_THEME_ID, listThemes, getTheme, isDarkTheme,
  resolveThemeId, getThemeCss, getCachedThemeCss, _resetThemeCache,
} from '../themes/registry.js'

beforeEach(() => _resetThemeCache())

describe('theme registry', () => {
  it('lists themes with required metadata', () => {
    const themes = listThemes()
    expect(themes.length).toBeGreaterThanOrEqual(4)
    for (const t of themes) {
      expect(typeof t.id).toBe('string')
      expect(typeof t.name).toBe('string')
      expect(typeof t.load).toBe('function')
      expect(t.swatch).toHaveProperty('bg')
      expect(t.swatch).toHaveProperty('fg')
      expect(t.swatch).toHaveProperty('accent')
    }
  })

  it('has a default theme that exists in the list', () => {
    expect(THEMES.some(t => t.id === DEFAULT_THEME_ID)).toBe(true)
  })

  it('getTheme falls back to default for unknown ids', () => {
    expect(getTheme('nope').id).toBe(DEFAULT_THEME_ID)
    expect(getTheme('github').id).toBe('github')
  })

  it('resolveThemeId normalizes unknown ids', () => {
    expect(resolveThemeId('night')).toBe('night')
    expect(resolveThemeId('does-not-exist')).toBe(DEFAULT_THEME_ID)
  })

  it('isDarkTheme reflects the dark flag', () => {
    expect(isDarkTheme('night')).toBe(true)
    expect(isDarkTheme('github')).toBe(false)
  })

  it('lazy-loads scoped CSS and caches it', async () => {
    expect(getCachedThemeCss('github')).toBe('')
    const css = await getThemeCss('github')
    expect(css).toContain('.markdown-body')
    // Every selector is scoped to .markdown-body (no bare element leakage).
    expect(css).not.toMatch(/^\s*body\s*\{/m)
    // Cached now.
    expect(getCachedThemeCss('github')).toBe(css)
  })

  it('every theme CSS scopes rules to .markdown-body', async () => {
    for (const t of THEMES) {
      const css = await getThemeCss(t.id)
      expect(css).toContain('.markdown-body')
      // No top-level html/body selectors that would leak into app chrome.
      expect(css).not.toMatch(/(^|\})\s*(html|body)\s*\{/)
    }
  })

  it('unknown id resolves CSS to the default theme', async () => {
    const fallback = await getThemeCss('totally-unknown')
    const def = await getThemeCss(DEFAULT_THEME_ID)
    expect(fallback).toBe(def)
  })
})
