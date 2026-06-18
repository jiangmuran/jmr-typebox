// Impure Pyodide runtime glue for the Python playground. This module touches the network,
// WebAssembly and the global scope, so it is imported LAZILY (only when the user runs code or
// loads the runtime) and never at app/SSG load time. Pure value logic lives in
// pythonHelpers.js and is tested separately; the wasm runtime itself is NOT unit-tested.

import { loadLibrary } from '../../utils/loadLibrary'
import { PYODIDE_SIZE_MB } from './pythonHelpers'

// Pyodide is loaded from the OFFICIAL jsDelivr CDN. The version MUST match the installed
// `pyodide` npm package (node_modules/pyodide/package.json -> "version": "314.0.0", which ships
// Python 3.14). Using the CDN indexURL is what makes loadPackage + micropip + the bundled
// numpy/matplotlib wheels resolve (they live next to the runtime under /full/). The browser HTTP
// cache keeps the ~12MB runtime after the first visit, so re-loads are effectively instant.
export const PYODIDE_VERSION = '314.0.0'
export const PYODIDE_CDN_URL = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`

let pyodideInstance = null   // the loaded Pyodide instance (singleton)
let loadPromise = null       // dedupes concurrent load() calls
let bootstrapped = false     // capture helpers defined in the interpreter once
let matplotlibPatched = false // Agg backend + show() shim installed once matplotlib loads

// ---- stdin (interactive input) ----------------------------------------------------------
// Pyodide's stdin callback is SYNCHRONOUS (it must return one line of text immediately), and we
// have no SharedArrayBuffer (no COOP/COEP headers), so we can't truly block an async run waiting
// on the DOM. Instead we keep a queue of lines the user pre-typed in the console box; when a
// program calls input() we shift the next queued line. If the queue is empty we fall back to a
// caller-provided synchronous prompt (window.prompt) so an interactive input()-loop never
// deadlocks. The caller also gets an echo callback so typed input shows up in the transcript.
let stdinQueue = []          // lines waiting to satisfy the next input() call(s)
let stdinPrompt = null       // () => string|null  — synchronous fallback (window.prompt)
let stdinEcho = null         // (line) => void     — echo a consumed line into the console

// Push lines the user typed into the console input box (split on newlines). They satisfy the
// next input() call(s) in order.
export function feedStdin(text) {
  if (text == null) return
  const parts = String(text).split('\n')
  for (const p of parts) stdinQueue.push(p)
}

export function clearStdin() {
  stdinQueue = []
}

// Wire the synchronous prompt fallback + echo hook used while a program runs. Pass nulls to clear.
export function setStdinHandlers({ prompt, echo } = {}) {
  stdinPrompt = typeof prompt === 'function' ? prompt : null
  stdinEcho = typeof echo === 'function' ? echo : null
}

// The synchronous stdin function handed to Pyodide. Returns a whole line WITHOUT the trailing
// newline (Pyodide/Python appends line handling itself); returning null signals EOF.
// Lines pulled from the pre-typed queue were already echoed by the UI when the user submitted
// them, so we only echo lines obtained interactively via the prompt fallback.
function readStdinLine() {
  if (stdinQueue.length) {
    return stdinQueue.shift()
  }
  if (stdinPrompt) {
    const r = stdinPrompt()
    if (r == null) return null // user cancelled -> EOF (raises EOFError in input())
    const line = String(r)
    try { stdinEcho?.(line) } catch { /* echo is best-effort */ }
    return line
  }
  return null // no input available -> EOF
}

// ---- core download with real progress ---------------------------------------------------
// loadPyodide has NO progress hook for its internal wasm/stdlib download, so we PREFETCH the two
// big files ourselves with a streaming fetch (tracking Content-Length + received bytes) to warm
// the HTTP cache. loadPyodide then reuses the cached responses, so the visible bar reflects the
// real ~12MB transfer. Best-effort: if a prefetch fails (offline-after-cache, CORS quirk) we
// silently skip it and let loadPyodide fetch normally.
const PREFETCH_FILES = [
  // [filename, approxBytes] — approx is only used before Content-Length is known.
  ['pyodide.asm.wasm', 9_600_000],
  ['python_stdlib.zip', 2_600_000],
]

async function prefetchCore(onProgress) {
  if (typeof fetch !== 'function') return
  // First, learn each file's real size (from cache or a HEAD-like ranged GET) so the bar total is
  // accurate; fall back to the baked-in estimate.
  const totals = PREFETCH_FILES.map(([, approx]) => approx)
  let grandTotal = totals.reduce((a, b) => a + b, 0)
  let loaded = 0
  const report = () => onProgress?.({ loaded, total: grandTotal })
  report()

  for (let i = 0; i < PREFETCH_FILES.length; i++) {
    const [file] = PREFETCH_FILES[i]
    const url = PYODIDE_CDN_URL + file
    let res
    try {
      res = await fetch(url, { cache: 'force-cache' })
    } catch {
      // Network blocked for this file — bump the bar by its estimate so it still completes.
      loaded += totals[i]; report(); continue
    }
    if (!res.ok || !res.body) { loaded += totals[i]; report(); continue }

    // Refine the total with the real Content-Length when present.
    const len = Number(res.headers.get('content-length')) || 0
    if (len > 0) { grandTotal += len - totals[i]; totals[i] = len }

    try {
      const reader = res.body.getReader()
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        loaded += value.byteLength
        report()
      }
    } catch {
      loaded += Math.max(0, totals[i] - 0); report()
    }
  }
  // Snap to 100% so rounding never leaves the bar at 99%.
  loaded = grandTotal
  report()
}

// Lazily import the `pyodide` ESM through loadLibrary so the shared load-state flag works exactly
// like the ffmpeg core and other heavy libs (the small ESM glue is the npm package; the heavy
// wasm/stdlib come from the CDN at runtime).
function importPyodide() {
  return loadLibrary('pyodide', () => import('pyodide'), { sizeMB: PYODIDE_SIZE_MB })
}

// Get a loaded, ready-to-use Pyodide instance. The runtime loads once and is reused for every
// subsequent run (instant). Optional callbacks:
//   onStatus(phase)            — 'download' | 'init'
//   onProgress({loaded,total}) — byte progress of the core download (for a determinate bar)
export async function getPyodide({ onStatus, onProgress } = {}) {
  if (pyodideInstance) return pyodideInstance
  if (loadPromise) return loadPromise

  loadPromise = (async () => {
    onStatus?.('download')
    // Kick off the byte-tracked prefetch and the ESM glue import together.
    const [mod] = await Promise.all([
      importPyodide(),
      prefetchCore(onProgress),
    ])
    const { loadPyodide } = mod
    onStatus?.('init')
    const py = await loadPyodide({ indexURL: PYODIDE_CDN_URL, stdin: readStdinLine })
    // Install our synchronous stdin handler (queue + prompt fallback) for input().
    try { py.setStdin({ stdin: readStdinLine, autoEOF: false }) } catch { /* older API */ }
    pyodideInstance = py
    return py
  })()

  try {
    await loadPromise
  } catch (err) {
    loadPromise = null // allow retry after a failed load
    throw err
  }
  return pyodideInstance
}

// Defines the capture helpers in the interpreter once (run by bootstrap()): a matplotlib
// figure grabber (_tb_take_figures), the Agg/show() installer (_tb_install_matplotlib, called
// lazily after matplotlib loads), _tb_repr for the last expression's rich/text repr, and
// _tb_wsgi_call for the experimental in-interpreter web-app preview.
const BOOTSTRAP_PY = `
import io, base64

# Matplotlib figure capture. Called lazily (from JS) only AFTER matplotlib is loaded, since
# it ships separately and is pulled in on demand by loadPackagesFromImports. Switches to the
# headless Agg backend and rewires plt.show() to stash each figure as a base64 PNG.
_tb_figs = []
def _tb_install_matplotlib():
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    def _show(*args, **kwargs):
        for num in plt.get_fignums():
            fig = plt.figure(num)
            buf = io.BytesIO()
            fig.savefig(buf, format="png", bbox_inches="tight", dpi=110)
            _tb_figs.append(base64.b64encode(buf.getvalue()).decode("ascii"))
        plt.close("all")
    plt.show = _show

def _tb_take_figures():
    out = list(_tb_figs)
    _tb_figs.clear()
    return out

# Rich repr of the last expression value: prefer _repr_html_, else repr(). Returns
# {"kind": "html"|"text"|"none", "data": str}.
def _tb_repr(value):
    if value is None:
        return {"kind": "none", "data": ""}
    html = getattr(value, "_repr_html_", None)
    if callable(html):
        try:
            return {"kind": "html", "data": str(html())}
        except Exception:
            pass
    try:
        return {"kind": "text", "data": repr(value)}
    except Exception:
        return {"kind": "text", "data": "<unreprable object>"}

# ---- Experimental in-interpreter web-app preview ----------------------------------------
# Pyodide can't bind real sockets, so we route a *synthetic* request straight to a user-defined
# WSGI/ASGI callable. Looks for a likely app object in the user's globals (Flask's app, a generic
# 'app'/'application', or anything with a .wsgi_app), builds a minimal WSGI environ for the given
# path/method, invokes it, and returns the response body + status + content-type.
def _tb_find_app(ns):
    for name in ("app", "application", "wsgi_app", "server"):
        obj = ns.get(name)
        if obj is None:
            continue
        # Flask / many frameworks: the instance is itself a WSGI callable.
        if callable(obj):
            return obj, ("asgi" if _tb_is_asgi(obj) else "wsgi")
        wsgi = getattr(obj, "wsgi_app", None)
        if callable(wsgi):
            return wsgi, "wsgi"
    return None, None

def _tb_is_asgi(obj):
    # Heuristic: ASGI apps are typically 'async def app(scope, receive, send)' or expose 3-arg
    # __call__ coroutines. We only *attempt* WSGI here; ASGI is detected so we can report it.
    import inspect
    target = obj
    call = getattr(obj, "__call__", None)
    if call is not None and not inspect.isfunction(obj):
        target = call
    try:
        sig = inspect.signature(target)
    except (TypeError, ValueError):
        return False
    params = [p for p in sig.parameters.values()
              if p.kind in (p.POSITIONAL_ONLY, p.POSITIONAL_OR_KEYWORD)]
    is_coro = inspect.iscoroutinefunction(target)
    return is_coro and len(params) == 3

def _tb_wsgi_call(path, method, ns):
    app, kind = _tb_find_app(ns)
    if app is None:
        return {"ok": False, "error": "no-app",
                "detail": "No WSGI app found. Define a callable named 'app' "
                          "(e.g. Flask's app) at module level."}
    if kind == "asgi":
        return {"ok": False, "error": "asgi",
                "detail": "Detected an ASGI app. The preview only supports synchronous WSGI "
                          "callables (e.g. Flask). ASGI isn't supported in this sandbox."}
    if "?" in path:
        raw_path, query = path.split("?", 1)
    else:
        raw_path, query = path, ""
    if not raw_path.startswith("/"):
        raw_path = "/" + raw_path
    body_chunks = []
    status_holder = {}
    def start_response(status, headers, exc_info=None):
        status_holder["status"] = status
        status_holder["headers"] = headers
        return body_chunks.append
    environ = {
        "REQUEST_METHOD": str(method or "GET").upper(),
        "SCRIPT_NAME": "",
        "PATH_INFO": raw_path,
        "QUERY_STRING": query,
        "SERVER_NAME": "preview.local",
        "SERVER_PORT": "80",
        "SERVER_PROTOCOL": "HTTP/1.1",
        "HTTP_HOST": "preview.local",
        "wsgi.version": (1, 0),
        "wsgi.url_scheme": "http",
        "wsgi.input": io.BytesIO(b""),
        "wsgi.errors": io.StringIO(),
        "wsgi.multithread": False,
        "wsgi.multiprocess": False,
        "wsgi.run_once": False,
        "CONTENT_LENGTH": "0",
    }
    try:
        result = app(environ, start_response)
        for chunk in result:
            body_chunks.append(chunk)
        if hasattr(result, "close"):
            result.close()
    except Exception as exc:
        import traceback
        return {"ok": False, "error": "exception",
                "detail": "".join(traceback.format_exception(type(exc), exc, exc.__traceback__))}
    parts = []
    for c in body_chunks:
        if isinstance(c, (bytes, bytearray)):
            parts.append(bytes(c).decode("utf-8", "replace"))
        elif c is not None:
            parts.append(str(c))
    headers = dict(status_holder.get("headers", []) or [])
    content_type = headers.get("Content-Type") or headers.get("content-type") or "text/html"
    return {"ok": True, "status": status_holder.get("status", "200 OK"),
            "contentType": content_type, "body": "".join(parts)}
`

async function bootstrap(py) {
  if (bootstrapped) return
  await py.runPythonAsync(BOOTSTRAP_PY)
  bootstrapped = true
}

// Working directory inside Pyodide's virtual FS where project files are written. It's added to
// sys.path so cross-file `import othermodule` resolves to the user's sibling files.
const WORK_DIR = '/home/pyodide/project'
let workDirReady = false
const writtenFiles = new Set() // filenames currently on disk in WORK_DIR (for stale cleanup)

// Mirror the in-memory project (a { filename: source } map) into the virtual FS so multi-file
// imports work. Files removed since the last run are deleted, and modules whose source changed
// are invalidated from importlib's caches so the next import re-reads them. WORK_DIR is ensured
// on sys.path. Pure-Python only; the heavy work is the wasm FS write, hence it lives here.
function writeFiles(py, files) {
  const FS = py.FS
  if (!workDirReady) {
    try { FS.mkdirTree(WORK_DIR) } catch { /* already exists */ }
    // Prepend WORK_DIR to sys.path once so bare imports find the project files first.
    py.runPython(
      'import sys\n' +
      `_p = ${JSON.stringify(WORK_DIR)}\n` +
      'if _p not in sys.path:\n    sys.path.insert(0, _p)\n'
    )
    workDirReady = true
  }

  const names = Object.keys(files || {})
  const keep = new Set(names)

  // Remove files that were deleted/renamed away since the last run.
  for (const old of [...writtenFiles]) {
    if (!keep.has(old)) {
      try { FS.unlink(`${WORK_DIR}/${old}`) } catch { /* already gone */ }
      writtenFiles.delete(old)
    }
  }

  // (Re)write every current file. Writing unconditionally is cheap and guarantees the FS matches
  // the editor exactly, including unsaved edits.
  for (const name of names) {
    FS.writeFile(`${WORK_DIR}/${name}`, String(files[name] ?? ''), { encoding: 'utf8' })
    writtenFiles.add(name)
  }

  // Drop cached bytecode + already-imported user modules so edits to imported files take effect
  // on the next run (otherwise Python would keep the first version it imported).
  const modList = names
    .filter(n => n.endsWith('.py'))
    .map(n => n.slice(0, -3))
  py.runPython(
    'import importlib, sys\n' +
    'importlib.invalidate_caches()\n' +
    `_mods = ${JSON.stringify(modList)}\n` +
    'for _m in _mods:\n' +
    '    sys.modules.pop(_m, None)\n'
  )
}

// Run the active file of a multi-file project (or a bare code string for back-compat).
//
// Signature:
//   runPython(codeString, opts)                       — run a single snippet (legacy)
//   runPython({ files, entry }, opts)                  — write ALL files to the virtual FS,
//                                                        then run the entry file's source
//
// `files` is a { 'main.py': source, 'utils.py': source } map; `entry` is the filename to
// execute (defaults to 'main.py', or the first file). Writing every file first is what makes
// cross-file `import utils` work. Streams stdout/stderr via the provided callbacks (already
// batched by the caller) and returns a structured result:
//   { ok, result: { kind, data }, figures: string[] (base64 png), error: string|null, hasApp }
// The last top-level expression's value is captured the way a REPL would show it. `hasApp` is
// true if the run left a WSGI-style app callable in globals (enables the preview pane).
export async function runPython(codeOrProject, { onStdout, onStderr, onStatus, onProgress } = {}) {
  const py = await getPyodide({ onStatus, onProgress })
  await bootstrap(py)

  // Normalize input into { files, entry, code }. A bare string runs as a one-file program.
  let files = null
  let entry = null
  let code
  if (codeOrProject && typeof codeOrProject === 'object' && codeOrProject.files) {
    files = codeOrProject.files
    const names = Object.keys(files)
    entry = names.includes(codeOrProject.entry) ? codeOrProject.entry
      : (names.includes('main.py') ? 'main.py' : names[0])
    code = String(files[entry] ?? '')
  } else {
    code = String(codeOrProject ?? '')
  }

  // Mirror every project file into the virtual FS so imports across files resolve.
  if (files) {
    try { writeFiles(py, files) } catch { /* FS write failure surfaces as an import error below */ }
  }

  // Route stdout/stderr to the UI. IMPORTANT: Pyodide's `batched` writer is LINE-BUFFERED and
  // strips the trailing newline before each call (its default handler is console.log, which
  // re-adds one). If we forwarded the chunks as-is, every print() would be concatenated onto one
  // line and all newlines from the program would vanish (the reported "换行没了" bug). So we
  // re-append "\n" to each batched line to faithfully reconstruct the stream. (Re)assert our
  // stdin handler each run in case anything reset the streams.
  py.setStdout({ batched: (s) => onStdout?.(s + '\n') })
  py.setStderr({ batched: (s) => onStderr?.(s + '\n') })
  try { py.setStdin({ stdin: readStdinLine, autoEOF: false }) } catch {}

  const figures = []
  let result = { kind: 'none', data: '' }
  let error = null
  let hasApp = false

  try {
    // Since Pyodide 0.18, runPythonAsync does NOT auto-install packages referenced by import
    // statements. loadPackagesFromImports inspects the code and loads any packages that are
    // bundled with Pyodide (numpy, matplotlib, pandas, …) from the CDN lock. Scan EVERY file so a
    // bundled dependency imported only by a sibling module is still preloaded.
    try {
      const scanSrc = files ? Object.values(files).join('\n') : code
      await py.loadPackagesFromImports(scanSrc)
    } catch { /* unknown/3rd-party imports — let the run raise a clear ModuleNotFoundError */ }

    // matplotlib may have just been loaded; (re)install the Agg backend + show() capture.
    if (!matplotlibPatched) {
      try {
        await py.runPythonAsync('_tb_install_matplotlib()')
        matplotlibPatched = true
      } catch { /* matplotlib not present — ignore */ }
    }

    // run_async returns the value of the last expression (like the REPL), or None.
    const value = await py.runPythonAsync(code)
    // Collect any matplotlib figures produced during the run.
    try {
      const takeFigs = py.globals.get('_tb_take_figures')
      const figProxy = takeFigs()
      const arr = figProxy?.toJs ? figProxy.toJs() : figProxy
      if (Array.isArray(arr)) figures.push(...arr)
      figProxy?.destroy?.()
      takeFigs?.destroy?.()
    } catch { /* matplotlib not used — ignore */ }

    // Rich repr of the last expression.
    try {
      const reprFn = py.globals.get('_tb_repr')
      const r = reprFn(value)
      const obj = r.toJs ? r.toJs({ dict_converter: Object.fromEntries }) : r
      if (obj && obj.kind) result = { kind: obj.kind, data: obj.data }
      r?.destroy?.()
      reprFn?.destroy?.()
    } catch { /* ignore repr failures */ }

    // Detect a WSGI/ASGI app left in globals so the UI can offer the preview pane.
    try {
      hasApp = !!py.runPython(
        'bool(_tb_find_app(dict(globals()))[0])'
      )
    } catch { hasApp = false }

    // Free the PyProxy of the returned value if one was created.
    if (value && typeof value.destroy === 'function') value.destroy()
  } catch (err) {
    error = err
  } finally {
    // Restore default streams so nothing leaks between runs.
    try { py.setStdout({}) } catch {}
    try { py.setStderr({}) } catch {}
  }

  return { ok: !error, result, figures, error, hasApp }
}

// Route a synthetic HTTP request to a user-defined WSGI app left in globals by the last run.
// Returns { ok, status, contentType, body } on success, or { ok:false, error, detail } if no app
// / an ASGI app / an exception. EXPERIMENTAL — see _tb_wsgi_call in BOOTSTRAP_PY.
export async function callServer(path = '/', method = 'GET') {
  const py = pyodideInstance
  if (!py) return { ok: false, error: 'no-runtime', detail: 'Run your code first.' }
  let out = null
  try {
    const fn = py.globals.get('_tb_wsgi_call')
    // Pass the live global namespace so _tb_find_app sees the user's `app`. py.globals is a
    // PyProxy of the module dict, which the Python side treats as the mapping it expects.
    const proxy = fn(String(path || '/'), String(method || 'GET'), py.globals)
    out = proxy?.toJs ? proxy.toJs({ dict_converter: Object.fromEntries }) : proxy
    proxy?.destroy?.()
    fn?.destroy?.()
  } catch (err) {
    return { ok: false, error: 'exception', detail: (err && err.message) || String(err) }
  }
  return out || { ok: false, error: 'unknown', detail: 'No response.' }
}

// Install packages with micropip. This FETCHES WHEELS OVER THE NETWORK (PyPI / jsDelivr) and
// is the only part of the playground that is not offline. Returns the list of installed
// specifiers. onStatus(spec) reports progress per package. Pure-python wheels and the many
// packages prebuilt for Pyodide both work.
export async function installPackages(specs, { onStatus } = {}) {
  if (!specs || !specs.length) return []
  const py = await getPyodide()
  await py.loadPackage('micropip')
  const micropip = py.pyimport('micropip')
  try {
    for (const spec of specs) {
      onStatus?.(spec)
      // keep_going surfaces a clearer error if a dependency can't be resolved.
      await micropip.install(spec, { keep_going: true })
    }
    return [...specs]
  } finally {
    micropip?.destroy?.()
  }
}

// True once the runtime is loaded (re-runs are instant). Lets the UI label state without
// importing loadLibrary state directly.
export function isReady() {
  return !!pyodideInstance
}

// Free the runtime (used by tests / clear-all). Best-effort; Pyodide has no full teardown, so
// we just drop our references and let the page reload reclaim memory.
export function _resetRunner() {
  pyodideInstance = null
  loadPromise = null
  bootstrapped = false
  matplotlibPatched = false
  workDirReady = false
  writtenFiles.clear()
  stdinQueue = []
  stdinPrompt = null
  stdinEcho = null
}
