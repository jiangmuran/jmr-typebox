import { describe, it, expect, beforeEach } from 'vitest'
import {
  PYODIDE_SIZE_MB,
  storageKey,
  STORAGE_KEYS,
  makeLine,
  appendChunk,
  createBatcher,
  formatError,
  parsePackages,
  packageName,
  EXAMPLES,
  getExample,
  DEFAULT_CODE,
  insertIndent,
} from '../pythonHelpers'
import feature from '../index.js'
import { _resetCommands, allCommands, searchCommands } from '../../../composables/useCommands'
import { ALL_PATHS } from '../../../router/meta'

describe('storage keys', () => {
  it('namespaces under python-*', () => {
    expect(storageKey('code')).toBe('python-code')
    expect(STORAGE_KEYS.code).toBe('python-code')
    expect(STORAGE_KEYS.packages).toBe('python-packages')
  })
})

describe('makeLine / appendChunk', () => {
  it('makeLine coerces text and keeps kind', () => {
    expect(makeLine('out', 42)).toEqual({ kind: 'out', text: '42' })
    expect(makeLine('err', null)).toEqual({ kind: 'err', text: '' })
  })

  it('coalesces consecutive same-kind chunks into one line', () => {
    const lines = []
    appendChunk(lines, 'out', 'a')
    appendChunk(lines, 'out', 'b')
    expect(lines).toEqual([{ kind: 'out', text: 'ab' }])
  })

  it('starts a new line when the kind changes', () => {
    const lines = []
    appendChunk(lines, 'out', 'hello\n')
    appendChunk(lines, 'err', 'boom')
    appendChunk(lines, 'out', 'more')
    expect(lines.map(l => l.kind)).toEqual(['out', 'err', 'out'])
    expect(lines[0].text).toBe('hello\n')
  })

  it('ignores empty/nullish chunks', () => {
    const lines = []
    appendChunk(lines, 'out', '')
    appendChunk(lines, 'out', null)
    expect(lines).toEqual([])
  })
})

describe('createBatcher', () => {
  it('buffers until flushed, then emits the whole string once', () => {
    const seen = []
    const b = createBatcher(s => seen.push(s))
    b.push('a'); b.push('b'); b.push('c')
    expect(seen).toEqual([])
    expect(b.hasPending).toBe(true)
    expect(b.pending).toBe('abc')
    b.flush()
    expect(seen).toEqual(['abc'])
    expect(b.hasPending).toBe(false)
  })

  it('flush is a no-op when empty', () => {
    const seen = []
    const b = createBatcher(s => seen.push(s))
    b.flush()
    expect(seen).toEqual([])
  })

  it('auto-flushes once the buffer exceeds maxChars', () => {
    const seen = []
    const b = createBatcher(s => seen.push(s), { maxChars: 4 })
    b.push('abcd') // hits the threshold
    expect(seen).toEqual(['abcd'])
    b.push('ef')
    expect(seen).toEqual(['abcd'])
    b.flush()
    expect(seen).toEqual(['abcd', 'ef'])
  })

  it('ignores null pushes', () => {
    const seen = []
    const b = createBatcher(s => seen.push(s))
    b.push(null)
    b.flush()
    expect(seen).toEqual([])
  })
})

describe('formatError', () => {
  it('keeps the python traceback and trims trailing whitespace', () => {
    const err = { message: 'noise line\nTraceback (most recent call last):\n  File "<exec>", line 1\nNameError: x\n\n' }
    const out = formatError(err)
    expect(out.startsWith('Traceback (most recent call last):')).toBe(true)
    expect(out).toContain('NameError: x')
    expect(out.endsWith('\n')).toBe(false)
  })

  it('passes through messages without a traceback', () => {
    expect(formatError({ message: 'plain error' })).toBe('plain error')
  })

  it('handles bare values', () => {
    expect(formatError('boom')).toBe('boom')
    expect(formatError(null)).toBe('Error')
  })
})

describe('parsePackages', () => {
  it('splits on commas and whitespace, de-dupes case-insensitively', () => {
    expect(parsePackages('numpy, pandas==2.0  requests')).toEqual(['numpy', 'pandas==2.0', 'requests'])
    expect(parsePackages('Rich rich RICH')).toEqual(['Rich'])
  })
  it('returns [] for empty input', () => {
    expect(parsePackages('')).toEqual([])
    expect(parsePackages(undefined)).toEqual([])
    expect(parsePackages('   ')).toEqual([])
  })
})

describe('packageName', () => {
  it('strips version/extras specifiers and lowercases', () => {
    expect(packageName('pandas==2.0.1')).toBe('pandas')
    expect(packageName('scikit-learn>=1.0')).toBe('scikit-learn')
    expect(packageName('Requests[security]')).toBe('requests')
    expect(packageName('  Flask ')).toBe('flask')
  })
})

describe('examples registry', () => {
  it('has stable ids with bilingual titles and code', () => {
    expect(EXAMPLES.length).toBeGreaterThanOrEqual(4)
    for (const ex of EXAMPLES) {
      expect(typeof ex.id).toBe('string')
      expect(typeof ex.title.en).toBe('string')
      expect(typeof ex.title.zh).toBe('string')
      expect(ex.code.length).toBeGreaterThan(0)
      expect(typeof ex.needsNetwork).toBe('boolean')
    }
  })
  it('ids are unique', () => {
    const ids = EXAMPLES.map(e => e.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
  it('only the micropip demo needs the network', () => {
    expect(EXAMPLES.filter(e => e.needsNetwork).map(e => e.id)).toEqual(['requests-demo'])
  })
  it('getExample looks up by id; DEFAULT_CODE is the hello example', () => {
    expect(getExample('plot')?.id).toBe('plot')
    expect(getExample('nope')).toBe(null)
    expect(DEFAULT_CODE).toBe(getExample('hello').code)
  })
})

describe('insertIndent', () => {
  it('inserts four spaces at a collapsed caret', () => {
    const r = insertIndent('ab', 1, 1)
    expect(r.value).toBe('a    b')
    expect(r.caret).toBe(5)
  })
  it('indents every line of a multi-line selection', () => {
    const code = 'one\ntwo\nthree'
    // select from start of "one" through end of "two"
    const r = insertIndent(code, 0, 7)
    expect(r.value).toBe('    one\n    two\nthree')
    expect(r.selStart).toBe(0)
    expect(r.selEnd).toBe(15) // 7 + 2 lines * 4 spaces
  })
})

describe('feature module contract', () => {
  beforeEach(() => _resetCommands())

  it('default-exports a single /python component as a lazy importer', () => {
    expect(typeof feature).toBe('object')
    expect(Object.keys(feature.components)).toEqual(['/python'])
    expect(typeof feature.components['/python']).toBe('function')
  })

  it('en and zh i18n have identical key sets, all namespaced py.*', () => {
    const en = Object.keys(feature.i18n.en).sort()
    const zh = Object.keys(feature.i18n.zh).sort()
    expect(zh).toEqual(en)
    expect(en.length).toBeGreaterThan(0)
    expect(en.every(k => k.startsWith('py.'))).toBe(true)
  })

  it('register() adds a searchable, no-backend command', () => {
    feature.register()
    const cmd = allCommands.find(c => c.id === 'open-python')
    expect(cmd).toBeTruthy()
    expect(cmd.needsBackend).toBe(false)
    expect(typeof cmd.run).toBe('function')
    expect(searchCommands('python').some(c => c.id === 'open-python')).toBe(true)
  })

  it('the /python route exists in ROUTE_META', () => {
    expect(ALL_PATHS).toContain('/python')
  })

  it('exposes the documented ~12MB size hint', () => {
    expect(PYODIDE_SIZE_MB).toBe(12)
  })
})
