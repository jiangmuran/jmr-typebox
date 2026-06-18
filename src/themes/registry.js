/**
 * TypeBox — Typora theme registry
 * ================================
 * Real, community-made Typora themes vendored locally under ./typora/.
 * Themes target Typora's DOM (`#write`, `body`, `.md-*`), so instead of
 * rewriting selectors we render the preview/export inside an isolated iframe
 * and apply each theme's CSS verbatim (see `buildThemedHtml`).
 *
 * Public API:
 *   THEMES                         array of { id, name, dark }
 *   getThemeCss(id) -> string      the theme's full CSS (fonts localized, cached)
 *   buildThemedHtml(body, id)      a standalone HTML doc string for iframe/export
 *   isThemeId(id) -> boolean
 *   DEFAULT_THEME_ID               id used when an unknown id is requested
 *
 * Fonts: every vendored `@font-face` uses a `url(__FONT__/<file>)` placeholder.
 * The real files live in ./typora/fonts/ and are imported here with Vite's
 * `?url` so they ship as hashed, same-origin assets — NO CDN, NO remote URLs.
 */

// --- Raw CSS modules (lazy; Vite returns the file text as a string) ----------
const cssModules = import.meta.glob('./typora/**/*.css', {
  query: '?raw',
  import: 'default',
})

// --- Font asset URLs (Vite rewrites these to bundled, same-origin paths) -----
const fontModules = import.meta.glob('./typora/fonts/*.{woff2,woff,ttf,otf}', {
  query: '?url',
  import: 'default',
  eager: true,
})

// Map bare font file name -> resolved bundled URL. e.g. "inter-400.woff2" -> "/assets/inter-400.[hash].woff2"
const FONT_URLS = {}
for (const [path, url] of Object.entries(fontModules)) {
  const name = path.split('/').pop()
  FONT_URLS[name] = url
}

/**
 * Theme catalog.
 *
 * `file` is the entry CSS under ./typora/. Phycat color variants `@import`
 * a shared base; `base` names that file so we can inline it (the iframe string
 * has no base URL, so relative @import can't resolve on its own).
 *
 * Phycat ships two real series:
 *   - Color (light): cherry, caramel, forest, mint, sky, prussian, sakura, mauve
 *   - Neon  (dark):  vampire, radiation, abyss
 * `phycat-neon` is exposed as an alias to the author-recommended Neon variant
 * (Vampire) so the conventional id resolves.
 */
const THEME_DEFS = [
  // ---- Standalone themes ----------------------------------------------------
  { id: 'nocturne',       name: 'Nocturne',          dark: true,  file: './typora/nocturne.css' },
  { id: 'inkwell',        name: 'Inkwell',           dark: false, file: './typora/inkwell.css' },
  { id: 'inkwell-dark',   name: 'Inkwell Dark',      dark: true,  file: './typora/inkwell-dark.css' },
  { id: 'lightmind',      name: 'LightMind',         dark: false, file: './typora/lightmind.css' },
  { id: 'lightmind-dark', name: 'LightMind Dark',    dark: true,  file: './typora/lightmind-dark.css' },
  { id: 'ivory-flow',     name: 'Ivory Flow',        dark: false, file: './typora/ivory-flow.css' },
  { id: 'johntor',        name: 'Johntor Dark Blue', dark: true,  file: './typora/johntor-dark-blue.css' },

  // ---- Phycat — Color series (light) ---------------------------------------
  { id: 'phycat-cherry',   name: 'Phycat · Cherry',   dark: false, file: './typora/phycat/phycat-cherry.css',   base: './typora/phycat/phycat.light.css' },
  { id: 'phycat-caramel',  name: 'Phycat · Caramel',  dark: false, file: './typora/phycat/phycat-caramel.css',  base: './typora/phycat/phycat.light.css' },
  { id: 'phycat-forest',   name: 'Phycat · Forest',   dark: false, file: './typora/phycat/phycat-forest.css',   base: './typora/phycat/phycat.light.css' },
  { id: 'phycat-mint',     name: 'Phycat · Mint',     dark: false, file: './typora/phycat/phycat-mint.css',     base: './typora/phycat/phycat.light.css' },
  { id: 'phycat-sky',      name: 'Phycat · Sky',      dark: false, file: './typora/phycat/phycat-sky.css',      base: './typora/phycat/phycat.light.css' },
  { id: 'phycat-prussian', name: 'Phycat · Prussian', dark: false, file: './typora/phycat/phycat-prussian.css', base: './typora/phycat/phycat.light.css' },
  { id: 'phycat-sakura',   name: 'Phycat · Sakura',   dark: false, file: './typora/phycat/phycat-sakura.css',   base: './typora/phycat/phycat.light.css' },
  { id: 'phycat-mauve',    name: 'Phycat · Mauve',    dark: false, file: './typora/phycat/phycat-mauve.css',    base: './typora/phycat/phycat.light.css' },

  // ---- Phycat — Neon series (dark) -----------------------------------------
  { id: 'phycat-vampire',   name: 'Phycat · Neon Vampire',   dark: true, file: './typora/phycat/phycat-vampire.css',   base: './typora/phycat/phycat.dark.css' },
  { id: 'phycat-radiation', name: 'Phycat · Neon Radiation', dark: true, file: './typora/phycat/phycat-radiation.css', base: './typora/phycat/phycat.dark.css' },
  { id: 'phycat-abyss',     name: 'Phycat · Neon Abyss',     dark: true, file: './typora/phycat/phycat-abyss.css',     base: './typora/phycat/phycat.dark.css' },
  // Alias: conventional "phycat-neon" id -> recommended Neon variant (Vampire).
  { id: 'phycat-neon',      name: 'Phycat · Neon',           dark: true, file: './typora/phycat/phycat-vampire.css',   base: './typora/phycat/phycat.dark.css' },
]

/** Public, UI-facing list. */
export const THEMES = THEME_DEFS.map(({ id, name, dark }) => ({ id, name, dark }))

export const DEFAULT_THEME_ID = 'nocturne'

const DEFS_BY_ID = Object.fromEntries(THEME_DEFS.map((d) => [d.id, d]))

export function isThemeId(id) {
  return Object.prototype.hasOwnProperty.call(DEFS_BY_ID, id)
}

// --- CSS loading -------------------------------------------------------------

const _rawCache = new Map() // module path -> raw CSS string
const _cssCache = new Map() // theme id   -> assembled+localized CSS string

// Vite's `.css?raw` transform reliably returns the file text in dev/build, but
// under Vitest (jsdom) the CSS plugin empties it. So in a Node/test context we
// read the vendored file straight from disk; in the browser we use the glob.
// `process` is undefined in the browser, so the fs branch is never reached there
// and the dynamic import keeps `node:fs` out of the client bundle.
const IS_NODE =
  typeof process !== 'undefined' &&
  !!(process.versions && process.versions.node)

async function loadViaFs(modulePath) {
  const { readFile } = await import('node:fs/promises')
  const { fileURLToPath } = await import('node:url')
  // modulePath is relative to this file (e.g. './typora/nocturne.css').
  const abs = fileURLToPath(new URL(modulePath, import.meta.url))
  return readFile(abs, 'utf-8')
}

async function loadViaVite(modulePath) {
  const loader = cssModules[modulePath]
  if (!loader) throw new Error(`[themes] CSS module not found: ${modulePath}`)
  const mod = await loader()
  return typeof mod === 'string' ? mod : (mod && mod.default) || ''
}

function loadRaw(modulePath) {
  if (_rawCache.has(modulePath)) return _rawCache.get(modulePath)
  const p = (async () => {
    let text = ''
    try {
      text = await loadViaVite(modulePath)
    } catch {
      text = ''
    }
    // Vitest empties `?raw` CSS — fall back to reading from disk.
    if (!text && IS_NODE) {
      text = await loadViaFs(modulePath)
    }
    _rawCache.set(modulePath, text) // replace the in-flight promise with the value
    return text
  })()
  _rawCache.set(modulePath, p)
  return p
}

/** Replace the `url(__FONT__/<file>)` placeholders with bundled font URLs. */
function localizeFonts(css) {
  return css.replace(/__FONT__\/([A-Za-z0-9._-]+)/g, (m, file) => {
    // Unknown/removed fonts (e.g. the 24MB CJK font we drop in favor of system CJK)
    // resolve to an empty url so the @font-face is ignored and the family falls through.
    return FONT_URLS[file] || ''
  })
}

/** Strip a variant's `@import url(... base ...)` line (we inline the base instead). */
function stripBaseImport(css) {
  return css.replace(/^\s*@import\s+url\([^)]*\)\s*;?\s*$/gim, '')
}

function assemble(rawSelf, rawBase) {
  let out = ''
  if (rawBase != null) {
    out = '/* base */\n' + rawBase + '\n/* variant overrides */\n' + stripBaseImport(rawSelf)
  } else {
    out = rawSelf
  }
  return localizeFonts(out)
}

// Canonical key so aliases that point at the same files share one cache entry
// (e.g. `phycat-neon` and `phycat-vampire` yield byte-identical CSS).
function cacheKeyFor(def) {
  return def.base ? `${def.base}|${def.file}` : def.file
}

/**
 * Get a theme's full CSS string (base inlined for Phycat, fonts localized).
 * Returns a Promise<string>. Result is cached, so repeat calls are instant.
 * Unknown ids fall back to DEFAULT_THEME_ID.
 */
export function getThemeCss(id) {
  const def = DEFS_BY_ID[id] || DEFS_BY_ID[DEFAULT_THEME_ID]
  const key = cacheKeyFor(def)
  if (_cssCache.has(key)) return Promise.resolve(_cssCache.get(key))

  const selfP = loadRaw(def.file)
  const baseP = def.base ? loadRaw(def.base) : Promise.resolve(null)

  return Promise.all([selfP, baseP]).then(([rawSelf, rawBase]) => {
    const css = assemble(rawSelf, rawBase)
    _cssCache.set(key, css)
    return css
  })
}

/**
 * Synchronous variant — only returns CSS if it has already been loaded
 * (via getThemeCss). Useful for hover preview after warm-up; returns '' if cold.
 */
export function getThemeCssSync(id) {
  const def = DEFS_BY_ID[id] || DEFS_BY_ID[DEFAULT_THEME_ID]
  return _cssCache.get(cacheKeyFor(def)) || ''
}

function escapeForStyle(css) {
  // A <style> element ends at the first literal "</style>"; neutralize any.
  return String(css).replace(/<\/(style)>/gi, '<\\/$1>')
}

/**
 * Build a complete, standalone HTML document that renders `bodyHtml` styled by
 * the given theme. Used for: live preview (iframe srcdoc), HTML export, and
 * print-to-PDF. The body is wrapped exactly as Typora themes expect:
 * `<body><div id="write" class="markdown-body">…</div></body>`.
 *
 * Returns a Promise<string>.
 */
export async function buildThemedHtml(bodyHtml, themeId, opts = {}) {
  const css = await getThemeCss(themeId)
  return buildThemedHtmlSync(bodyHtml, css, opts)
}

/**
 * Synchronous document builder when you already hold the CSS string
 * (e.g. from getThemeCss / getThemeCssSync). Same output as buildThemedHtml.
 */
export function buildThemedHtmlSync(bodyHtml, css, opts = {}) {
  const lang = opts.lang || 'en'
  const title = opts.title || 'TypeBox'
  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
<style>
/* Typora-style host reset so themes that style html/body/#write apply cleanly */
html,body{margin:0;padding:0}
#write{box-sizing:border-box}
img{max-width:100%}
</style>
<style data-typora-theme>
${escapeForStyle(css)}
</style>
</head>
<body class="typora-export">
<div id="write" class="markdown-body">
${bodyHtml || ''}
</div>
</body>
</html>`
}
