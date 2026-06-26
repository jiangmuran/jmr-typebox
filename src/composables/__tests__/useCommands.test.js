import { beforeEach, describe, it, expect } from 'vitest'
import { registerCommand, searchCommands, allCommands, _resetCommands } from '../useCommands'

beforeEach(() => _resetCommands())

describe('useCommands', () => {
  it('registers and finds by title and alias', () => {
    registerCommand({ id: 'b64', title: 'Base64 Encode', aliases: ['encode'], group: 'Tools', run() {} })
    expect(searchCommands('base64').map(c => c.id)).toContain('b64')
    expect(searchCommands('encode').map(c => c.id)).toContain('b64')
  })

  it('ranks title-prefix above keyword match', () => {
    registerCommand({ id: 'a', title: 'Convert image', group: 'g', run() {} })
    registerCommand({ id: 'b', title: 'Watermark', keywords: 'convert', group: 'g', run() {} })
    const ids = searchCommands('convert').map(c => c.id)
    expect(ids[0]).toBe('a')
  })

  it('dedupes by id and returns empty for no match', () => {
    registerCommand({ id: 'x', title: 'X', group: 'g', run() {} })
    registerCommand({ id: 'x', title: 'X2', group: 'g', run() {} })
    expect(allCommands.filter(c => c.id === 'x').length).toBe(1)
    expect(searchCommands('zzzz')).toEqual([])
  })
})
