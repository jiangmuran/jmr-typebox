// Browser-only metadata read / write / strip for the Image Metadata tool.
//
// SSG-safety: this module has NO top-level side effects and does NOT import exifr/piexifjs at
// module scope — both heavy libs are pulled in via dynamic import() the first time they're
// actually needed (i.e. only after the user opens a file), so the home page / prerender stay
// light. The functions here touch FileReader/Blob, but only when invoked from handlers.

import { mimeForFormat } from './imageHelpers'
import { drawToCanvas, canvasToBlob, loadImageFromBlob } from './canvasUtils'

let _exifr = null
let _piexif = null

// Lazy singletons. exifr's full build reads EXIF/GPS/IPTC/XMP; piexifjs writes JPEG EXIF.
async function getExifr() {
  if (!_exifr) {
    const mod = await import('exifr')
    _exifr = mod.default || mod
  }
  return _exifr
}
async function getPiexif() {
  if (!_piexif) {
    const mod = await import('piexifjs')
    _piexif = mod.default || mod
  }
  return _piexif
}

// True for JPEG inputs (the only format piexifjs can losslessly read+write EXIF for).
export function isJpeg(file) {
  const type = (file?.type || '').toLowerCase()
  if (type) return type === 'image/jpeg' || type === 'image/jpg'
  return /\.jpe?g$/i.test(file?.name || '')
}

// PNG inputs carry tEXt/iTXt/zTXt chunks + an IHDR; exifr reads them but we can't rewrite them.
export function isPng(file) {
  const type = (file?.type || '').toLowerCase()
  if (type) return type === 'image/png'
  return /\.png$/i.test(file?.name || '')
}

// Read ALL metadata from a File via exifr. Returns a flat tags object (may be {} when none).
// We request every block exifr supports; `mergeOutput` flattens IFDs into one object, and the
// GPS convenience fields (latitude/longitude) are added so the helpers can show coordinates.
export async function readAllMetadata(file) {
  const exifr = await getExifr()
  let tags = {}
  try {
    tags = await exifr.parse(file, {
      // Blocks
      tiff: true, ifd0: true, exif: true, gps: true, interop: true,
      iptc: true, xmp: true, jfif: true, ihdr: true, icc: false,
      // Output shape
      mergeOutput: true,
      translateKeys: true,
      translateValues: true,
      reviveValues: true,
      sanitize: true,
      // Make sure we don't silently drop unknown maker tags.
      makerNote: false, userComment: true,
    }) || {}
  } catch {
    tags = {}
  }
  // Belt-and-braces: exifr.gps() is the most reliable way to get signed decimals.
  if (tags.latitude == null || tags.longitude == null) {
    try {
      const g = await exifr.gps(file)
      if (g && typeof g.latitude === 'number') {
        tags.latitude = g.latitude
        tags.longitude = g.longitude
      }
    } catch { /* ignore */ }
  }
  return tags
}

// Read a File as a binary data URL (needed by piexifjs, which works on data-URL strings).
function fileToDataURL(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result)
    r.onerror = () => reject(r.error || new Error('read-failed'))
    r.readAsDataURL(file)
  })
}

// Convert a data URL back into a Blob for download / clipboard.
export function dataUrlToBlob(dataUrl) {
  const [head, body] = String(dataUrl).split(',')
  const mime = (head.match(/data:([^;]+)/) || [])[1] || 'application/octet-stream'
  const isBase64 = /;base64/i.test(head)
  const binary = isBase64 ? atob(body) : decodeURIComponent(body)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new Blob([bytes], { type: mime })
}

// Write edited fields into a JPEG via piexifjs and return a new Blob (image/jpeg).
//   edits: { ImageDescription, Artist, Copyright, Make, Model, Software, DateTimeOriginal,
//            gpsLat, gpsLon }  (strings; empty string = clear that tag)
// Only JPEG is supported for writing — callers must gate on isJpeg().
export async function writeJpegMetadata(file, edits) {
  const piexif = await getPiexif()
  const dataUrl = await fileToDataURL(file)

  // Start from the existing EXIF so untouched tags survive.
  let exifObj
  try {
    exifObj = piexif.load(dataUrl)
  } catch {
    exifObj = { '0th': {}, Exif: {}, GPS: {}, Interop: {}, '1st': {}, thumbnail: null }
  }
  exifObj['0th'] = exifObj['0th'] || {}
  exifObj.Exif = exifObj.Exif || {}
  exifObj.GPS = exifObj.GPS || {}

  const I = piexif.ImageIFD
  const E = piexif.ExifIFD
  const G = piexif.GPSIFD

  // Helper: set or delete a string tag in a given dict.
  const setStr = (dict, tag, value) => {
    if (value == null || value === '') delete dict[tag]
    else dict[tag] = String(value)
  }

  setStr(exifObj['0th'], I.ImageDescription, edits.ImageDescription)
  setStr(exifObj['0th'], I.Artist, edits.Artist)
  setStr(exifObj['0th'], I.Copyright, edits.Copyright)
  setStr(exifObj['0th'], I.Make, edits.Make)
  setStr(exifObj['0th'], I.Model, edits.Model)
  setStr(exifObj['0th'], I.Software, edits.Software)
  setStr(exifObj.Exif, E.DateTimeOriginal, edits.DateTimeOriginal)

  // GPS: write the coordinate pair (DMS rationals + hemisphere refs) or clear it entirely.
  applyGps(piexif, exifObj.GPS, edits.gpsLat, edits.gpsLon)

  const exifBytes = piexif.dump(exifObj)
  const newDataUrl = piexif.insert(exifBytes, dataUrl)
  return dataUrlToBlob(newDataUrl)
}

// Set or clear the GPS block. lat/lon are decimal-degree strings; both empty → remove GPS.
function applyGps(piexif, gpsDict, latStr, lonStr) {
  const G = piexif.GPSIFD
  const lat = latStr === '' || latStr == null ? null : Number(latStr)
  const lon = lonStr === '' || lonStr == null ? null : Number(lonStr)
  // Clear the coordinate tags first so a partial edit can't leave a stale half.
  for (const tag of [G.GPSLatitude, G.GPSLatitudeRef, G.GPSLongitude, G.GPSLongitudeRef]) {
    delete gpsDict[tag]
  }
  if (lat == null || lon == null || !Number.isFinite(lat) || !Number.isFinite(lon)) return
  gpsDict[G.GPSLatitudeRef] = lat < 0 ? 'S' : 'N'
  gpsDict[G.GPSLatitude] = piexif.GPSHelper.degToDmsRational(Math.abs(lat))
  gpsDict[G.GPSLongitudeRef] = lon < 0 ? 'W' : 'E'
  gpsDict[G.GPSLongitude] = piexif.GPSHelper.degToDmsRational(Math.abs(lon))
}

// Remove ALL EXIF/GPS/etc. for privacy.
//   • JPEG  → piexif.remove() (surgical: strips the APP1/EXIF segment, keeps pixels untouched).
//   • other → re-encode through a canvas, which inherently drops every metadata block.
// Returns { blob, mime } of the cleaned image (PNG-cleaning yields PNG; JPEG stays JPEG).
export async function removeAllMetadata(file) {
  if (isJpeg(file)) {
    const piexif = await getPiexif()
    const dataUrl = await fileToDataURL(file)
    let cleaned = dataUrl
    try {
      cleaned = piexif.remove(dataUrl)
    } catch {
      // Some JPEGs without an APP1 segment make piexif.remove throw — they're already clean.
      cleaned = dataUrl
    }
    return { blob: dataUrlToBlob(cleaned), mime: 'image/jpeg' }
  }
  // Canvas re-encode path (PNG / WebP / GIF → same family where possible, else PNG).
  const img = await loadImageFromBlob(file)
  const format = formatFromFile(file)
  const mime = mimeForFormat(format)
  const bg = format === 'jpg' ? '#ffffff' : undefined
  const canvas = drawToCanvas(img, img.naturalWidth, img.naturalHeight, { background: bg })
  let blob = await canvasToBlob(canvas, mime, format === 'png' ? undefined : 0.92)
  if (!blob) {
    // Fallback to PNG if the browser can't encode the source mime.
    blob = await canvasToBlob(canvas, 'image/png')
    return { blob, mime: 'image/png' }
  }
  return { blob, mime: blob.type || mime }
}

// Pick a short format token from a file's mime/extension for the re-encode path.
function formatFromFile(file) {
  const type = (file?.type || '').toLowerCase()
  if (type.includes('png')) return 'png'
  if (type.includes('webp')) return 'webp'
  if (type.includes('jpeg') || type.includes('jpg')) return 'jpg'
  if (type.includes('gif')) return 'png' // GIF can't be canvas-encoded; PNG keeps the first frame losslessly
  const name = (file?.name || '').toLowerCase()
  if (name.endsWith('.png')) return 'png'
  if (name.endsWith('.webp')) return 'webp'
  if (name.endsWith('.jpg') || name.endsWith('.jpeg')) return 'jpg'
  return 'png'
}
