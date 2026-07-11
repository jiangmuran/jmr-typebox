import { describe, it, expect } from 'vitest'
import { ROUTE_META, ALL_PATHS } from '../meta'
import { routes } from '../routes'

describe('route meta', () => {
  it('every static path has unique non-empty title + description', () => {
    const titles = new Set()
    for (const p of ALL_PATHS) {
      const m = ROUTE_META[p]
      expect(m, `meta for ${p}`).toBeTruthy()
      expect(m.title.length).toBeGreaterThan(5)
      expect(m.description.length).toBeGreaterThan(10)
      expect(m.h1.length).toBeGreaterThan(1)
      expect(titles.has(m.title), `dup title ${m.title}`).toBe(false)
      titles.add(m.title)
    }
  })

  it('includes the core tool paths', () => {
    for (const p of ['/', '/image/compress', '/convert/markdown-to-pdf', '/python', '/tools/base64'])
      expect(ALL_PATHS).toContain(p)
  })
})

describe('routes', () => {
  it('produces one route per path with a tab + name', () => {
    // Every ROUTE_META path yields one static route; plus the single dynamic /w/:id verify
    // route (appended in routes.js, intentionally NOT in ROUTE_META so vite-ssg skips it).
    expect(routes.filter(r => !r.path.includes(':')).length).toBe(ALL_PATHS.length)
    for (const r of routes) {
      expect(typeof r.component).toBe('function') // lazy import
      expect(r.meta.tab).toBeTruthy()
      expect(r.name).toBeTruthy()
    }
    expect(routes.find(r => r.path === '/').name).toBe('home')
    expect(routes.find(r => r.path === '/w/:id').name).toBe('verify')
  })

  it('maps paths to the correct owning tab', () => {
    const tabOf = p => routes.find(r => r.path === p).meta.tab
    expect(tabOf('/')).toBe('markdown')
    expect(tabOf('/txt')).toBe('txt')
    expect(tabOf('/image/compress')).toBe('image')
    expect(tabOf('/convert/pdf-to-word')).toBe('convert')
    expect(tabOf('/media/mp3-to-wav')).toBe('media')
    expect(tabOf('/tools/aes')).toBe('tools')
    expect(tabOf('/python')).toBe('python')
  })
})
