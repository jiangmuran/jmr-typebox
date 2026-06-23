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
// Note: this requires network the FIRST time (to fetch the core). After that the browser cache
// usually serves it. There is no offline fallback for the core itself.

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
      const [{ FFmpeg }, { toBlobURL }] = await Promise.all([
        import('@ffmpeg/ffmpeg'),
        import('@ffmpeg/util'),
      ])

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
      const reportDownload = ({ url, received, total }) => {
        emit({ type: 'download', ...dlProgress.update({ url, received, total }) })
      }

      // Robust single-asset fetch: try @ffmpeg/util's toBlobURL (which streams w/ progress), and if
      // it throws (e.g. jsDelivr's Content-Length mismatch → ERROR_INCOMPLETED_DOWNLOAD → "body
      // stream already read"), fall back to a plain fetch→blob URL so a CDN quirk can't brick us.
      const fetchAsset = async (url, mime) => {
        try {
          return await toBlobURL(url, mime, true, reportDownload)
        } catch (e) {
          console.warn('[media] streamed download failed, retrying as a plain fetch:', url, e)
          const resp = await fetch(url)
          if (!resp.ok) throw new Error(`fetch ${url} → HTTP ${resp.status}`)
          const blob = await resp.blob()
          // Re-type the blob to the expected MIME (some CDNs send octet-stream for .wasm).
          const typed = blob.type === mime ? blob : new Blob([blob], { type: mime })
          return URL.createObjectURL(typed)
        }
      }
      const fetchCore = (base) => Promise.all([
        fetchAsset(`${base}/ffmpeg-core.js`, 'text/javascript'),
        fetchAsset(`${base}/ffmpeg-core.wasm`, 'application/wasm'),
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
      const data = f.data instanceof Uint8Array ? f.data : await fetchFile(f.data)
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

// Test/teardown hook.
export function _resetEngine() {
  try { _ffmpeg?.terminate?.() } catch { /* ignore */ }
  _ffmpeg = null
  _loadPromise = null
  _expectedDurationSec = 0
  _listeners.clear()
}
