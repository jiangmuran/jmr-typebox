// Client-only ffmpeg.wasm engine. This module DEFINES functions that touch Worker/Blob/fetch,
// but it has NO top-level side effects, so importing it during SSG is safe. It is only ever
// invoked from event handlers / onMounted in the pages, behind a dynamic import().
//
// IMPORTANT (hosting): ffmpeg-core is ~31MB and exceeds Cloudflare's 25MB static-asset limit,
// so the user approved loading the core FROM THE OFFICIAL CDN at runtime via toBlobURL. We use
// the SINGLE-THREADED core (@ffmpeg/core, NOT core-mt) so we do NOT need SharedArrayBuffer or
// COOP/COEP headers. The small JS wrappers (@ffmpeg/ffmpeg, @ffmpeg/util) are bundled locally.
//
// ---------------------------------------------------------------------------
// WHY THE OLD CODE FAILED IN PRODUCTION ("failed to import ffmpeg-core.js")
// ---------------------------------------------------------------------------
// @ffmpeg/ffmpeg@0.12 ALWAYS spawns its worker with `{ type: "module" }` (see
// node_modules/@ffmpeg/ffmpeg/dist/esm/classes.js — even a custom classWorkerURL is loaded as a
// module). Inside the worker, load() first tries `importScripts(coreURL)`. But `importScripts` is
// NOT defined in a MODULE worker, so it throws; the bare `catch {}` then falls back to
// `await import(coreURL)`. The predecessor pointed coreURL at the UMD core
// (`/dist/umd/ffmpeg-core.js`), which is a classic script (`var createFFmpegCore = …`), NOT an ES
// module — so `import()`-ing that blob fails and the worker throws ERROR_IMPORT_FAILURE, surfaced
// as "failed to import ffmpeg-core.js". (It can appear to work in some dev setups but fails in the
// built/module-worker path, which is exactly what real users hit.)
//
// THE FIX: load the **ESM** core (`/dist/esm/ffmpeg-core.js`). It is a real ES module
// (`export default createFFmpegCore`), single-threaded, and — critically — does NOT perform any
// internal dynamic `import()` of sub-chunks, so it imports cleanly from a blob URL inside the
// module worker. The wasm location is carried in the `#<base64>` hash the wrapper appends to
// mainScriptUrlOrBlob, which the core decodes via locateFile — identical for ESM and UMD, so our
// CDN wasm blob is found. No worker-type hacking, no COOP/COEP, no self-hosting the 31MB core.
//
// Note: this requires network the FIRST time (to fetch the core). After that we store the core in
// a durable named Cache API bucket (`tb-ffmpeg-v1`) and serve it from there on every subsequent
// load — so the 31MB is fetched from the network exactly once and survives reloads/restarts (see
// cachedBlobURL / isRuntimeCached below). There is no offline fallback for the very first fetch.

import { libLoadState, libMeta } from '../../utils/loadLibrary'

// Pin the core version so the CDN URL is reproducible. The @ffmpeg/ffmpeg@0.12.15 wrapper targets
// the 0.12.x core ABI (its bundled CORE_URL points at 0.12.9); 0.12.10 is the latest 0.12.x core
// and is ABI-compatible. Keep this in lockstep with the wrapper's major.minor.
export const CORE_VERSION = '0.12.10'
// We load the ESM core (NOT umd) — see the header note.
// CDN order: unpkg FIRST. In real-browser testing, jsDelivr serves the wasm with a Content-Length
// that doesn't match the (compressed) streamed bytes, which trips @ffmpeg/util's
// ERROR_INCOMPLETED_DOWNLOAD → "body stream already read" and fails toBlobURL. unpkg streams a
// matching length and loads cleanly, so it's primary; jsDelivr remains a fallback for when unpkg
// is unreachable (its mismatch is tolerated by our own fallback fetch below).
export const CORE_CDN_BASE = `https://unpkg.com/@ffmpeg/core@${CORE_VERSION}/dist/esm`
export const CORE_CDN_FALLBACK = `https://cdn.jsdelivr.net/npm/@ffmpeg/core@${CORE_VERSION}/dist/esm`

const LIB_KEY = 'ffmpeg'
const CORE_SIZE_MB = 31 // approximate, for the "downloading N MB" hint

// ---------------------------------------------------------------------------
// DURABLE caching of the big core via the Cache API (Bug 2: "ffmpeg 也没有缓存")
// ---------------------------------------------------------------------------
// The ~31MB core re-downloaded on every page load because we built blob URLs with a plain
// toBlobURL (no persistence). We now store the fetched core `.js` + `.wasm` Responses in a NAMED
// Cache (`tb-ffmpeg-v1`), keyed by their CDN URL, and serve from it on subsequent loads — so the
// core hits the network only ONCE and survives reloads/restarts (the Cache API is disk-backed and
// origin-scoped). Blob URLs themselves are per-session and cannot be cached; we cache the bytes and
// mint a fresh object URL from them each load. Requires a secure context (https, or localhost),
// which production (box.muran.tech) and dev both satisfy; if `caches` is missing we degrade to a
// plain network fetch so the engine still loads.
export const FFMPEG_CACHE = 'tb-ffmpeg-v1'

// The exact asset URLs (primary CDN) that make up the runtime — used by isRuntimeCached() for the
// "runtime cached / will download ~31MB" UI hint.
function coreAssetUrls(base = CORE_CDN_BASE) {
  return [`${base}/ffmpeg-core.js`, `${base}/ffmpeg-core.wasm`]
}

function cacheStorage() {
  // `caches` is only defined in a secure context with the Cache API available.
  return (typeof caches !== 'undefined' && caches) ? caches : null
}

// Have we already cached the core assets (from a previous visit)? Used purely for the UI hint, so
// it must never throw — any failure (no Cache API, private mode, etc.) resolves to false.
export async function isRuntimeCached() {
  if (_ffmpeg?.loaded) return true
  const cs = cacheStorage()
  if (!cs) return false
  try {
    const cache = await cs.open(FFMPEG_CACHE)
    // Consider it cached only if BOTH the js and wasm are present (either CDN base counts).
    for (const base of [CORE_CDN_BASE, CORE_CDN_FALLBACK]) {
      const hits = await Promise.all(coreAssetUrls(base).map((u) => cache.match(u)))
      if (hits.every(Boolean)) return true
    }
    return false
  } catch { return false }
}

// Stream a response body to a Uint8Array, reporting progress via `onChunk({ url, received, total })`.
// Tolerates a Content-Length that doesn't match the streamed byte count (compressed transfer) — we
// never throw on a mismatch (that quirk previously bricked toBlobURL on some CDNs). Returns the
// assembled bytes so the caller can both cache them AND build a blob URL.
async function streamToBytes(resp, url, onChunk) {
  const total = parseInt(resp.headers.get('Content-Length') || '-1', 10)
  const reader = resp.body?.getReader?.()
  if (!reader) {
    // No streaming reader (or opaque response): fall back to a single buffered read.
    const buf = new Uint8Array(await resp.arrayBuffer())
    onChunk?.({ url, received: buf.length, total: buf.length })
    return buf
  }
  const chunks = []
  let received = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    received += value.length
    onChunk?.({ url, received, total: total > 0 ? total : received })
  }
  const out = new Uint8Array(received)
  let pos = 0
  for (const c of chunks) { out.set(c, pos); pos += c.length }
  onChunk?.({ url, received, total: total > 0 ? total : received })
  return out
}

// cachedBlobURL(url, mime, onChunk) — the durable replacement for toBlobURL:
//   1. cache.match(url) → if HIT, read the stored bytes (no network), report it as fully received,
//      and return a fresh object URL.
//   2. on MISS, fetch+stream (reporting download progress), cache.put a fresh typed Response under
//      the URL, then return an object URL.
// Always resolves to a usable blob URL even if the Cache API is unavailable (degrades to a plain
// streamed fetch with no persistence).
export async function cachedBlobURL(url, mime, onChunk) {
  const cs = cacheStorage()
  let cache = null
  if (cs) { try { cache = await cs.open(FFMPEG_CACHE) } catch { cache = null } }

  // 1) Cache hit → serve instantly from disk.
  if (cache) {
    try {
      const hit = await cache.match(url)
      if (hit) {
        const blob = await hit.blob()
        const typed = blob.type === mime ? blob : new Blob([blob], { type: mime })
        // Report as a completed download so the progress bar fills (and we know it was free).
        onChunk?.({ url, received: typed.size, total: typed.size, cached: true })
        return URL.createObjectURL(typed)
      }
    } catch { /* fall through to network */ }
  }

  // 2) Cache miss → stream from the network, persist, and return a blob URL.
  const resp = await fetch(url)
  if (!resp.ok) throw new Error(`fetch ${url} → HTTP ${resp.status}`)
  const bytes = await streamToBytes(resp, url, onChunk)
  const blob = new Blob([bytes], { type: mime })
  if (cache) {
    try {
      // Store a fresh Response with a correct content-type + length (independent of the stream).
      await cache.put(url, new Response(blob, {
        headers: { 'Content-Type': mime, 'Content-Length': String(blob.size) },
      }))
    } catch { /* cache write is best-effort; the engine still loads from the blob URL */ }
  }
  return URL.createObjectURL(blob)
}

// Test/diagnostic helper: drop the cached runtime so the next load re-fetches.
export async function clearRuntimeCache() {
  const cs = cacheStorage()
  if (!cs) return false
  try { return await cs.delete(FFMPEG_CACHE) } catch { return false }
}

let _ffmpeg = null          // singleton FFmpeg instance
let _loadPromise = null     // dedupes concurrent load() calls
const _listeners = new Set() // progress/log subscribers: fn({ type, ... })

// Probe duration (seconds) parsed from ffmpeg's log for the *current* job, so we can derive a sane
// progress percentage even when the core's own `progress` ratio is unreliable (it sometimes emits
// garbage like a huge negative number before the muxer knows the total — that was the source of
// the "-604120800%" bug). Set per-run by runFFmpeg.
let _expectedDurationSec = 0

function emit(evt) {
  for (const fn of _listeners) { try { fn(evt) } catch { /* ignore subscriber errors */ } }
}

// Parse "Duration: HH:MM:SS.xx" out of an ffmpeg log line → seconds, or null.
function parseDurationLine(message) {
  const m = /Duration:\s*(\d+):(\d{2}):(\d{2})(?:\.(\d+))?/.exec(message || '')
  if (!m) return null
  const [, h, mm, ss, frac] = m
  return (+h) * 3600 + (+mm) * 60 + (+ss) + (frac ? +`0.${frac}` : 0)
}

// Parse "time=HH:MM:SS.xx" out of an ffmpeg progress log line → seconds, or null.
function parseTimeLine(message) {
  const m = /time=\s*(\d+):(\d{2}):(\d{2})(?:\.(\d+))?/.exec(message || '')
  if (!m) return null
  const [, h, mm, ss, frac] = m
  return (+h) * 3600 + (+mm) * 60 + (+ss) + (frac ? +`0.${frac}` : 0)
}

// Pure accumulator for multi-asset DOWNLOAD progress. Tracks received/total per URL and returns a
// combined { received, total, ratio } where ratio is ALWAYS clamped to [0,1]. Servers sometimes
// under-report Content-Length for compressed payloads (received > total), which is exactly what
// produced the ">100%"/"695%" download bar — so we cap per-URL received at its total. Exported so
// the math is unit-tested deterministically (browser timing makes intermediate capture flaky).
export function makeDownloadProgress() {
  const receivedByUrl = {}
  const totalByUrl = {}
  return {
    update({ url, received, total }) {
      const capped = total ? Math.min(received, total) : received
      receivedByUrl[url] = capped
      if (total) totalByUrl[url] = total
      const received2 = Object.values(receivedByUrl).reduce((a, b) => a + b, 0)
      const total2 = Object.values(totalByUrl).reduce((a, b) => a + b, 0)
      const ratio = total2 ? Math.max(0, Math.min(1, received2 / total2)) : 0
      return { received: received2, total: total2, ratio }
    },
    reset() {
      for (const k of Object.keys(receivedByUrl)) delete receivedByUrl[k]
      for (const k of Object.keys(totalByUrl)) delete totalByUrl[k]
    },
  }
}

// Clamp a raw ffmpeg progress ratio (native event or time/duration) to a sane [0,1], dropping
// non-finite garbage. Exported for unit testing the "-604120800%" guard.
export function sanitizeProgress(p) {
  if (typeof p !== 'number' || !Number.isFinite(p)) return null
  return Math.max(0, Math.min(1, p))
}

// Subscribe to engine events. Returns an unsubscribe fn.
//   onEngineEvent(({ type:'download', received, total, ratio }) => ...)
//   onEngineEvent(({ type:'progress', progress, time }) => ...)   // progress is a clamped 0..1
//   onEngineEvent(({ type:'log', message }) => ...)
export function onEngineEvent(fn) {
  _listeners.add(fn)
  return () => _listeners.delete(fn)
}

export function isEngineLoaded() {
  return !!_ffmpeg?.loaded
}

// Load ffmpeg once. Reports download progress for the big core via onEngineEvent.
export async function loadFFmpeg() {
  if (_ffmpeg?.loaded) return _ffmpeg
  if (_loadPromise) return _loadPromise

  _loadPromise = (async () => {
    libLoadState[LIB_KEY] = 'loading'
    libMeta[LIB_KEY] = { sizeMB: CORE_SIZE_MB }
    try {
      const { FFmpeg } = await import('@ffmpeg/ffmpeg')

      const ffmpeg = new FFmpeg()
      ffmpeg.on('log', ({ message }) => {
        emit({ type: 'log', message })
        // Mine the log for duration/time so we can compute a robust percentage (see runFFmpeg).
        if (_expectedDurationSec <= 0) {
          const d = parseDurationLine(message)
          if (d && d > 0) _expectedDurationSec = d
        }
        const tt = parseTimeLine(message)
        if (tt != null && _expectedDurationSec > 0) {
          const p = Math.max(0, Math.min(1, tt / _expectedDurationSec))
          emit({ type: 'progress', progress: p, time: tt, source: 'log' })
        }
      })
      // The core's native progress event. Its `progress` is usually 0..1 but is occasionally bogus
      // (>1 or negative / NaN) — sanitize hard so the UI never shows nonsense like "-604120800%".
      ffmpeg.on('progress', ({ progress, time }) => {
        const p = sanitizeProgress(progress)
        if (p != null) emit({ type: 'progress', progress: p, time, source: 'native' })
      })

      // Download the core JS + wasm from the CDN as blob URLs, reporting combined (clamped) progress
      // via the unit-tested accumulator. The wasm (~30MB) dominates; the JS shim is tiny.
      const dlProgress = makeDownloadProgress()
      const resetTallies = () => dlProgress.reset()
      let anyFromNetwork = false
      const reportDownload = ({ url, received, total, cached }) => {
        if (!cached) anyFromNetwork = true
        // `fromCache` is true only while every asset reported so far came from the Cache API — lets
        // the UI label an instant (no-network) load. Flips false the moment any asset streams.
        emit({ type: 'download', fromCache: !anyFromNetwork, ...dlProgress.update({ url, received, total }) })
      }

      // Durable single-asset fetch: cachedBlobURL serves the bytes from the `tb-ffmpeg-v1` Cache on
      // repeat loads (network ONCE), streaming with progress on a cache miss. It tolerates a
      // Content-Length mismatch (the jsDelivr quirk that used to brick toBlobURL) and degrades to a
      // plain fetch when the Cache API is unavailable, so a CDN/cache quirk can't brick the engine.
      const fetchCore = (base) => Promise.all([
        cachedBlobURL(`${base}/ffmpeg-core.js`, 'text/javascript', reportDownload),
        cachedBlobURL(`${base}/ffmpeg-core.wasm`, 'application/wasm', reportDownload),
      ])
      let coreURL, wasmURL
      try {
        [coreURL, wasmURL] = await fetchCore(CORE_CDN_BASE)
      } catch (primaryErr) {
        console.warn('[media] ffmpeg core CDN (unpkg) failed, trying jsDelivr…', primaryErr)
        resetTallies() // restart the bar cleanly on the fallback
        ;[coreURL, wasmURL] = await fetchCore(CORE_CDN_FALLBACK)
      }

      // We pass coreURL (the ESM core blob) + wasmURL. The wrapper's module worker will fail the
      // `importScripts(coreURL)` line (not available in a module worker) and fall back to
      // `import(coreURL)`, which SUCCEEDS because coreURL is now a real ES module. We deliberately
      // do NOT pass workerURL (that is core-mt only).
      await ffmpeg.load({ coreURL, wasmURL })

      _ffmpeg = ffmpeg
      libLoadState[LIB_KEY] = 'ready'
      return ffmpeg
    } catch (err) {
      libLoadState[LIB_KEY] = 'error'
      _loadPromise = null // allow retry
      throw err
    }
  })()

  return _loadPromise
}

// Run an arbitrary ffmpeg job. Caller supplies:
//   files:  [{ name, data }]  — written to the in-memory FS before exec (data: Uint8Array|Blob|File)
//   args:   string[]          — the ffmpeg command
//   outName:string            — the file to read back
//   outMime:string            — MIME for the returned Blob
//   durationSec: number       — (optional) known input duration, used to seed the % bar before the
//                               core logs its own "Duration:" line. Improves the early progress UX.
//   onProgress: ({progress}) => void  — 0..1 transcode progress (already clamped & sane)
// Returns a Blob. Cleans up the in-memory FS afterward.
export async function runFFmpeg({ files = [], args, outName, outMime = 'application/octet-stream', durationSec = 0, onProgress } = {}) {
  const ffmpeg = await loadFFmpeg()
  const { fetchFile } = await import('@ffmpeg/util')

  // Seed the duration so log-derived progress works from the first frame; the core's own
  // "Duration:" log line will refine it if our estimate was 0.
  _expectedDurationSec = Number.isFinite(Number(durationSec)) && Number(durationSec) > 0 ? Number(durationSec) : 0

  let unsub = null
  let lastPct = 0
  if (onProgress) {
    unsub = onEngineEvent((e) => {
      if (e.type === 'progress' && typeof e.progress === 'number' && Number.isFinite(e.progress)) {
        // Clamp + monotonic: progress should never jump backwards on screen.
        const p = Math.max(0, Math.min(1, e.progress))
        if (p >= lastPct - 0.001) { lastPct = Math.max(lastPct, p); onProgress({ progress: lastPct }) }
      }
    })
  }

  const written = []
  try {
    for (const f of files) {
      const raw = f.data instanceof Uint8Array ? f.data : await fetchFile(f.data)
      // ffmpeg.writeFile() TRANSFERS the Uint8Array's ArrayBuffer to the worker, DETACHING it here.
      // If the caller reuses that buffer (e.g. converts the same picked file twice, or passes a
      // shared Uint8Array), the next writeFile throws "ArrayBuffer ... is already detached". Always
      // hand the worker a fresh copy so each write is self-contained and the caller's bytes survive.
      const data = raw.slice()
      await ffmpeg.writeFile(f.name, data)
      written.push(f.name)
    }

    const code = await ffmpeg.exec(args)
    if (code !== 0) throw new Error(`ffmpeg exited with code ${code}`)

    const out = await ffmpeg.readFile(outName)
    if (!out || (out.length != null && out.length === 0)) {
      throw new Error('ffmpeg produced an empty output (check the arguments / input)')
    }
    onProgress?.({ progress: 1 })
    // out is a Uint8Array; copy into a fresh ArrayBuffer-backed blob.
    return new Blob([out], { type: outMime })
  } finally {
    unsub?.()
    _expectedDurationSec = 0
    // Best-effort cleanup so repeated jobs don't leak the in-memory FS.
    for (const name of written) { try { await ffmpeg.deleteFile(name) } catch { /* ignore */ } }
    try { await ffmpeg.deleteFile(outName) } catch { /* ignore */ }
  }
}

// Run a metadata-PROBE job: write the input, exec the args (e.g. `-f ffmetadata meta.txt`), and read
// back a TEXT output file as a utf8 string while capturing the full ffmpeg LOG (for stream/technical
// info parsing). Unlike runFFmpeg this returns text + log rather than a Blob, and tolerates a
// non-zero exit code AS LONG AS the requested text file was produced (ffmpeg sometimes returns
// non-zero when there is "nothing to write" yet still emits a valid ffmetadata file).
//   probeMetadata({ files, args, textOut }) -> { text, log }
export async function probeMetadata({ files = [], args, textOut = 'meta.txt' } = {}) {
  const ffmpeg = await loadFFmpeg()
  const { fetchFile } = await import('@ffmpeg/util')

  const logLines = []
  const offLog = onEngineEvent((e) => { if (e.type === 'log' && typeof e.message === 'string') logLines.push(e.message) })

  const written = []
  try {
    for (const f of files) {
      const raw = f.data instanceof Uint8Array ? f.data : await fetchFile(f.data)
      // Copy: writeFile transfers (detaches) the buffer; keep the caller's bytes reusable.
      await ffmpeg.writeFile(f.name, raw.slice())
      written.push(f.name)
    }
    // Ignore the exit code: a valid ffmetadata file can be produced even on a non-zero return.
    await ffmpeg.exec(args)
    let text = ''
    try { text = await ffmpeg.readFile(textOut, 'utf8') } catch { text = '' }
    return { text: typeof text === 'string' ? text : '', log: logLines.join('\n') }
  } finally {
    offLog()
    for (const name of written) { try { await ffmpeg.deleteFile(name) } catch { /* ignore */ } }
    try { await ffmpeg.deleteFile(textOut) } catch { /* ignore */ }
  }
}

// Test/teardown hook.
export function _resetEngine() {
  try { _ffmpeg?.terminate?.() } catch { /* ignore */ }
  _ffmpeg = null
  _loadPromise = null
  _expectedDurationSec = 0
  _listeners.clear()
}
