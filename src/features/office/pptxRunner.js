// Lazy JSZip-based .pptx (OOXML) parser → a best-effort, positioned preview model. Rendering pptx
// faithfully is genuinely hard (it's a full vector layout format); this maps the common building
// blocks — text boxes and pictures — to percentage-positioned HTML boxes, and ALWAYS keeps the raw
// paragraph text so a slide that can't be laid out still shows its content instead of failing.
//
// SSG-safe: `jszip` is dynamically imported at call time only; nothing here runs at module eval.

import {
  extractSlideParagraphs, parseXfrm, xfrmToBox, parseSlideSize, sortSlidePaths,
  decodeXmlEntities, slidePlainText, DEFAULT_SLIDE_W, DEFAULT_SLIDE_H,
} from './officeHelpers'

let _zip = null
async function zipLib() {
  if (!_zip) _zip = (await import('jszip')).default
  return _zip
}

// Parse a .pptx File/Blob/ArrayBuffer into:
//   {
//     slideW, slideH,              // EMU dimensions (drives the preview aspect ratio)
//     slides: [{ index, paragraphs: string[], text, shapes: [...] }]
//   }
// A shape is either:
//   { type:'text', box:{leftPct,topPct,widthPct,heightPct}, paragraphs: [{ runs:[{text,bold,italic}], align }] }
//   { type:'image', box:{...}, src:'data:...' }
export async function parsePptx(input) {
  const JSZip = await zipLib()
  const data = await toUint8(input)
  const zip = await JSZip.loadAsync(data)

  // Slide dimensions.
  let slideW = DEFAULT_SLIDE_W, slideH = DEFAULT_SLIDE_H
  const presFile = zip.file('ppt/presentation.xml')
  if (presFile) {
    const sz = parseSlideSize(await presFile.async('string'))
    slideW = sz.cx; slideH = sz.cy
  }

  // Ordered slide parts.
  const slidePaths = sortSlidePaths(Object.keys(zip.files))
  const slides = []
  for (let i = 0; i < slidePaths.length; i++) {
    const path = slidePaths[i]
    const xml = await zip.file(path).async('string')
    const paragraphs = extractSlideParagraphs(xml)
    let shapes = []
    try {
      const rels = await loadSlideRels(zip, path)
      shapes = await buildShapes(zip, xml, rels, slideW, slideH)
    } catch {
      shapes = [] // fall back to the text-only render below
    }
    slides.push({
      index: i + 1,
      paragraphs,
      text: slidePlainText(xml),
      shapes,
    })
  }

  return { slideW, slideH, slides }
}

// Resolve the slide's relationship map (rId -> target path) for image lookups.
async function loadSlideRels(zip, slidePath) {
  // ppt/slides/slideN.xml -> ppt/slides/_rels/slideN.xml.rels
  const relsPath = slidePath.replace(/(^|\/)([^/]+)$/, '$1_rels/$2.rels')
  const relsFile = zip.file(relsPath)
  const map = {}
  if (!relsFile) return map
  const xml = await relsFile.async('string')
  const re = /<Relationship\b[^>]*\bId="([^"]+)"[^>]*\bTarget="([^"]+)"/g
  let m
  while ((m = re.exec(xml)) !== null) {
    map[m[1]] = resolveRelTarget(slidePath, decodeXmlEntities(m[2]))
  }
  return map
}

// Targets in rels are relative to the part's folder (e.g. "../media/image1.png").
function resolveRelTarget(slidePath, target) {
  if (/^https?:|^data:/i.test(target)) return target
  const baseDir = slidePath.replace(/\/[^/]*$/, '') // ppt/slides
  const parts = (baseDir + '/' + target).split('/')
  const stack = []
  for (const p of parts) {
    if (p === '..') stack.pop()
    else if (p !== '.' && p !== '') stack.push(p)
  }
  return stack.join('/')
}

// Walk the slide's shape tree, emitting positioned text + image boxes.
async function buildShapes(zip, xml, rels, slideW, slideH) {
  const shapes = []
  // Each top-level <p:sp> (shape, usually a text box) and <p:pic> (picture).
  for (const block of matchBlocks(xml, 'p:sp')) {
    const xfrm = parseXfrm(block)
    const paras = parseTextBody(block)
    if (!paras.some(p => p.runs.some(r => r.text.trim()))) continue
    shapes.push({
      type: 'text',
      box: xfrm ? xfrmToBox(xfrm, slideW, slideH) : null,
      paragraphs: paras,
    })
  }
  for (const block of matchBlocks(xml, 'p:pic')) {
    const xfrm = parseXfrm(block)
    const embed = block.match(/r:embed="([^"]+)"/)
    if (!embed) continue
    const target = rels[embed[1]]
    if (!target) continue
    const file = zip.file(target)
    if (!file) continue
    try {
      const b64 = await file.async('base64')
      const mime = mimeForImage(target)
      shapes.push({
        type: 'image',
        box: xfrm ? xfrmToBox(xfrm, slideW, slideH) : null,
        src: `data:${mime};base64,${b64}`,
      })
    } catch { /* skip unreadable image */ }
  }
  return shapes
}

// Return the inner+outer XML of every top-level <tag ...>...</tag> at any depth (non-nested same-tag
// handling is good enough for sp/pic which don't nest within themselves at slide level).
function matchBlocks(xml, tag) {
  const out = []
  const re = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?</${tag}>`, 'g')
  let m
  while ((m = re.exec(xml)) !== null) out.push(m[0])
  return out
}

// Parse a shape's <p:txBody> into paragraphs of styled runs.
// Returns [{ runs:[{text,bold,italic}], align:'l'|'ctr'|'r'|'just' }].
function parseTextBody(spXml) {
  const bodyMatch = spXml.match(/<p:txBody\b[^>]*>([\s\S]*?)<\/p:txBody>/)
  const body = bodyMatch ? bodyMatch[1] : ''
  const paras = []
  const pRe = /<a:p\b[^>]*>([\s\S]*?)<\/a:p>/g
  let pm
  while ((pm = pRe.exec(body)) !== null) {
    const pBody = pm[1]
    const align = (pBody.match(/<a:pPr\b[^>]*\balgn="([^"]+)"/) || [])[1] || 'l'
    const runs = []
    const rRe = /<a:r\b[^>]*>([\s\S]*?)<\/a:r>/g
    let rm
    while ((rm = rRe.exec(pBody)) !== null) {
      const rBody = rm[1]
      const rPr = (rBody.match(/<a:rPr\b[^>]*>/) || rBody.match(/<a:rPr\b[^>]*\/>/) || [''])[0]
      const t = (rBody.match(/<a:t\b[^>]*>([\s\S]*?)<\/a:t>/) || [])[1]
      if (t == null) continue
      runs.push({
        text: decodeXmlEntities(t),
        bold: /\bb="1"/.test(rPr),
        italic: /\bi="1"/.test(rPr),
      })
    }
    // Honor explicit line breaks as empty runs joined later by the renderer.
    if (runs.length || /<a:br\b/.test(pBody)) paras.push({ runs, align })
  }
  return paras
}

function mimeForImage(path) {
  const ext = String(path).toLowerCase().match(/\.([a-z0-9]+)$/)?.[1]
  switch (ext) {
    case 'png': return 'image/png'
    case 'jpg': case 'jpeg': return 'image/jpeg'
    case 'gif': return 'image/gif'
    case 'bmp': return 'image/bmp'
    case 'svg': return 'image/svg+xml'
    case 'webp': return 'image/webp'
    case 'emf': case 'wmf': return 'image/x-emf' // browsers can't render these; alt text will show
    default: return 'application/octet-stream'
  }
}

async function toUint8(input) {
  if (input instanceof Uint8Array) return input
  if (input instanceof ArrayBuffer) return new Uint8Array(input)
  if (typeof input?.arrayBuffer === 'function') return new Uint8Array(await input.arrayBuffer())
  throw new Error('Unsupported input for parsePptx')
}
