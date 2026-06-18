import { describe, it, expect } from 'vitest'
import { buildDocxHtml } from '../utils/docx.js'

describe('buildDocxHtml (markdown -> docx HTML prep)', () => {
  it('produces a full HTML document with the markdown rendered into the body', () => {
    const html = buildDocxHtml('# Hello\n\nWorld', 'My Doc')
    expect(html).toMatch(/^<!DOCTYPE html>/)
    expect(html).toContain('<title>My Doc</title>')
    expect(html).toContain('class="markdown-body"')
    expect(html).toContain('<h1')
    expect(html).toContain('Hello')
    expect(html).toContain('World')
  })

  it('renders lists, tables and code so OOXML conversion has structure', () => {
    const md = [
      '- one',
      '- two',
      '',
      '| A | B |',
      '| - | - |',
      '| 1 | 2 |',
      '',
      '```js',
      'const x = 1',
      '```',
    ].join('\n')
    const html = buildDocxHtml(md, 'Doc')
    expect(html).toContain('<ul>')
    expect(html).toContain('<li>')
    expect(html).toContain('<table>')
    expect(html).toContain('<th>')
    expect(html).toContain('<pre>')
    expect(html).toContain('<code')
  })

  it('embeds a Word-friendly stylesheet (pt units, no flex/grid)', () => {
    const html = buildDocxHtml('text', 'Doc')
    expect(html).toContain('<style>')
    expect(html).toMatch(/font-size:\s*11pt/)
    expect(html).not.toContain('display: flex')
    expect(html).not.toContain('display: grid')
  })

  it('escapes angle brackets / ampersands in the title', () => {
    const html = buildDocxHtml('x', '<script>&')
    expect(html).toContain('<title>script</title>')
    expect(html).not.toContain('<title><script>')
  })

  it('handles empty / nullish markdown gracefully', () => {
    expect(buildDocxHtml('', 'Doc')).toContain('class="markdown-body"')
    expect(buildDocxHtml(undefined, 'Doc')).toContain('<!DOCTYPE html>')
  })
})
