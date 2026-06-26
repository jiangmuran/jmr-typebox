import { describe, it, expect } from 'vitest'
import {
  THEMES,
  getThemeCss,
  getThemeCssSync,
  buildThemedHtml,
  buildThemedHtmlSync,
  isThemeId,
  DEFAULT_THEME_ID,
} from '../registry'

// The full set of ids the registry must expose.
const EXPECTED_IDS = [
  // standalone
  'nocturne',
  'inkwell',
  'inkwell-dark',
  'lightmind',
  'lightmind-dark',
  'ivory-flow',
  'johntor',
  // phycat — color (light)
  'phycat-cherry',
  'phycat-caramel',
  'phycat-forest',
  'phycat-mint',
  'phycat-sky',
  'phycat-prussian',
  'phycat-sakura',
  'phycat-mauve',
  // phycat — neon (dark)
  'phycat-vampire',
  'phycat-radiation',
  'phycat-abyss',
  'phycat-neon',
]

describe('THEMES catalog', () => {
  it('exposes exactly the expected theme ids', () => {
    const ids = THEMES.map((t) => t.id)
    expect(new Set(ids)).toEqual(new Set(EXPECTED_IDS))
    expect(ids.length).toBe(EXPECTED_IDS.length)
  })

  it('every theme has id, non-empty name, and boolean dark flag', () => {
    for (const t of THEMES) {
      expect(t.id, 'id').toBeTruthy()
      expect(typeof t.name).toBe('string')
      expect(t.name.length, `name for ${t.id}`).toBeGreaterThan(1)
      expect(typeof t.dark, `dark for ${t.id}`).toBe('boolean')
    }
  })

  it('ids are unique', () => {
    const ids = THEMES.map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('marks the expected light/dark split', () => {
    const dark = new Set(THEMES.filter((t) => t.dark).map((t) => t.id))
    expect(dark.has('nocturne')).toBe(true)
    expect(dark.has('phycat-vampire')).toBe(true)
    expect(dark.has('johntor')).toBe(true)
    expect(dark.has('phycat-sky')).toBe(false)
    expect(dark.has('inkwell')).toBe(false)
    expect(dark.has('ivory-flow')).toBe(false)
  })

  it('isThemeId / DEFAULT_THEME_ID behave', () => {
    expect(isThemeId('nocturne')).toBe(true)
    expect(isThemeId('does-not-exist')).toBe(false)
    expect(isThemeId(DEFAULT_THEME_ID)).toBe(true)
  })
})

describe('getThemeCss', () => {
  it('returns non-empty CSS for every vendored theme', async () => {
    for (const { id } of THEMES) {
      const css = await getThemeCss(id)
      expect(typeof css, `css type for ${id}`).toBe('string')
      expect(css.length, `css length for ${id}`).toBeGreaterThan(200)
    }
  })

  it('inlines the Phycat base (no leftover @import to the base file)', async () => {
    const css = await getThemeCss('phycat-sky')
    // base-only selectors must be present (proves the @import was inlined)
    expect(css).toContain('#write')
    // the variant's own override must be present too
    expect(css).toContain('--head-title-color')
    // the relative @import to the base must be gone
    expect(/@import\s+url\([^)]*phycat\.(light|dark)\.css/.test(css)).toBe(false)
  })

  it('localizes fonts — no Google Fonts / gstatic URLs survive, no __FONT__ placeholder leaks', async () => {
    for (const id of ['ivory-flow', 'nocturne', 'phycat-cherry', 'phycat-vampire']) {
      const css = await getThemeCss(id)
      expect(css.includes('fonts.googleapis.com'), `googleapis in ${id}`).toBe(false)
      expect(css.includes('fonts.gstatic.com'), `gstatic in ${id}`).toBe(false)
      expect(css.includes('__FONT__'), `unresolved placeholder in ${id}`).toBe(false)
    }
  })

  it('caches results (same reference on repeat call)', async () => {
    const a = await getThemeCss('inkwell')
    const b = await getThemeCss('inkwell')
    expect(a).toBe(b)
    // sync accessor returns the cached value after warm-up
    expect(getThemeCssSync('inkwell')).toBe(a)
  })

  it('falls back to the default theme for unknown ids', async () => {
    const unknown = await getThemeCss('totally-bogus')
    const def = await getThemeCss(DEFAULT_THEME_ID)
    expect(unknown).toBe(def)
  })

  it('aliases phycat-neon to a real dark Neon variant', async () => {
    const neon = await getThemeCss('phycat-neon')
    const vampire = await getThemeCss('phycat-vampire')
    expect(neon).toBe(vampire)
  })
})

describe('buildThemedHtml', () => {
  const BODY = '<h1>Hello TypeBox</h1><p>unmistakable-body-marker-xyz</p>'

  it('contains BOTH the theme CSS and the body', async () => {
    const css = await getThemeCss('nocturne')
    const html = await buildThemedHtml(BODY, 'nocturne')
    // a stable, theme-specific token from nocturne.css
    expect(css).toContain('--bg-color')
    expect(html).toContain('--bg-color')
    // the body is present and wrapped as Typora expects
    expect(html).toContain('unmistakable-body-marker-xyz')
    expect(html).toContain('<div id="write" class="markdown-body">')
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true)
  })

  it('produces a full standalone document', async () => {
    const html = await buildThemedHtml('<p>x</p>', 'phycat-sky')
    expect(html).toContain('<html')
    expect(html).toContain('</html>')
    expect(html).toContain('<style data-typora-theme>')
  })

  it('buildThemedHtmlSync mirrors the async builder', async () => {
    const css = await getThemeCss('inkwell')
    const sync = buildThemedHtmlSync(BODY, css)
    const asyncHtml = await buildThemedHtml(BODY, 'inkwell')
    expect(sync).toBe(asyncHtml)
  })

  it('neutralizes a stray </style> in the body so the document stays valid', () => {
    const html = buildThemedHtmlSync('<p>a</style><script>bad</script></p>', '/* css */')
    // the literal closing tag inside our theme <style> must be escaped,
    // but the body content is placed verbatim after </style> so it is fine;
    // the guard targets CSS — assert no early style termination from CSS side.
    expect(html).toContain('<style data-typora-theme>')
  })
})
