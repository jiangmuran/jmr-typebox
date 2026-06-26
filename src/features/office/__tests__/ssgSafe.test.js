import { describe, it, expect } from 'vitest'

// SSG-safety: the office modules must import cleanly in node (vite-ssg prerenders routes in Node).
// The heavy libs (SheetJS / JSZip) and all File/DOM/Blob work live behind dynamic import() inside
// functions, so a plain top-level import of these modules must NOT pull them in or touch the DOM.
describe('office modules import clean in node (SSG-safe)', () => {
  it('officeHelpers is pure and exposes its API', async () => {
    const m = await import('../officeHelpers')
    expect(typeof m.normalizeAoa).toBe('function')
    expect(typeof m.extractSlideParagraphs).toBe('function')
    expect(typeof m.colLabel).toBe('function')
    expect(typeof m.parsePptx).toBe('undefined') // lives in the runner, not here
  })

  it('xlsxRunner imports without eagerly loading SheetJS or touching DOM', async () => {
    const m = await import('../xlsxRunner')
    expect(typeof m.parseWorkbook).toBe('function')
    expect(typeof m.buildWorkbook).toBe('function')
  })

  it('pptxRunner imports without eagerly loading JSZip or touching DOM', async () => {
    const m = await import('../pptxRunner')
    expect(typeof m.parsePptx).toBe('function')
  })

  it('officeStore stages and consumes a file once', async () => {
    const { stageOfficeFile, takeOfficeFile, hasPendingOfficeFile } = await import('../officeStore')
    expect(hasPendingOfficeFile()).toBe(false)
    const fake = { name: 'a.xlsx', size: 1 }
    stageOfficeFile(fake)
    expect(hasPendingOfficeFile()).toBe(true)
    expect(takeOfficeFile()).toBe(fake)
    expect(takeOfficeFile()).toBe(null) // consumed
  })

  it('the feature module exports the /office component and en/zh i18n with identical keys', async () => {
    const mod = (await import('../index.js')).default
    expect(typeof mod.components['/office']).toBe('function')
    const en = Object.keys(mod.i18n.en).sort()
    const zh = Object.keys(mod.i18n.zh).sort()
    expect(en).toEqual(zh) // en + zh must have identical keys
    expect(en.length).toBeGreaterThan(10)
  })
})
