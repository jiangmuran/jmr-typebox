import { describe, it, expect } from 'vitest'
import { mergeRemoteDocs } from '../useEditor'

describe('mergeRemoteDocs (cross-tab merge)', () => {
  it('adds remote-only docs and keeps local-only docs', () => {
    const local = [{ id: 1, name: 'a', content: 'A' }]
    const remote = [{ id: 2, name: 'b', content: 'B' }]
    const out = mergeRemoteDocs(local, remote, { activeId: 1, dirty: false })
    expect(out.map(d => d.id).sort()).toEqual([1, 2])
    // local-only doc 1 preserved with its content
    expect(out.find(d => d.id === 1)).toMatchObject({ name: 'a', content: 'A' })
    // remote-only doc 2 merged in
    expect(out.find(d => d.id === 2)).toMatchObject({ name: 'b', content: 'B' })
  })

  it('takes remote content for shared docs unless active + dirty', () => {
    const local = [
      { id: 1, name: 'active', content: 'local-edit' },
      { id: 2, name: 'other', content: 'local-other' },
    ]
    const remote = [
      { id: 1, name: 'active', content: 'remote-1' },
      { id: 2, name: 'other', content: 'remote-2' },
    ]
    // doc 1 is the active doc with unsaved edits → keep local; doc 2 → take remote
    const out = mergeRemoteDocs(local, remote, { activeId: 1, dirty: true })
    expect(out.find(d => d.id === 1).content).toBe('local-edit')
    expect(out.find(d => d.id === 2).content).toBe('remote-2')

    // when the active doc is NOT dirty, remote wins for it too
    const clean = mergeRemoteDocs(local, remote, { activeId: 1, dirty: false })
    expect(clean.find(d => d.id === 1).content).toBe('remote-1')
  })
})
