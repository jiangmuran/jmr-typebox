import { describe, it, expect } from 'vitest'
import {
  PROXY_PATH,
  isBlockedProxyHost,
  classifyProxyTarget,
  buildProxyUrl,
  splitPath,
  buildAsgiScope,
  normalizeResponse,
  prettyJson,
  STATUS_TEXT,
} from '../pythonNet'

describe('CORS proxy host guard (mirrors worker/api/fetch.js)', () => {
  it('blocks loopback/private/link-local hosts', () => {
    for (const h of ['localhost', '127.0.0.1', '10.1.2.3', '192.168.0.1', '169.254.1.1', '172.16.0.1', '172.31.255.1', '::1', 'foo.local', 'svc.internal', '0.0.0.0'])
      expect(isBlockedProxyHost(h), h).toBe(true)
  })
  it('allows public hosts', () => {
    for (const h of ['example.com', '8.8.8.8', 'raw.githubusercontent.com', '172.32.0.1', 'api.github.com'])
      expect(isBlockedProxyHost(h), h).toBe(false)
  })
  it('treats empty/garbage as blocked', () => {
    expect(isBlockedProxyHost('')).toBe(true)
    expect(isBlockedProxyHost(null)).toBe(true)
  })
})

describe('classifyProxyTarget', () => {
  it('accepts absolute http(s) public URLs', () => {
    expect(classifyProxyTarget('https://api.github.com/repos/vuejs/vue')).toEqual({ ok: true, reason: '' })
    expect(classifyProxyTarget('http://example.com/').ok).toBe(true)
  })
  it('rejects non-http protocols', () => {
    expect(classifyProxyTarget('ftp://example.com/x')).toEqual({ ok: false, reason: 'protocol' })
    expect(classifyProxyTarget('file:///etc/passwd').ok).toBe(false)
  })
  it('rejects blocked hosts', () => {
    expect(classifyProxyTarget('http://localhost:8000/secret')).toEqual({ ok: false, reason: 'blocked' })
    expect(classifyProxyTarget('http://192.168.0.1/').reason).toBe('blocked')
  })
  it('rejects relative / invalid input', () => {
    expect(classifyProxyTarget('/relative/path').ok).toBe(false)
    expect(classifyProxyTarget('not a url').ok).toBe(false)
    expect(classifyProxyTarget('').reason).toBe('empty')
  })
})

describe('buildProxyUrl', () => {
  it('encodes the target as a single query value (same-origin by default)', () => {
    expect(buildProxyUrl('https://api.example.com/x?y=1&z=2'))
      .toBe('/api/fetch?url=https%3A%2F%2Fapi.example.com%2Fx%3Fy%3D1%26z%3D2')
  })
  it('honours a non-empty apiBase', () => {
    expect(buildProxyUrl('https://e.com/', 'https://box.example'))
      .toBe('https://box.example/api/fetch?url=https%3A%2F%2Fe.com%2F')
  })
  it('uses the documented proxy path', () => {
    expect(PROXY_PATH).toBe('/api/fetch')
    expect(buildProxyUrl('https://e.com/').startsWith(PROXY_PATH)).toBe(true)
  })
})

describe('splitPath', () => {
  it('splits path and query, forcing a leading slash', () => {
    expect(splitPath('/users?id=5')).toEqual({ path: '/users', query: 'id=5' })
    expect(splitPath('about')).toEqual({ path: '/about', query: '' })
    expect(splitPath('')).toEqual({ path: '/', query: '' })
    expect(splitPath(undefined)).toEqual({ path: '/', query: '' })
    expect(splitPath('/?a=1&b=2')).toEqual({ path: '/', query: 'a=1&b=2' })
  })
})

describe('buildAsgiScope (ASGI/FastAPI request)', () => {
  it('shapes a valid http scope with method/path/query and header pairs', () => {
    const scope = buildAsgiScope('/items?limit=3', 'get')
    expect(scope.type).toBe('http')
    expect(scope.asgi.version).toBe('3.0')
    expect(scope.method).toBe('GET')      // upper-cased
    expect(scope.path).toBe('/items')
    expect(scope.query_string).toBe('limit=3')
    expect(scope.http_version).toBe('1.1')
    expect(scope.scheme).toBe('http')
    // Headers are an array of [name, value] string pairs (Python bytes-encodes them).
    expect(Array.isArray(scope.headers)).toBe(true)
    expect(scope.headers.find(h => h[0] === 'host')).toBeTruthy()
  })
  it('merges extra headers', () => {
    const scope = buildAsgiScope('/', 'GET', [['x-test', 'yes']])
    expect(scope.headers.find(h => h[0] === 'x-test')[1]).toBe('yes')
  })
})

describe('normalizeResponse', () => {
  it('reads content-type case-insensitively and flags html', () => {
    const r = normalizeResponse({ status: 200, headers: [['Content-Type', 'text/html; charset=utf-8']], body: '<h1>hi</h1>' })
    expect(r.status).toBe('200 OK')
    expect(r.statusCode).toBe(200)
    expect(r.isHtml).toBe(true)
    expect(r.isJson).toBe(false)
    expect(r.body).toBe('<h1>hi</h1>')
  })
  it('flags json and surfaces reason phrases', () => {
    const r = normalizeResponse({ status: 404, headers: [['content-type', 'application/json']], body: '{"detail":"x"}' })
    expect(r.status).toBe('404 Not Found')
    expect(r.isJson).toBe(true)
    expect(r.isHtml).toBe(false)
  })
  it('defaults content-type to html when absent', () => {
    const r = normalizeResponse({ status: 200, headers: [], body: 'x' })
    expect(r.contentType).toMatch(/text\/html/)
    expect(r.isHtml).toBe(true)
  })
  it('handles unknown status codes without a reason phrase', () => {
    const r = normalizeResponse({ status: 299, headers: [], body: '' })
    expect(r.status).toBe('299')
  })
  it('has a reason table covering common codes', () => {
    expect(STATUS_TEXT[200]).toBe('OK')
    expect(STATUS_TEXT[404]).toBe('Not Found')
    expect(STATUS_TEXT[500]).toBe('Internal Server Error')
  })
})

describe('prettyJson', () => {
  it('pretty-prints valid JSON', () => {
    expect(prettyJson('{"a":1,"b":[2,3]}')).toBe('{\n  "a": 1,\n  "b": [\n    2,\n    3\n  ]\n}')
  })
  it('passes through non-JSON unchanged', () => {
    expect(prettyJson('not json')).toBe('not json')
    expect(prettyJson('')).toBe('')
  })
})
