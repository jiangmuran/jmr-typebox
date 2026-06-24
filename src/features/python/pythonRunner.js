// Main-thread proxy to the Pyodide Web Worker. This module owns the Worker lifecycle and maps the
// postMessage protocol (see ./workerProtocol.js + ./pyworker.js) onto the Promise-based API the
// PythonIDE component already calls (runPython / callServer / installPackages / feedStdin). It is
// imported LAZILY (only when the user runs code), never at app/SSG load time, and it must NOT touch
// window/Worker at module top level — the Worker is created on first use inside getWorker().
//
// WHY A WORKER (the four reported bugs):
//   1. "全部输出完了才会显示" — Pyodide on the MAIN THREAD blocked repaint, so stdout only showed
//      after the program ended. The worker runs off-thread; we forward stdout/stderr chunks to the
//      UI as they arrive, so output streams LIVE.
//   2. "没法强制停止程序" — a main-thread infinite loop was unkillable. stopRun() calls
//      worker.terminate() (hard-kills the loop) and we respawn a fresh worker (re-init Pyodide),
//      surfaced to the UI as a "restarting runtime" status.
//   3/4. WSGI/ASGI preview navigation + new-window/fullscreen are handled in the component using
//      callServer() (which round-trips to the worker).
//
// No SharedArrayBuffer / COOP / COEP — the terminate-to-stop design needs none, which keeps the
// CDN-loaded ffmpeg + Pyodide and the analytics beacon working.
//
// BLOCKING input(): a Service Worker (public/pyodide-sw.js) lets the Pyodide worker pause on a
// synchronous XHR until the user types a line (see registerStdinSW + feedStdin below). No isolation
// headers needed. If the SW can't be registered/controlled, input() degrades to the pre-typed queue.

import { libLoadState, libMeta } from '../../utils/loadLibrary'
import { PYODIDE_SIZE_MB } from './pythonHelpers'
import { PROXY_PATH } from './pythonNet'
import {
  runRequest,
  installRequest,
  callServerRequest,
  stdinMessage,
  listPackagesRequest,
  uninstallRequest,
  cacheStatusRequest,
} from './workerProtocol'

export const PYODIDE_VERSION = '314.0.0'
export const PYODIDE_CDN_URL = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`

// ---- worker lifecycle --------------------------------------------------------------------
let worker = null
let runSeq = 0                 // monotonically increasing id per run/install/callServer
let proxyBase = ''            // full proxy endpoint (apiBase + PROXY_PATH)
let runtimeReady = false      // the current worker has finished loading Pyodide

// Per-id pending handlers: { onStdout, onStderr, onInput, resolve } for the in-flight op.
const pending = new Map()

// Subscribers for runtime-level status (download/init/ready, restart). Lets the UI show a
// "restarting runtime" banner after a Stop. fn({ phase }).
const statusSubs = new Set()
export function onRuntimeStatus(fn) {
  if (typeof fn !== 'function') return () => {}
  statusSubs.add(fn)
  return () => statusSubs.delete(fn)
}
function emitStatus(phase) {
  for (const fn of statusSubs) { try { fn({ phase }) } catch { /* ignore */ } }
}

// Mark the shared load-state flag the UI reads (mirrors loadLibrary so the first-run banner works
// without importing pyodide). We flip it from the worker's status messages.
function setLibState(state) {
  libLoadState.pyodide = state
  if (!libMeta.pyodide) libMeta.pyodide = { sizeMB: PYODIDE_SIZE_MB }
}

// Create (or return) the worker. The Worker URL uses import.meta.url so Vite bundles pyworker.js as
// a module worker. Created lazily on first run — never at import (SSG-safe).
function getWorker() {
  if (worker) return worker
  if (typeof window === 'undefined' || typeof Worker === 'undefined') {
    throw new Error('Web Worker unavailable in this environment')
  }
  setLibState('loading')
  worker = new Worker(new URL('./pyworker.js', import.meta.url), { type: 'module' })
  worker.onmessage = onWorkerMessage
  worker.onerror = (e) => {
    // A worker-level error (e.g. failed CDN import) rejects every in-flight op so the UI recovers.
    const err = (e && (e.message || e.error?.message)) || 'Python worker error'
    for (const [, h] of pending) { try { h.reject?.(new Error(err)) } catch { /* ignore */ } }
    pending.clear()
    setLibState('error')
  }
  // Hand the blocking-input SharedArrayBuffer to the new worker (if isolation gave us one).
  sendStdinBufferToWorker()
  return worker
}

// Route a worker message to the right pending op (by id) or to runtime-status subscribers.
function onWorkerMessage(e) {
  const msg = e.data || {}
  switch (msg.type) {
    case 'status':
      if (msg.phase === 'ready') { runtimeReady = true; setLibState('ready') }
      else { setLibState('loading') }
      emitStatus(msg.phase)
      return
    case 'progress': {
      const h = currentProgressHandler
      if (h) h({ loaded: msg.loaded, total: msg.total })
      return
    }
    case 'ready':
      runtimeReady = true
      setLibState('ready')
      return
    case 'stdout': { const h = pending.get(msg.id); h?.onStdout?.(msg.text); return }
    case 'stderr': { const h = pending.get(msg.id); h?.onStderr?.(msg.text); return }
    case 'input': {
      // The worker is now WAITING on input() (blocking-mode SAB or fallback). If the user pre-typed
      // a line before the program asked, deliver it now so the program resumes without stalling.
      if (blockingAvailable && stdinSAB && preStdin.length && Atomics.load(stdinCtrl, CTRL_STATE) === ST_WAITING) {
        deliverStdinLine(preStdin.shift())
      }
      const h = pending.get(msg.id); h?.onInput?.(); return
    }
    case 'result': {
      const h = pending.get(msg.id)
      pending.delete(msg.id)
      h?.resolve?.({ ok: msg.ok, result: msg.result, figures: msg.figures || [], error: msg.error || null, hasApp: !!msg.hasApp, appKind: msg.appKind || '' })
      return
    }
    case 'installed': {
      const h = pending.get(msg.id)
      pending.delete(msg.id)
      if (msg.ok) h?.resolve?.(true)
      else h?.reject?.(new Error(msg.error || 'Install failed'))
      return
    }
    case 'server': {
      const h = pending.get(msg.id)
      pending.delete(msg.id)
      h?.resolve?.(msg)
      return
    }
    case 'packages': {
      const h = pending.get(msg.id)
      pending.delete(msg.id)
      h?.resolve?.(msg.ok ? (msg.packages || []) : [])
      return
    }
    case 'uninstalled': {
      const h = pending.get(msg.id)
      pending.delete(msg.id)
      if (msg.ok) h?.resolve?.(true)
      else h?.reject?.(new Error(msg.error || 'Uninstall failed'))
      return
    }
    case 'cacheStatus': {
      const h = pending.get(msg.id)
      pending.delete(msg.id)
      h?.resolve?.({ runtimeCached: !!msg.runtimeCached })
      return
    }
    default:
      return
  }
}

// The progress callback for the CURRENT core download (only one load happens at a time).
let currentProgressHandler = null

// ---- public: stop / restart --------------------------------------------------------------
// Hard-stop a running program: terminate the worker (kills any infinite loop) and reject the
// in-flight run with a STOP marker so the caller can report "stopped". A fresh worker is spawned
// lazily on the next run (re-initialising Pyodide), which the UI shows as "restarting runtime".
export function stopRun() {
  if (!worker) return false
  const w = worker
  worker = null
  runtimeReady = false
  try { w.terminate() } catch { /* ignore */ }
  // Reset the blocking-input SAB so a stale WAITING state can't affect the next worker (the
  // terminated worker's Atomics.wait dies with it). The next worker gets a fresh SAB handle.
  if (blockingAvailable && stdinCtrl) { try { Atomics.store(stdinCtrl, CTRL_STATE, ST_IDLE) } catch { /* ignore */ } }
  preStdin = []
  // Reject every pending op; the run promise rejects with a recognisable code.
  for (const [, h] of pending) {
    try { h.reject?.(Object.assign(new Error('stopped'), { stopped: true })) } catch { /* ignore */ }
  }
  pending.clear()
  currentProgressHandler = null
  setLibState('idle')
  emitStatus('stopped')
  return true
}

// True once the current worker has Pyodide loaded (re-runs are instant).
export function isReady() { return runtimeReady }

// ---- public: proxy base ------------------------------------------------------------------
export function setProxyApiBase(apiBase = '') {
  proxyBase = `${String(apiBase || '')}${PROXY_PATH}`
}

// ---- BLOCKING input() via SharedArrayBuffer + Atomics ------------------------------------
// When a Python program calls input(), the Pyodide worker Atomics.wait()s on a SharedArrayBuffer —
// genuinely pausing the program — until the user types a line in the terminal. feedStdin() writes
// that line into the SAB and Atomics.notify()s, resuming the program (like a real TTY). SAB needs
// cross-origin isolation (COOP/COEP via public/_headers). If SAB is unavailable (not isolated /
// unsupported), we degrade to the pre-typed QUEUE (lines forwarded to the worker / seeded into the
// run request) — input() then consumes pre-typed lines, otherwise EOFs rather than blocking.
//
// SAB layout: control Int32Array(4) over [0,16) — [0]=STATE, [1]=LEN; data Uint8Array over [16,end)
// holding the UTF-8 line. STATE: IDLE 0 | WAITING 1 | READY 2 | EOF 3.
const ST_IDLE = 0, ST_WAITING = 1, ST_READY = 2, ST_EOF = 3
const CTRL_STATE = 0, CTRL_LEN = 1
const STDIN_DATA_OFFSET = 16
const STDIN_DATA_BYTES = 64 * 1024   // max line length the SAB carries (64KB)

let stdinSAB = null            // SharedArrayBuffer (or null → queue fallback)
let stdinCtrl = null           // Int32Array control view
let stdinData = null           // Uint8Array data view
let stdinEncoder = null
let blockingAvailable = false  // cross-origin isolated + SAB supported
let preStdin = []              // lines typed before the worker exists (queue fallback seed)

// Allocate the SAB once if the environment supports it (cross-origin isolated). Safe to call
// repeatedly. Returns whether blocking input is available.
export function registerStdinSW() {
  // (Name kept for the component's call site.) Initialise the SAB-backed blocking-input channel.
  if (stdinSAB || blockingAvailable) return Promise.resolve(blockingAvailable)
  try {
    const isolated = typeof self !== 'undefined' ? self.crossOriginIsolated : (typeof window !== 'undefined' && window.crossOriginIsolated)
    if (isolated && typeof SharedArrayBuffer !== 'undefined' && typeof Atomics !== 'undefined') {
      stdinSAB = new SharedArrayBuffer(STDIN_DATA_OFFSET + STDIN_DATA_BYTES)
      stdinCtrl = new Int32Array(stdinSAB, 0, 4)
      stdinData = new Uint8Array(stdinSAB, STDIN_DATA_OFFSET)
      stdinEncoder = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null
      Atomics.store(stdinCtrl, CTRL_STATE, ST_IDLE)
      blockingAvailable = true
    }
  } catch { blockingAvailable = false; stdinSAB = null }
  return Promise.resolve(blockingAvailable)
}

// True if blocking input() (SAB) is available.
export function stdinBlockingAvailable() { return blockingAvailable }

// Hand the SAB to a freshly-spawned worker (once) so its input() can block on it.
function sendStdinBufferToWorker() {
  if (worker && stdinSAB) {
    try { worker.postMessage({ type: 'stdinBuffer', buffer: stdinSAB }) } catch { /* ignore */ }
  }
}

// Write a line into the SAB and wake the blocked worker (READY), so the program's input() returns.
function deliverStdinLine(line) {
  if (!stdinSAB || !stdinCtrl) return false
  const bytes = stdinEncoder ? stdinEncoder.encode(line) : new Uint8Array([...line].map(c => c.charCodeAt(0) & 0xff))
  const n = Math.min(bytes.length, stdinData.length)
  stdinData.set(bytes.subarray(0, n))
  Atomics.store(stdinCtrl, CTRL_LEN, n)
  Atomics.store(stdinCtrl, CTRL_STATE, ST_READY)
  Atomics.notify(stdinCtrl, CTRL_STATE)
  return true
}

// Feed a line the user typed in the terminal. In blocking mode it goes through the SAB (resuming the
// paused program); otherwise it's buffered for the queue fallback (or posted live to the worker).
export function feedStdin(text) {
  const line = text == null ? '' : String(text)
  if (blockingAvailable && stdinSAB) {
    if (Atomics.load(stdinCtrl, CTRL_STATE) === ST_WAITING) deliverStdinLine(line)
    else preStdin.push(line) // typed before input() asked — replay on the next WAITING (see drain)
    return
  }
  if (worker) {
    try { worker.postMessage(stdinMessage(line)) } catch { /* ignore */ }
  } else {
    preStdin.push(line)
  }
}

// Signal EOF to a program currently blocked on input() (clean EOFError). Blocking mode only.
export function endStdin() {
  if (blockingAvailable && stdinSAB && Atomics.load(stdinCtrl, CTRL_STATE) === ST_WAITING) {
    Atomics.store(stdinCtrl, CTRL_STATE, ST_EOF)
    Atomics.notify(stdinCtrl, CTRL_STATE)
  }
}

// Back-compat no-ops kept so existing call sites/tests don't break.
export function setStdinHandlers() { /* stdin handled via the SAB / worker queue now */ }
export function clearStdin() { /* reset per run inside the worker */ }

// ---- public: run -------------------------------------------------------------------------
// Run the active file of a multi-file project. Streams stdout/stderr via the callbacks (already
// batched by the caller) and resolves with { ok, result, figures, error, hasApp, appKind }. An
// onInput callback fires when a program calls input() with no queued line (so the UI can prompt).
// Rejects with err.stopped === true if the user pressed Stop.
export function runPython(codeOrProject, { onStdout, onStderr, onStatus, onProgress, onInput } = {}) {
  let files, entry
  if (codeOrProject && typeof codeOrProject === 'object' && codeOrProject.files) {
    files = codeOrProject.files
    entry = codeOrProject.entry
  } else {
    files = { 'main.py': String(codeOrProject ?? '') }
    entry = 'main.py'
  }

  // Make sure the blocking-input SAB is allocated (idempotent; no-op if not isolated).
  registerStdinSW()
  // Pre-typed lines: in blocking mode keep them in preStdin so they're delivered when input() first
  // WAITs (see the 'input' handler); in fallback mode they seed the worker's queue via the request.
  const seedStdin = preStdin
  const id = ++runSeq
  currentProgressHandler = onProgress || null

  return new Promise((resolve, reject) => {
    const finishResolve = (v) => { currentProgressHandler = null; resolve(v) }
    const finishReject = (e) => { currentProgressHandler = null; reject(e) }
    pending.set(id, { onStdout, onStderr, onInput, resolve: finishResolve, reject: finishReject })
    // Bridge the worker's coarse status into the caller's onStatus (download/init).
    if (onStatus) {
      const off = onRuntimeStatus(({ phase }) => {
        if (phase === 'download') onStatus('download')
        else if (phase === 'init') onStatus('init')
      })
      const h = pending.get(id)
      const wrap = h.resolve, wrapR = h.reject
      h.resolve = (v) => { off(); wrap(v) }
      h.reject = (e) => { off(); wrapR(e) }
    }
    let w
    try { w = getWorker() } catch (err) { pending.delete(id); finishReject(err); return }
    if (blockingAvailable && stdinSAB) {
      // Reset the SAB control word so a stale state can't make input() return immediately.
      Atomics.store(stdinCtrl, CTRL_STATE, ST_IDLE)
      preStdin = seedStdin.slice() // delivered on the next WAITING
    } else {
      preStdin = []
    }
    try {
      // In fallback mode seedStdin feeds the worker queue; in blocking mode it's held in preStdin
      // (passed as [] here), and `swStdin` (= blockingAvailable) tells the worker to use the SAB.
      w.postMessage(runRequest(id, { ...files }, entry, proxyBase, blockingAvailable ? [] : seedStdin, blockingAvailable))
    } catch (err) {
      pending.delete(id)
      finishReject(err)
    }
  })
}

// ---- public: web-app preview (WSGI/ASGI) -------------------------------------------------
// Route a synthetic HTTP request to the app left in the worker's globals by the last run. Resolves
// with { ok, status, statusCode, contentType, body, isHtml, isJson } or { ok:false, error, detail }.
export function callServer(path = '/', method = 'GET', body = '', headers = []) {
  if (!worker) return Promise.resolve({ ok: false, error: 'no-runtime', detail: 'Run your code first.' })
  const id = ++runSeq
  return new Promise((resolve) => {
    pending.set(id, { resolve, reject: (e) => resolve({ ok: false, error: 'exception', detail: (e && e.message) || String(e) }) })
    try {
      worker.postMessage(callServerRequest(id, path, method, body, headers))
    } catch (err) {
      pending.delete(id)
      resolve({ ok: false, error: 'exception', detail: (err && err.message) || String(err) })
    }
  })
}

// ---- public: install packages (micropip — network) --------------------------------------
// Streams `micropip: <spec>` progress lines to the run console via onStatus. Resolves true on
// success, rejects on failure.
export function installPackages(specs, { onStatus } = {}) {
  const list = Array.isArray(specs) ? specs : []
  if (!list.length) return Promise.resolve(true)
  const w = getWorker()
  const id = ++runSeq
  return new Promise((resolve, reject) => {
    pending.set(id, {
      onStdout: (text) => { onStatus?.(String(text).replace(/\n$/, '')) },
      resolve,
      reject,
    })
    try {
      w.postMessage(installRequest(id, list, proxyBase))
    } catch (err) {
      pending.delete(id)
      reject(err)
    }
  })
}

// ---- public: package manager -------------------------------------------------------------
// List installed distributions with versions (for the package-manager UI). Resolves [] before the
// runtime exists. Each entry: { name, version, source, installer }.
export function listPackages() {
  if (!worker) return Promise.resolve([])
  const id = ++runSeq
  return new Promise((resolve) => {
    pending.set(id, { resolve, reject: () => resolve([]) })
    try { worker.postMessage(listPackagesRequest(id)) } catch { pending.delete(id); resolve([]) }
  })
}

// Uninstall a micropip-installed package by name. Resolves true / rejects with the error.
export function uninstallPackage(name) {
  if (!worker) return Promise.reject(new Error('Runtime not started'))
  const id = ++runSeq
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    try { worker.postMessage(uninstallRequest(id, name)) } catch (err) { pending.delete(id); reject(err) }
  })
}

// ---- public: cache status ----------------------------------------------------------------
// Ask the worker whether the big Pyodide runtime asset is already in the durable Cache (so the UI
// can show "cached — instant" vs "will download ~12MB"). Spawns the worker if needed. Resolves
// { runtimeCached }.
export function getCacheStatus() {
  let w
  try { w = getWorker() } catch { return Promise.resolve({ runtimeCached: false }) }
  const id = ++runSeq
  return new Promise((resolve) => {
    pending.set(id, { resolve, reject: () => resolve({ runtimeCached: false }) })
    try { w.postMessage(cacheStatusRequest(id)) } catch { pending.delete(id); resolve({ runtimeCached: false }) }
  })
}

// Free the worker (tests / teardown). Best-effort.
export function _resetRunner() {
  if (worker) { try { worker.terminate() } catch { /* ignore */ } }
  worker = null
  runSeq = 0
  runtimeReady = false
  proxyBase = ''
  pending.clear()
  statusSubs.clear()
  currentProgressHandler = null
  preStdin = []
  if (blockingAvailable && stdinCtrl) { try { Atomics.store(stdinCtrl, CTRL_STATE, ST_IDLE) } catch { /* ignore */ } }
}
