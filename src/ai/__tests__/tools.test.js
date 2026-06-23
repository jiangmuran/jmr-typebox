import { describe, it, expect, vi } from 'vitest'
import { TOOLS, TOOL_MAP, toolSpecs, dispatchTool } from '../tools'

// A fake host context capturing tool effects.
function makeCtx(overrides = {}) {
  const state = { doc: { name: 'note', content: '# Hi\nbody' }, inserted: [], theme: null, exported: null, created: null }
  return {
    state,
    getDocument: () => state.doc,
    getStats: () => ({ chars: state.doc.content.length, words: 2, lines: 2 }),
    replaceDocument: vi.fn(t => { state.doc.content = t }),
    insertText: vi.fn((t, where) => state.inserted.push({ t, where })),
    appendText: vi.fn(t => state.inserted.push({ t, where: 'end' })),
    newDocument: vi.fn((name, content) => { state.created = { name, content }; return { name: name || 'untitled' } }),
    exportDocument: vi.fn(async f => { state.exported = f }),
    setTheme: vi.fn((id) => (id === 'nocturne' || id === 'default') ? { ok: true, id } : { ok: false }),
    listThemes: () => [{ id: 'nocturne', name: 'Nocturne', dark: true }, { id: 'inkwell', name: 'Inkwell', dark: false }],
    ai: vi.fn(async () => 'a summary'),
    ...overrides,
  }
}

describe('toolSpecs', () => {
  it('produces OpenAI function-tool schema for every tool', () => {
    const specs = toolSpecs()
    expect(specs).toHaveLength(TOOLS.length)
    for (const s of specs) {
      expect(s.type).toBe('function')
      expect(typeof s.function.name).toBe('string')
      expect(typeof s.function.description).toBe('string')
      expect(s.function.parameters.type).toBe('object')
    }
  })
  it('can filter by name', () => {
    const specs = toolSpecs(['get_document'])
    expect(specs).toHaveLength(1)
    expect(specs[0].function.name).toBe('get_document')
  })
  it('registry map matches the tool list', () => {
    expect(Object.keys(TOOL_MAP).sort()).toEqual(TOOLS.map(t => t.name).sort())
  })
})

describe('dispatchTool', () => {
  it('get_document returns the current doc + stats', async () => {
    const ctx = makeCtx()
    const r = await dispatchTool('get_document', {}, ctx)
    expect(r.name).toBe('note')
    expect(r.content).toContain('# Hi')
    expect(r.chars).toBe(ctx.state.doc.content.length)
  })

  it('replace_document overwrites content', async () => {
    const ctx = makeCtx()
    const r = await dispatchTool('replace_document', { content: 'new text' }, ctx)
    expect(ctx.replaceDocument).toHaveBeenCalledWith('new text')
    expect(ctx.state.doc.content).toBe('new text')
    expect(r.ok).toBe(true)
  })

  it('insert_text appends by default and respects where', async () => {
    const ctx = makeCtx()
    await dispatchTool('insert_text', { text: 'X' }, ctx)
    await dispatchTool('insert_text', { text: 'Y', where: 'cursor' }, ctx)
    expect(ctx.state.inserted).toEqual([{ t: 'X', where: 'end' }, { t: 'Y', where: 'cursor' }])
  })

  it('new_document creates a tab', async () => {
    const ctx = makeCtx()
    const r = await dispatchTool('new_document', { name: 'draft', content: 'hello' }, ctx)
    expect(ctx.state.created).toEqual({ name: 'draft', content: 'hello' })
    expect(r.name).toBe('draft')
  })

  it('export_document triggers export for valid formats', async () => {
    const ctx = makeCtx()
    const r = await dispatchTool('export_document', { format: 'pdf' }, ctx)
    expect(ctx.exportDocument).toHaveBeenCalledWith('pdf')
    expect(r.ok).toBe(true)
    expect(r.format).toBe('pdf')
  })

  it('export_document rejects unknown formats without calling the host', async () => {
    const ctx = makeCtx()
    const r = await dispatchTool('export_document', { format: 'wat' }, ctx)
    expect(ctx.exportDocument).not.toHaveBeenCalled()
    expect(r.error).toMatch(/Unsupported/)
  })

  it('set_theme applies a known theme and reports the target', async () => {
    const ctx = makeCtx()
    const r = await dispatchTool('set_theme', { theme: 'nocturne', target: 'export' }, ctx)
    expect(r.ok).toBe(true)
    expect(r.target).toBe('export')
  })

  it('set_theme errors with valid ids listed for unknown themes', async () => {
    const ctx = makeCtx()
    const r = await dispatchTool('set_theme', { theme: 'bogus' }, ctx)
    expect(r.error).toMatch(/nocturne/)
    expect(r.error).toMatch(/default/)
  })

  it('list_themes includes the default option', async () => {
    const ctx = makeCtx()
    const r = await dispatchTool('list_themes', {}, ctx)
    expect(r.themes[0]).toEqual({ id: 'default', name: 'Default' })
    expect(r.themes.map(t => t.id)).toContain('inkwell')
  })

  it('summarize_document calls the sub-AI and returns a summary', async () => {
    const ctx = makeCtx()
    const r = await dispatchTool('summarize_document', { style: 'tldr' }, ctx)
    expect(ctx.ai).toHaveBeenCalled()
    expect(r.summary).toBe('a summary')
  })

  it('summarize_document errors on empty docs', async () => {
    const ctx = makeCtx({ getDocument: () => ({ name: 'x', content: '   ' }) })
    const r = await dispatchTool('summarize_document', {}, ctx)
    expect(r.error).toMatch(/empty/i)
    expect(ctx.ai).not.toHaveBeenCalled?.()
  })

  it('unknown tool name returns an error result', async () => {
    const r = await dispatchTool('does_not_exist', {}, makeCtx())
    expect(r.error).toMatch(/Unknown tool/)
  })

  it('converts thrown errors into { error } rather than rejecting', async () => {
    const ctx = makeCtx({ replaceDocument: () => { throw new Error('boom') } })
    const r = await dispatchTool('replace_document', { content: 'x' }, ctx)
    expect(r.error).toBe('boom')
  })
})
