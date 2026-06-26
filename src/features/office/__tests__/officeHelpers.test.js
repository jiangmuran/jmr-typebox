import { describe, it, expect } from 'vitest'
import {
  extOf, baseName, isXlsxName, isPptxName, isOfficeName, officeKind,
  colLabel, colLabels,
  normalizeAoa, isBlankCell, cellToString,
  decodeXmlEntities, extractSlideParagraphs, slidePlainText,
  emuToPct, xfrmToBox, parseXfrm, parseSlideSize, sortSlidePaths,
  formatBytes, DEFAULT_SLIDE_W, DEFAULT_SLIDE_H,
} from '../officeHelpers'
import { ALL_PATHS } from '../../../router/meta'

describe('office helpers — file-type detection', () => {
  it('extOf / baseName', () => {
    expect(extOf('Report.XLSX')).toBe('xlsx')
    expect(extOf('a.b.pptx')).toBe('pptx')
    expect(extOf('noext')).toBe('')
    expect(baseName('Quarterly.Report.xlsx')).toBe('Quarterly.Report')
    expect(baseName('deck.pptx')).toBe('deck')
  })
  it('classifies xlsx / pptx / other', () => {
    expect(isXlsxName('a.xlsx')).toBe(true)
    expect(isXlsxName('a.csv')).toBe(true)
    expect(isXlsxName('a.pptx')).toBe(false)
    expect(isPptxName('slides.pptx')).toBe(true)
    expect(isPptxName('slides.ppt')).toBe(true)
    expect(isOfficeName('x.docx')).toBe(false)
    expect(isOfficeName('x.md')).toBe(false)
    expect(officeKind('book.xlsx')).toBe('sheet')
    expect(officeKind('deck.pptx')).toBe('slides')
    expect(officeKind('readme.txt')).toBe(null)
  })
})

describe('office helpers — spreadsheet column labels', () => {
  it('maps index → A1-style column letters', () => {
    expect(colLabel(0)).toBe('A')
    expect(colLabel(25)).toBe('Z')
    expect(colLabel(26)).toBe('AA')
    expect(colLabel(27)).toBe('AB')
    expect(colLabel(51)).toBe('AZ')
    expect(colLabel(52)).toBe('BA')
    expect(colLabel(701)).toBe('ZZ')
    expect(colLabel(702)).toBe('AAA')
  })
  it('rejects bad indices and builds header lists', () => {
    expect(colLabel(-1)).toBe('')
    expect(colLabels(3)).toEqual(['A', 'B', 'C'])
    expect(colLabels(0)).toEqual([])
  })
})

describe('office helpers — AOA normalization (sheet → rows)', () => {
  it('rectangularizes a ragged grid and stringifies cells', () => {
    const aoa = [
      ['Name', 'Score', 'Pass'],
      ['Alice', 91, true],
      ['Bob', 88],            // short row
    ]
    const { rows, cols, rowCount } = normalizeAoa(aoa)
    expect(cols).toBe(3)
    expect(rowCount).toBe(3)
    expect(rows).toEqual([
      ['Name', 'Score', 'Pass'],
      ['Alice', '91', 'TRUE'],
      ['Bob', '88', ''],
    ])
  })
  it('trims trailing empty rows but keeps interior blanks', () => {
    const aoa = [
      ['a'],
      [null],
      ['b'],
      [''],
      [null],   // trailing empties
    ]
    const { rows, rowCount } = normalizeAoa(aoa)
    expect(rowCount).toBe(3)            // up to and including 'b'
    expect(rows.length).toBe(3)
    expect(rows[1]).toEqual([''])       // interior blank preserved
  })
  it('respects a maxRows cap (never freezes on huge sheets)', () => {
    const aoa = Array.from({ length: 5000 }, (_, i) => [`r${i}`])
    const { rows, rowCount } = normalizeAoa(aoa, { maxRows: 100 })
    expect(rowCount).toBe(5000)         // true count reported
    expect(rows.length).toBe(100)       // but render capped
  })
  it('cellToString handles dates, numbers, rich text objects', () => {
    expect(cellToString(42)).toBe('42')
    expect(cellToString(false)).toBe('FALSE')
    expect(cellToString(new Date('2024-01-15T00:00:00Z'))).toBe('2024-01-15')
    expect(cellToString({ text: 'hi' })).toBe('hi')
    expect(cellToString({ w: '$1.00', v: 1 })).toBe('$1.00')
    expect(isBlankCell(null)).toBe(true)
    expect(isBlankCell('')).toBe(true)
    expect(isBlankCell(0)).toBe(false)
  })
})

describe('office helpers — pptx text extraction', () => {
  it('decodes XML entities', () => {
    expect(decodeXmlEntities('A &amp; B &lt;3 &quot;x&quot; &#65;')).toBe('A & B <3 "x" A')
  })
  it('pulls paragraphs and runs out of slide XML', () => {
    const xml = `
      <p:sp><p:txBody>
        <a:p><a:r><a:t>Hello </a:t></a:r><a:r><a:t>World</a:t></a:r></a:p>
        <a:p><a:r><a:t>Second line</a:t></a:r></a:p>
      </p:txBody></p:sp>`
    const paras = extractSlideParagraphs(xml)
    expect(paras).toEqual(['Hello World', 'Second line'])
    expect(slidePlainText(xml)).toBe('Hello World\nSecond line')
  })
  it('handles a slide with no <a:p> wrappers (scrapes runs)', () => {
    const xml = `<a:t>Just</a:t><a:t> text</a:t>`
    expect(extractSlideParagraphs(xml)).toEqual(['Just text'])
  })
  it('empty slide → no paragraphs', () => {
    expect(extractSlideParagraphs('<p:sp></p:sp>')).toEqual([])
    expect(slidePlainText('')).toBe('')
  })
})

describe('office helpers — pptx geometry (EMU → %)', () => {
  it('emuToPct clamps and guards bad input', () => {
    expect(emuToPct(6096000, 12192000)).toBe(50)
    expect(emuToPct(0, 12192000)).toBe(0)
    expect(emuToPct(99999999, 12192000)).toBe(100)   // clamp
    expect(emuToPct(100, 0)).toBe(0)                  // bad denom
    expect(emuToPct(NaN, 100)).toBe(0)
  })
  it('parseXfrm reads off/ext', () => {
    const xml = '<a:xfrm><a:off x="914400" y="457200"/><a:ext cx="3657600" cy="1828800"/></a:xfrm>'
    expect(parseXfrm(xml)).toEqual({ x: 914400, y: 457200, cx: 3657600, cy: 1828800 })
    expect(parseXfrm('<p:sp></p:sp>')).toBe(null)
  })
  it('xfrmToBox produces clamped percentage box', () => {
    const box = xfrmToBox({ x: 0, y: 0, cx: DEFAULT_SLIDE_W / 2, cy: DEFAULT_SLIDE_H / 2 })
    expect(box.leftPct).toBe(0)
    expect(box.topPct).toBe(0)
    expect(box.widthPct).toBe(50)
    expect(box.heightPct).toBe(50)
    // A box that would overflow is clamped so width never exceeds remaining space.
    const big = xfrmToBox({ x: DEFAULT_SLIDE_W * 0.9, y: 0, cx: DEFAULT_SLIDE_W, cy: 100 })
    expect(big.leftPct).toBeCloseTo(90, 0)
    expect(big.widthPct).toBeLessThanOrEqual(10.001)
  })
  it('parseSlideSize reads sldSz or defaults', () => {
    expect(parseSlideSize('<p:sldSz cx="9144000" cy="6858000" type="screen4x3"/>')).toEqual({ cx: 9144000, cy: 6858000 })
    expect(parseSlideSize('')).toEqual({ cx: DEFAULT_SLIDE_W, cy: DEFAULT_SLIDE_H })
  })
  it('sortSlidePaths orders numerically and filters non-slides', () => {
    const paths = [
      'ppt/slides/slide10.xml',
      'ppt/slides/slide2.xml',
      'ppt/slides/slide1.xml',
      'ppt/slideLayouts/slideLayout1.xml',
      'ppt/presentation.xml',
    ]
    expect(sortSlidePaths(paths)).toEqual([
      'ppt/slides/slide1.xml',
      'ppt/slides/slide2.xml',
      'ppt/slides/slide10.xml',
    ])
  })
})

describe('office helpers — misc + route wiring', () => {
  it('formatBytes', () => {
    expect(formatBytes(500)).toBe('500 B')
    expect(formatBytes(2048)).toBe('2.0 KB')
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB')
  })
  it('the /office route is registered in ROUTE_META', () => {
    expect(ALL_PATHS).toContain('/office')
  })
})
