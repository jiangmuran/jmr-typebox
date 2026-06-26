import { describe, it, expect } from 'vitest'
import { buildSitemap } from '../seo'

describe('buildSitemap', () => {
  it('emits one <url> per path with the origin prefixed', () => {
    const xml = buildSitemap('https://x.com', ['/', '/python'])
    expect(xml).toContain('<loc>https://x.com/</loc>')
    expect(xml).toContain('<loc>https://x.com/python</loc>')
    expect((xml.match(/<url>/g) || []).length).toBe(2)
  })

  it('is well-formed sitemap XML', () => {
    const xml = buildSitemap('https://x.com', ['/'])
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>')
    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">')
    expect(xml.trim().endsWith('</urlset>')).toBe(true)
  })
})
