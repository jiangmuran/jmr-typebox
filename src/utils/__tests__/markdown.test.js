import { describe, it, expect, beforeAll } from 'vitest'
import { renderMarkdown, buildStandaloneHTML, ensureHljs } from '../markdown'
import { hasMermaid, prerenderMermaid } from '../mermaid'
import { hasMathToken, ensureKatex } from '../math'

// KaTeX + highlight.js load on demand — preload them so renderMarkdown emits real
// KaTeX HTML / hljs token spans synchronously instead of the pending placeholders.
beforeAll(async () => { await ensureKatex(); await ensureHljs() })

describe('renderMarkdown — math survives DOMPurify', () => {
  it('keeps KaTeX HTML (spans + MathML) that DOMPurify would otherwise strip', () => {
    const out = renderMarkdown('Inline $E=mc^2$ done.')
    expect(out).toContain('class="katex"')
    expect(out).toContain('<math') // MathML mirror survived
    expect(hasMathToken(out)).toBe(false) // no leftover placeholder tokens
  })

  it('renders block math in display mode', () => {
    const out = renderMarkdown('$$\\sum_{i=1}^n i$$')
    expect(out).toContain('katex-display')
  })

  it('does not eat a "$5 and $10" price as math', () => {
    const out = renderMarkdown('It costs $5 and $10.')
    expect(out).not.toContain('class="katex"')
    expect(out).toContain('$5 and $10')
  })

  it('does not render math inside a code block', () => {
    const out = renderMarkdown('```\n$x^2$\n```')
    expect(out).not.toContain('class="katex"')
    expect(out).toContain('$x^2$')
  })
})

describe('renderMarkdown — mermaid container', () => {
  it('emits a stable <pre class="mermaid"> with the source preserved', () => {
    const out = renderMarkdown('```mermaid\ngraph TD\n  A-->B\n```')
    expect(out).toContain('class="mermaid"')
    expect(out).toContain('data-mermaid-src=') // base64 source survived sanitize
    expect(out).toContain('graph TD') // visible fallback text
  })

  it('round-trips the diagram source through the data attribute', () => {
    const out = renderMarkdown('```mermaid\nflowchart LR\n  X --> Y\n```')
    const m = out.match(/data-mermaid-src="([^"]*)"/)
    expect(m).toBeTruthy()
    const decoded = Buffer.from(m[1], 'base64').toString('utf-8')
    expect(decoded).toBe('flowchart LR\n  X --> Y')
  })

  it('leaves non-mermaid code blocks as normal code', () => {
    const out = renderMarkdown('```js\nconst x = 1\n```')
    expect(out).not.toContain('class="mermaid"')
    expect(out).toContain('language-js')
  })
})

describe('renderMarkdown — syntax highlighting (marked v18 renderer path)', () => {
  it('emits highlight.js token spans for a fenced code block with a known language', () => {
    const out = renderMarkdown('```js\nconst x = 1\n```')
    // hljs wraps tokens in <span class="hljs-*"> — the theme CSS colors these.
    expect(out).toContain('hljs-keyword') // `const`
    expect(out).toContain('hljs-number') // `1`
    expect(out).toContain('class="hljs language-js"')
  })

  it('highlights python too (proves the language registry is live, not dead weight)', () => {
    const out = renderMarkdown('```python\ndef f():\n    return 1\n```')
    expect(out).toContain('hljs-keyword') // `def` / `return`
    expect(out).toContain('language-python')
  })

  it('renders an unknown/absent language as plain escaped code (no mis-detection)', () => {
    const out = renderMarkdown('```\nplain text $x^2$\n```')
    expect(out).toContain('plain text $x^2$') // untouched — no auto-highlight mangling
    expect(out).not.toContain('hljs-')
  })
})

describe('hasMermaid / prerenderMermaid (non-loading paths)', () => {
  it('hasMermaid detects the container', () => {
    expect(hasMermaid(renderMarkdown('```mermaid\ngraph TD\nA-->B\n```'))).toBe(true)
    expect(hasMermaid('<p>no diagrams</p>')).toBe(false)
  })

  it('prerenderMermaid returns input unchanged (and never loads mermaid) when no diagram', async () => {
    const html = '<p>plain</p>'
    expect(await prerenderMermaid(html, false)).toBe(html)
  })
})

describe('buildStandaloneHTML', () => {
  it('embeds KaTeX CSS only when provided', () => {
    expect(buildStandaloneHTML('t', '<p>x</p>')).not.toContain('data-katex')
    const withCss = buildStandaloneHTML('t', '<p>x</p>', { katexCss: '.katex{}' })
    expect(withCss).toContain('.katex{}')
  })

  it('renders the body inside a .markdown-body element', () => {
    expect(buildStandaloneHTML('t', '<h1>Hi</h1>')).toContain('class="markdown-body"')
  })
})
