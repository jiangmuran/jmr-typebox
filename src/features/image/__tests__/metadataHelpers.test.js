import { describe, it, expect } from 'vitest'
import {
  toDecimal, roundTo, dmsToDecimal, extractGps, mapUrl, formatCoord,
  formatOrientation, formatExposure, formatFNumber, formatFocal, formatIso, formatFlash,
  stringifyValue, humanizeKey, formatDateValue,
  buildMetadataModel, EDITABLE_FIELDS, readEditableValues,
  exifDateToInput, inputDateToExif, parseLatLon,
} from '../metadataHelpers'

describe('toDecimal', () => {
  it('passes through finite numbers and rejects junk', () => {
    expect(toDecimal(3.5)).toBe(3.5)
    expect(toDecimal(0)).toBe(0)
    expect(toDecimal(NaN)).toBe(null)
    expect(toDecimal(Infinity)).toBe(null)
    expect(toDecimal(null)).toBe(null)
    expect(toDecimal(undefined)).toBe(null)
  })
  it('reduces [num, den] rationals to a decimal', () => {
    expect(toDecimal([1, 250])).toBeCloseTo(0.004)
    expect(toDecimal([28, 10])).toBe(2.8)
    expect(toDecimal([5, 0])).toBe(null) // divide-by-zero guarded
  })
  it('parses numeric strings', () => {
    expect(toDecimal('42')).toBe(42)
    expect(toDecimal('abc')).toBe(null)
  })
})

describe('roundTo', () => {
  it('rounds and trims trailing zeros', () => {
    expect(roundTo(2.80000, 2)).toBe('2.8')
    expect(roundTo(40.123456, 4)).toBe('40.1235')
    expect(roundTo(50, 1)).toBe('50')
    expect(roundTo(null)).toBe(null)
  })
})

describe('dmsToDecimal', () => {
  it('converts degrees/minutes/seconds + ref to a signed decimal', () => {
    // 40° 26' 46" N ≈ 40.4461
    expect(dmsToDecimal([40, 26, 46], 'N')).toBeCloseTo(40.4461, 3)
    // West and South are negative.
    expect(dmsToDecimal([73, 58, 56], 'W')).toBeCloseTo(-73.9822, 3)
    expect(dmsToDecimal([33, 52, 4], 'S')).toBeCloseTo(-33.8678, 3)
  })
  it('accepts rational triplets', () => {
    expect(dmsToDecimal([[40, 1], [30, 1], [0, 1]], 'N')).toBeCloseTo(40.5, 5)
  })
  it('returns null for bad input', () => {
    expect(dmsToDecimal(null, 'N')).toBe(null)
    expect(dmsToDecimal([], 'N')).toBe(null) // empty array → no usable degrees
    expect(dmsToDecimal('nope', 'N')).toBe(null)
  })
})

describe('extractGps', () => {
  it('prefers exifr convenience decimals', () => {
    const g = extractGps({ latitude: 48.8584, longitude: 2.2945 })
    expect(g.lat).toBeCloseTo(48.8584)
    expect(g.lon).toBeCloseTo(2.2945)
  })
  it('falls back to raw DMS arrays + refs', () => {
    const g = extractGps({
      GPSLatitude: [40, 26, 46], GPSLatitudeRef: 'N',
      GPSLongitude: [73, 58, 56], GPSLongitudeRef: 'W',
    })
    expect(g.lat).toBeCloseTo(40.4461, 3)
    expect(g.lon).toBeCloseTo(-73.9822, 3)
  })
  it('returns null when no coords present or out of range', () => {
    expect(extractGps({})).toBe(null)
    expect(extractGps(null)).toBe(null)
    expect(extractGps({ latitude: 999, longitude: 0 })).toBe(null)
  })
  it('carries altitude when present', () => {
    const g = extractGps({ latitude: 1, longitude: 2, GPSAltitude: 120.5 })
    expect(g.altitude).toBe(120.5)
  })
})

describe('mapUrl / formatCoord', () => {
  it('builds an OSM url', () => {
    expect(mapUrl(40.5, -73.9)).toContain('openstreetmap.org')
    expect(mapUrl(40.5, -73.9)).toContain('mlat=40.5')
    expect(mapUrl(40.5, -73.9)).toContain('mlon=-73.9')
    expect(mapUrl(null, 1)).toBe(null)
  })
  it('formats a coordinate pair to 6 dp', () => {
    expect(formatCoord(40.123456789, -73.9)).toBe('40.123457, -73.900000')
    expect(formatCoord(null, 1)).toBe('')
  })
})

describe('value formatters', () => {
  it('formatOrientation maps codes to words', () => {
    expect(formatOrientation(1)).toBe('Normal')
    expect(formatOrientation(6)).toBe('Rotate 90° CW')
    expect(formatOrientation(99)).toContain('Unknown')
    expect(formatOrientation(null)).toBe(null)
  })
  it('formatExposure handles fractional + long shutter', () => {
    expect(formatExposure(0.004)).toBe('1/250 s')
    expect(formatExposure([1, 250])).toBe('1/250 s')
    expect(formatExposure(2)).toBe('2 s')
    expect(formatExposure(null)).toBe(null)
  })
  it('formatFNumber / formatFocal / formatIso', () => {
    expect(formatFNumber(2.8)).toBe('f/2.8')
    expect(formatFNumber([28, 10])).toBe('f/2.8')
    expect(formatFocal(50)).toBe('50 mm')
    expect(formatIso(400)).toBe('ISO 400')
    expect(formatIso(null)).toBe(null)
  })
  it('formatFlash decodes the fired bit and passes strings through', () => {
    expect(formatFlash('Flash did not fire')).toBe('Flash did not fire')
    expect(formatFlash(1)).toBe('Flash fired')
    expect(formatFlash(0)).toBe('No flash')
    expect(formatFlash(null)).toBe(null)
  })
})

describe('stringifyValue', () => {
  it('handles dates, arrays, objects, primitives', () => {
    expect(stringifyValue(new Date('2023-08-15T10:00:00Z'))).toBe('2023-08-15T10:00:00.000Z')
    expect(stringifyValue([1, 2, 3])).toBe('1, 2, 3')
    expect(stringifyValue({ a: 1 })).toBe('{"a":1}')
    expect(stringifyValue('hi')).toBe('hi')
    expect(stringifyValue(42)).toBe('42')
    expect(stringifyValue(null)).toBe('')
  })
})

describe('humanizeKey', () => {
  it('splits camelCase + acronyms', () => {
    expect(humanizeKey('DateTimeOriginal')).toBe('Date Time Original')
    expect(humanizeKey('FNumber')).toBe('F Number')
    expect(humanizeKey('GPSLatitude')).toBe('GPS Latitude')
    expect(humanizeKey('Caption-Abstract')).toBe('Caption Abstract')
  })
})

describe('formatDateValue', () => {
  it('reformats EXIF date strings', () => {
    expect(formatDateValue('2023:08:15 14:32:01')).toBe('2023-08-15 14:32:01')
    expect(formatDateValue(null)).toBe(null)
  })
})

describe('buildMetadataModel', () => {
  const sample = {
    Make: 'Canon', Model: 'EOS 5D', Software: 'Lightroom',
    ISO: 400, FNumber: 2.8, ExposureTime: 0.004, FocalLength: 50,
    DateTimeOriginal: '2023:08:15 14:32:01',
    Artist: 'Jane Doe', Copyright: '© 2023', ImageDescription: 'A test photo',
    Orientation: 6,
    latitude: 48.8584, longitude: 2.2945, GPSAltitude: 35,
    ExifImageWidth: 6000, ExifImageHeight: 4000,
    SomeWeirdMakerTag: 'xyz',
  }

  it('groups known tags into sections in order', () => {
    const model = buildMetadataModel(sample)
    const ids = model.sections.map((s) => s.id)
    expect(ids).toContain('camera')
    expect(ids).toContain('exposure')
    expect(ids).toContain('datetime')
    expect(ids).toContain('authorship')
    // camera precedes exposure precedes datetime (display order preserved).
    expect(ids.indexOf('camera')).toBeLessThan(ids.indexOf('exposure'))
    expect(ids.indexOf('exposure')).toBeLessThan(ids.indexOf('datetime'))
  })

  it('formats values via the per-field formatters', () => {
    const model = buildMetadataModel(sample)
    const exposure = model.sections.find((s) => s.id === 'exposure')
    const byLabel = Object.fromEntries(exposure.rows.map((r) => [r.label, r.value]))
    expect(byLabel['ISO']).toBe('ISO 400')
    expect(byLabel['Aperture']).toBe('f/2.8')
    expect(byLabel['Shutter speed']).toBe('1/250 s')
    expect(byLabel['Focal length']).toBe('50 mm')
    const image = model.sections.find((s) => s.id === 'image')
    const imgByLabel = Object.fromEntries(image.rows.map((r) => [r.label, r.value]))
    expect(imgByLabel['Orientation']).toBe('Rotate 90° CW')
    expect(imgByLabel['Width']).toBe('6000 px')
    expect(imgByLabel['Height']).toBe('4000 px')
  })

  it('extracts GPS into its own slot, not the raw list', () => {
    const model = buildMetadataModel(sample)
    expect(model.gps.lat).toBeCloseTo(48.8584)
    expect(model.gps.lon).toBeCloseTo(2.2945)
    expect(model.gps.altitude).toBe(35)
    // GPS keys must not leak into raw.
    expect(model.raw.some((r) => /lat|lon|gps/i.test(r.key))).toBe(false)
  })

  it('puts unknown tags in a sorted raw list with humanized labels', () => {
    const model = buildMetadataModel(sample)
    const weird = model.raw.find((r) => r.key === 'SomeWeirdMakerTag')
    expect(weird).toBeTruthy()
    expect(weird.label).toBe('Some Weird Maker Tag')
    expect(weird.value).toBe('xyz')
    // Handled keys (Make/Model/etc.) must not appear in raw.
    expect(model.raw.some((r) => r.key === 'Make')).toBe(false)
    expect(model.raw.some((r) => r.key === 'ISO')).toBe(false)
  })

  it('backfills dimensions from the decoded image', () => {
    const model = buildMetadataModel({ Make: 'X' }, { width: 1920, height: 1080 })
    const image = model.sections.find((s) => s.id === 'image')
    const imgByLabel = Object.fromEntries(image.rows.map((r) => [r.label, r.value]))
    expect(imgByLabel['Width']).toBe('1920 px')
    expect(imgByLabel['Height']).toBe('1080 px')
  })

  it('reports empty cleanly', () => {
    const model = buildMetadataModel({})
    expect(model.hasAny).toBe(false)
    expect(model.hasEmbedded).toBe(false)
    expect(model.sections).toEqual([])
    expect(model.gps).toBe(null)
    expect(model.raw).toEqual([])
  })

  it('treats backfilled dimensions as NOT embedded metadata (clean empty state)', () => {
    // A metadata-less image: only the decoded pixel size is known. hasEmbedded must stay false
    // so the UI shows "no metadata found" rather than a bogus Image section.
    const model = buildMetadataModel({}, { width: 1920, height: 1080 })
    expect(model.hasEmbedded).toBe(false)
    // hasAny is true (we did build a dimensions section) but the page keys off hasEmbedded.
    expect(model.sections.find((s) => s.id === 'image')).toBeTruthy()
  })

  it('sets hasEmbedded when any real tag is present', () => {
    expect(buildMetadataModel({ Make: 'Canon' }).hasEmbedded).toBe(true)
    expect(buildMetadataModel({ latitude: 40, longitude: -73 }).hasEmbedded).toBe(true)
  })
})

describe('edit model', () => {
  it('exposes a stable set of editable JPEG fields', () => {
    const ids = EDITABLE_FIELDS.map((f) => f.id)
    expect(ids).toContain('Artist')
    expect(ids).toContain('Copyright')
    expect(ids).toContain('ImageDescription')
    expect(ids).toContain('DateTimeOriginal')
    // Each field declares which IFD it lives in.
    for (const f of EDITABLE_FIELDS) {
      expect(['0th', 'Exif']).toContain(f.block)
    }
  })

  it('readEditableValues prefills text + datetime + gps', () => {
    const v = readEditableValues({
      Artist: 'Jane', Copyright: '© 2023',
      DateTimeOriginal: '2023:08:15 14:32:01',
      latitude: 40.5, longitude: -73.9,
    })
    expect(v.Artist).toBe('Jane')
    expect(v.Copyright).toBe('© 2023')
    expect(v.DateTimeOriginal).toBe('2023-08-15T14:32:01')
    expect(v.gpsLat).toBe('40.5')
    expect(v.gpsLon).toBe('-73.9')
  })

  it('readEditableValues yields empty strings when absent', () => {
    const v = readEditableValues({})
    expect(v.Artist).toBe('')
    expect(v.DateTimeOriginal).toBe('')
    expect(v.gpsLat).toBe('')
  })
})

describe('datetime round-trip', () => {
  it('exifDateToInput parses EXIF + Date forms', () => {
    expect(exifDateToInput('2023:08:15 14:32:01')).toBe('2023-08-15T14:32:01')
    expect(exifDateToInput(new Date(2023, 7, 15, 14, 32, 1))).toBe('2023-08-15T14:32:01')
    expect(exifDateToInput('')).toBe('')
    expect(exifDateToInput(null)).toBe('')
  })
  it('inputDateToExif converts back to EXIF format', () => {
    expect(inputDateToExif('2023-08-15T14:32:01')).toBe('2023:08:15 14:32:01')
    expect(inputDateToExif('2023-08-15T14:32')).toBe('2023:08:15 14:32:00')
    expect(inputDateToExif('')).toBe('')
    expect(inputDateToExif('garbage')).toBe('')
  })
  it('is a faithful round trip', () => {
    const exif = '2021:12:31 23:59:59'
    expect(inputDateToExif(exifDateToInput(exif))).toBe(exif)
  })
})

describe('parseLatLon', () => {
  it('accepts in-range decimals and rejects the rest', () => {
    expect(parseLatLon('40.5', 'lat')).toBe(40.5)
    expect(parseLatLon('-120.3', 'lon')).toBe(-120.3)
    expect(parseLatLon('100', 'lat')).toBe(null) // > 90
    expect(parseLatLon('200', 'lon')).toBe(null) // > 180
    expect(parseLatLon('', 'lat')).toBe(null)
    expect(parseLatLon('abc', 'lat')).toBe(null)
  })
})
