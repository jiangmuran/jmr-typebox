/**
 * PDF-to-Markdown layout analysis engine v2
 *
 * Pipeline: pdf.js raw items → normalize → line grouping → column detection
 *           → block classification (heading/list/table/code/paragraph)
 *           → smart paragraph merging → Markdown generation
 */

let pdfjsLib = null

async function ensurePdfJs() {
  if (pdfjsLib) return pdfjsLib
  pdfjsLib = await import('pdfjs-dist')
  const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
  pdfjsLib.GlobalWorkerOptions.workerSrc = worker.default
  return pdfjsLib
}

// ===== Extract raw items =====
async function extractRawPages(file, onProgress) {
  const pdfjs = await ensurePdfJs()
  const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise
  const pages = []

  try {
    for (let i = 1; i <= pdf.numPages; i++) {
      if (onProgress) onProgress(i, pdf.numPages)
      const page = await pdf.getPage(i)
      const vp = page.getViewport({ scale: 1 })
      const content = await page.getTextContent()

      const items = content.items
        .filter(it => it.str && it.str.trim().length > 0)
        .map(it => {
          const tx = it.transform
          const fontSize = Math.round(Math.sqrt(tx[0] * tx[0] + tx[1] * tx[1]) * 10) / 10
          return {
            str: it.str,
            x: Math.round(tx[4] * 10) / 10,
            y: Math.round((vp.height - tx[5]) * 10) / 10,
            width: it.width || 0,
            height: it.height || fontSize,
            fontSize,
            fontName: it.fontName || '',
          }
        })

      pages.push({ pageNum: i, width: vp.width, height: vp.height, items })
    }
    return { pages, numPages: pdf.numPages }
  } finally {
    // Free the document's worker-side memory — without this, every conversion leaks
    // the whole parsed PDF until the tab is reloaded.
    pdf.destroy().catch(() => {})
  }
}

// ===== Group items into lines =====
function groupIntoLines(items, tolerance) {
  if (!items.length) return []
  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x)
  const lines = []
  let cur = [sorted[0]]

  for (let i = 1; i < sorted.length; i++) {
    if (Math.abs(sorted[i].y - cur[0].y) <= tolerance) {
      cur.push(sorted[i])
    } else {
      cur.sort((a, b) => a.x - b.x)
      lines.push(cur)
      cur = [sorted[i]]
    }
  }
  cur.sort((a, b) => a.x - b.x)
  lines.push(cur)
  return lines
}

// ===== Merge line items to text (smart spacing) =====
function lineToText(items) {
  if (!items.length) return ''
  let text = items[0].str
  for (let i = 1; i < items.length; i++) {
    const prev = items[i - 1], curr = items[i]
    const gap = curr.x - (prev.x + prev.width)
    // For CJK: no space needed between adjacent characters
    const prevIsCJK = /[\u4e00-\u9fff\u3000-\u303f]$/.test(prev.str)
    const currIsCJK = /^[\u4e00-\u9fff\u3000-\u303f]/.test(curr.str)
    if (prevIsCJK && currIsCJK && gap < prev.fontSize * 0.8) {
      text += curr.str
    } else if (gap > prev.fontSize * 0.25) {
      text += ' ' + curr.str
    } else {
      text += curr.str
    }
  }
  return text
}

// ===== Font statistics =====
function analyzeFonts(pages) {
  const sizeCounts = {}
  const nameCounts = {}

  for (const p of pages) {
    for (const it of p.items) {
      const fs = Math.round(it.fontSize)
      sizeCounts[fs] = (sizeCounts[fs] || 0) + it.str.length
      nameCounts[it.fontName] = (nameCounts[it.fontName] || 0) + it.str.length
    }
  }

  let bodySize = 12, maxCount = 0
  for (const [s, c] of Object.entries(sizeCounts)) {
    if (c > maxCount) { maxCount = c; bodySize = Number(s) }
  }

  const monoFonts = new Set()
  for (const name of Object.keys(nameCounts)) {
    if (/mono|courier|consola|menlo|fira.?code|source.?code/i.test(name)) monoFonts.add(name)
  }

  const headingSizes = Object.keys(sizeCounts).map(Number)
    .filter(s => s > bodySize * 1.12)
    .sort((a, b) => b - a)

  return { bodySize, headingSizes, monoFonts }
}

// ===== Multi-column detection =====
function detectColumns(lines, pageWidth) {
  if (lines.length < 6) return null
  const midX = pageWidth / 2
  let left = 0, right = 0
  for (const l of lines) {
    const x = l[0].x
    if (x < midX * 0.65) left++
    else if (x > midX * 0.85) right++
  }
  if (right > lines.length * 0.2 && left > lines.length * 0.2) {
    return { splitX: midX * 0.8 }
  }
  return null
}

// ===== Table detection v2 =====
// Look for lines with multiple items at consistent x-positions
function detectTableRegions(lines) {
  const regions = []
  let i = 0

  while (i < lines.length) {
    // A table line has >= 3 items with reasonable spacing
    if (lines[i].length >= 3) {
      const startCols = lines[i].map(it => Math.round(it.x / 8) * 8)
      let tableLines = [lines[i]]
      let j = i + 1

      while (j < lines.length) {
        if (lines[j].length < 2) break
        const cols = lines[j].map(it => Math.round(it.x / 8) * 8)
        // Check alignment: at least 40% of columns should match
        const matchCount = startCols.filter(c => cols.some(c2 => Math.abs(c2 - c) < 16)).length
        const minCols = Math.min(startCols.length, cols.length)
        if (matchCount >= minCols * 0.4) {
          tableLines.push(lines[j])
          j++
        } else break
      }

      if (tableLines.length >= 2) {
        regions.push({ type: 'table', startIdx: i, endIdx: j, lines: tableLines })
        i = j
        continue
      }
    }
    i++
  }
  return regions
}

// ===== Line classification =====
function classifyLine(items, text, fonts) {
  const avgSize = items.reduce((s, it) => s + it.fontSize, 0) / items.length
  const primaryFont = items[0]?.fontName || ''
  const trimmed = text.trim()

  // Heading: larger font, short text
  if (avgSize > fonts.bodySize * 1.12 && trimmed.length < 200) {
    const tier = fonts.headingSizes.findIndex(s => avgSize >= s * 0.95)
    return { type: 'heading', level: Math.min((tier >= 0 ? tier : 0) + 1, 6), text: trimmed }
  }

  // Bold headings
  if (/bold|heavy|black/i.test(primaryFont) && trimmed.length < 100 && avgSize >= fonts.bodySize) {
    return { type: 'heading', level: 3, text: trimmed }
  }

  // Bullet list
  if (/^[•●○◦▪▸►–—\-\*]\s+/.test(trimmed)) {
    return { type: 'list', marker: '-', text: trimmed.replace(/^[•●○◦▪▸►–—\-\*]\s+/, '') }
  }

  // Numbered list
  const numMatch = trimmed.match(/^(\d+)[.)、]\s*(.*)/)
  if (numMatch) {
    return { type: 'list', marker: `${numMatch[1]}.`, text: numMatch[2] }
  }

  // Code (monospace font)
  if (fonts.monoFonts.has(primaryFont)) {
    return { type: 'code', text: trimmed }
  }

  return { type: 'para', text: trimmed }
}

// ===== Smart paragraph merging =====
// Merge consecutive paragraph lines that belong to the same paragraph
function mergeBlocks(blocks) {
  const result = []

  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i]

    if (b.type === 'para' && result.length > 0) {
      const last = result[result.length - 1]
      if (last.type === 'para') {
        // Check if continuation: same indentation, no sentence-ending punctuation
        const lastEndsWithPeriod = /[.。！？!?\n]$/.test(last.text.trim())
        const currStartsCapital = /^[A-Z]/.test(b.text)
        // For CJK: merge if both are CJK text
        const lastIsCJK = /[\u4e00-\u9fff]/.test(last.text)
        const currIsCJK = /[\u4e00-\u9fff]/.test(b.text)

        if (!lastEndsWithPeriod || (lastIsCJK && currIsCJK)) {
          // Continuation — merge
          const sep = (lastIsCJK && currIsCJK) ? '' : ' '
          last.text = last.text + sep + b.text
          continue
        }
      }
    }

    result.push({ ...b })
  }

  return result
}

// ===== Table to Markdown =====
function tableToMarkdown(tableLines) {
  // Find all unique x-positions to define columns
  const allXs = []
  for (const line of tableLines) {
    for (const it of line) {
      allXs.push(Math.round(it.x / 8) * 8)
    }
  }
  const uniqueXs = [...new Set(allXs)].sort((a, b) => a - b)

  // Merge close x-positions into column boundaries
  const colBounds = [uniqueXs[0]]
  for (let i = 1; i < uniqueXs.length; i++) {
    if (uniqueXs[i] - colBounds[colBounds.length - 1] > 20) {
      colBounds.push(uniqueXs[i])
    }
  }

  const numCols = colBounds.length

  // Assign items to columns
  const rows = tableLines.map(line => {
    const cells = Array(numCols).fill('')
    for (const it of line) {
      const x = Math.round(it.x / 8) * 8
      let colIdx = 0
      let minDist = Infinity
      for (let c = 0; c < colBounds.length; c++) {
        const d = Math.abs(x - colBounds[c])
        if (d < minDist) { minDist = d; colIdx = c }
      }
      cells[colIdx] = cells[colIdx] ? cells[colIdx] + ' ' + it.str.trim() : it.str.trim()
    }
    return cells
  })

  if (rows.length === 0) return ''

  const md = []
  // Header
  md.push('| ' + rows[0].map(c => c || ' ').join(' | ') + ' |')
  md.push('| ' + rows[0].map(() => '---').join(' | ') + ' |')
  // Body
  for (let r = 1; r < rows.length; r++) {
    md.push('| ' + rows[r].map(c => c || ' ').join(' | ') + ' |')
  }
  return md.join('\n')
}

// ===== Generate Markdown =====
function generateMarkdown(blocks) {
  const md = []
  let inCode = false

  for (const b of blocks) {
    switch (b.type) {
      case 'heading':
        if (inCode) { md.push('```'); inCode = false }
        md.push('', '#'.repeat(b.level) + ' ' + b.text, '')
        break

      case 'list':
        if (inCode) { md.push('```'); inCode = false }
        md.push(`${b.marker} ${b.text}`)
        break

      case 'code':
        if (!inCode) { md.push('', '```'); inCode = true }
        md.push(b.text)
        break

      case 'table':
        if (inCode) { md.push('```'); inCode = false }
        md.push('', b.text, '')
        break

      case 'para':
        if (inCode) { md.push('```'); inCode = false }
        md.push('', b.text)
        break
    }
  }

  if (inCode) md.push('```')
  return md.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

// ===== Main export =====
export async function pdfToMarkdown(file, onProgress) {
  const { pages, numPages } = await extractRawPages(file, onProgress)
  const fonts = analyzeFonts(pages)
  const allBlocks = []

  for (const page of pages) {
    const tolerance = fonts.bodySize * 0.45
    let lines = groupIntoLines(page.items, tolerance)

    // Multi-column handling
    const cols = detectColumns(lines, page.width)
    if (cols) {
      const left = lines.filter(l => l[0].x < cols.splitX)
      const right = lines.filter(l => l[0].x >= cols.splitX)
      lines = [...left, ...right]
    }

    // Detect tables
    const tableRegions = detectTableRegions(lines)
    const tableSet = new Set()
    for (const tr of tableRegions) {
      for (let idx = tr.startIdx; idx < tr.endIdx; idx++) tableSet.add(idx)
    }

    // Classify lines
    const blocks = []
    for (let i = 0; i < lines.length; i++) {
      // Check if this line is part of a table
      const tableRegion = tableRegions.find(tr => i === tr.startIdx)
      if (tableRegion) {
        blocks.push({ type: 'table', text: tableToMarkdown(tableRegion.lines) })
        i = tableRegion.endIdx - 1
        continue
      }
      if (tableSet.has(i)) continue

      const text = lineToText(lines[i])
      if (text.trim()) {
        blocks.push(classifyLine(lines[i], text, fonts))
      }
    }

    // Merge paragraphs
    const merged = mergeBlocks(blocks)
    allBlocks.push(...merged)

    // Page separator
    if (page.pageNum < numPages) {
      allBlocks.push({ type: 'para', text: '\n---\n' })
    }
  }

  return {
    markdown: generateMarkdown(allBlocks),
    numPages,
    stats: {
      bodyFontSize: fonts.bodySize,
      headingLevels: fonts.headingSizes.length,
      hasMonoFont: fonts.monoFonts.size > 0,
    },
  }
}
