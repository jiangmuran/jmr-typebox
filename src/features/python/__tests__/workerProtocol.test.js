import { describe, it, expect } from 'vitest'
import {
  MSG,
  runRequest,
  installRequest,
  callServerRequest,
  stdinMessage,
  listPackagesRequest,
  uninstallRequest,
  cacheStatusRequest,
  resolveNav,
  resolveForm,
  encodeForm,
  normalizePath,
  injectPreviewBridge,
  PREVIEW_BRIDGE,
} from '../workerProtocol'

describe('worker message constructors (main -> worker wire format)', () => {
  it('runRequest carries id, files, entry, proxyBase, stdin with defaults', () => {
    const m = runRequest(7, { 'main.py': 'x' }, 'main.py', '/api/fetch', ['ada'])
    expect(m).toEqual({ type: MSG.RUN, id: 7, files: { 'main.py': 'x' }, entry: 'main.py', proxyBase: '/api/fetch', stdin: ['ada'] })
    // Defaults: empty files map, main.py entry, empty proxy, empty stdin seed.
    expect(runRequest(1)).toEqual({ type: 'run', id: 1, files: {}, entry: 'main.py', proxyBase: '', stdin: [] })
    // Non-array stdin coerces to [].
    expect(runRequest(2, {}, 'main.py', '', 'oops').stdin).toEqual([])
  })

  it('installRequest coerces specs to an array', () => {
    expect(installRequest(2, ['numpy', 'rich'], '')).toEqual({ type: 'install', id: 2, specs: ['numpy', 'rich'], proxyBase: '' })
    expect(installRequest(2, null).specs).toEqual([])
  })

  it('callServerRequest upper-cases method and normalises body/headers', () => {
    const m = callServerRequest(3, '/items', 'post', 'a=1', [['x', 'y']])
    expect(m).toEqual({ type: 'callServer', id: 3, path: '/items', method: 'POST', body: 'a=1', headers: [['x', 'y']] })
    // null body -> '' ; default method GET ; non-array headers -> []
    const d = callServerRequest(4)
    expect(d.method).toBe('GET'); expect(d.body).toBe(''); expect(d.headers).toEqual([]); expect(d.path).toBe('/')
  })

  it('stdin / list / uninstall / cacheStatus messages', () => {
    expect(stdinMessage('hi')).toEqual({ type: 'stdin', text: 'hi' })
    expect(stdinMessage(null)).toEqual({ type: 'stdin', text: '' })
    expect(listPackagesRequest(5)).toEqual({ type: 'listPackages', id: 5 })
    expect(uninstallRequest(6, 'rich')).toEqual({ type: 'uninstall', id: 6, name: 'rich' })
    expect(cacheStatusRequest(8)).toEqual({ type: 'cacheStatus', id: 8 })
  })
})

describe('normalizePath', () => {
  it('forces a leading slash for path-like inputs and defaults empty to /', () => {
    expect(normalizePath('')).toBe('/')
    expect(normalizePath(undefined)).toBe('/')
    expect(normalizePath('about')).toBe('/about')
    expect(normalizePath('/x')).toBe('/x')
    expect(normalizePath('https://preview.local/x')).toBe('https://preview.local/x')
  })
})

describe('resolveNav (preview link interception)', () => {
  it('follows root-relative paths', () => {
    expect(resolveNav('/', '/about')).toEqual({ follow: true, path: '/about' })
    expect(resolveNav('/items', '/items?limit=2')).toEqual({ follow: true, path: '/items?limit=2' })
  })

  it('resolves relative links against the current directory and collapses ..', () => {
    expect(resolveNav('/', 'about').path).toBe('/about')
    expect(resolveNav('/a/b', 'c').path).toBe('/a/c')         // sibling of /a/b
    expect(resolveNav('/a/b/', 'c').path).toBe('/a/b/c')      // child of dir /a/b/
    expect(resolveNav('/a/b/', '../d').path).toBe('/a/d')
  })

  it('does NOT follow external origins, fragments, or non-http schemes', () => {
    expect(resolveNav('/', 'https://evil.com/x').follow).toBe(false)
    expect(resolveNav('/', '#section').follow).toBe(false)
    expect(resolveNav('/', 'mailto:a@b.c').follow).toBe(false)
    expect(resolveNav('/', 'javascript:alert(1)').follow).toBe(false)
    expect(resolveNav('/', 'tel:123').follow).toBe(false)
  })

  it('follows absolute URLs that target the synthetic preview host (strips origin)', () => {
    expect(resolveNav('/', 'http://preview.local/about')).toEqual({ follow: true, path: '/about' })
    expect(resolveNav('/', 'https://preview.local/items?x=1').path).toBe('/items?x=1')
  })

  it('strips a trailing fragment from a followed link', () => {
    expect(resolveNav('/', '/about#top').path).toBe('/about')
  })

  it('empty href stays on the current path without navigating', () => {
    expect(resolveNav('/here', '')).toEqual({ follow: false, path: '/here' })
  })
})

describe('encodeForm + resolveForm (preview form submit)', () => {
  it('encodes name/value pairs urlencoded', () => {
    expect(encodeForm([['a', '1'], ['b', 'two words'], ['c', 'x&y']])).toBe('a=1&b=two%20words&c=x%26y')
    expect(encodeForm(null)).toBe('')
    expect(encodeForm([['', 'skip']])).toBe('') // blank name dropped
  })

  it('GET forms append fields to the action query', () => {
    const r = resolveForm('/', '/search', 'GET', [['q', 'cats'], ['p', '2']])
    expect(r).toEqual({ path: '/search?q=cats&p=2', method: 'GET', body: '', contentType: '' })
  })

  it('GET form on a path that already has a query uses & to append', () => {
    const r = resolveForm('/', '/search?lang=en', 'get', [['q', 'dogs']])
    expect(r.path).toBe('/search?lang=en&q=dogs')
    expect(r.method).toBe('GET')
  })

  it('POST forms carry a urlencoded body + content type and bare action posts to current path', () => {
    const r = resolveForm('/submit', '', 'POST', [['name', 'Ada']])
    expect(r).toEqual({ path: '/submit', method: 'POST', body: 'name=Ada', contentType: 'application/x-www-form-urlencoded' })
  })

  it('an external form action is not followed (falls back to current path)', () => {
    const r = resolveForm('/here', 'https://evil.com/x', 'POST', [['a', '1']])
    expect(r.path).toBe('/here')
  })
})

describe('preview bridge injection', () => {
  it('PREVIEW_BRIDGE posts tagged navigate/submit intents to the parent', () => {
    expect(PREVIEW_BRIDGE).toContain('__tbPreview')
    expect(PREVIEW_BRIDGE).toContain("kind:'navigate'")
    expect(PREVIEW_BRIDGE).toContain("kind:'submit'")
    expect(PREVIEW_BRIDGE).toContain('preventDefault')
  })

  it('injects the bridge before </body> when present, else appends', () => {
    const withBody = injectPreviewBridge('<html><body><h1>hi</h1></body></html>')
    expect(withBody).toMatch(/<script>.*__tbPreview.*<\/script><\/body>/s)
    const noBody = injectPreviewBridge('<h1>hi</h1>')
    expect(noBody.startsWith('<h1>hi</h1><script>')).toBe(true)
    expect(injectPreviewBridge(null)).toContain('<script>')
  })
})
