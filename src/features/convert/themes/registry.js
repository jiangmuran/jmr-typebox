// Export-theme registry for the Convert suite.
//
// Each theme ships as a LOCAL, original CSS string scoped to `.markdown-body`
// (see ./<id>.js). Nothing is loaded from a CDN. Themes are lazy-imported on
// demand and cached in memory so hover live-preview is instant after the first
// load.
//
// Writing-theme vs export-theme are independent settings (see useSettings:
// settings.writingTheme / settings.exportTheme). This registry is the source of
// truth for EXPORT theming today, and is intentionally reusable: a later step
// can call getThemeCss()/the same map to theme the editor preview for the
// writing theme without touching this folder. See FOLLOWUPS at the bottom.

// Theme metadata. `dark` drives the print/canvas background fallback so dark
// themes export on a dark page instead of white.
export const THEMES = [
  { id: 'github',    name: 'GitHub',    dark: false, swatch: { bg: '#ffffff', fg: '#1f2328', accent: '#0969da' }, load: () => import('./github.js') },
  { id: 'minimal',   name: 'Minimal',   dark: false, swatch: { bg: '#ffffff', fg: '#222222', accent: '#111111' }, load: () => import('./minimal.js') },
  { id: 'newsprint', name: 'Newsprint', dark: false, swatch: { bg: '#fbf7ef', fg: '#2b2620', accent: '#8c4a2f' }, load: () => import('./newsprint.js') },
  { id: 'night',     name: 'Night',     dark: true,  swatch: { bg: '#14171f', fg: '#e6e6ea', accent: '#7aa2f7' }, load: () => import('./night.js') },
]

export const DEFAULT_THEME_ID = 'github'

const byId = new Map(THEMES.map(t => [t.id, t]))
const cssCache = new Map() // id -> css string

export function listThemes() {
  return THEMES
}

export function getTheme(id) {
  return byId.get(id) || byId.get(DEFAULT_THEME_ID)
}

export function isDarkTheme(id) {
  return !!getTheme(id).dark
}

// Resolve an arbitrary id to a known one (falls back to default).
export function resolveThemeId(id) {
  return byId.has(id) ? id : DEFAULT_THEME_ID
}

// Lazy-load (and cache) a theme's CSS string. Safe to call repeatedly; concurrent
// calls share the same module promise via the JS module cache.
export async function getThemeCss(id) {
  const theme = getTheme(id)
  if (cssCache.has(theme.id)) return cssCache.get(theme.id)
  const mod = await theme.load()
  const css = mod.default || ''
  cssCache.set(theme.id, css)
  return css
}

// Synchronous accessor for already-cached CSS (returns '' if not yet loaded).
export function getCachedThemeCss(id) {
  return cssCache.get(getTheme(id).id) || ''
}

// Test seam.
export function _resetThemeCache() {
  cssCache.clear()
}

// ---- FOLLOWUPS (writing-theme wiring) ---------------------------------------
// To apply a theme to the EDITOR preview (writing theme), a later step can:
//   import { getThemeCss } from 'src/features/convert/themes/registry.js'
//   const css = await getThemeCss(settings.writingTheme)
//   // inject `css` into a <style> next to the editor's `.markdown-body` preview,
//   // or render the preview inside an iframe and write `css` there.
// No edits to this folder are required for that — the map is already exported.
