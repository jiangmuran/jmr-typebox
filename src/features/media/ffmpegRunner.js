// Impure ffmpeg.wasm runtime glue for the Media suite. This module touches the network,
// web workers and Blobs, so it is imported LAZILY (only when a conversion is requested) and
// never at app/SSG load time. Pure arg/format logic lives in mediaHelpers.js and is tested
// separately; the wasm run itself is intentionally NOT unit-tested.

import { loadLibrary } from '../../utils/loadLibrary'
import { buildFfmpegArgs, virtualNames, mimeForFormat } from './mediaHelpers'

// Self-hosted single-thread core (copied into public/ffmpeg/ from @ffmpeg/core). The
// single-thread build does NOT require COOP/COEP cross-origin isolation, so this works on
// plain static hosting (e.g. GitHub Pages / a CDN) without special response headers.
const CORE_URL = '/ffmpeg/ffmpeg-core.js'
const WASM_URL = '/ffmpeg/ffmpeg-core.wasm'

// Approx download weight of the core wasm — surfaced in the UI via libLoadState/libMeta.
export const FFMPEG_CORE_SIZE_MB = 31

let ffmpegInstance = null      // the loaded FFmpeg instance (singleton)
let loadPromise = null         // dedupes concurrent load() calls
let blobUrls = []              // object URLs created for the core, revoked on demand

// Lazily import @ffmpeg/ffmpeg through loadLibrary so the shared spinner/size hint
// ("downloading ~31MB") works exactly like Pyodide and other heavy libs.
function importFfmpeg() {
  return loadLibrary('ffmpeg', () => import('@ffmpeg/ffmpeg'), { sizeMB: FFMPEG_CORE_SIZE_MB })
}

// Get a loaded, ready-to-use FFmpeg instance. Optional callbacks:
//   onLog(message)   — raw ffmpeg log lines (stderr)
//   onProgress({ progress, time }) — 0..1 conversion progress when ffmpeg reports it
export async function getFfmpeg({ onLog, onProgress } = {}) {
  if (ffmpegInstance && ffmpegInstance.loaded) {
    bindCallbacks(ffmpegInstance, { onLog, onProgress })
    return ffmpegInstance
  }
  if (loadPromise) {
    await loadPromise
    bindCallbacks(ffmpegInstance, { onLog, onProgress })
    return ffmpegInstance
  }

  loadPromise = (async () => {
    const mod = await importFfmpeg()
    const { FFmpeg } = mod
    const { toBlobURL } = await import('@ffmpeg/util')

    const ffmpeg = new FFmpeg()
    bindCallbacks(ffmpeg, { onLog, onProgress })

    // Fetch the self-hosted core as blob URLs. This sidesteps any cross-origin worker
    // quirks and lets the browser/HTTP cache keep the 31MB wasm after first use.
    const coreURL = await toBlobURL(CORE_URL, 'text/javascript')
    const wasmURL = await toBlobURL(WASM_URL, 'application/wasm')
    blobUrls = [coreURL, wasmURL]

    await ffmpeg.load({ coreURL, wasmURL })
    ffmpegInstance = ffmpeg
    return ffmpeg
  })()

  try {
    await loadPromise
  } catch (err) {
    loadPromise = null // allow retry after a failed load
    throw err
  }
  return ffmpegInstance
}

// (Re)attach log/progress listeners. We clear prior listeners by re-creating arrays via
// the public on() API each call would stack handlers, so we track and guard instead.
let boundLog = null
let boundProgress = null
function bindCallbacks(ffmpeg, { onLog, onProgress }) {
  if (!ffmpeg) return
  if (onLog && onLog !== boundLog) {
    ffmpeg.on('log', ({ message }) => onLog(message))
    boundLog = onLog
  }
  if (onProgress && onProgress !== boundProgress) {
    // ffmpeg reports { progress: 0..1, time } during exec.
    ffmpeg.on('progress', ({ progress, time }) => onProgress({ progress, time }))
    boundProgress = onProgress
  }
}

// Run a single audio conversion fully in-browser and return a Blob of the result.
//   convertAudio(File|Blob|Uint8Array, { inputFormat, outputFormat, options, onLog, onProgress })
// Pipeline: writeFile(input) -> exec(['-i', input, ...args, output]) -> readFile(output).
export async function convertAudio(file, {
  inputFormat,
  outputFormat,
  options = {},
  onLog,
  onProgress,
} = {}) {
  const { fetchFile } = await import('@ffmpeg/util')
  const ffmpeg = await getFfmpeg({ onLog, onProgress })

  const { input, output } = virtualNames(inputFormat, outputFormat)
  const args = buildFfmpegArgs({ inputFile: input, outputFile: output, outputFormat, options })

  await ffmpeg.writeFile(input, await fetchFile(file))
  const code = await ffmpeg.exec(args)
  if (code !== 0) {
    await safeDelete(ffmpeg, input)
    throw new Error(`ffmpeg exited with code ${code}`)
  }

  const data = await ffmpeg.readFile(output) // Uint8Array
  // Clean up the virtual FS so repeated conversions don't leak memory.
  await safeDelete(ffmpeg, input)
  await safeDelete(ffmpeg, output)

  // data may be a Uint8Array; copy into a fresh ArrayBuffer for a clean Blob.
  return new Blob([data.buffer ? data.slice() : data], { type: mimeForFormat(outputFormat) })
}

async function safeDelete(ffmpeg, path) {
  try { await ffmpeg.deleteFile(path) } catch { /* file may not exist — ignore */ }
}

// Free the loaded core (used by tests / clear-all). Best-effort.
export function _terminateFfmpeg() {
  try { ffmpegInstance?.terminate?.() } catch {}
  blobUrls.forEach(u => { try { URL.revokeObjectURL(u) } catch {} })
  blobUrls = []
  ffmpegInstance = null
  loadPromise = null
  boundLog = null
  boundProgress = null
}
