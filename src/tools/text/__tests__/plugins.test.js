import { describe, it, expect } from 'vitest'
import { EDITOR_PLUGINS, PLUGIN_GROUPS } from '../plugins'

describe('editor plugins', () => {
  it('each plugin has an id, bilingual labels, a known group, and a fn or asyncFn', () => {
    const ids = new Set()
    for (const p of EDITOR_PLUGINS) {
      expect(p.id).toBeTruthy()
      expect(ids.has(p.id)).toBe(false)
      ids.add(p.id)
      expect(p.en && p.zh).toBeTruthy()
      expect(PLUGIN_GROUPS[p.group], `group ${p.group}`).toBeTruthy()
      expect(typeof p.fn === 'function' || typeof p.asyncFn === 'function').toBe(true)
    }
  })

  it('a sync plugin transforms its input', () => {
    const upper = EDITOR_PLUGINS.find(p => p.id === 'upper')
    expect(upper.fn('aBc')).toBe('ABC')
  })
})
