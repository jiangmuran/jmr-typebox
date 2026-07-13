import { describe, it, expect, beforeAll } from 'vitest'
import { protectMath, restoreMath, hasMathToken, ensureKatex } from '../math'

// KaTeX now loads on demand; renderOne renders synchronously only once the runtime
// is in memory. Preload it so these assertions see real KaTeX HTML (not the
// raw-TeX pending placeholder).
beforeAll(async () => { await ensureKatex() })

describe('protectMath — delimiter detection', () => {
  it('extracts inline $...$ math to a token', () => {
    const { text, tokens } = protectMath('Energy is $E=mc^2$ today.')
    expect(tokens).toHaveLength(1)
    expect(tokens[0]).toContain('class="katex"')
    expect(text).not.toContain('$E=mc^2$')
    expect(text).toMatch(/Energy is .+ today\./)
  })

  it('extracts block $$...$$ math with display mode', () => {
    const { tokens } = protectMath('$$\\int_0^1 x\\,dx$$')
    expect(tokens).toHaveLength(1)
    expect(tokens[0]).toContain('katex-display')
  })

  it('supports \\(...\\) inline and \\[...\\] block delimiters', () => {
    const { tokens } = protectMath('a \\(x+y\\) b \\[z\\]')
    expect(tokens).toHaveLength(2)
    expect(tokens[0]).not.toContain('katex-display') // inline
    expect(tokens[1]).toContain('katex-display')     // block
  })

  it('does NOT treat prices like "$5 and $10" as math', () => {
    const { text, tokens } = protectMath('It costs $5 and $10 total.')
    expect(tokens).toHaveLength(0)
    expect(text).toBe('It costs $5 and $10 total.')
  })

  it('disambiguates mixed prices + real math on one line', () => {
    // "$5 and $10 ... $a^2+b^2=c^2$" — only the Pythagoras formula is math.
    const { tokens } = protectMath('price of $5 and $10 (x), Pythagoras $a^2+b^2=c^2$.')
    expect(tokens).toHaveLength(1)
    expect(tokens[0]).toContain('class="katex"')
  })

  it('treats a $ immediately followed by a digit as currency, not a math opener', () => {
    expect(protectMath('Pay $100 now or $200 later').tokens).toHaveLength(0)
    expect(protectMath('$2x$ leading digit').tokens).toHaveLength(0)
  })

  it('does not start math when $ is followed by whitespace', () => {
    const { tokens } = protectMath('a $ b $ c')
    expect(tokens).toHaveLength(0)
  })

  it('ignores $ inside inline code spans', () => {
    const { text, tokens } = protectMath('use `$x$` literally')
    expect(tokens).toHaveLength(0)
    expect(text).toContain('`$x$`')
  })

  it('ignores $ inside fenced code blocks', () => {
    const src = '```js\nconst p = "$5"\nlet m = $x$\n```'
    const { text, tokens } = protectMath(src)
    expect(tokens).toHaveLength(0)
    expect(text).toBe(src)
  })

  it('keeps an escaped \\$ as a literal (no math)', () => {
    const { tokens } = protectMath('price \\$5 and \\$6')
    expect(tokens).toHaveLength(0)
  })

  it('takes the no-op fast path when there are no delimiters', () => {
    const input = 'plain text, nothing to do'
    const { text, tokens } = protectMath(input)
    expect(tokens).toHaveLength(0)
    expect(text).toBe(input)
  })

  it('does not throw on malformed TeX (renders an error inline)', () => {
    const { tokens } = protectMath('$\\frac{1}{$')
    expect(tokens).toHaveLength(1)
    expect(typeof tokens[0]).toBe('string')
  })

  it('handles empty / nullish input', () => {
    expect(protectMath('')).toEqual({ text: '', tokens: [] })
    expect(protectMath(undefined)).toEqual({ text: '', tokens: [] })
  })
})

describe('restoreMath — placeholder swap', () => {
  it('swaps trusted KaTeX HTML back in after sanitize', () => {
    const { text, tokens } = protectMath('value $a^2$ here')
    // simulate marked + DOMPurify wrapping the text in a <p>
    const sanitized = `<p>${text}</p>`
    const restored = restoreMath(sanitized, tokens)
    expect(restored).toContain('class="katex"')
    expect(hasMathToken(restored)).toBe(false)
  })

  it('round-trips multiple tokens in order', () => {
    const { text, tokens } = protectMath('$a$ and $b$ and $c$')
    expect(tokens).toHaveLength(3)
    const restored = restoreMath(text, tokens)
    // all three placeholders gone
    expect(hasMathToken(restored)).toBe(false)
    expect((restored.match(/class="katex"/g) || []).length).toBe(3)
  })

  it('is a no-op when there are no tokens', () => {
    expect(restoreMath('<p>hi</p>', [])).toBe('<p>hi</p>')
  })

  it('leaves an unknown token index untouched rather than crashing', () => {
    // token list shorter than the index referenced
    const html = 'zZkaTeXmathZz9zZendZz'
    expect(restoreMath(html, ['only-one'])).toBe(html)
  })
})
