import { describe, it, expect } from 'vitest'
import * as T from '../transforms'

describe('text transforms', () => {
  it('base64 round-trips UTF-8 incl. CJK + emoji', () => {
    const s = 'Hello 世界 🌍'
    expect(T.base64Decode(T.base64Encode(s))).toBe(s)
  })
  it('hex round-trips and rejects odd length', () => {
    expect(T.hexDecode(T.hexEncode('abc'))).toBe('abc')
    expect(() => T.hexDecode('abc')).toThrow()
  })
  it('url encode/decode', () => {
    expect(T.urlEncode('a b&c')).toBe('a%20b%26c')
    expect(T.urlDecode('a%20b%26c')).toBe('a b&c')
  })
  it('html entities encode/decode', () => {
    expect(T.htmlEntitiesEncode('<a href="x">&')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;')
    expect(T.htmlEntitiesDecode('&lt;a&gt;&amp;')).toBe('<a>&')
  })
  it('case transforms', () => {
    expect(T.toUpper('aB')).toBe('AB')
    expect(T.toLower('aB')).toBe('ab')
    expect(T.toTitle('hello world')).toBe('Hello World')
    expect(T.toSentence('hello. world')).toBe('Hello. World')
  })
  it('json format + minify', () => {
    expect(T.jsonMinify('{ "a": 1 }')).toBe('{"a":1}')
    expect(T.jsonFormat('{"a":1}')).toBe('{\n  "a": 1\n}')
    expect(() => T.jsonFormat('{bad}')).toThrow()
  })
  it('line ops', () => {
    expect(T.sortLines('b\na\nc')).toBe('a\nb\nc')
    expect(T.uniqueLines('a\na\nb')).toBe('a\nb')
    expect(T.reverseLines('a\nb')).toBe('b\na')
  })
  it('countText', () => {
    const c = T.countText('hello world\nfoo')
    expect(c.words).toBe(3)
    expect(c.lines).toBe(2)
    expect(c.chars).toBe(15)
  })
  it('jwtDecode reads header + payload', () => {
    const tok = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiI0MiJ9.sig'
    const r = T.jwtDecode(tok)
    expect(r.header.alg).toBe('HS256')
    expect(r.payload.sub).toBe('42')
  })
})
