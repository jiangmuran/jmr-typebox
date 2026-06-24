// Pure, SSG-safe helpers for the Image Metadata tool. No window/document/exif-library access
// here — these operate on plain values (a parsed-tags object from exifr) so they can be
// unit-tested in node and imported anywhere. The exifr / piexifjs libraries themselves are
// lazy-imported only from the page's handlers (see MetadataPage.vue), never at module top level.

// ---- Low-level value coercion --------------------------------------------------------------

// EXIF rationals come through exifr already reduced to JS numbers, but raw piexif dicts hold
// [num, den] pairs. Accept both plus plain numbers / numeric strings → a finite number or null.
export function toDecimal(value) {
  if (value == null) return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (Array.isArray(value) && value.length === 2) {
    const [n, d] = value
    if (typeof n === 'number' && typeof d === 'number' && d !== 0) return n / d
    return null
  }
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

// Round a number to at most `places` decimals, dropping trailing zeros. Returns a string.
export function roundTo(value, places = 4) {
  const n = toDecimal(value)
  if (n == null) return null
  const f = Number(n.toFixed(places))
  return String(f)
}

// ---- GPS -----------------------------------------------------------------------------------

// Convert a [degrees, minutes, seconds] triplet (numbers OR [num,den] rationals) + a hemisphere
// ref ('N'/'S'/'E'/'W') into a signed decimal degree. Returns null on bad input.
export function dmsToDecimal(dms, ref) {
  if (!Array.isArray(dms) || dms.length < 1) return null
  const deg = toDecimal(dms[0]) || 0
  const min = toDecimal(dms[1]) || 0
  const sec = toDecimal(dms[2]) || 0
  let dec = deg + min / 60 + sec / 3600
  if (!Number.isFinite(dec)) return null
  const r = String(ref || '').trim().toUpperCase()
  if (r === 'S' || r === 'W') dec = -dec
  return dec
}

// Normalize whatever exifr / a raw dict gives us for latitude+longitude into
// { lat, lon } decimals (or null if not present). exifr's high-level parse already returns
// `latitude`/`longitude` as decimals; the raw GPS block holds DMS arrays + refs.
export function extractGps(tags) {
  if (!tags || typeof tags !== 'object') return null
  // exifr convenience fields (already signed decimals).
  let lat = toDecimal(tags.latitude)
  let lon = toDecimal(tags.longitude)
  // Fall back to raw GPS arrays if the convenience fields are absent.
  if (lat == null && tags.GPSLatitude != null) {
    lat = dmsToDecimal(tags.GPSLatitude, tags.GPSLatitudeRef)
  }
  if (lon == null && tags.GPSLongitude != null) {
    lon = dmsToDecimal(tags.GPSLongitude, tags.GPSLongitudeRef)
  }
  if (lat == null || lon == null) return null
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null
  const altitude = toDecimal(tags.GPSAltitude) ?? toDecimal(tags.altitude)
  return { lat, lon, altitude: altitude == null ? null : altitude }
}

// Build an OpenStreetMap link for a coordinate (used for the "view on map" affordance).
export function mapUrl(lat, lon) {
  const a = toDecimal(lat)
  const o = toDecimal(lon)
  if (a == null || o == null) return null
  return `https://www.openstreetmap.org/?mlat=${a}&mlon=${o}#map=15/${a}/${o}`
}

// Pretty "40.123456, -73.987654" for display.
export function formatCoord(lat, lon) {
  const a = toDecimal(lat)
  const o = toDecimal(lon)
  if (a == null || o == null) return ''
  return `${a.toFixed(6)}, ${o.toFixed(6)}`
}

// ---- Human-readable formatting of individual EXIF values -----------------------------------

const ORIENTATION_TEXT = {
  1: 'Normal',
  2: 'Mirror horizontal',
  3: 'Rotate 180°',
  4: 'Mirror vertical',
  5: 'Mirror horizontal, rotate 270° CW',
  6: 'Rotate 90° CW',
  7: 'Mirror horizontal, rotate 90° CW',
  8: 'Rotate 270° CW',
}
export function formatOrientation(value) {
  const n = toDecimal(value)
  if (n == null) return value == null ? null : String(value)
  return ORIENTATION_TEXT[n] || `Unknown (${n})`
}

// Exposure time → "1/250 s" (or "2 s" for long exposures).
export function formatExposure(value) {
  const n = toDecimal(value)
  if (n == null) return null
  if (n >= 1) return `${roundTo(n, 1)} s`
  if (n <= 0) return `${n} s`
  return `1/${Math.round(1 / n)} s`
}

// FNumber → "f/2.8".
export function formatFNumber(value) {
  const n = toDecimal(value)
  if (n == null) return null
  return `f/${roundTo(n, 1)}`
}

// FocalLength → "50 mm".
export function formatFocal(value) {
  const n = toDecimal(value)
  if (n == null) return null
  return `${roundTo(n, 1)} mm`
}

// ISO → "ISO 400".
export function formatIso(value) {
  const n = toDecimal(value)
  if (n == null) return null
  return `ISO ${Math.round(n)}`
}

// Flash: exifr often expands this to a descriptive string already; if we get the raw bitmask
// number, decode the "fired" bit honestly.
export function formatFlash(value) {
  if (value == null) return null
  if (typeof value === 'string') return value
  const n = toDecimal(value)
  if (n == null) return String(value)
  return (n & 0x1) ? 'Flash fired' : 'No flash'
}

// Stringify any leftover tag value for the raw "all tags" list: dates → ISO, arrays → joined,
// objects → JSON, primitives → String. Kept defensive so the raw list never throws.
export function stringifyValue(value) {
  if (value == null) return ''
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? String(value) : value.toISOString()
  }
  if (Array.isArray(value)) {
    return value.map((v) => stringifyValue(v)).join(', ')
  }
  if (typeof value === 'object') {
    try { return JSON.stringify(value) } catch { return String(value) }
  }
  return String(value)
}

// Turn a tag key like "DateTimeOriginal" or "FNumber" into "Date Time Original" / "F Number".
export function humanizeKey(key) {
  return String(key)
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
}

// ---- Date/time -----------------------------------------------------------------------------

// Display a date/time tag (Date instance or EXIF "YYYY:MM:DD HH:MM:SS" string) as a clean string.
export function formatDateValue(value) {
  if (value == null) return null
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null
    return value.toLocaleString(undefined, {
      year: 'numeric', month: 'short', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    })
  }
  const s = String(value).trim()
  // EXIF stores "2023:08:15 14:32:01" — convert the date part's colons to dashes for readability.
  const m = s.match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)/)
  if (m) return `${m[1]}-${m[2]}-${m[3]} ${m[4]}`
  return s
}

// ---- Grouping into the display model -------------------------------------------------------

// Field descriptors per section: [tagKey, label, formatterFn?]. The formatter receives the raw
// value and returns a display string (or null to skip). Order here is the display order.
const SECTION_DEFS = [
  {
    id: 'image', titleKey: 'img2.meta.secImage', fields: [
      ['ImageWidth', 'Width', (v) => { const n = toDecimal(v); return n == null ? null : `${Math.round(n)} px` }],
      ['ImageHeight', 'Height', (v) => { const n = toDecimal(v); return n == null ? null : `${Math.round(n)} px` }],
      ['Orientation', 'Orientation', formatOrientation],
      ['BitDepth', 'Bit depth', null],
      ['BitsPerSample', 'Bits per sample', null],
      ['ColorType', 'Color type', null],
      ['ColorSpace', 'Color space', null],
      ['Compression', 'Compression', null],
      ['ResolutionUnit', 'Resolution unit', null],
      ['XResolution', 'X resolution', (v) => { const n = toDecimal(v); return n == null ? null : roundTo(n, 1) }],
      ['YResolution', 'Y resolution', (v) => { const n = toDecimal(v); return n == null ? null : roundTo(n, 1) }],
    ],
  },
  {
    id: 'camera', titleKey: 'img2.meta.secCamera', fields: [
      ['Make', 'Make', null],
      ['Model', 'Model', null],
      ['LensMake', 'Lens make', null],
      ['LensModel', 'Lens model', null],
      ['LensInfo', 'Lens info', null],
      ['Software', 'Software', null],
    ],
  },
  {
    id: 'exposure', titleKey: 'img2.meta.secExposure', fields: [
      ['ISO', 'ISO', formatIso],
      ['FNumber', 'Aperture', formatFNumber],
      ['ApertureValue', 'Aperture value', (v) => { const n = toDecimal(v); return n == null ? null : roundTo(n, 2) }],
      ['ExposureTime', 'Shutter speed', formatExposure],
      ['ShutterSpeedValue', 'Shutter speed value', (v) => { const n = toDecimal(v); return n == null ? null : roundTo(n, 2) }],
      ['FocalLength', 'Focal length', formatFocal],
      ['FocalLengthIn35mmFormat', 'Focal length (35mm)', formatFocal],
      ['ExposureCompensation', 'Exposure compensation', (v) => { const n = toDecimal(v); return n == null ? null : `${n > 0 ? '+' : ''}${roundTo(n, 2)} EV` }],
      ['ExposureProgram', 'Exposure program', null],
      ['MeteringMode', 'Metering mode', null],
      ['WhiteBalance', 'White balance', null],
      ['Flash', 'Flash', formatFlash],
    ],
  },
  {
    id: 'datetime', titleKey: 'img2.meta.secDate', fields: [
      ['DateTimeOriginal', 'Taken', formatDateValue],
      ['CreateDate', 'Created', formatDateValue],
      ['ModifyDate', 'Modified', formatDateValue],
      ['OffsetTime', 'Time zone', null],
    ],
  },
  {
    id: 'authorship', titleKey: 'img2.meta.secAuthor', fields: [
      ['ImageDescription', 'Description', null],
      ['Artist', 'Artist', null],
      ['Copyright', 'Copyright', null],
      ['XPAuthor', 'Author (XP)', stringifyValue],
      ['XPComment', 'Comment (XP)', stringifyValue],
      ['UserComment', 'User comment', stringifyValue],
      // Common IPTC / XMP equivalents.
      ['Creator', 'Creator', stringifyValue],
      ['By-line', 'By-line', stringifyValue],
      ['Caption-Abstract', 'Caption', stringifyValue],
      ['CopyrightNotice', 'Copyright notice', stringifyValue],
      ['Rights', 'Rights', stringifyValue],
      ['ObjectName', 'Title', stringifyValue],
      ['Headline', 'Headline', stringifyValue],
      ['Keywords', 'Keywords', stringifyValue],
    ],
  },
]

// Keys consumed by the structured sections above OR surfaced specially (GPS / dimensions) so
// they aren't duplicated in the raw "everything else" list.
const HANDLED_KEYS = new Set([
  // GPS (shown in its own prominent section).
  'latitude', 'longitude', 'GPSLatitude', 'GPSLatitudeRef', 'GPSLongitude', 'GPSLongitudeRef',
  'GPSAltitude', 'GPSAltitudeRef', 'altitude', 'GPSDateStamp', 'GPSTimeStamp', 'GPSVersionID',
  'GPSProcessingMethod', 'GPSMapDatum', 'GPSSpeed', 'GPSImgDirection', 'GPSImgDirectionRef',
])
for (const sec of SECTION_DEFS) for (const [key] of sec.fields) HANDLED_KEYS.add(key)

// Build the full display model from a parsed-tags object (exifr output). Returns:
//   { sections: [{ id, titleKey, rows: [{label, value}] }], gps, raw: [{key, label, value}], hasAny }
// `dimensions` (from the decoded <img>, when exifr didn't carry width/height) can be merged in.
export function buildMetadataModel(tags, dimensions) {
  const t = (tags && typeof tags === 'object') ? { ...tags } : {}

  // Did the file actually carry any EMBEDDED metadata (before we backfill intrinsic pixel size)?
  // Width/height from the decoded <img> aren't "metadata", so they must not flip the empty state.
  const embeddedKeys = Object.keys(t).filter((k) => t[k] != null && t[k] !== '')
  const hasEmbedded = embeddedKeys.length > 0

  // Backfill pixel dimensions from the decoded image if EXIF lacked them.
  if (dimensions) {
    if (t.ImageWidth == null && t.ExifImageWidth == null && dimensions.width) t.ImageWidth = dimensions.width
    if (t.ImageHeight == null && t.ExifImageHeight == null && dimensions.height) t.ImageHeight = dimensions.height
  }
  // exifr sometimes exposes pixel size only as ExifImageWidth/Height.
  if (t.ImageWidth == null && t.ExifImageWidth != null) t.ImageWidth = t.ExifImageWidth
  if (t.ImageHeight == null && t.ExifImageHeight != null) t.ImageHeight = t.ExifImageHeight

  const sections = []
  for (const def of SECTION_DEFS) {
    const rows = []
    for (const [key, label, fmt] of def.fields) {
      if (!(key in t) || t[key] == null || t[key] === '') continue
      const value = fmt ? fmt(t[key]) : stringifyValue(t[key])
      if (value == null || value === '') continue
      rows.push({ key, label, value })
    }
    if (rows.length) sections.push({ id: def.id, titleKey: def.titleKey, rows })
  }

  const gps = extractGps(t)

  // Everything not already surfaced → raw list (sorted, humanized labels).
  const raw = []
  for (const key of Object.keys(t)) {
    if (HANDLED_KEYS.has(key)) continue
    if (key === 'ExifImageWidth' || key === 'ExifImageHeight') continue
    const value = stringifyValue(t[key])
    if (value === '') continue
    raw.push({ key, label: humanizeKey(key), value })
  }
  raw.sort((a, b) => a.label.localeCompare(b.label))

  const hasAny = sections.length > 0 || !!gps || raw.length > 0
  return { sections, gps, raw, hasAny, hasEmbedded }
}

// ---- Edit model ----------------------------------------------------------------------------

// The fields we let the user EDIT for JPEG (mapped to piexif dicts). `block` selects which
// IFD the value lands in; 'gps' is handled specially (coordinate pair). Order = form order.
export const EDITABLE_FIELDS = [
  { id: 'ImageDescription', block: '0th', tag: 'ImageDescription', labelKey: 'img2.meta.fDescription', type: 'text' },
  { id: 'Artist', block: '0th', tag: 'Artist', labelKey: 'img2.meta.fArtist', type: 'text' },
  { id: 'Copyright', block: '0th', tag: 'Copyright', labelKey: 'img2.meta.fCopyright', type: 'text' },
  { id: 'Make', block: '0th', tag: 'Make', labelKey: 'img2.meta.fMake', type: 'text' },
  { id: 'Model', block: '0th', tag: 'Model', labelKey: 'img2.meta.fModel', type: 'text' },
  { id: 'Software', block: '0th', tag: 'Software', labelKey: 'img2.meta.fSoftware', type: 'text' },
  { id: 'DateTimeOriginal', block: 'Exif', tag: 'DateTimeOriginal', labelKey: 'img2.meta.fDate', type: 'datetime' },
]

// Read current editable values out of a parsed-tags object so the form can prefill. GPS comes
// back as decimals (or empty strings). Pure — no library use.
export function readEditableValues(tags) {
  const t = (tags && typeof tags === 'object') ? tags : {}
  const out = {}
  for (const f of EDITABLE_FIELDS) {
    if (f.type === 'datetime') {
      out[f.id] = exifDateToInput(t[f.id])
    } else {
      out[f.id] = t[f.id] == null ? '' : stringifyValue(t[f.id])
    }
  }
  const gps = extractGps(t)
  out.gpsLat = gps ? String(roundTo(gps.lat, 6)) : ''
  out.gpsLon = gps ? String(roundTo(gps.lon, 6)) : ''
  return out
}

// EXIF datetime string / Date → value for an <input type="datetime-local"> ("YYYY-MM-DDTHH:MM:SS").
export function exifDateToInput(value) {
  if (value == null || value === '') return ''
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return ''
    const p = (n) => String(n).padStart(2, '0')
    return `${value.getFullYear()}-${p(value.getMonth() + 1)}-${p(value.getDate())}T${p(value.getHours())}:${p(value.getMinutes())}:${p(value.getSeconds())}`
  }
  const s = String(value).trim()
  const m = s.match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/)
  if (m) return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] || '00'}`
  // Already ISO-ish?
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}T${iso[4]}:${iso[5]}:${iso[6] || '00'}`
  return ''
}

// <input type="datetime-local"> value → EXIF "YYYY:MM:DD HH:MM:SS". Empty in → empty out.
export function inputDateToExif(value) {
  if (!value) return ''
  const m = String(value).match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/)
  if (!m) return ''
  return `${m[1]}:${m[2]}:${m[3]} ${m[4]}:${m[5]}:${m[6] || '00'}`
}

// Validate a decimal-degree text input. Returns a number in range or null.
export function parseLatLon(value, kind) {
  if (value == null || String(value).trim() === '') return null
  const n = Number(value)
  if (!Number.isFinite(n)) return null
  if (kind === 'lat' && (n < -90 || n > 90)) return null
  if (kind === 'lon' && (n < -180 || n > 180)) return null
  return n
}
