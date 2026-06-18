import { describe, it, expect } from 'vitest'
import {
  MIME, stripExt, safeBaseName, withExt, deriveTitle, fileKind,
} from '../utils/fileHelpers.js'

describe('fileHelpers', () => {
  describe('stripExt', () => {
    it('removes known extensions case-insensitively', () => {
      expect(stripExt('notes.md')).toBe('notes')
      expect(stripExt('Report.PDF')).toBe('Report')
      expect(stripExt('a.markdown')).toBe('a')
      expect(stripExt('photo.JPEG')).toBe('photo')
    })
    it('leaves unknown / no extension intact', () => {
      expect(stripExt('archive.tar')).toBe('archive.tar')
      expect(stripExt('plain')).toBe('plain')
    })
    it('handles nullish input', () => {
      expect(stripExt(undefined)).toBe('')
      expect(stripExt(null)).toBe('')
    })
  })

  describe('safeBaseName', () => {
    it('strips illegal filesystem characters but keeps spaces', () => {
      expect(safeBaseName('a/b:c*d?.md')).toBe('abcd')
      expect(safeBaseName('hello world.md')).toBe('hello world')
      expect(safeBaseName('my  report .md')).toBe('my report')
    })
    it('falls back when empty after sanitizing', () => {
      expect(safeBaseName('???.md')).toBe('document')
      expect(safeBaseName('', 'fallback')).toBe('fallback')
    })
  })

  describe('withExt', () => {
    it('builds a filename with the given extension', () => {
      expect(withExt('notes.md', 'pdf')).toBe('notes.pdf')
      expect(withExt('notes.md', '.docx')).toBe('notes.docx')
    })
    it('uses fallback for empty names', () => {
      expect(withExt('', 'html', 'untitled')).toBe('untitled.html')
    })
  })

  describe('deriveTitle', () => {
    it('uses the first non-empty line, stripping heading markers', () => {
      expect(deriveTitle('# My Title\n\nbody')).toBe('My Title')
      expect(deriveTitle('\n\n## Section\nmore')).toBe('Section')
    })
    it('strips inline emphasis markers', () => {
      expect(deriveTitle('# **Bold** _Title_')).toBe('Bold Title')
    })
    it('falls back when blank', () => {
      expect(deriveTitle('   \n\n')).toBe('Document')
      expect(deriveTitle('', 'X')).toBe('X')
    })
  })

  describe('fileKind', () => {
    it('detects pdf by extension and mime', () => {
      expect(fileKind({ name: 'a.pdf', type: '' })).toBe('pdf')
      expect(fileKind({ name: 'a', type: 'application/pdf' })).toBe('pdf')
    })
    it('detects markdown/text', () => {
      expect(fileKind({ name: 'a.md' })).toBe('markdown')
      expect(fileKind({ name: 'a.txt' })).toBe('markdown')
      expect(fileKind({ name: 'a.markdown' })).toBe('markdown')
      expect(fileKind({ name: 'a', type: 'text/plain' })).toBe('markdown')
    })
    it('returns null for unsupported and nullish', () => {
      expect(fileKind({ name: 'a.png', type: 'image/png' })).toBeNull()
      expect(fileKind(null)).toBeNull()
    })
  })

  it('exposes correct MIME types', () => {
    expect(MIME.docx).toContain('wordprocessingml')
    expect(MIME.html).toContain('text/html')
    expect(MIME.pdf).toBe('application/pdf')
  })
})
