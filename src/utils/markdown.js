import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { protectMath, restoreMath } from './math'
// KaTeX styles are injected ON DEMAND (see ensureKatexStyles in katexCss.js): the
// vast majority of documents have no math, so we no longer pull the full ~75KB
// KaTeX stylesheet into the first-screen CSS via a static `import`. When a render
// actually emits KaTeX HTML we lazily load katexCss.js (its own chunk) and inject
// the stylesheet once. Browser-only + idempotent, so it's SSG-safe.

// highlight.js is loaded ON DEMAND. hljs core + the 15 language packs are ~25KB
// gzip that most first screens never need (a doc with no code fences uses none of
// it). Mirrors the KaTeX lazy pattern in math.js:
//   - highlightCode() highlights synchronously once the runtime is in memory
//     (_hljs), and otherwise emits escaped (un-highlighted) code while kicking off
//     the async import in the background.
//   - onHljsReady(cb) lets the live preview re-render once the chunk lands, so the
//     plain code is upgraded to real hljs token markup (usually <1s later).
//   - Async callers (exports, themed iframe) `await ensureHljs()` up front so their
//     one-shot output already contains highlighted code.
let _hljs = null
let _hljsLoading = null
const _hljsReadyCbs = new Set()

/**
 * Idempotently load the highlight.js runtime + language packs and register them.
 * Resolves with the hljs instance; concurrent callers share a single import.
 * Notifies onHljsReady subscribers when the chunk first lands.
 */
export function ensureHljs() {
  if (_hljs) return Promise.resolve(_hljs)
  if (!_hljsLoading) {
    _hljsLoading = Promise.all([
      import('highlight.js/lib/core'),
      import('highlight.js/lib/languages/javascript'),
      import('highlight.js/lib/languages/typescript'),
      import('highlight.js/lib/languages/python'),
      import('highlight.js/lib/languages/css'),
      import('highlight.js/lib/languages/xml'),
      import('highlight.js/lib/languages/json'),
      import('highlight.js/lib/languages/bash'),
      import('highlight.js/lib/languages/markdown'),
      import('highlight.js/lib/languages/sql'),
      import('highlight.js/lib/languages/java'),
      import('highlight.js/lib/languages/go'),
      import('highlight.js/lib/languages/rust'),
      import('highlight.js/lib/languages/cpp'),
      import('highlight.js/lib/languages/yaml'),
    ])
      .then(([core, javascript, typescript, python, css, xml, json, bash, markdown, sql, java, go, rust, cpp, yaml]) => {
        const d = (m) => m.default || m
        const hljs = d(core)
        hljs.registerLanguage('javascript', d(javascript))
        hljs.registerLanguage('js', d(javascript))
        hljs.registerLanguage('typescript', d(typescript))
        hljs.registerLanguage('ts', d(typescript))
        hljs.registerLanguage('python', d(python))
        hljs.registerLanguage('py', d(python))
        hljs.registerLanguage('css', d(css))
        hljs.registerLanguage('html', d(xml))
        hljs.registerLanguage('xml', d(xml))
        hljs.registerLanguage('json', d(json))
        hljs.registerLanguage('bash', d(bash))
        hljs.registerLanguage('sh', d(bash))
        hljs.registerLanguage('shell', d(bash))
        hljs.registerLanguage('markdown', d(markdown))
        hljs.registerLanguage('md', d(markdown))
        hljs.registerLanguage('sql', d(sql))
        hljs.registerLanguage('java', d(java))
        hljs.registerLanguage('go', d(go))
        hljs.registerLanguage('rust', d(rust))
        hljs.registerLanguage('cpp', d(cpp))
        hljs.registerLanguage('c', d(cpp))
        hljs.registerLanguage('yaml', d(yaml))
        hljs.registerLanguage('yml', d(yaml))
        _hljs = hljs
        for (const cb of _hljsReadyCbs) { try { cb() } catch { /* ignore */ } }
        _hljsReadyCbs.clear()
        return _hljs
      })
      .catch((e) => {
        _hljsLoading = null // allow a later retry
        throw e
      })
  }
  return _hljsLoading
}

/**
 * Run `cb` once the highlight.js runtime is available: immediately if it already
 * is, otherwise when ensureHljs()'s import resolves. Fires at most once. Returns an
 * unsubscribe — components MUST call it on unmount, or (in a session where no code
 * fence ever appears and the set is never flushed) their closures leak in
 * _hljsReadyCbs.
 */
export function onHljsReady(cb) {
  if (typeof cb !== 'function') return () => {}
  if (_hljs) { cb(); return () => {} }
  _hljsReadyCbs.add(cb)
  return () => { _hljsReadyCbs.delete(cb) }
}

// Configure marked. NOTE: marked v18 removed the `highlight` option entirely — passing it here is a
// silent no-op (verified in node_modules/marked). Syntax highlighting is applied on the `code` token
// via the renderer override below instead (see marked.use(...)).
marked.setOptions({
  breaks: true,
  gfm: true,
})

// Highlight a fenced code block's text with highlight.js. We only highlight when the fence names a
// language we've registered — auto-detection over plain prose is unreliable (it can mangle
// non-code content, e.g. splitting "$x^2$" as a shell variable), so unknown/absent langs render as
// plain escaped text. Returns { html, lang } where `html` is trusted highlight markup (hljs spans).
function highlightCode(code, lang) {
  if (lang) {
    // Runtime not loaded yet → kick off the async import and emit escaped (plain)
    // code for now. The live preview subscribes via onHljsReady and re-renders once
    // the chunk lands, upgrading this to real hljs token markup. Async callers avoid
    // this path entirely by awaiting ensureHljs() first. We keep the language class
    // (below) either way, so styling / the test contract hold.
    if (!_hljs) {
      ensureHljs().catch(() => {})
    } else if (_hljs.getLanguage(lang)) {
      try {
        return { html: _hljs.highlight(code, { language: lang }).value, lang }
      } catch { /* fall through to plain */ }
    }
  }
  return { html: escapeHtml(code), lang: lang || '' }
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// utf-8 string -> base64 (browser + Node). Stashing the raw diagram source in an
// attribute keeps it intact through DOMPurify and lets the renderer re-read the
// original code on theme change / edit without re-deriving it from the SVG.
function toBase64(str) {
  try {
    if (typeof btoa === 'function') return btoa(unescape(encodeURIComponent(str)))
  } catch {}
  // Node / SSG fallback
  try { return Buffer.from(str, 'utf-8').toString('base64') } catch {}
  return ''
}

// Intercept ```mermaid fences and emit a stable container for the mermaid helper
// to render (live DOM) or pre-render to inline SVG (iframe/export). Every other
// language falls through to marked's default code rendering (returning false),
// preserving existing behavior. The raw code is escaped as visible text (so a
// failed/blocked render still shows the source) AND base64'd into an attribute.
marked.use({
  renderer: {
    code({ text, lang }) {
      const language = (lang || '').trim().toLowerCase().split(/\s+/)[0]
      if (language === 'mermaid') {
        return `<pre class="mermaid" data-mermaid-src="${toBase64(text)}">${escapeHtml(text)}</pre>`
      }
      // Every other fence: highlight.js token markup wrapped in the same <pre><code> shape marked's
      // default renderer emits. Keep the `language-<lang>` class (styling / test contract) and add
      // the `hljs` class so the token-color CSS (see the typora theme stylesheets) applies.
      const { html, lang: hlLang } = highlightCode(text, language)
      const cls = hlLang ? `hljs language-${escapeHtml(hlLang)}` : 'hljs'
      return `<pre><code class="${cls}">${html}</code></pre>\n`
    },
  },
})

// DOMPurify config: allow the mermaid container's data attribute through. (The
// trusted KaTeX HTML is swapped in AFTER sanitize, so we don't need to widen the
// allow-list for MathML here — see math.js.)
const PURIFY_OPTS = { ADD_ATTR: ['data-mermaid-src'] }

// Lazily inject the KaTeX stylesheet the first time a render emits math. Fire-and-
// forget: renderMarkdown stays synchronous, and the <style> lands a tick later (the
// injector is idempotent). No-op under SSG/Node (no document) — prerendered math
// gets its styles when the page hydrates and re-renders on the client.
function scheduleKatexCss() {
  if (typeof document === 'undefined') return
  import('./katexCss').then((m) => m.ensureKatexStyles && m.ensureKatexStyles()).catch(() => {})
}

export function renderMarkdown(text) {
  try {
    // 1+2: pull math out to tokens (rendered KaTeX HTML) before marked sees it.
    const { text: protectedText, tokens } = protectMath(text || '')
    // KaTeX HTML was emitted → make sure its stylesheet is present (browser only).
    if (tokens.length > 0) scheduleKatexCss()
    // 3: markdown -> HTML -> sanitize (math-free, so KaTeX output is never stripped).
    const raw = marked.parse(protectedText)
    const clean = DOMPurify.sanitize(raw, PURIFY_OPTS)
    // 4: swap trusted KaTeX HTML back in for the placeholder tokens.
    return restoreMath(clean, tokens)
  } catch (e) {
    console.error('Markdown render error:', e)
    return ''
  }
}

export function buildStandaloneHTML(title, bodyHTML, opts = {}) {
  const katexStyle = opts.katexCss
    ? `<style>\n${String(opts.katexCss).replace(/<\/(style)>/gi, '<\\/$1>')}\n</style>`
    : ''
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
<style>
body{max-width:800px;margin:40px auto;padding:0 24px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,"PingFang SC",sans-serif;line-height:1.7;color:#24292f;font-size:15px}
h1,h2{border-bottom:1px solid #d0d7de;padding-bottom:.3em}h1{font-size:2em}h2{font-size:1.5em}h3{font-size:1.25em}
a{color:#0969da;text-decoration:none}a:hover{text-decoration:underline}
code{background:#f6f8fa;padding:.15em .4em;border-radius:4px;font-size:85%;font-family:"SF Mono","Fira Code",monospace}
pre{background:#f6f8fa;padding:16px;border-radius:8px;overflow-x:auto}pre code{background:none;padding:0;font-size:13px}
blockquote{border-left:3px solid #0969da;padding:.5em 1em;margin:1em 0;background:rgba(9,105,218,.05);border-radius:0 6px 6px 0;color:#57606a}
table{border-collapse:collapse;width:100%;margin:1em 0}th,td{border:1px solid #d0d7de;padding:8px 14px;text-align:left}th{background:#f6f8fa;font-weight:600}
img{max-width:100%;border-radius:8px}hr{border:none;height:1px;background:#d0d7de;margin:2em 0}
.katex-display{overflow-x:auto;overflow-y:hidden;margin:1em 0}
pre.mermaid,.mermaid{background:none;padding:0;margin:1em 0;text-align:center;overflow-x:auto}.mermaid svg{max-width:100%;height:auto}
.mermaid-error{display:inline-block;text-align:left;color:#b42318;background:rgba(180,35,24,.08);border:1px solid rgba(180,35,24,.3);border-radius:6px;padding:8px 12px;font-family:monospace;font-size:.82em;white-space:pre-wrap}
</style>
${katexStyle}
</head>
<body class="markdown-body">${bodyHTML}</body>
</html>`
}
