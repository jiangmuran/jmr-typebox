// Pure, SSG-safe helpers for the ASR (speech-to-text) transcription tool. NO window/Blob/fetch/
// ffmpeg access here — everything operates on plain values so it can be unit-tested in node and
// imported anywhere. The page reaches the provider via useAsr and ffmpeg via audioRunner.
//
// An ASR "segment" is the OpenAI verbose_json shape: { id?, start, end, text }. We normalize the
// provider's segments, stitch chunked windows back together with the right time offsets, and
// serialize to TXT / SRT / VTT.

// ---------------------------------------------------------------------------
// Time formatting
// ---------------------------------------------------------------------------

// Seconds → SRT timestamp 'HH:MM:SS,mmm' (comma decimal separator).
export function secToSrtTime(sec) {
  return formatClock(sec, ',')
}

// Seconds → WebVTT timestamp 'HH:MM:SS.mmm' (dot decimal separator).
export function secToVttTime(sec) {
  return formatClock(sec, '.')
}

function formatClock(sec, sep) {
  let s = Number(sec)
  if (!Number.isFinite(s) || s < 0) s = 0
  const ms = Math.round((s - Math.floor(s)) * 1000)
  let whole = Math.floor(s)
  // Carry a rounded-up 1000ms back into the seconds.
  let msPart = ms
  if (msPart >= 1000) { whole += 1; msPart -= 1000 }
  const h = Math.floor(whole / 3600)
  const m = Math.floor((whole % 3600) / 60)
  const ss = whole % 60
  const pad = (n, w = 2) => String(n).padStart(w, '0')
  return `${pad(h)}:${pad(m)}:${pad(ss)}${sep}${pad(msPart, 3)}`
}

// ---------------------------------------------------------------------------
// Segment normalization
// ---------------------------------------------------------------------------

// Coerce one raw provider segment into { start, end, text } with finite, ordered times and trimmed
// text. Returns null for empties so callers can drop them.
export function normalizeSegment(seg) {
  if (!seg || typeof seg !== 'object') return null
  const start = Number(seg.start)
  const end = Number(seg.end)
  const text = String(seg.text ?? '').trim()
  if (!text) return null
  const s = Number.isFinite(start) && start >= 0 ? start : 0
  const e = Number.isFinite(end) && end > s ? end : s
  return { start: s, end: e, text }
}

// Pull the segment list out of a verbose_json response (segments), or synthesize a single segment
// from a plain { text } response, or from a bare string. Always returns an array (possibly empty).
export function extractSegments(resp) {
  if (!resp) return []
  if (typeof resp === 'string') {
    const t = resp.trim()
    return t ? [{ start: 0, end: 0, text: t }] : []
  }
  if (Array.isArray(resp.segments) && resp.segments.length) {
    return resp.segments.map(normalizeSegment).filter(Boolean)
  }
  // No segment timing — fall back to the whole transcript as one block.
  const t = String(resp.text ?? '').trim()
  return t ? [{ start: 0, end: 0, text: t }] : []
}

// Shift every segment's times by `offsetSec` (used when stitching a time-windowed chunk back into
// the full timeline). Returns a NEW array.
export function offsetSegments(segments, offsetSec) {
  const off = Number(offsetSec) || 0
  return (segments || []).map((s) => ({ start: (Number(s.start) || 0) + off, end: (Number(s.end) || 0) + off, text: s.text }))
}

// Stitch an ordered list of per-chunk results — [{ offset, segments }] — into one continuous,
// re-id'd segment list (offsets applied, sorted by start). Used by the chunked long-audio path.
export function stitchChunks(chunks) {
  const all = []
  for (const c of chunks || []) {
    const off = Number(c?.offset) || 0
    for (const seg of offsetSegments(c?.segments || [], off)) all.push(seg)
  }
  all.sort((a, b) => a.start - b.start)
  return all
}

// Concatenate the plain text of chunk results in order (for providers that return only `text`).
export function joinChunkText(chunks) {
  return (chunks || [])
    .map((c) => String(c?.text ?? '').trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// ---------------------------------------------------------------------------
// Chunk planning (split long media into time windows so each upload fits provider limits)
// ---------------------------------------------------------------------------

// Plan time windows of `windowSec` (with `overlapSec` carried so a sentence on the boundary isn't
// lost — the page can de-dup, but a small overlap is safer than a hard cut). Returns
// [{ index, start, dur }]. A single window when the media is short or duration is unknown.
//   planChunks({ durationSec, windowSec, overlapSec }) -> [{ index, start, dur }]
export function planChunks({ durationSec, windowSec = 600, overlapSec = 0 } = {}) {
  const dur = Number(durationSec)
  const win = Math.max(30, Number(windowSec) || 600)
  if (!Number.isFinite(dur) || dur <= 0 || dur <= win) {
    return [{ index: 0, start: 0, dur: Number.isFinite(dur) && dur > 0 ? dur : 0 }]
  }
  const ov = Math.max(0, Math.min(win / 2, Number(overlapSec) || 0))
  const out = []
  let start = 0
  let i = 0
  while (start < dur) {
    const dleft = dur - start
    const d = Math.min(win, dleft)
    out.push({ index: i, start, dur: d })
    if (start + d >= dur) break
    start += win - ov
    i++
  }
  return out
}

// Should we bother extracting/downsampling before upload? True for video, or for audio that is
// large (over ~maxBytes, default ~24 MB to stay under the common 25 MB provider cap) or clearly
// high-bitrate. Pure decision so the page logic is testable.
export function needsExtraction({ isVideo, sizeBytes, maxBytes = 24 * 1024 * 1024 } = {}) {
  if (isVideo) return true
  return Number(sizeBytes) > Number(maxBytes)
}

// ---------------------------------------------------------------------------
// Serialization → TXT / SRT / VTT
// ---------------------------------------------------------------------------

// Plain transcript: each segment's text on its own line (blank segments already dropped). When the
// segments have no timing it is effectively the whole transcript.
export function segmentsToTXT(segments) {
  return (segments || [])
    .map((s) => String(s.text ?? '').trim())
    .filter(Boolean)
    .join('\n')
}

// SubRip (.srt): numbered cues with 'HH:MM:SS,mmm --> HH:MM:SS,mmm' and the text, blank line between.
export function segmentsToSRT(segments) {
  const out = []
  let n = 1
  for (const seg of segments || []) {
    const text = String(seg.text ?? '').trim()
    if (!text) continue
    const start = Number(seg.start) || 0
    let end = Number(seg.end)
    if (!Number.isFinite(end) || end <= start) end = start + 2 // give zero-length cues a 2s tail
    out.push(String(n++))
    out.push(`${secToSrtTime(start)} --> ${secToSrtTime(end)}`)
    out.push(text)
    out.push('')
  }
  return out.join('\n').trimEnd() + (out.length ? '\n' : '')
}

// WebVTT (.vtt): 'WEBVTT' header then 'HH:MM:SS.mmm --> HH:MM:SS.mmm' cues.
export function segmentsToVTT(segments) {
  const out = ['WEBVTT', '']
  for (const seg of segments || []) {
    const text = String(seg.text ?? '').trim()
    if (!text) continue
    const start = Number(seg.start) || 0
    let end = Number(seg.end)
    if (!Number.isFinite(end) || end <= start) end = start + 2
    out.push(`${secToVttTime(start)} --> ${secToVttTime(end)}`)
    out.push(text)
    out.push('')
  }
  return out.join('\n').trimEnd() + '\n'
}

// Serialize to a named format. fmt: 'txt' | 'srt' | 'vtt'. Returns { text, mime, ext }.
export function serializeTranscript(segments, fmt = 'txt') {
  const f = String(fmt || 'txt').toLowerCase()
  if (f === 'srt') return { text: segmentsToSRT(segments), mime: 'application/x-subrip', ext: 'srt' }
  if (f === 'vtt') return { text: segmentsToVTT(segments), mime: 'text/vtt', ext: 'vtt' }
  return { text: segmentsToTXT(segments), mime: 'text/plain', ext: 'txt' }
}
