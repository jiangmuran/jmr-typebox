/**
 * KaTeX math for the Markdown pipeline.
 * =====================================
 * KaTeX emits HTML with many classes plus a MathML mirror (`<math>…`), all of
 * which DOMPurify happily strips. To keep math intact we never run KaTeX output
 * through the sanitizer: instead we
 *
 *   1. extract `$$…$$` / `\[…\]` (block) and `$…$` / `\(…\)` (inline) BEFORE marked,
 *   2. render each to a trusted KaTeX HTML string, stash it in a list, and leave a
 *      sanitizer-inert placeholder token in the source,
 *   3. let marked + DOMPurify process the (math-free) text,
 *   4. swap the trusted KaTeX HTML back in AFTER sanitize.
 *
 * KaTeX is isomorphic, so this all works during SSG/prerender in Node too.
 *
 * Public API:
 *   protectMath(text)  -> { text, tokens }   step 1+2 (run before marked)
 *   restoreMath(html, tokens) -> html        step 4 (run after DOMPurify)
 *   hasMathToken(html) -> boolean            cheap "did we emit any math?" check
 */

import katex from 'katex'

// Placeholder token: plain alphanumerics only, so neither marked (no markdown
// punctuation to interpret) nor DOMPurify (no tags/attrs) will touch it, and it
// can't appear in real prose by accident. We keep it on one line so `breaks:true`
// can't wrap a <br> through the middle of a block-math placeholder.
const PREFIX = 'zZkaTeXmathZz'
function token(i) {
  return `${PREFIX}${i}zZendZz`
}
// Matches a previously emitted token, possibly HTML-escaped/­wrapped by marked
// (e.g. inside a <p>). Global so restoreMath can replace every occurrence.
const TOKEN_RE = new RegExp(`${PREFIX}(\\d+)zZendZz`, 'g')

function renderOne(tex, displayMode) {
  try {
    return katex.renderToString(tex, {
      displayMode,
      throwOnError: false,
      // Surface errors inline (in a muted color) instead of throwing — a single
      // bad formula must not blank the whole preview.
      errorColor: '#cc0000',
      strict: false,
      output: 'htmlAndMathml',
      trust: false,
    })
  } catch {
    // Last-resort guard: show the raw source rather than crash the pipeline.
    const safe = tex.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    return `<code class="math-error">${safe}</code>`
  }
}

/**
 * Is this `$` (at index `i`, an opening delimiter candidate) part of a price /
 * currency rather than math? We only need light heuristics because the matcher
 * already requires a non-space right after `$` and a balanced closing `$`.
 */
function looksLikeMoney(src, openIdx, closeIdx) {
  // "$5" / "$5.00" — opener immediately followed by a digit and the span is just
  // a number (optionally with thousands separators / decimals) → treat as text.
  const body = src.slice(openIdx + 1, closeIdx)
  return /^\s*[\d.,]+\s*$/.test(body)
}

/**
 * Step 1+2. Returns the text with every math span replaced by a token, plus the
 * ordered list of rendered KaTeX HTML strings. Pure & SSG-safe.
 */
export function protectMath(text) {
  if (!text || (text.indexOf('$') === -1 && text.indexOf('\\(') === -1 && text.indexOf('\\[') === -1)) {
    return { text: text || '', tokens: [] }
  }

  const tokens = []
  const src = text
  let out = ''
  let i = 0
  const n = src.length

  // Track fenced code blocks (``` / ~~~) and inline code (`…`) so `$` inside code
  // is left verbatim for marked/highlight.js.
  let inFence = false
  let fenceMarker = ''

  while (i < n) {
    const ch = src[i]

    // --- fenced code block boundaries (line-anchored ``` or ~~~) ---
    if (ch === '`' || ch === '~') {
      const atLineStart = i === 0 || src[i - 1] === '\n'
      if (atLineStart) {
        const m = /^([`~]{3,})/.exec(src.slice(i))
        if (m) {
          const marker = m[1][0].repeat(3) // normalize length-compare below
          if (!inFence) {
            inFence = true
            fenceMarker = m[1][0]
          } else if (m[1][0] === fenceMarker) {
            inFence = false
            fenceMarker = ''
          }
          out += m[1]
          i += m[1].length
          continue
        }
      }
    }

    if (inFence) {
      out += ch
      i++
      continue
    }

    // --- inline code span: copy `…` verbatim ---
    if (ch === '`') {
      const close = src.indexOf('`', i + 1)
      if (close !== -1) {
        out += src.slice(i, close + 1)
        i = close + 1
        continue
      }
    }

    // --- escaped delimiters: keep the literal char, drop the backslash later via marked ---
    if (ch === '\\') {
      const next = src[i + 1]
      if (next === '(' || next === ')' || next === '[' || next === ']') {
        // handled as math delimiters below — fall through to the \( \[ checks
      } else if (next === '$') {
        out += '\\$' // leave escape for marked to render a literal '$'
        i += 2
        continue
      }
    }

    // --- block math: $$ … $$ ---
    if (ch === '$' && src[i + 1] === '$') {
      const close = src.indexOf('$$', i + 2)
      if (close !== -1) {
        const tex = src.slice(i + 2, close)
        tokens.push(renderOne(tex.trim(), true))
        out += token(tokens.length - 1)
        i = close + 2
        continue
      }
    }

    // --- block math: \[ … \] ---
    if (ch === '\\' && src[i + 1] === '[') {
      const close = src.indexOf('\\]', i + 2)
      if (close !== -1) {
        const tex = src.slice(i + 2, close)
        tokens.push(renderOne(tex.trim(), true))
        out += token(tokens.length - 1)
        i = close + 2
        continue
      }
    }

    // --- inline math: \( … \) ---
    if (ch === '\\' && src[i + 1] === '(') {
      const close = src.indexOf('\\)', i + 2)
      if (close !== -1) {
        const tex = src.slice(i + 2, close)
        tokens.push(renderOne(tex.trim(), false))
        out += token(tokens.length - 1)
        i = close + 2
        continue
      }
    }

    // --- inline math: $ … $ (pandoc-style delimiter guards) ---
    if (ch === '$') {
      // Opener must NOT be followed by space/tab/newline, another `$`, or a DIGIT.
      // The no-digit rule is what disambiguates currency: "$5", "$10" never open
      // math (real inline math rarely starts with a bare digit; use \(…\) if needed).
      const after = src[i + 1]
      const openOk =
        after && after !== ' ' && after !== '\t' && after !== '\n' && after !== '$' &&
        !(after >= '0' && after <= '9')
      if (openOk) {
        // Closing `$` must be preceded by a non-space, not escaped, and NOT followed
        // by a digit (so "$x$5" doesn't close oddly into a price). Same logical line.
        let j = i + 1
        let close = -1
        while (j < n) {
          const cj = src[j]
          if (cj === '\n' && src[j + 1] === '\n') break // blank line ends the search
          if (
            cj === '$' &&
            src[j - 1] !== ' ' && src[j - 1] !== '\t' && src[j - 1] !== '\\' &&
            !(src[j + 1] >= '0' && src[j + 1] <= '9')
          ) {
            close = j
            break
          }
          j++
        }
        if (close !== -1 && !looksLikeMoney(src, i, close)) {
          const tex = src.slice(i + 1, close)
          tokens.push(renderOne(tex, false))
          out += token(tokens.length - 1)
          i = close + 1
          continue
        }
      }
      // not math → emit the literal '$'
      out += '$'
      i++
      continue
    }

    out += ch
    i++
  }

  return { text: out, tokens }
}

/** Step 4. Swap trusted KaTeX HTML back in for the placeholder tokens. */
export function restoreMath(html, tokens) {
  if (!tokens || tokens.length === 0) return html
  return html.replace(TOKEN_RE, (m, idx) => {
    const n = Number(idx)
    return Number.isInteger(n) && tokens[n] != null ? tokens[n] : m
  })
}

/** Cheap check: does this rendered HTML still contain a math placeholder? */
export function hasMathToken(html) {
  return typeof html === 'string' && html.indexOf(PREFIX) !== -1
}
