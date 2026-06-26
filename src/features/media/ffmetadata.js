// Pure, SSG-safe helpers for ffmpeg's FFMETADATA1 text format and the metadata→ffmpeg-args builder
// used by the audio Metadata editor. NO window/Blob/ffmpeg access here — everything operates on
// plain strings/objects so it can be unit-tested in node and imported anywhere (the page reaches
// the engine separately, via audioRunner).
//
// FFMETADATA1 reference (what `ffmpeg -i in -f ffmetadata out.txt` writes / reads back):
//   • First line is the magic `;FFMETADATA1`.
//   • Global, format-level tags are `key=value`, one per line, BEFORE any `[SECTION]` header.
//   • Sections like `[CHAPTER]` / `[STREAM]` carry per-chapter / per-stream tags; we treat those as
//     opaque (preserved as a raw tail, never edited by the key/value UI which only edits globals).
//   • `;` and `#` at the start of a line are comments.
//   • `=`, `;`, `#`, `\` and a literal newline are escaped with a backslash inside keys AND values.
//     A value can span multiple physical lines: a backslash at end-of-line means "the newline is part
//     of the value", so the next physical line continues it.

export const FFMETADATA_HEADER = ';FFMETADATA1'

// ---------------------------------------------------------------------------
// Escaping (mirrors libavformat/ffmetaenc.c / ffmetadec.c)
// ---------------------------------------------------------------------------

// Escape a key or value for writing into an ffmetadata file. The set ffmpeg escapes is = ; # \ and
// newline; we also escape a leading-newline-producing \r defensively (normalized to \n first).
export function escapeMeta(str) {
  return String(str ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/([=;#\\])/g, '\\$1')
    .replace(/\n/g, '\\\n')
}

// Unescape a single already-joined logical line value (after multiline continuation has been
// resolved). `\\` → `\`, `\=` → `=`, etc.; an escaped newline `\` + `\n` becomes a real newline.
export function unescapeMeta(str) {
  const s = String(str ?? '')
  let out = ''
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c === '\\' && i + 1 < s.length) {
      const n = s[++i]
      out += n // the escaped char (=, ;, #, \, or a newline) is taken literally
    } else {
      out += c
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// Parse
// ---------------------------------------------------------------------------

// Parse an FFMETADATA1 document into:
//   { tags: { key: value, ... }, order: [key, ...], tail: '<raw [SECTION]… text>' }
// `tags` are the GLOBAL key/value pairs (lower-cased keys, original-case kept in `order` casing via
// `keyCase`); `tail` is everything from the first `[SECTION]` header onward, preserved verbatim so
// chapters/streams survive a round-trip. Robust to a missing header and to CRLF.
export function parseFFMetadata(text) {
  const tags = {}
  const order = []
  const keyCase = {} // lower-cased key → the original-cased key, so we can re-emit faithfully
  let tail = ''

  const src = String(text ?? '').replace(/\r\n?/g, '\n')
  const lines = src.split('\n')

  // Resolve multiline continuations: a line whose UNESCAPED-trailing backslash count is odd means
  // the newline is escaped and the value continues on the next physical line.
  const logical = []
  let buf = null
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const continues = endsWithOddBackslashes(line)
    if (buf == null) buf = line
    else buf += '\n' + line
    if (continues && i < lines.length - 1) {
      // keep accumulating (drop the trailing escaping backslash now; unescape handles the rest)
      continue
    }
    logical.push(buf)
    buf = null
  }
  if (buf != null) logical.push(buf)

  let inTail = false
  for (let li = 0; li < logical.length; li++) {
    const raw = logical[li]
    if (inTail) { tail += (tail ? '\n' : '') + raw; continue }

    // Section header → everything from here on is the opaque tail.
    if (/^\[/.test(raw)) { inTail = true; tail += raw; continue }

    // Header / comments / blank lines are skipped in the global block.
    if (raw === FFMETADATA_HEADER) continue
    if (raw.length === 0) continue
    if (raw[0] === ';' || raw[0] === '#') continue

    // Split on the FIRST UNESCAPED '='.
    const eq = indexOfUnescaped(raw, '=')
    if (eq < 0) continue
    const rawKey = raw.slice(0, eq)
    const rawVal = raw.slice(eq + 1)
    const key = unescapeMeta(rawKey)
    const val = unescapeMeta(rawVal)
    const lk = key.toLowerCase()
    if (!(lk in tags)) order.push(key)
    tags[lk] = val
    keyCase[lk] = key
  }

  return { tags, order, keyCase, tail }
}

// True if the string ends with an ODD number of backslashes (so a trailing newline would be escaped).
function endsWithOddBackslashes(line) {
  let n = 0
  for (let i = line.length - 1; i >= 0 && line[i] === '\\'; i--) n++
  return n % 2 === 1
}

// Index of the first occurrence of `ch` not preceded by an escaping backslash, or -1.
function indexOfUnescaped(str, ch) {
  for (let i = 0; i < str.length; i++) {
    if (str[i] === '\\') { i++; continue }
    if (str[i] === ch) return i
  }
  return -1
}

// ---------------------------------------------------------------------------
// Serialize
// ---------------------------------------------------------------------------

// Build an FFMETADATA1 document from an ordered list of { key, value } entries (plus an optional raw
// `tail` of preserved [SECTION] blocks). Blank keys are dropped; blank VALUES are kept (a present
// key with an empty value is meaningful — it can clear a tag). Order is preserved.
//   serializeFFMetadata([{ key:'title', value:'Hi' }, …], { tail }) -> string
export function serializeFFMetadata(entries = [], { tail = '' } = {}) {
  const lines = [FFMETADATA_HEADER]
  const seen = new Set()
  for (const e of entries || []) {
    const key = String(e?.key ?? '').trim()
    if (!key) continue
    const lk = key.toLowerCase()
    if (seen.has(lk)) continue // de-dupe by key (last write in UI wins is handled upstream)
    seen.add(lk)
    lines.push(`${escapeMeta(key)}=${escapeMeta(e.value ?? '')}`)
  }
  let out = lines.join('\n') + '\n'
  if (tail && String(tail).trim()) out += String(tail).replace(/^\n+/, '') + '\n'
  return out
}

// ---------------------------------------------------------------------------
// Common-tag taxonomy (drives the labeled-fields UI; everything else is "custom")
// ---------------------------------------------------------------------------

// The well-known global tag keys we surface as labeled fields, in a sensible editing order. Keys are
// the canonical ffmetadata/Vorbis names (lower-cased). The page maps each to an i18n label.
export const COMMON_TAG_KEYS = [
  'title', 'artist', 'album', 'album_artist', 'composer', 'genre',
  'date', 'track', 'disc', 'comment', 'lyrics', 'publisher', 'copyright',
  'language', 'encoded_by', 'grouping',
]

const COMMON_SET = new Set(COMMON_TAG_KEYS)

// Some readers/writers use synonyms; normalize the most common aliases to our canonical key so the
// labeled field captures them (e.g. ffmpeg may surface `album-artist` or `year`).
const KEY_ALIASES = {
  'album artist': 'album_artist',
  'album-artist': 'album_artist',
  albumartist: 'album_artist',
  year: 'date',
  tracknumber: 'track',
  track_number: 'track',
  discnumber: 'disc',
  disc_number: 'disc',
  unsyncedlyrics: 'lyrics',
  'unsynced lyrics': 'lyrics',
  lyrics_eng: 'lyrics',
  description: 'comment',
  organization: 'publisher',
}

export function canonicalTagKey(key) {
  const lk = String(key || '').trim().toLowerCase()
  return KEY_ALIASES[lk] || lk
}

export function isCommonTagKey(key) {
  return COMMON_SET.has(canonicalTagKey(key))
}

// Split a parsed `tags` map into ordered { common:[{key,value}], custom:[{key,value}] } lists,
// folding aliases onto their canonical key. `order` preserves first-seen ordering for custom tags;
// common tags follow the canonical COMMON_TAG_KEYS order so the form is stable. Keys ffmpeg adds for
// its own bookkeeping (the `encoder` line) are treated as custom/editable but flagged via isEncoder.
export function splitTags(parsed) {
  const tags = parsed?.tags || {}
  const order = parsed?.order || Object.keys(tags)
  const keyCase = parsed?.keyCase || {}

  // Collapse onto canonical keys (later duplicates overwrite; first-seen casing is kept).
  const canon = {}
  const canonOrder = []
  for (const origKey of order) {
    const lk = String(origKey).toLowerCase()
    const ck = canonicalTagKey(lk)
    if (!(ck in canon)) { canonOrder.push(ck); canon[ck] = { value: tags[lk], display: keyCase[lk] || origKey } }
    else canon[ck].value = tags[lk]
  }

  const common = []
  for (const ck of COMMON_TAG_KEYS) {
    if (ck in canon) common.push({ key: ck, value: canon[ck].value })
  }
  const custom = []
  for (const ck of canonOrder) {
    if (COMMON_SET.has(ck)) continue
    custom.push({ key: canon[ck].display || ck, value: canon[ck].value })
  }
  return { common, custom }
}

// Merge the edited common + custom field lists back into one ordered entry list for serialization.
// Drops entries with a blank key; trims keys. Keeps blank values (present key clears the tag).
//   buildEntries({ common:{title,…}, custom:[{key,value}] }) -> [{ key, value }]
export function buildEntries(common = {}, custom = []) {
  const out = []
  for (const k of COMMON_TAG_KEYS) {
    const v = common[k]
    if (v != null && String(v).length) out.push({ key: k, value: String(v) })
  }
  for (const c of custom || []) {
    const key = String(c?.key ?? '').trim()
    if (!key) continue
    out.push({ key, value: String(c?.value ?? '') })
  }
  return out
}

// ---------------------------------------------------------------------------
// ffmpeg argument builders for WRITE / STRIP (the unit-tested core)
// ---------------------------------------------------------------------------

// Build args to WRITE edited metadata WITHOUT re-encoding the audio, using the ffmetadata-file
// approach so ARBITRARY keys are supported. Inputs on the in-memory FS:
//   input   : the source audio (index 0)
//   metaFile: the rebuilt FFMETADATA1 text file (index 1)
//   cover?  : a replacement cover image (index 2) — only when replacing the artwork.
// Behavior:
//   • keepCover (default true): `-map 0` carries every original stream (audio + any embedded cover),
//     and `-map_metadata 1` swaps in the new global tags. removeCover → `-map 0:a` (audio only).
//   • newCover: `-map 0:a -map 2:v -c:v mjpeg -disposition:v attached_pic` embeds the new image.
//   • `-c:a copy` (and `-c:v copy` when keeping an existing cover) → no audio re-encode.
//   • mp3 gets `-id3v2_version 3` for the widest player/tag-reader compatibility.
//   buildWriteMetadataArgs({ input, metaFile, output, cover, keepCover, removeCover, isMp3 }) -> string[]
export function buildWriteMetadataArgs({
  input = 'input.mp3',
  metaFile = 'meta.txt',
  output = 'output.mp3',
  cover = null,           // replacement cover filename on the FS, or null
  keepCover = true,       // preserve an existing embedded cover (ignored if `cover` or removeCover)
  removeCover = false,    // drop any embedded cover
  isMp3 = false,
} = {}) {
  const args = ['-i', input, '-i', metaFile]
  const metaIndex = cover ? 2 : 1
  if (cover) args.push('-i', cover)

  if (cover) {
    // Replace artwork: audio from input, picture from the new image.
    args.push('-map', '0:a', '-map', `${metaIndex}:v`)
    args.push('-map_metadata', '1')
    args.push('-c:a', 'copy', '-c:v', 'mjpeg', '-disposition:v', 'attached_pic')
  } else if (removeCover) {
    // Strip artwork: keep only the audio stream(s).
    args.push('-map', '0:a', '-map_metadata', '1', '-c:a', 'copy')
  } else if (keepCover) {
    // Preserve every original stream (audio + existing cover) and just swap the tags.
    args.push('-map', '0', '-map_metadata', '1', '-c', 'copy')
  } else {
    args.push('-map', '0:a', '-map_metadata', '1', '-c:a', 'copy')
  }

  if (isMp3) args.push('-id3v2_version', '3')
  args.push(output)
  return args
}

// Build args to STRIP ALL metadata (and chapters) WITHOUT re-encoding. `keepCover` decides whether
// the embedded artwork survives (it is a stream, not a tag). `-map_metadata -1 -map_chapters -1`.
//   buildStripMetadataArgs({ input, output, keepCover, isMp3 }) -> string[]
export function buildStripMetadataArgs({ input = 'input.mp3', output = 'output.mp3', keepCover = false, isMp3 = false } = {}) {
  const args = ['-i', input]
  if (keepCover) args.push('-map', '0', '-c', 'copy')
  else args.push('-map', '0:a', '-c:a', 'copy')
  args.push('-map_metadata', '-1', '-map_chapters', '-1')
  if (isMp3) args.push('-id3v2_version', '3')
  args.push(output)
  return args
}

// ---------------------------------------------------------------------------
// Technical / stream info parsing (from ffmpeg log lines) — for VIEWING only
// ---------------------------------------------------------------------------

// Parse the "Duration: HH:MM:SS.xx, start: …, bitrate: N kb/s" line → { durationSec, bitrateKbps }.
export function parseDurationInfo(logText) {
  const out = {}
  const m = /Duration:\s*(\d+):(\d{2}):(\d{2})(?:\.(\d+))?/.exec(logText || '')
  if (m) {
    const [, h, mm, ss, frac] = m
    out.durationSec = (+h) * 3600 + (+mm) * 60 + (+ss) + (frac ? +`0.${frac}` : 0)
  }
  const b = /bitrate:\s*(\d+)\s*kb\/s/i.exec(logText || '')
  if (b) out.bitrateKbps = parseInt(b[1], 10)
  return out
}

// ffmpeg channel-layout names → channel counts (the ones it prints in stream lines).
const CHANNEL_LAYOUTS = {
  mono: 1, stereo: 2, '2.1': 3, '3.0': 3, quad: 4, '4.0': 4, '5.0': 5,
  '5.1': 6, '5.1(side)': 6, '6.1': 7, '7.1': 8, '7.1(wide)': 8, 'downmix': 2,
}

// Parse the first AUDIO "Stream #…: Audio: codec, 44100 Hz, stereo, …, 192 kb/s" line into
// { codec, sampleRate, channelLayout, channels, bitrateKbps }. Returns {} if no audio stream line.
export function parseAudioStreamInfo(logText) {
  const text = String(logText || '')
  // Find an audio stream line (ffmpeg prints "Stream #0:0… : Audio: …").
  const line = text.split('\n').find((l) => /Stream #\d+:\d+.*:\s*Audio:/.test(l))
  if (!line) return {}
  const body = line.slice(line.indexOf('Audio:') + 'Audio:'.length).trim()
  const parts = body.split(',').map((s) => s.trim())
  const out = {}
  if (parts[0]) out.codec = parts[0].split(/\s+/)[0]
  for (const p of parts) {
    const hz = /^(\d+)\s*Hz$/.exec(p)
    if (hz) { out.sampleRate = parseInt(hz[1], 10); continue }
    const kb = /^(\d+)\s*kb\/s$/i.exec(p)
    if (kb) { out.bitrateKbps = parseInt(kb[1], 10); continue }
    const lay = CHANNEL_LAYOUTS[p.toLowerCase()]
    if (lay) { out.channelLayout = p.toLowerCase(); out.channels = lay; continue }
    const ch = /^(\d+)\s*channels?$/i.exec(p)
    if (ch) { out.channelLayout = p; out.channels = parseInt(ch[1], 10); continue }
  }
  return out
}

// Parse the first VIDEO "Stream #…: Video: codec, yuv420p, 1920x1080, …, 30 fps" line into
// { vcodec, width, height, fps }. Returns {} if there's no (non-attached-pic) video stream. Used so
// the metadata tool can show resolution/codec/fps for a real video file (not just audio).
export function parseVideoStreamInfo(logText) {
  const text = String(logText || '')
  const line = text.split('\n').find((l) => /Stream #\d+:\d+.*:\s*Video:/.test(l) && !/attached pic/i.test(l))
  if (!line) return {}
  const body = line.slice(line.indexOf('Video:') + 'Video:'.length).trim()
  const parts = body.split(',').map((s) => s.trim())
  const out = {}
  if (parts[0]) out.vcodec = parts[0].split(/\s+/)[0]
  for (const p of parts) {
    const dim = /(\d{2,5})x(\d{2,5})/.exec(p)
    if (dim && !out.width) { out.width = parseInt(dim[1], 10); out.height = parseInt(dim[2], 10); continue }
    const fps = /^([\d.]+)\s*fps$/i.exec(p)
    if (fps) { out.fps = Math.round(parseFloat(fps[1])); continue }
  }
  return out
}

// Has the input got an embedded cover/attached picture? (a Video stream marked "attached pic", or
// any "Stream …: Video:" line in an audio container's log).
export function hasAttachedPicture(logText) {
  const text = String(logText || '')
  if (/attached pic/i.test(text)) return true
  return text.split('\n').some((l) => /Stream #\d+:\d+.*:\s*Video:/.test(l))
}

// Containers/extensions where arbitrary custom tag keys can't be reliably written (the writer maps a
// fixed/limited tag set). Used to surface an honest "some custom keys may not be saved" note.
const LIMITED_TAG_EXTS = new Set(['wav', 'wave', 'aiff', 'aif', 'amr'])
export function hasLimitedTagSupport(ext) {
  return LIMITED_TAG_EXTS.has(String(ext || '').toLowerCase().replace(/^\./, ''))
}
