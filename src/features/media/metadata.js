// Dependency-free, lazy-loaded audio METADATA reader for the player. Parses the common tag
// containers — ID3v2.3/2.4 (MP3), FLAC Vorbis comments + PICTURE block, and MP4/M4A iTunes atoms
// (`moov/udta/meta/ilst`) — extracting title / artist / album / cover art. We deliberately avoid a
// heavyweight npm dep (music-metadata pulls a large tree) so the home bundle stays tiny; this whole
// module is only ever reached via a dynamic import() from a client handler.
//
// SSG-SAFETY: no top-level browser globals. `readTags` takes a File/Blob and uses its .arrayBuffer()
// (and only constructs Blob/URL inside the function). Always resolves — on any parse failure it
// returns an empty {} so callers fall back to filename-derived titles + placeholder art.

const td = (enc) => new TextDecoder(enc) // created per-call inside functions (see below)

function decodeText(bytes, encodingByte) {
  // ID3 text encodings: 0=ISO-8859-1, 1=UTF-16 (BOM), 2=UTF-16BE, 3=UTF-8.
  try {
    switch (encodingByte) {
      case 1: return new TextDecoder('utf-16').decode(bytes).replace(/\0+$/, '')
      case 2: return new TextDecoder('utf-16be').decode(bytes).replace(/\0+$/, '')
      case 3: return new TextDecoder('utf-8').decode(bytes).replace(/\0+$/, '')
      default: return new TextDecoder('iso-8859-1').decode(bytes).replace(/\0+$/, '')
    }
  } catch {
    return new TextDecoder('utf-8').decode(bytes).replace(/\0+$/, '')
  }
}

function readUInt32BE(view, off) { return view.getUint32(off, false) }
// ID3 size fields are "synchsafe": 7 bits per byte.
function readSynchsafe(view, off) {
  return ((view.getUint8(off) & 0x7f) << 21) | ((view.getUint8(off + 1) & 0x7f) << 14) |
         ((view.getUint8(off + 2) & 0x7f) << 7) | (view.getUint8(off + 3) & 0x7f)
}

// ---- ID3v2 (MP3) ------------------------------------------------------------
function parseID3v2(buf) {
  const view = new DataView(buf)
  const u8 = new Uint8Array(buf)
  if (u8[0] !== 0x49 || u8[1] !== 0x44 || u8[2] !== 0x33) return null // 'ID3'
  const major = u8[3]
  const flags = u8[5]
  const size = readSynchsafe(view, 6)
  let pos = 10
  const end = Math.min(buf.byteLength, 10 + size)
  // Skip extended header if present (bit 6 of flags).
  if (flags & 0x40) {
    const extSize = major === 4 ? readSynchsafe(view, pos) : readUInt32BE(view, pos)
    pos += extSize
  }
  const out = {}
  while (pos + 10 <= end) {
    const id = String.fromCharCode(u8[pos], u8[pos + 1], u8[pos + 2], u8[pos + 3])
    if (!/^[A-Z0-9]{4}$/.test(id)) break // padding / end of frames
    const frameSize = major === 4 ? readSynchsafe(view, pos + 4) : readUInt32BE(view, pos + 4)
    const dataStart = pos + 10
    if (frameSize <= 0 || dataStart + frameSize > end) break
    const data = u8.subarray(dataStart, dataStart + frameSize)

    if (id === 'TIT2' || id === 'TPE1' || id === 'TALB') {
      const text = decodeText(data.subarray(1), data[0])
      if (id === 'TIT2') out.title = text
      else if (id === 'TPE1') out.artist = text
      else if (id === 'TALB') out.album = text
    } else if (id === 'APIC') {
      // APIC: <enc:1><mime\0><picType:1><desc\0...><image bytes>
      let p = 1
      const encByte = data[0]
      // MIME (null-terminated, latin1)
      let mimeEnd = p
      while (mimeEnd < data.length && data[mimeEnd] !== 0) mimeEnd++
      const mime = new TextDecoder('iso-8859-1').decode(data.subarray(p, mimeEnd)) || 'image/jpeg'
      p = mimeEnd + 1
      p += 1 // picture type byte
      // Description (null-terminated; UTF-16 uses double-null)
      if (encByte === 1 || encByte === 2) {
        while (p + 1 < data.length && !(data[p] === 0 && data[p + 1] === 0)) p += 2
        p += 2
      } else {
        while (p < data.length && data[p] !== 0) p++
        p += 1
      }
      const imgBytes = data.subarray(p)
      if (imgBytes.length > 0 && !out.cover) out.cover = { mime, bytes: imgBytes.slice() }
    }
    pos = dataStart + frameSize
  }
  return out
}

// ---- FLAC (Vorbis comments + PICTURE) --------------------------------------
function parseFlac(buf) {
  const u8 = new Uint8Array(buf)
  const view = new DataView(buf)
  if (!(u8[0] === 0x66 && u8[1] === 0x4c && u8[2] === 0x61 && u8[3] === 0x43)) return null // 'fLaC'
  let pos = 4
  const out = {}
  while (pos + 4 <= buf.byteLength) {
    const header = u8[pos]
    const last = (header & 0x80) !== 0
    const type = header & 0x7f
    const len = (u8[pos + 1] << 16) | (u8[pos + 2] << 8) | u8[pos + 3]
    const start = pos + 4
    if (start + len > buf.byteLength) break
    if (type === 4) {
      // VORBIS_COMMENT: vendor string, then comment list, all little-endian lengths.
      let p = start
      const vendorLen = view.getUint32(p, true); p += 4 + vendorLen
      const count = view.getUint32(p, true); p += 4
      for (let i = 0; i < count && p + 4 <= start + len; i++) {
        const cl = view.getUint32(p, true); p += 4
        const comment = new TextDecoder('utf-8').decode(u8.subarray(p, p + cl)); p += cl
        const eq = comment.indexOf('=')
        if (eq > 0) {
          const key = comment.slice(0, eq).toLowerCase()
          const val = comment.slice(eq + 1)
          if (key === 'title') out.title = val
          else if (key === 'artist') out.artist = val
          else if (key === 'album') out.album = val
        }
      }
    } else if (type === 6 && !out.cover) {
      // PICTURE block (same layout as ID3 APIC, big-endian lengths).
      let p = start
      p += 4 // picture type
      const mimeLen = view.getUint32(p, false); p += 4
      const mime = new TextDecoder('iso-8859-1').decode(u8.subarray(p, p + mimeLen)); p += mimeLen
      const descLen = view.getUint32(p, false); p += 4 + descLen
      p += 16 // width, height, depth, colors (4×4)
      const dataLen = view.getUint32(p, false); p += 4
      const bytes = u8.subarray(p, p + dataLen)
      if (bytes.length) out.cover = { mime: mime || 'image/jpeg', bytes: bytes.slice() }
    }
    pos = start + len
    if (last) break
  }
  return out
}

// ---- MP4 / M4A (iTunes ilst atoms) -----------------------------------------
function parseMp4(buf) {
  const u8 = new Uint8Array(buf)
  const view = new DataView(buf)
  const out = {}
  const A = (s) => s.charCodeAt(0)

  // Walk atoms within [start,end), invoking cb(type, dataStart, dataEnd). Recurse into containers.
  function walk(start, end, want, cb, depth = 0) {
    let pos = start
    while (pos + 8 <= end) {
      let size = view.getUint32(pos, false)
      const type = String.fromCharCode(u8[pos + 4], u8[pos + 5], u8[pos + 6], u8[pos + 7])
      let headerSize = 8
      if (size === 1) { // 64-bit size
        size = Number(view.getBigUint64(pos + 8, false)); headerSize = 16
      } else if (size === 0) {
        size = end - pos
      }
      if (size < headerSize || pos + size > end) break
      const dataStart = pos + headerSize
      const dataEnd = pos + size
      if (want.has(type)) cb(type, dataStart, dataEnd, depth)
      pos += size
    }
  }

  const containers = new Set(['moov', 'udta', 'meta', 'ilst', 'trak', 'mdia'])
  const fields = new Set(['©nam', '©ART', '©alb', 'covr'])

  // Find ilst by descending moov→udta→meta→ilst. `meta` has a 4-byte version/flags before children.
  function descend(start, end, depth = 0) {
    walk(start, end, new Set([...containers, ...fields]), (type, ds, de) => {
      if (type === 'meta') { descend(ds + 4, de, depth + 1); return }
      if (containers.has(type)) { descend(ds, de, depth + 1); return }
      if (fields.has(type)) {
        // Each field contains a 'data' atom: <size><'data'><4 type><4 locale><payload>.
        walk(ds, de, new Set(['data']), (_t, dds, dde) => {
          const payload = u8.subarray(dds + 8, dde)
          if (type === 'covr') {
            if (!out.cover && payload.length) {
              // dataType in covr: 13=jpeg, 14=png (best-effort).
              const dataType = view.getUint32(dds, false)
              const mime = dataType === 14 ? 'image/png' : 'image/jpeg'
              out.cover = { mime, bytes: payload.slice() }
            }
          } else {
            const text = new TextDecoder('utf-8').decode(payload).replace(/\0+$/, '')
            if (type === '©nam') out.title = text
            else if (type === '©ART') out.artist = text
            else if (type === '©alb') out.album = text
          }
        })
      }
    })
  }
  descend(0, buf.byteLength)
  void A
  return out
}

// Detect container from the leading bytes and dispatch. Returns the raw tag object (no cover URL).
function parseBuffer(buf) {
  const u8 = new Uint8Array(buf)
  if (u8[0] === 0x49 && u8[1] === 0x44 && u8[2] === 0x33) return parseID3v2(buf) || {}
  if (u8[0] === 0x66 && u8[1] === 0x4c && u8[2] === 0x61 && u8[3] === 0x43) return parseFlac(buf) || {}
  // MP4: 'ftyp' box at offset 4.
  if (u8[4] === 0x66 && u8[5] === 0x74 && u8[6] === 0x79 && u8[7] === 0x70) return parseMp4(buf) || {}
  return {}
}

// Public: read tags from a File/Blob. Returns
//   { title?, artist?, album?, cover?: { mime, bytes }, coverUrl?: string, hasCover: boolean }
// Never throws — resolves to {} (hasCover:false) on any failure. The caller owns revoking coverUrl.
export async function readTags(fileOrBlob) {
  try {
    if (!fileOrBlob || typeof fileOrBlob.arrayBuffer !== 'function') return { hasCover: false }
    // Read enough of the head for tags + cover. ID3v2 declares its size; to be safe (cover at the
    // front), read up to 6 MB, which comfortably covers embedded artwork. For MP4 the tags can sit
    // at the END (moov last), so if the head yields nothing we retry with the whole file.
    const headSize = Math.min(fileOrBlob.size || 0, 6 * 1024 * 1024)
    let buf = await fileOrBlob.slice(0, headSize || undefined).arrayBuffer()
    let tags = parseBuffer(buf)
    const empty = !tags.title && !tags.artist && !tags.album && !tags.cover
    if (empty && (fileOrBlob.size || 0) > headSize) {
      buf = await fileOrBlob.arrayBuffer()
      tags = parseBuffer(buf)
    }
    const result = { title: tags.title || '', artist: tags.artist || '', album: tags.album || '', hasCover: !!tags.cover }
    if (tags.cover) {
      result.cover = tags.cover
      result.coverUrl = URL.createObjectURL(new Blob([tags.cover.bytes], { type: tags.cover.mime || 'image/jpeg' }))
    }
    return result
  } catch {
    return { hasCover: false }
  }
}

void td
