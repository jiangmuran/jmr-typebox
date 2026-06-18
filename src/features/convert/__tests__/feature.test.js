import { describe, it, expect, beforeEach } from 'vitest'
import feature from '../index.js'
import { _resetConverters, getConverter, allConverters } from '../../../converters/registry.js'

beforeEach(() => _resetConverters())

describe('convert feature module contract', () => {
  it('default-exports components / i18n / register', () => {
    expect(typeof feature).toBe('object')
    expect(Object.keys(feature.components)).toEqual([
      '/convert/markdown-to-pdf',
      '/convert/markdown-to-docx',
      '/convert/markdown-to-html',
      '/convert/pdf-to-word',
    ])
    expect(typeof feature.components['/convert/markdown-to-pdf']).toBe('function') // lazy importer
    expect(feature.i18n.en['convert.mdToPdf.title']).toBeTruthy()
    expect(feature.i18n.zh['convert.mdToPdf.title']).toBeTruthy()
    expect(typeof feature.register).toBe('function')
  })

  it('en and zh i18n have identical key sets', () => {
    const en = Object.keys(feature.i18n.en).sort()
    const zh = Object.keys(feature.i18n.zh).sort()
    expect(zh).toEqual(en)
  })

  it('register() wires all four converters as client-side, no-backend', () => {
    feature.register()
    const ids = allConverters().map(c => c.id).sort()
    expect(ids).toEqual(['markdown-to-docx', 'markdown-to-html', 'markdown-to-pdf', 'pdf-to-word'])
    for (const c of allConverters()) {
      expect(c.where).toBe('client')
      expect(c.needsBackend).toBe(false)
      expect(typeof c.run).toBe('function')
      expect(Array.isArray(c.inputs)).toBe(true)
    }
    expect(getConverter('pdf-to-word').inputs).toEqual(['pdf'])
    expect(getConverter('markdown-to-html').output).toBe('html')
  })

  it('markdown-to-html run() returns standalone themed HTML (no heavy libs)', async () => {
    feature.register()
    const html = await getConverter('markdown-to-html').run('# Hi\n\nbody', { title: 'T', theme: 'github' })
    expect(html).toContain('<!DOCTYPE html>')
    expect(html).toContain('<title>T</title>')
    expect(html).toContain('.markdown-body')
    expect(html).toContain('Hi')
  })
})
