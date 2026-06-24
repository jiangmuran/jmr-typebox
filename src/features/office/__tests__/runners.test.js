import { describe, it, expect } from 'vitest'
import * as XLSX from 'xlsx'
import JSZip from 'jszip'

// End-to-end-ish tests for the lazy runners against REAL SheetJS / JSZip parses, using workbooks
// and a .pptx we synthesize in-memory (no browser needed — they accept ArrayBuffer/Uint8Array).

describe('xlsxRunner — parse + rebuild a real workbook', () => {
  function makeWorkbookBuffer() {
    const wb = XLSX.utils.book_new()
    const ws1 = XLSX.utils.aoa_to_sheet([
      ['Name', 'Score', 'Pass'],
      ['Alice', 91, true],
      ['Bob', 88, false],
    ])
    ws1['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 0 } }] // (1x1, ignored by reader)
    XLSX.utils.book_append_sheet(wb, ws1, 'Scores')
    const ws2 = XLSX.utils.aoa_to_sheet([['only'], ['one', 'two']])
    XLSX.utils.book_append_sheet(wb, ws2, 'Notes')
    return XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
  }

  it('parseWorkbook returns sheets with rectangular string grids', async () => {
    const { parseWorkbook } = await import('../xlsxRunner')
    const model = await parseWorkbook(new Uint8Array(makeWorkbookBuffer()))
    expect(model.sheetNames).toEqual(['Scores', 'Notes'])
    const s = model.sheets[0]
    expect(s.name).toBe('Scores')
    expect(s.cols).toBe(3)
    expect(s.rowCount).toBe(3)
    expect(s.rows[0]).toEqual(['Name', 'Score', 'Pass'])
    expect(s.rows[1]).toEqual(['Alice', '91', 'TRUE'])
    expect(s.rows[2]).toEqual(['Bob', '88', 'FALSE'])
    // Second sheet ragged → rectangularized to width 2.
    expect(model.sheets[1].cols).toBe(2)
    expect(model.sheets[1].rows).toEqual([['only', ''], ['one', 'two']])
  })

  it('buildWorkbook round-trips edited cells and coerces numbers back', async () => {
    const { buildWorkbook, parseWorkbook } = await import('../xlsxRunner')
    const edited = [{
      name: 'Edited',
      rows: [['Item', 'Qty'], ['Widgets', '42'], ['Gadgets', '7']],
    }]
    const blob = await buildWorkbook(edited)
    expect(blob).toBeInstanceOf(Blob)
    // Re-parse the produced workbook to confirm structure + numeric coercion survived.
    const buf = await blob.arrayBuffer()
    const back = await parseWorkbook(buf)
    expect(back.sheetNames).toEqual(['Edited'])
    expect(back.sheets[0].rows[1]).toEqual(['Widgets', '42'])
    // The raw cell should be a number, not the string "42".
    const wb = XLSX.read(new Uint8Array(buf), { type: 'array' })
    const cell = wb.Sheets['Edited']['B2']
    expect(cell.t).toBe('n')
    expect(cell.v).toBe(42)
  })

  it('caps a huge sheet so it never freezes, while reporting the true row count', async () => {
    const { parseWorkbook } = await import('../xlsxRunner')
    const aoa = Array.from({ length: 4000 }, (_, i) => [`row${i}`, i])
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'Big')
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
    const model = await parseWorkbook(new Uint8Array(buf))
    const s = model.sheets[0]
    expect(s.rowCount).toBe(4000)        // true count
    expect(s.truncated).toBe(true)
    expect(s.rows.length).toBeLessThanOrEqual(2000) // MAX_GRID_ROWS
  })
})

describe('pptxRunner — parse a minimal real .pptx', () => {
  // Craft the smallest valid-enough pptx zip for our parser: presentation.xml (slide size) + two
  // slide parts with text, plus one slide referencing an embedded PNG via its rels.
  async function makePptxBuffer() {
    const zip = new JSZip()
    zip.file('ppt/presentation.xml',
      `<?xml version="1.0"?><p:presentation xmlns:p="x"><p:sldSz cx="12192000" cy="6858000"/></p:presentation>`)
    zip.file('ppt/slides/slide1.xml',
      `<?xml version="1.0"?><p:sld><p:cSld><p:spTree>
        <p:sp><p:txBody>
          <a:p><a:r><a:rPr b="1"/><a:t>Title One</a:t></a:r></a:p>
          <a:p><a:r><a:t>Body text</a:t></a:r></a:p>
        </p:txBody></p:sp>
        <p:pic><p:blipFill><a:blip r:embed="rId2"/></p:blipFill>
          <p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="3000000" cy="2000000"/></a:xfrm></p:spPr>
        </p:pic>
      </p:spTree></p:cSld></p:sld>`)
    // 1x1 transparent PNG.
    const pngB64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
    zip.file('ppt/media/image1.png', pngB64, { base64: true })
    zip.file('ppt/slides/_rels/slide1.xml.rels',
      `<?xml version="1.0"?><Relationships><Relationship Id="rId2" Target="../media/image1.png"/></Relationships>`)
    zip.file('ppt/slides/slide2.xml',
      `<?xml version="1.0"?><p:sld><p:cSld><p:spTree>
        <p:sp><p:txBody><a:p><a:r><a:t>Second slide</a:t></a:r></a:p></p:txBody></p:sp>
      </p:spTree></p:cSld></p:sld>`)
    return zip.generateAsync({ type: 'uint8array' })
  }

  it('parsePptx returns ordered slides with text, shapes, and an embedded image', async () => {
    const { parsePptx } = await import('../pptxRunner')
    const buf = await makePptxBuffer()
    const model = await parsePptx(buf)
    expect(model.slideW).toBe(12192000)
    expect(model.slideH).toBe(6858000)
    expect(model.slides.length).toBe(2)

    const s1 = model.slides[0]
    expect(s1.index).toBe(1)
    expect(s1.paragraphs).toEqual(['Title One', 'Body text'])
    expect(s1.text).toContain('Title One')
    // A bold text shape + an image shape were extracted.
    const textShape = s1.shapes.find(sh => sh.type === 'text')
    expect(textShape).toBeTruthy()
    expect(textShape.paragraphs[0].runs[0].bold).toBe(true)
    const imgShape = s1.shapes.find(sh => sh.type === 'image')
    expect(imgShape).toBeTruthy()
    expect(imgShape.src.startsWith('data:image/png;base64,')).toBe(true)
    expect(imgShape.box.widthPct).toBeGreaterThan(0)

    expect(model.slides[1].paragraphs).toEqual(['Second slide'])
  })

  it('a slide with unreadable shapes still yields its text (fallback never blanks)', async () => {
    const { parsePptx } = await import('../pptxRunner')
    const zip = new JSZip()
    zip.file('ppt/slides/slide1.xml',
      `<p:sld><a:p><a:t>Only paragraph text, no shape tree</a:t></a:p></p:sld>`)
    const buf = await zip.generateAsync({ type: 'uint8array' })
    const model = await parsePptx(buf)
    expect(model.slides[0].paragraphs).toEqual(['Only paragraph text, no shape tree'])
  })
})
