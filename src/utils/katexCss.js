/**
 * KaTeX stylesheet, self-contained for embedding.
 * ================================================
 * The live `.markdown-body` preview just imports `katex/dist/katex.min.css`
 * normally (Vite handles fonts). But the themed iframe (srcdoc, no base URL) and
 * the HTML/PNG/PDF exports embed CSS as a string in a `<style>` — there, KaTeX's
 * relative `url(fonts/KaTeX_*.woff2)` references can't resolve.
 *
 * So we load the raw CSS once and rewrite every `url(fonts/<file>)` to the bundled,
 * same-origin asset URL (the exact pattern themes/registry.js uses for its fonts).
 * No CDN, no remote URLs. Cached after first use; returns a Promise<string>.
 */

// Raw CSS text (lazy — only fetched when an iframe/export actually needs it).
const cssRaw = import.meta.glob('/node_modules/katex/dist/katex.min.css', {
  query: '?raw',
  import: 'default',
})

// Bundled font URLs, keyed by bare filename (e.g. "KaTeX_Main-Regular.woff2").
const fontModules = import.meta.glob('/node_modules/katex/dist/fonts/*.{woff2,woff,ttf}', {
  query: '?url',
  import: 'default',
  eager: true,
})
const FONT_URLS = {}
for (const [path, url] of Object.entries(fontModules)) {
  FONT_URLS[path.split('/').pop()] = url
}

const IS_NODE =
  typeof process !== 'undefined' && !!(process.versions && process.versions.node)

let _cache = null

async function loadRaw() {
  // Browser/build: Vite glob returns the file text.
  const loader = Object.values(cssRaw)[0]
  if (loader) {
    try {
      const mod = await loader()
      const text = typeof mod === 'string' ? mod : (mod && mod.default) || ''
      if (text) return text
    } catch { /* fall through to fs */ }
  }
  // Node/SSG/Vitest fallback: read straight from the installed package.
  if (IS_NODE) {
    try {
      const { readFile } = await import('node:fs/promises')
      const { createRequire } = await import('node:module')
      const require = createRequire(import.meta.url)
      const cssPath = require.resolve('katex/dist/katex.min.css')
      return await readFile(cssPath, 'utf-8')
    } catch { /* ignore */ }
  }
  return ''
}

/**
 * Get KaTeX CSS with font URLs rewritten to bundled same-origin assets.
 * Returns Promise<string> (empty string if it can't be loaded — math still
 * renders structurally, just without KaTeX's bundled fonts).
 */
export async function getKatexCss() {
  if (_cache != null) return _cache
  const raw = await loadRaw()
  const out = raw.replace(/url\(fonts\/([A-Za-z0-9._-]+)\)/g, (m, file) => {
    const url = FONT_URLS[file]
    return url ? `url(${url})` : m
  })
  _cache = out
  return out
}
