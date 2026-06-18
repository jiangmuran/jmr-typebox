import { beforeEach, describe, it, expect } from 'vitest'
import { registerConverter, getConverter, convertersFor, allConverters, _resetConverters } from '../registry'

beforeEach(() => _resetConverters())

describe('converter registry', () => {
  it('registers and looks up by id and input type, and runs', async () => {
    registerConverter({ id: 'md-html', route: '/convert/markdown-to-html', inputs: ['md'], output: 'html', where: 'client', needsBackend: false, run: async s => `<p>${s}</p>` })
    expect(getConverter('md-html').output).toBe('html')
    expect(convertersFor('md').map(c => c.id)).toContain('md-html')
    expect(await getConverter('md-html').run('hi')).toBe('<p>hi</p>')
  })

  it('upserts by id and lists all', () => {
    registerConverter({ id: 'x', inputs: [], output: 'a', run() {} })
    registerConverter({ id: 'x', inputs: [], output: 'b', run() {} })
    expect(getConverter('x').output).toBe('b')
    expect(allConverters().length).toBe(1)
  })
})
