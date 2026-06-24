// Pure, SSG-safe LRC (synced-lyrics) parser + helpers. NO browser globals — operates on plain
// strings/values so it can be unit-tested in node and imported anywhere (it's reached from the
// player UI which is itself client-only, but this module is dependency-free on purpose).
//
// Supported:
//   • Multiple timestamps per line:  [00:12.34][01:05.00] same words
//   • 2- or 3-digit fractional seconds:  [00:12.3] / [00:12.34] / [00:12.345]
//   • ID tags:  [ti:Title] [ar:Artist] [al:Album] [by:Author] [offset:+250] [length:03:21]
//   • Blank lyric lines (kept, so timing/scrolling stays faithful)
// Anything without a leading timestamp is treated as PLAIN text (no timing) so we can still show it.

// Match one timestamp like [mm:ss.xx] (xx optional, 1–3 digits). Global so we can pull several.
const TS_RE = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g
// Match an ID tag like [ti:...] — a non-numeric key followed by a colon and a value.
const TAG_RE = /^\[([a-zA-Z]+):(.*)\]$/

// Convert a captured (min, sec, frac) into seconds. `frac` is the literal digit string after the
// dot/colon, so "5" → 0.5, "34" → 0.34, "345" → 0.345.
function toSeconds(min, sec, frac) {
  const m = parseInt(min, 10) || 0
  const s = parseInt(sec, 10) || 0
  let f = 0
  if (frac != null && frac !== '') f = parseInt(frac, 10) / Math.pow(10, frac.length)
  return m * 60 + s + f
}

// Parse an LRC string into a sorted list of timed lines + metadata. Returns:
//   { lines: [{ time:Number(seconds), text:String }], meta: { ti, ar, al, by, length }, offset:Number(seconds), synced:Boolean }
// `offset` is the LRC [offset:] tag in seconds (positive = lyrics later). `synced` is true if at
// least one timed line was found; otherwise the input is treated as plain text and split per line.
export function parseLrc(input) {
  const text = String(input == null ? '' : input).replace(/\r\n?/g, '\n')
  const meta = {}
  let offset = 0
  const lines = []
  let sawTimed = false

  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line) continue

    // ID tag line (e.g. [ti:Song]) — but only if the key is non-numeric (so [00:..] isn't a tag).
    const tag = line.match(TAG_RE)
    if (tag && !/^\d+$/.test(tag[1])) {
      const key = tag[1].toLowerCase()
      const val = tag[2].trim()
      if (key === 'offset') {
        const n = parseFloat(val)
        if (Number.isFinite(n)) offset = n / 1000 // [offset] is in milliseconds
      } else {
        meta[key] = val
      }
      continue
    }

    // Pull all leading timestamps; the remainder is the lyric text.
    TS_RE.lastIndex = 0
    const stamps = []
    let match
    while ((match = TS_RE.exec(line)) !== null) {
      // Only treat as a timestamp if it's contiguous from the start (handles "[xx][yy] text").
      stamps.push({ index: match.index, end: TS_RE.lastIndex, time: toSeconds(match[1], match[2], match[3]) })
    }
    // Keep only the run of timestamps anchored at the start of the line.
    let cut = 0
    const leading = []
    for (const st of stamps) {
      if (st.index === cut) { leading.push(st.time); cut = st.end } else break
    }

    if (leading.length) {
      sawTimed = true
      const lyric = line.slice(cut).trim()
      for (const time of leading) lines.push({ time, text: lyric })
    } else {
      // No timestamp → plain text line (time -1 so synced consumers can ignore it).
      lines.push({ time: -1, text: line })
    }
  }

  if (sawTimed) {
    // Sort timed lines by time; drop the untimed ones from the synced track (kept separately is
    // unnecessary — a real .lrc with stamps shouldn't mix in stray text).
    const timed = lines.filter((l) => l.time >= 0).sort((a, b) => a.time - b.time)
    return { lines: timed, meta, offset, synced: true }
  }
  // Plain text fallback: every line, no timing.
  return { lines: lines.map((l) => ({ time: -1, text: l.text })), meta, offset, synced: false }
}

// Given sorted synced lines and a playback time (seconds), return the index of the ACTIVE line
// (the last line whose adjusted time ≤ t), or -1 before the first line. `offset` shifts all times.
// Binary search so it's cheap to call every timeupdate.
export function activeLineIndex(lines, t, offset = 0) {
  if (!Array.isArray(lines) || !lines.length) return -1
  const time = Number(t) || 0
  let lo = 0
  let hi = lines.length - 1
  let ans = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const lt = (lines[mid].time || 0) + offset
    if (lt <= time) { ans = mid; lo = mid + 1 } else { hi = mid - 1 }
  }
  return ans
}

// Quick sniff: does this text look like a synced .lrc (has at least one [mm:ss] stamp)?
export function looksLikeLrc(input) {
  TS_RE.lastIndex = 0
  return TS_RE.test(String(input || ''))
}
