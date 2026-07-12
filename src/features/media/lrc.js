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

// ---------------------------------------------------------------------------
// PHASE 2: sentence-level navigation helpers. The classic .lrc parser above only ANSWERS "what
// line is active at time t"; these new helpers let the player go the OTHER direction — given a
// line index, return its time, or find the prev/next line boundary so users can jump by SENTENCE
// rather than by ±10s. All operate on the same `lines` shape `parseLrc` returns, so they're
// trivially unit-testable in node.
// ---------------------------------------------------------------------------

// Safe line getter — `lines[i]` with bounds clamping; returns null when out of range.
export function lineAt(lines, index) {
  if (!Array.isArray(lines) || index < 0 || index >= lines.length) return null
  return lines[index] || null
}

// Time of a line by index (seconds). Returns 0 for out-of-range / untimed lines so seeking is a
// no-op rather than NaN.
export function timeOfLine(lines, index) {
  const l = lineAt(lines, index)
  return l && l.time >= 0 ? l.time : 0
}

// Index of the line that BEGINS BEFORE `t` (the active line). Same as activeLineIndex but exposed
// under a clearer name for the navigation surface.
export function currentLineIndex(lines, t, offset = 0) {
  return activeLineIndex(lines, t, offset)
}

// Index of the previous line relative to time `t` (the line whose time is strictly less than the
// active line's time). Returns -1 if there is no previous line (we're at the very start).
export function prevLineIndex(lines, t, offset = 0) {
  const cur = activeLineIndex(lines, t, offset)
  if (cur <= 0) return -1
  return cur - 1
}

// Index of the next line relative to time `t` (the line whose time is strictly greater). Returns
// -1 if there is no next line (we're past the last lyric).
export function nextLineIndex(lines, t, offset = 0) {
  if (!Array.isArray(lines) || !lines.length) return -1
  const cur = activeLineIndex(lines, t, offset)
  // Untimed (plain-text) lines all have time -1 → activeLineIndex returns -1; treat that as
  // "before the first line" so the next call returns the first index.
  const base = cur < 0 ? -1 : cur
  if (base + 1 >= lines.length) return -1
  return base + 1
}

// ---------------------------------------------------------------------------
// PHASE 2: parseYrc — NCM's per-syllable KTV timing format. The wire format looks like:
//
//   [1318,4000](1318,444,0)窗 (1764,222,0)外 (1988,1000,0)的 ...
//
// where the leading [start,dur] is a per-line bracket and each (start,dur,word_pitch) wraps one
// syllable. We surface a `lines: [{ time, duration, words: [{ start, dur, text }] }]` shape so
// the KTV view can render character-by-character highlighting driven by currentTime.
//
// This parser is forgiving: anything it can't tokenise falls through to a single-word line, so a
// partially-broken yrc still plays. Returns { lines, synced:true } on success, or
// { lines: [], synced:false } when the input doesn't look like yrc.
const YRC_LINE_RE = /\[(\d+),(\d+)\]/g           // [startMs,durMs]
const YRC_WORD_RE = /\((\d+),(\d+),([^)]*)\)/g    // (startMs,durMs,pitchOrExtra)

export function parseYrc(input) {
  const text = String(input == null ? '' : input)
  if (!text.includes('[') || !text.includes('(')) return { lines: [], synced: false }
  const lines = []
  // Walk line by line; each line begins with a [start,dur] bracket then any number of (s,d,x) words.
  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trim()
    if (!line) continue
    const lineMatch = line.match(/\[(\d+),(\d+)\]/)
    if (!lineMatch) continue
    const lineStart = parseInt(lineMatch[1], 10)
    const lineDur = parseInt(lineMatch[2], 10)
    // Pull every (start,dur,extra) word from the rest of the line.
    const words = []
    let m
    YRC_WORD_RE.lastIndex = 0
    while ((m = YRC_WORD_RE.exec(line)) !== null) {
      const wStart = parseInt(m[1], 10)
      const wDur = parseInt(m[2], 10)
      // m[3] is "pitch" (an integer) in older yrc, or sometimes a hex string in newer ones;
      // we don't render pitch, so we ignore it. The actual character/text is whatever sits
      // AFTER the closing paren up to the next opening paren — collect those by stripping all
      // (...) and [...] groups from the line and re-aligning offsets is fiddly; instead we
      // parse the words by walking the original regex matches and slicing the text between them.
      words.push({ start: wStart, dur: wDur, text: '' })
    }
    // Now backfill the text by scanning the line character-by-character between word matches.
    // Each `(s,d,x)` is immediately followed by its visible text; the next `(` starts the next
    // syllable. We do a single pass eating "(" ... ")" then reading literal chars up to "(".
    let i = line.indexOf('(')
    for (let w = 0; w < words.length; w++) {
      const close = line.indexOf(')', i)
      if (close < 0) break
      let end = line.indexOf('(', close + 1)
      if (end < 0) end = line.length
      // Strip a trailing [..] if this word is the last on the line and a bracket opens right
      // after (rare but seen in some yrc variants).
      const raw = line.slice(close + 1, end)
      words[w].text = raw
      i = end
    }
    lines.push({ time: lineStart / 1000, duration: lineDur / 1000, words })
  }
  if (!lines.length) return { lines: [], synced: false }
  lines.sort((a, b) => a.time - b.time)
  return { lines, synced: true }
}

// Given yrc lines + currentTime, return { lineIndex, wordIndex } for the active syllable. Both
// are -1 when not playing inside any line. Cheap to call every animation frame.
export function activeYrcIndices(lines, t) {
  if (!Array.isArray(lines) || !lines.length) return { lineIndex: -1, wordIndex: -1 }
  const time = Number(t) || 0
  // Find the active LINE (last one whose time ≤ t).
  let li = -1
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].time <= time) li = i; else break
  }
  if (li < 0) return { lineIndex: -1, wordIndex: -1 }
  const line = lines[li]
  // Find the active WORD inside the line (start ≤ t < start+dur, in seconds).
  let wi = -1
  for (let i = 0; i < line.words.length; i++) {
    const ws = line.words[i].start / 1000
    const we = ws + line.words[i].dur / 1000
    if (time >= ws && time < we) { wi = i; break }
    if (time >= ws) wi = i // last-resort: last word whose start ≤ t (covers the trailing gap)
  }
  return { lineIndex: li, wordIndex: wi }
}
