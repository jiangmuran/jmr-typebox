import { describe, it, expect } from 'vitest'
import { TOOL_DEFS, TOOL_PATHS } from '../toolDefs'
import { ALL_PATHS } from '../../../router/meta'

describe('toolDefs', () => {
  it('defines every /tools/* route present in the router', () => {
    const routeToolPaths = ALL_PATHS.filter(p => p.startsWith('/tools/'))
    for (const p of routeToolPaths) expect(TOOL_DEFS[p], `missing def for ${p}`).toBeTruthy()
  })

  it('transform ops carry a function and bilingual labels', () => {
    for (const def of Object.values(TOOL_DEFS)) {
      if (def.mode !== 'transform') continue
      for (const op of def.ops) {
        expect(typeof op.fn).toBe('function')
        expect(op.en && op.zh).toBeTruthy()
      }
    }
  })

  it('TOOL_PATHS matches the def keys', () => {
    expect(TOOL_PATHS.length).toBe(Object.keys(TOOL_DEFS).length)
  })
})
