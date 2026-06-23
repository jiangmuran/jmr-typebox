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
    case 'input': { const h = pending.get(msg.id); h?.onInput?.(); return }
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

// ---- public: stdin (queue-fed) -----------------------------------------------------------
// Lines the user pre-types before a worker exists are buffered here and flushed to the worker on
// spawn, so a line typed BEFORE Run still satisfies the program's first input(). (No
// SharedArrayBuffer → input() can't synchronously block; an empty queue yields EOF, and the UI is
// notified via the onInput callback so it can highlight the terminal.)
let preStdin = []

// Feed a line the user typed in the terminal to the worker's stdin queue (buffered until the worker
// is alive). The worker shifts it on the next input() call.
export function feedStdin(text) {
  if (worker) {
    try { worker.postMessage(stdinMessage(text)) } catch { /* ignore */ }
  } else {
    preStdin.push(text == null ? '' : String(text))
  }
}


// Back-compat no-ops: the old main-thread runner exposed these to wire a window.prompt fallback +
// echo and to clear a JS-side queue. The queue now lives in the worker, so these are inert; kept so
// existing call sites (and tests) don't break.
export function setStdinHandlers() { /* queue lives in the worker now */ }
export function clearStdin() { /* queue is reset per run inside the worker */ }

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

  const w = getWorker()
  // Carry any lines the user pre-typed (before the worker existed) INTO the run request so they seed
  // the stdin queue after the worker resets it for this run. Lines typed during the run go via live
  // stdin messages (which append, not reset).
  const seedStdin = preStdin
  preStdin = []
  const id = ++runSeq
  currentProgressHandler = onProgress || null

  return new Promise((resolve, reject) => {
    pending.set(id, {
      onStdout,
      onStderr,
      onInput,
      resolve: (v) => { currentProgressHandler = null; resolve(v) },
      reject: (e) => { currentProgressHandler = null; reject(e) },
    })
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
    try {
      w.postMessage(runRequest(id, { ...files }, entry, proxyBase, seedStdin))
    } catch (err) {
      pending.delete(id)
      currentProgressHandler = null
      reject(err)
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
}
