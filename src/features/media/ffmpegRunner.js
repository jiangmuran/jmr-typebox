// Client-only ffmpeg.wasm engine. This module DEFINES functions that touch Worker/Blob/fetch,
// but it has NO top-level side effects, so importing it during SSG is safe. It is only ever
// invoked from event handlers / onMounted in the pages, behind a dynamic import().
//
// IMPORTANT (hosting): ffmpeg-core is ~31MB and exceeds Cloudflare's 25MB static-asset limit,
// so the user approved loading the core FROM THE OFFICIAL CDN at runtime via toBlobURL. We use
// the SINGLE-THREADED core (@ffmpeg/core, NOT core-mt) so we do NOT need SharedArrayBuffer or
// COOP/COEP headers. The small JS wrappers (@ffmpeg/ffmpeg, @ffmpeg/util) are bundled locally.
//
// Note: this requires network the FIRST time (to fetch the core). After that the browser cache
// usually serves it. There is no offline fallback for the core itself.

import { libLoadState, libMeta } from '../../utils/loadLibrary'

// Pin the core version so the CDN URL is reproducible. Keep in sync with the @ffmpeg/ffmpeg
// wrapper's expected core ABI (0.12.x core ↔ 0.12.x ffmpeg).
export const CORE_VERSION = '0.12.10'
export const CORE_CDN_BASE = `https://unpkg.com/@ffmpeg/core@${CORE_VERSION}/dist/umd`
// jsDelivr mirror used as a fallback if unpkg is unreachable.
export const CORE_CDN_FALLBACK = `https://cdn.jsdelivr.net/npm/@ffmpeg/core@${CORE_VERSION}/dist/umd`

const LIB_KEY = 'ffmpeg'
const CORE_SIZE_MB = 31 // approximate, for the "downloading N MB" hint

let _ffmpeg = null          // singleton FFmpeg instance
let _loadPromise = null     // dedupes concurrent load() calls
const _listeners = new Set() // progress/log subscribers: fn({ type, ... })

function emit(evt) {
  for (const fn of _listeners) { try { fn(evt) } catch { /* ignore subscriber errors */ } }
}

// Subscribe to engine events. Returns an unsubscribe fn.
//   onEngineEvent(({ type:'download', received, total, ratio }) => ...)
//   onEngineEvent(({ type:'progress', progress, time }) => ...)
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
      ffmpeg.on('log', ({ message }) => emit({ type: 'log', message }))
      ffmpeg.on('progress', ({ progress, time }) => emit({ type: 'progress', progress, time }))

      // Download the core JS + wasm from the CDN as blob URLs, reporting combined progress.
      // The wasm (~30MB) dominates; the JS shim is tiny.
      const progressByUrl = {}
      const totalsByUrl = {}
      const reportDownload = ({ url, received, total }) => {
        progressByUrl[url] = received
        if (total) totalsByUrl[url] = total
        const received2 = Object.values(progressByUrl).reduce((a, b) => a + b, 0)
        const total2 = Object.values(totalsByUrl).reduce((a, b) => a + b, 0)
        emit({ type: 'download', received: received2, total: total2, ratio: total2 ? received2 / total2 : 0 })
      }

      // Fetch the core pair from the primary CDN; if that fails (mirror down / blocked), retry the
      // whole pair from the jsDelivr fallback before giving up.
      const fetchCore = (base) => Promise.all([
        toBlobURL(`${base}/ffmpeg-core.js`, 'text/javascript', true, reportDownload),
        toBlobURL(`${base}/ffmpeg-core.wasm`, 'application/wasm', true, reportDownload),
      ])
      let coreURL, wasmURL
      try {
        [coreURL, wasmURL] = await fetchCore(CORE_CDN_BASE)
      } catch (primaryErr) {
        console.warn('[media] ffmpeg core CDN (unpkg) failed, trying jsDelivr…', primaryErr)
        ;[coreURL, wasmURL] = await fetchCore(CORE_CDN_FALLBACK)
      }

      // classWorkerURL is left to the default ('./worker.js'), which Vite resolves via the
      // `new URL('./worker.js', import.meta.url)` pattern in the wrapper. coreURL/wasmURL point
      // at the CDN blobs above. We deliberately do NOT pass workerURL (that is core-mt only).
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
//   onProgress: ({progress}) => void  — 0..1 transcode progress
// Returns a Blob. Cleans up the in-memory FS afterward.
export async function runFFmpeg({ files = [], args, outName, outMime = 'application/octet-stream', onProgress } = {}) {
  const ffmpeg = await loadFFmpeg()
  const { fetchFile } = await import('@ffmpeg/util')

  let unsub = null
  if (onProgress) {
    unsub = onEngineEvent((e) => {
      if (e.type === 'progress' && typeof e.progress === 'number') {
        onProgress({ progress: Math.max(0, Math.min(1, e.progress)) })
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
    onProgress?.({ progress: 1 })
    // out is a Uint8Array; copy into a fresh ArrayBuffer-backed blob.
    return new Blob([out], { type: outMime })
  } finally {
    unsub?.()
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
  _listeners.clear()
}
