// Pure, SSG-safe helpers for the Subtitle Studio: parse & serialize subtitle formats (SRT / VTT /
// LRC), edit an ordered list of segments (split / merge / add / delete / retime / global offset),
// look up the active segment for a playback time, and describe the styling presets + the pure
// text-wrap / fade math the canvas renderer draws with. NO browser globals here (no window / canvas
// / MediaRecorder) — everything operates on plain values so it is unit-testable in node and safe to
// import anywhere. The client-only canvas drawing + recording lives in ./subtitleRender.
//
// A "segment" is { start, end, text } in seconds. Callers may carry extra props (e.g. a UI `id`);
// the position-preserving edit ops keep them, so Vue list keys stay stable across edits.
import { segmentsToSRT, segmentsToVTT, secToSrtTime } from './asrHelpers'
import { parseLrc, looksLikeLrc } from './lrc'

// The font size in a preset is authored at this canvas height; the renderer scales it to the real
// output height so the on-screen preview matches the exported frame proportionally.
export const BASE_HEIGHT = 720

// Tail (seconds) given to the final LRC line, which has no explicit end in the format.
const LRC_TAIL = 4

// ---------------------------------------------------------------------------
// Timestamp parsing / formatting
// ---------------------------------------------------------------------------

// Parse 'HH:MM:SS,mmm' / 'HH:MM:SS.mmm' / 'MM:SS.mmm' / 'SS.mmm' → seconds (NaN if unparseable).
export function parseTimestamp(ts) {
  const s = String(ts == null ? '' : ts).trim().replace(',', '.')
  if (!s) return NaN
  const parts = s.split(':')
  let h = 0, m = 0, sec = 0
  if (parts.length === 3) { h = parseInt(parts[0], 10); m = parseInt(parts[1], 10); sec = parseFloat(parts[2]) }
  else if (parts.length === 2) { m = parseInt(parts[0], 10); sec = parseFloat(parts[1]) }
  else { sec = parseFloat(parts[0]) }
  if (![h, m, sec].every((n) => Number.isFinite(n))) return NaN
  return h * 3600 + m * 60 + sec
}

const pad2 = (n) => String(n).padStart(2, '0')

// Seconds → LRC timestamp 'mm:ss.xx' (centiseconds; minutes are not wrapped to hours).
export function secToLrcTime(sec) {
  let s = Math.max(0, Number(sec) || 0)
  let m = Math.floor(s / 60)
  let rem = s - m * 60
  let ss = Math.floor(rem)
  let cs = Math.round((rem - ss) * 100)
  if (cs >= 100) { cs -= 100; ss += 1 }
  if (ss >= 60) { ss -= 60; m += 1 }
  return `${pad2(m)}:${pad2(ss)}.${pad2(cs)}`
}

// Strip HTML/VTT inline tags (<c>, <i>, <00:00:01.000>) and ASS override blocks ({\an8}).
function stripCueTags(s) {
  return String(s == null ? '' : s).replace(/<[^>]*>/g, '').replace(/\{\\[^}]*\}/g, '')
}

// ---------------------------------------------------------------------------
// Segment normalization
// ---------------------------------------------------------------------------

// Coerce, clamp (0 ≤ start ≤ end) and sort a raw segment list by start. Preserves any extra props
// (e.g. a UI id) via spread. Used on import; live edits use the position-preserving ops below.
export function normalizeSegments(segs) {
  return (segs || [])
    .map((s) => {
      const start = Math.max(0, Number(s?.start) || 0)
      let end = Number(s?.end)
      if (!Number.isFinite(end) || end < start) end = start
      return { ...s, start, end, text: String(s?.text ?? '') }
    })
    .sort((a, b) => a.start - b.start || a.end - b.end)
}

// ---------------------------------------------------------------------------
// Parsing: SRT / VTT / LRC / plain text → segments
// ---------------------------------------------------------------------------

// Parse SubRip (.srt) OR WebVTT (.vtt) — one parser handles both: cue blocks are separated by blank
// lines; the timing line contains '-->' (comma or dot decimals), any numeric/id line before it and
// any cue settings after the end time are ignored; the remaining lines are the caption text.
export function parseSrtVtt(text) {
  const src = String(text == null ? '' : text).replace(/^﻿/, '').replace(/\r\n?/g, '\n')
  const TS = String.raw`\d{1,3}:\d{2}:\d{2}[.,]\d{1,3}|\d{1,3}:\d{2}[.,]\d{1,3}|\d{1,3}[.,]\d{1,3}`
  const cueRe = new RegExp(`(${TS})\\s*-->\\s*(${TS})`)
  const segs = []
  for (const block of src.split(/\n{2,}/)) {
    const lines = block.split('\n')
    const idx = lines.findIndex((l) => l.includes('-->'))
    if (idx < 0) continue
    const m = lines[idx].match(cueRe)
    if (!m) continue
    const start = parseTimestamp(m[1])
    const end = parseTimestamp(m[2])
    if (!Number.isFinite(start)) continue
    const body = stripCueTags(lines.slice(idx + 1).join('\n')).trim()
    segs.push({ start, end: Number.isFinite(end) && end > start ? end : start, text: body })
  }
  return normalizeSegments(segs)
}

// Parse LRC (synced lyrics) → segments. Each timed line becomes a segment whose end is the next
// timed line's start (LRC has no per-line end); the last line gets a short tail. Blank lyric lines
// act as terminators (they bound the previous segment but produce no segment themselves).
export function parseLrcToSegments(text) {
  const { lines, offset } = parseLrc(text)
  const timed = (lines || []).filter((l) => l.time >= 0)
  if (!timed.length) return segmentsFromPlainText((lines || []).map((l) => l.text).join('\n'))
  const segs = []
  for (let i = 0; i < timed.length; i++) {
    const start = Math.max(0, timed[i].time + offset)
    const nextRaw = timed[i + 1] ? Math.max(0, timed[i + 1].time + offset) : start + LRC_TAIL
    const body = String(timed[i].text || '').trim()
    if (!body) continue // blank line = gap / terminator
    segs.push({ start, end: nextRaw > start ? nextRaw : start + LRC_TAIL, text: body })
  }
  return normalizeSegments(segs)
}

// Split plain text into segments, one per non-empty line, spaced sequentially (a rough starting
// point the user can retime). Used for a plain-text transcript handoff or an unrecognized file.
export function segmentsFromPlainText(text, { perLineSec = 3 } = {}) {
  const lines = String(text == null ? '' : text).replace(/\r\n?/g, '\n').split('\n').map((l) => l.trim()).filter(Boolean)
  return lines.map((t, i) => ({ start: i * perLineSec, end: (i + 1) * perLineSec, text: t }))
}

// Sniff the subtitle format from a filename extension first, then the content.
export function detectSubtitleFormat(text, name = '') {
  const ext = String(name || '').toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] || ''
  if (ext === 'srt') return 'srt'
  if (ext === 'vtt') return 'vtt'
  if (ext === 'lrc') return 'lrc'
  const t = String(text == null ? '' : text)
  if (/^﻿?\s*WEBVTT/.test(t)) return 'vtt'
  if (t.includes('-->')) return 'srt'
  if (looksLikeLrc(t)) return 'lrc'
  return 'txt'
}

// Parse any supported subtitle text into segments, auto-detecting the format.
export function parseSubtitles(text, { name = '' } = {}) {
  const fmt = detectSubtitleFormat(text, name)
  if (fmt === 'lrc') return parseLrcToSegments(text)
  if (fmt === 'srt' || fmt === 'vtt') return parseSrtVtt(text)
  return segmentsFromPlainText(text)
}

// ---------------------------------------------------------------------------
// Serialization: segments → SRT / VTT / LRC
// ---------------------------------------------------------------------------

// SubRip / WebVTT reuse the shared ASR serializers (identical cue shape). LRC is added here.
// Segments → LRC. Emits optional [ti]/[ar]/[al] tags, then '[mm:ss.xx]text' per non-empty segment,
// plus a trailing empty stamp at the last end so a player knows when the lyrics stop.
export function segmentsToLRC(segments, meta = {}) {
  const out = []
  if (meta.ti) out.push(`[ti:${meta.ti}]`)
  if (meta.ar) out.push(`[ar:${meta.ar}]`)
  if (meta.al) out.push(`[al:${meta.al}]`)
  const segs = normalizeSegments(segments).filter((s) => String(s.text).trim())
  for (const s of segs) out.push(`[${secToLrcTime(s.start)}]${String(s.text).trim()}`)
  if (segs.length) out.push(`[${secToLrcTime(segs[segs.length - 1].end)}]`)
  return out.join('\n') + '\n'
}

// Serialize to a named subtitle format. fmt: 'srt' | 'vtt' | 'lrc'. Returns { text, mime, ext }.
export function serializeSubtitles(segments, fmt = 'srt', meta = {}) {
  const f = String(fmt || 'srt').toLowerCase()
  if (f === 'vtt') return { text: segmentsToVTT(segments), mime: 'text/vtt', ext: 'vtt' }
  if (f === 'lrc') return { text: segmentsToLRC(segments, meta), mime: 'text/plain', ext: 'lrc' }
  return { text: segmentsToSRT(segments), mime: 'application/x-subrip', ext: 'srt' }
}

export const SUBTITLE_EXPORT_FORMATS = ['srt', 'vtt', 'lrc']

// ---------------------------------------------------------------------------
// Segment editing (position-preserving; untouched segments keep their object identity)
// ---------------------------------------------------------------------------

// Split text at a fraction (0..1) of its length, preferring the nearest whitespace; for space-less
// text (e.g. CJK) it cuts at the character index. Returns { first, second } (trimmed).
export function splitTextByFraction(text, frac) {
  const t = String(text == null ? '' : text)
  if (!t.trim()) return { first: '', second: '' }
  const f = Math.max(0, Math.min(1, Number(frac) || 0))
  let cut = Math.round(t.length * f)
  if (/\s/.test(t)) {
    let best = -1, bestDist = Infinity
    for (let k = 0; k < t.length; k++) {
      if (/\s/.test(t[k])) { const d = Math.abs(k - cut); if (d < bestDist) { bestDist = d; best = k } }
    }
    if (best >= 0) cut = best
  }
  cut = Math.max(1, Math.min(t.length - 1, cut))
  return { first: t.slice(0, cut).trim(), second: t.slice(cut).trim() }
}

// Split segment i at `atSec` (defaults to the midpoint) into two, splitting the text proportionally.
export function splitSegment(segments, i, atSec) {
  const segs = (segments || []).slice()
  const s = segs[i]
  if (!s) return segments || []
  const at = Number.isFinite(atSec) && atSec > s.start && atSec < s.end ? atSec : (s.start + s.end) / 2
  const frac = s.end > s.start ? (at - s.start) / (s.end - s.start) : 0.5
  const { first, second } = splitTextByFraction(s.text, frac)
  segs.splice(i, 1,
    { start: s.start, end: at, text: first },
    { start: at, end: s.end, text: second })
  return segs
}

// Merge segment i with the following segment (i+1) into one spanning cue.
export function mergeSegments(segments, i) {
  const segs = (segments || []).slice()
  const a = segs[i]; const b = segs[i + 1]
  if (!a || !b) return segments || []
  const text = [a.text, b.text].map((x) => String(x ?? '').trim()).filter(Boolean).join(' ')
  segs.splice(i, 2, { start: Math.min(a.start, b.start), end: Math.max(a.end, b.end), text })
  return segs
}

// Insert a new (empty) segment after index i, timed to sit in the gap before the next cue.
export function addSegmentAfter(segments, i, { text = '', dur = 2 } = {}) {
  const segs = (segments || []).slice()
  const cur = segs[i]
  const next = segs[i + 1]
  let start, end
  if (cur) { start = cur.end; end = next ? Math.max(start + 0.2, Math.min(next.start, start + dur)) : start + dur }
  else if (next) { start = Math.max(0, next.start - dur); end = next.start }
  else { start = 0; end = dur }
  if (end <= start) end = start + dur
  segs.splice(i + 1, 0, { start, end, text })
  return segs
}

// Remove segment i.
export function deleteSegment(segments, i) {
  return (segments || []).filter((_, k) => k !== i)
}

// Replace segment i with { ...seg, ...patch }, clamping so 0 ≤ start ≤ end. Other segments keep
// their identity (new array, same refs) so list keys stay stable during editing.
export function updateSegment(segments, i, patch = {}) {
  const segs = (segments || []).slice()
  const s = segs[i]
  if (!s) return segments || []
  const merged = { ...s, ...patch }
  let start = Math.max(0, Number(merged.start) || 0)
  let end = Number(merged.end)
  if (!Number.isFinite(end)) end = start
  // If start was pushed past end, carry end along; if end pulled before start, clamp up.
  if ('start' in patch && !('end' in patch) && end < start) end = start
  if (end < start) end = start
  segs[i] = { ...merged, start, end, text: String(merged.text ?? '') }
  return segs
}

// Shift every segment by `deltaSec`, clamping to ≥ 0, and re-sort. Returns a NEW array.
export function applyOffset(segments, deltaSec) {
  const d = Number(deltaSec) || 0
  return normalizeSegments((segments || []).map((s) => ({
    ...s,
    start: Math.max(0, (Number(s.start) || 0) + d),
    end: Math.max(0, (Number(s.end) || 0) + d),
  })))
}

// ---------------------------------------------------------------------------
// Playback-time lookups (drive the waveform highlight + canvas preview/render)
// ---------------------------------------------------------------------------

// Index of the active segment for time t: the latest-starting segment whose [start, end) contains t,
// or -1 if none. Order-independent (handles overlaps and a mid-edit unsorted list) — a linear scan,
// which is trivially cheap for the segment counts a subtitle track has.
export function activeSegmentIndex(segments, t) {
  const time = Number(t) || 0
  let best = -1
  let bestStart = -Infinity
  const n = segments?.length || 0
  for (let i = 0; i < n; i++) {
    const s = segments[i]
    if (time >= s.start && time < s.end && s.start >= bestStart) { best = i; bestStart = s.start }
  }
  return best
}

// Opacity (0..1) of a caption at time t given a fade duration (seconds) at each edge. Outside the
// [start, end] window it's 0; with fade ≤ 0 it's a hard 1 inside the window.
export function fadeAlpha(t, start, end, fade = 0) {
  const time = Number(t) || 0
  if (time < start || time > end) return 0
  const f = Math.max(0, Number(fade) || 0)
  if (f <= 0) return 1
  return Math.max(0, Math.min(1, Math.min((time - start) / f, (end - time) / f)))
}

// ---------------------------------------------------------------------------
// Text wrapping (pure — the renderer injects a `measure(str)->width` from the canvas context)
// ---------------------------------------------------------------------------

// Greedy word-wrap to `maxWidth`, breaking on spaces; any single token wider than maxWidth (e.g. a
// long space-less CJK run) is broken character-by-character. `measure` returns a string's pixel
// width. Honors explicit '\n' as hard breaks. Returns an array of line strings.
export function wrapLines(text, maxWidth, measure) {
  const src = String(text == null ? '' : text)
  const width = Number(maxWidth) || 0
  const lines = []
  const charBreak = (word, seed) => {
    let chunk = seed
    for (const ch of word) {
      if (chunk && measure(chunk + ch) > width) { lines.push(chunk); chunk = '' }
      chunk += ch
    }
    return chunk
  }
  for (const paragraph of src.split('\n')) {
    const words = paragraph.split(/\s+/).filter((w) => w !== '')
    if (!words.length) { lines.push(''); continue }
    let line = ''
    for (const word of words) {
      const candidate = line ? line + ' ' + word : word
      if (width <= 0 || measure(candidate) <= width || line === '') {
        if (line === '' && width > 0 && measure(word) > width) line = charBreak(word, '')
        else line = candidate
      } else {
        lines.push(line)
        line = (width > 0 && measure(word) > width) ? charBreak(word, '') : word
      }
    }
    lines.push(line)
  }
  return lines
}

// ---------------------------------------------------------------------------
// Styling presets + render sizes
// ---------------------------------------------------------------------------

// A system-font stack: the browser resolves it to installed fonts, so CJK renders natively with no
// font files shipped (the core v1 decision). Latin + CJK fallbacks included.
export const SUBTITLE_FONT_STACK =
  '-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", "Hiragino Sans GB", "Segoe UI", Roboto, Arial, sans-serif'

// The two v1 presets. Positions: 'lower' (lower third) | 'center' | 'top'. Background: 'gradient'
// (preset colors) | 'cover' (blurred artwork, falls back to gradient when none). fontSize is at
// BASE_HEIGHT and scaled to the output height by the renderer.
export const STYLE_PRESETS = {
  minimal: {
    id: 'minimal', fontFamily: SUBTITLE_FONT_STACK, fontSize: 34, color: '#ffffff', bold: true,
    outline: true, outlineColor: 'rgba(0,0,0,0.85)', shadow: true, position: 'lower', align: 'center',
    background: 'gradient', gradient: ['#26262b', '#050506'], fade: 0.2,
  },
  lyric: {
    id: 'lyric', fontFamily: SUBTITLE_FONT_STACK, fontSize: 52, color: '#ffffff', bold: true,
    outline: false, outlineColor: 'rgba(0,0,0,0.6)', shadow: true, position: 'center', align: 'center',
    background: 'gradient', gradient: ['#3f3168', '#141026'], fade: 0.5,
  },
}

export const STYLE_PRESET_IDS = Object.keys(STYLE_PRESETS)

// Merge a preset with user overrides (undefined overrides are ignored so a control can be optional).
export function resolveStyle(presetId, overrides = {}) {
  const base = STYLE_PRESETS[presetId] || STYLE_PRESETS.minimal
  const clean = {}
  for (const k of Object.keys(overrides || {})) if (overrides[k] !== undefined) clean[k] = overrides[k]
  return { ...base, ...clean }
}

// Output canvas sizes for the render step (720-tall class keeps real-time recording feasible).
export const RENDER_SIZES = [
  { id: 'landscape', label: '16:9 · 1280×720', width: 1280, height: 720 },
  { id: 'square', label: '1:1 · 720×720', width: 720, height: 720 },
  { id: 'portrait', label: '9:16 · 720×1280', width: 720, height: 1280 },
]

export function renderSizeById(id) {
  return RENDER_SIZES.find((s) => s.id === id) || RENDER_SIZES[0]
}

// Convenience re-exports so pages can import all subtitle serialization from one module.
export { secToSrtTime }
