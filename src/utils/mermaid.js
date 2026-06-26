/**
 * Mermaid diagrams for the Markdown preview + exports.
 * ====================================================
 * Mermaid is large and browser-only, so it is **lazy-loaded** — `import('mermaid')`
 * happens the first time a diagram is actually rendered, never at module top level
 * and never during SSG/prerender (Node).
 *
 * `renderMarkdown` emits a stable container for ```mermaid fences:
 *     <pre class="mermaid" data-mermaid-src="<base64 code>"></pre>
 * (the raw code is base64'd into an attribute so DOMPurify can't mangle it and a
 * later edit can re-read the original source). Two consumers use that container:
 *
 *   - renderMermaidIn(root, isDark): live preview. Renders each diagram to SVG and
 *     injects it into the <pre>. Idempotent — re-runs skip already-rendered nodes
 *     of the current theme and re-render ones whose theme changed, so retyping /
 *     theme toggles never leave stale or duplicated SVGs.
 *
 *   - prerenderMermaid(html, isDark) -> Promise<html>: static path (themed iframe
 *     preview, HTML/PNG/PDF export). Replaces every container with inline <svg>
 *     so the output is self-contained with no client JS.
 *
 * A diagram with a syntax error shows a small inline error box instead of breaking
 * the whole preview.
 */

import { loadLibrary } from './loadLibrary'

let _mermaid = null
let _initTheme = null
let _seq = 0

function load() {
  return loadLibrary('mermaid', () => import('mermaid').then((m) => m.default || m), {
    sizeMB: 0, // bundled (code-split), not a CDN download — no size hint needed
  })
}

// (Re)initialize mermaid for a given color scheme. Mermaid keeps global config, so
// switching theme means re-initializing before the next render.
function ensureInit(mermaid, isDark) {
  const theme = isDark ? 'dark' : 'default'
  if (_initTheme === theme) return
  _initTheme = theme
  mermaid.initialize({
    startOnLoad: false,
    theme,
    securityLevel: 'strict', // sanitizes diagram text; no raw HTML/scripts in labels
    fontFamily: 'inherit',
    suppressErrorRendering: true, // we render our own inline error box
  })
}

function decodeSrc(el) {
  const enc = el.getAttribute('data-mermaid-src')
  if (enc == null) return el.textContent || ''
  try {
    // base64 -> utf-8
    return decodeURIComponent(escape(atob(enc)))
  } catch {
    return el.textContent || ''
  }
}

function errorBox(message) {
  const safe = String(message || 'Diagram error')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  return `<span class="mermaid-error" role="img" aria-label="Diagram error">${safe}</span>`
}

/**
 * Render all `<pre class="mermaid">` containers inside `root` to SVG (live DOM).
 * Safe to call repeatedly. `isDark` selects the mermaid theme.
 */
export async function renderMermaidIn(root, isDark) {
  if (!root || typeof document === 'undefined') return
  const theme = isDark ? 'dark' : 'default'
  const nodes = Array.from(root.querySelectorAll('pre.mermaid, .mermaid[data-mermaid-src]'))
  // Only (re)render nodes that are unrendered or rendered for a different theme.
  const todo = nodes.filter((el) => el.getAttribute('data-mermaid-theme') !== theme)
  if (todo.length === 0) return

  let mermaid
  try {
    mermaid = await load()
  } catch (e) {
    todo.forEach((el) => { el.innerHTML = errorBox('Failed to load diagram engine') })
    return
  }
  ensureInit(mermaid, isDark)

  for (const el of todo) {
    const code = decodeSrc(el)
    const id = `mmd-${Date.now().toString(36)}-${_seq++}`
    try {
      // mermaid.render returns { svg } and does NOT mutate `el`; we own insertion,
      // which keeps a single SVG per container (no duplicates on re-render).
      const { svg } = await mermaid.render(id, code)
      el.innerHTML = svg
      el.setAttribute('data-mermaid-theme', theme)
      el.classList.add('mermaid-rendered')
    } catch (err) {
      el.innerHTML = errorBox(err?.message || 'Invalid diagram syntax')
      el.setAttribute('data-mermaid-theme', theme)
      // Clean up any orphan node mermaid may have appended to <body> on failure.
      const orphan = document.getElementById(id) || document.getElementById('d' + id)
      orphan?.remove()
    }
  }
}

// Match the containers emitted by renderMarkdown (attribute order from DOMPurify
// is stable: class then data-mermaid-src). Non-greedy body, tolerant of either
// self-rendered or empty inner content.
const CONTAINER_RE = /<pre class="mermaid" data-mermaid-src="([^"]*)"[^>]*>[\s\S]*?<\/pre>/g

/**
 * Replace every mermaid container in `html` with inline <svg> (static export /
 * themed iframe). Returns the transformed HTML. If no diagrams are present the
 * input is returned unchanged without loading mermaid.
 */
export async function prerenderMermaid(html, isDark) {
  if (typeof html !== 'string' || html.indexOf('class="mermaid"') === -1) return html

  // Collect all matches first (regex.exec loop) so we can render sequentially.
  const matches = []
  let m
  CONTAINER_RE.lastIndex = 0
  while ((m = CONTAINER_RE.exec(html)) !== null) {
    matches.push({ full: m[0], enc: m[1] })
  }
  if (matches.length === 0) return html

  let mermaid
  try {
    mermaid = await load()
  } catch {
    return html // leave containers as-is; CSS still shows the raw code box
  }
  ensureInit(mermaid, isDark)

  // Decode base64 attr -> source.
  const decode = (enc) => {
    try { return decodeURIComponent(escape(atob(enc))) } catch { return '' }
  }

  const replacements = new Map()
  for (let i = 0; i < matches.length; i++) {
    const { full, enc } = matches[i]
    if (replacements.has(full)) continue
    const code = decode(enc)
    const id = `mmdx-${i}-${_seq++}`
    try {
      const { svg } = await mermaid.render(id, code)
      replacements.set(full, `<div class="mermaid mermaid-rendered">${svg}</div>`)
    } catch (err) {
      replacements.set(full, `<div class="mermaid">${errorBox(err?.message || 'Invalid diagram syntax')}</div>`)
      document.getElementById(id)?.remove()
    }
  }

  let out = html
  for (const [full, repl] of replacements) {
    out = out.split(full).join(repl)
  }
  return out
}

/** Cheap check used by callers to decide whether the async mermaid path is needed. */
export function hasMermaid(html) {
  return typeof html === 'string' && html.indexOf('class="mermaid"') !== -1
}
