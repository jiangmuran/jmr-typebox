// Impure Pyodide runtime glue for the Python playground. This module touches the network,
// WebAssembly and the global scope, so it is imported LAZILY (only when the user runs code or
// loads the runtime) and never at app/SSG load time. Pure value logic lives in
// pythonHelpers.js and is tested separately; the wasm runtime itself is NOT unit-tested.

import { loadLibrary } from '../../utils/loadLibrary'
import { PYODIDE_SIZE_MB } from './pythonHelpers'
import { PROXY_PATH, buildAsgiScope } from './pythonNet'

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
// lazily after matplotlib loads), _tb_repr for the last expression's rich/text repr,
// _tb_wsgi_call (sync WSGI) + _tb_asgi_call (async ASGI/FastAPI) for the in-interpreter web-app
// preview, and _tb_install_net which patches urllib/requests through the site CORS proxy.
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

# ---- In-interpreter web-app preview (WSGI + ASGI) ---------------------------------------
# Pyodide can't bind real sockets, so we route a *synthetic* request straight to a user-defined
# WSGI or ASGI callable. _tb_find_app looks for a likely app object in the user's globals (a
# generic 'app'/'application', Flask's instance, FastAPI()/Starlette, or anything with .wsgi_app),
# classifying it as 'wsgi' (sync) or 'asgi' (async). WSGI is driven synchronously; ASGI is driven
# with a minimal scope/receive/send and awaited (see runner's callServer, which awaits the coro).

def _tb_is_asgi(obj):
    # ASGI apps are async callables of (scope, receive, send) — FastAPI/Starlette instances expose
    # an 'async def __call__'. Detect coroutine-ness on the call target with a 3-positional sig.
    import inspect
    # FastAPI/Starlette set this attribute on their app instances; trust it when present.
    if getattr(type(obj), "__name__", "") in ("FastAPI", "Starlette", "ASGIApp"):
        return True
    target = obj
    if not (inspect.isfunction(obj) or inspect.ismethod(obj)):
        call = getattr(obj, "__call__", None)
        if call is not None:
            target = call
    if inspect.iscoroutinefunction(target):
        return True
    try:
        sig = inspect.signature(target)
    except (TypeError, ValueError):
        return False
    params = [p for p in sig.parameters.values()
              if p.kind in (p.POSITIONAL_ONLY, p.POSITIONAL_OR_KEYWORD)]
    # A non-coroutine 3-arg (scope, receive, send) callable is also ASGI (e.g. a plain function).
    names = [p.name for p in params]
    return len(params) == 3 and "scope" in names and ("receive" in names or "send" in names)

def _tb_find_app(ns):
    for name in ("app", "application", "asgi_app", "wsgi_app", "server", "api"):
        obj = ns.get(name)
        if obj is None:
            continue
        # A bare ASGI/WSGI callable instance.
        if callable(obj):
            return obj, ("asgi" if _tb_is_asgi(obj) else "wsgi"), name
        # Some frameworks expose the callable on an attribute.
        wsgi = getattr(obj, "wsgi_app", None)
        if callable(wsgi):
            return wsgi, "wsgi", name
        asgi = getattr(obj, "asgi_app", None)
        if callable(asgi):
            return asgi, "asgi", name
    return None, None, None

# Lightweight probe used after each run: returns the app kind ('wsgi'|'asgi') or '' if none.
# This is what gates the preview pane.
def _tb_app_kind(ns):
    _app, kind, _name = _tb_find_app(ns)
    return kind or ""

# The names _tb_find_app scans for. Cleared from globals BEFORE each run so a web app defined by a
# PREVIOUS run can't linger in the persistent interpreter namespace and keep the preview popping up
# on later, app-less runs ("只要之前激活一次网页 后面就一直会弹出那个窗口"). If the new run
# defines an app, it is simply re-created; if not, no stale app remains.
_TB_APP_NAMES = ("app", "application", "asgi_app", "wsgi_app", "server", "api")
def _tb_clear_apps(ns):
    for name in _TB_APP_NAMES:
        if name in ns:
            try:
                del ns[name]
            except Exception:
                pass

def _tb_split_path(path):
    if "?" in path:
        raw_path, query = path.split("?", 1)
    else:
        raw_path, query = path, ""
    if not raw_path.startswith("/"):
        raw_path = "/" + raw_path
    return raw_path, query

def _tb_call_wsgi(app, path, method):
    raw_path, query = _tb_split_path(path)
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
        "HTTP_ACCEPT": "text/html,application/json,*/*",
        "wsgi.version": (1, 0),
        "wsgi.url_scheme": "http",
        "wsgi.input": io.BytesIO(b""),
        "wsgi.errors": io.StringIO(),
        "wsgi.multithread": False,
        "wsgi.multiprocess": False,
        "wsgi.run_once": False,
        "CONTENT_LENGTH": "0",
    }
    result = app(environ, start_response)
    try:
        for chunk in result:
            body_chunks.append(chunk)
    finally:
        if hasattr(result, "close"):
            result.close()
    parts = []
    for c in body_chunks:
        if isinstance(c, (bytes, bytearray)):
            parts.append(bytes(c).decode("utf-8", "replace"))
        elif c is not None:
            parts.append(str(c))
    status = status_holder.get("status", "200 OK")
    try:
        status_code = int(str(status).split(" ", 1)[0])
    except Exception:
        status_code = 200
    headers = list(status_holder.get("headers", []) or [])
    return {"ok": True, "status": status, "statusCode": status_code,
            "headers": [[str(k), str(v)] for k, v in headers],
            "body": "".join(parts)}

async def _tb_call_asgi(app, path, method, headers_in):
    raw_path, query = _tb_split_path(path)
    # ASGI headers are (bytes, bytes) pairs.
    req_headers = [(str(k).lower().encode("latin-1"), str(v).encode("latin-1"))
                   for k, v in (headers_in or [])]
    scope = {
        "type": "http",
        "asgi": {"version": "3.0", "spec_version": "2.3"},
        "http_version": "1.1",
        "method": str(method or "GET").upper(),
        "scheme": "http",
        "path": raw_path,
        "raw_path": raw_path.encode("utf-8"),
        "query_string": query.encode("utf-8"),
        "root_path": "",
        "headers": req_headers,
        "server": ("preview.local", 80),
        "client": ("127.0.0.1", 0),
    }
    # A one-shot receive: the synthetic request has an empty body and never disconnects.
    _received = {"done": False}
    async def receive():
        if not _received["done"]:
            _received["done"] = True
            return {"type": "http.request", "body": b"", "more_body": False}
        # Block-free: signal disconnect so well-behaved apps stop awaiting.
        return {"type": "http.disconnect"}
    state = {"status": 200, "headers": [], "body": bytearray(), "started": False}
    async def send(message):
        mtype = message.get("type")
        if mtype == "http.response.start":
            state["status"] = int(message.get("status", 200))
            hdrs = message.get("headers", []) or []
            out = []
            for k, v in hdrs:
                if isinstance(k, (bytes, bytearray)):
                    k = bytes(k).decode("latin-1")
                if isinstance(v, (bytes, bytearray)):
                    v = bytes(v).decode("latin-1")
                out.append([str(k), str(v)])
            state["headers"] = out
            state["started"] = True
        elif mtype == "http.response.body":
            body = message.get("body", b"") or b""
            if isinstance(body, (bytes, bytearray)):
                state["body"].extend(body)
            else:
                state["body"].extend(str(body).encode("utf-8"))
    # Drive the app. Most ASGI frameworks (Starlette/FastAPI) catch handler errors and emit a 500
    # response themselves; any escape is surfaced as an exception by the caller.
    await app(scope, receive, send)
    body = bytes(state["body"]).decode("utf-8", "replace")
    return {"ok": True, "status": str(state["status"]), "statusCode": state["status"],
            "headers": state["headers"], "body": body}

def _tb_wsgi_call(path, method, ns):
    # Synchronous entry — handles WSGI directly and reports ASGI so the async path can take over.
    app, kind, _name = _tb_find_app(ns)
    if app is None:
        return {"ok": False, "error": "no-app",
                "detail": "No web app found. Define a callable named 'app' at module level — "
                          "a WSGI app (e.g. Flask's app) or an ASGI app (e.g. FastAPI())."}
    if kind == "asgi":
        # Signal the JS layer to invoke the async path (_tb_asgi_call) instead.
        return {"ok": False, "error": "asgi", "kind": "asgi"}
    try:
        return _tb_call_wsgi(app, path, method)
    except Exception as exc:
        import traceback
        return {"ok": False, "error": "exception",
                "detail": "".join(traceback.format_exception(type(exc), exc, exc.__traceback__))}

async def _tb_asgi_call(path, method, ns, headers_in):
    app, kind, _name = _tb_find_app(ns)
    if app is None:
        return {"ok": False, "error": "no-app",
                "detail": "No web app found. Define a callable named 'app' at module level."}
    try:
        return await _tb_call_asgi(app, path, method, headers_in)
    except Exception as exc:
        import traceback
        return {"ok": False, "error": "exception",
                "detail": "".join(traceback.format_exception(type(exc), exc, exc.__traceback__))}

# ---- Cross-origin networking via the site CORS proxy ------------------------------------
# Browsers block most cross-origin requests from Pyodide, and the main thread has no sockets.
# pyodide_http.patch_all() makes urllib/requests issue a SYNCHRONOUS XMLHttpRequest (works in the
# main thread; only streaming falls back). On top of that we rewrite outgoing absolute http(s) URLs
# to the site's SSRF-guarded proxy <base>/api/fetch?url=<encoded>, which returns the bytes with
# permissive CORS headers — so requests.get("https://api…") / urllib.request.urlopen("https://api…")
# transparently reach public APIs. Same-origin/relative URLs (including the proxy itself) pass
# through untouched. _tb_install_net is called each run (JS loads pyodide_http first); it is
# idempotent — the heavy patching happens once.
_TB_PROXY_BASE = ""   # set from JS before install (apiBase + '/api/fetch')

def _tb_proxy_for(url):
    import urllib.parse as _up
    s = str(url or "")
    low = s.lower()
    if not (low.startswith("http://") or low.startswith("https://")):
        return s  # relative/other — leave as-is
    if not _TB_PROXY_BASE:
        return s
    if s.startswith(_TB_PROXY_BASE):
        return s  # already proxied — don't double-wrap
    return _TB_PROXY_BASE + "?url=" + _up.quote(s, safe="")

_tb_net_installed = False
def _tb_install_net(proxy_base):
    global _TB_PROXY_BASE, _tb_net_installed
    _TB_PROXY_BASE = str(proxy_base or "")
    if _tb_net_installed:
        return  # _TB_PROXY_BASE is updated above; the URL-rewrite reads it live.

    # 1) Make urllib/requests actually work in-browser (synchronous XHR transport). pyodide_http is
    #    a bundled Pyodide package; JS loads it via loadPackage before this runs. Best-effort.
    try:
        import pyodide_http
        pyodide_http.patch_all()
    except Exception:
        pass

    # 2) Layer URL-rewriting so the (now XHR-backed) calls go through the CORS proxy. We wrap
    #    urllib.request.urlopen — pyodide_http has already replaced it, so we wrap its version.
    import urllib.request as _ur
    _orig_urlopen = _ur.urlopen
    def _proxied_urlopen(url, *args, **kwargs):
        if isinstance(url, _ur.Request):
            target = url.full_url
            new = _tb_proxy_for(target)
            if new != target:
                req = _ur.Request(new, data=url.data, method=url.get_method())
                for hk, hv in url.header_items():
                    req.add_header(hk, hv)
                url = req
        else:
            url = _tb_proxy_for(url)
        return _orig_urlopen(url, *args, **kwargs)
    _ur.urlopen = _proxied_urlopen

    # Patch requests.Session.send (used by requests.get/post). Importing requests is cheap if it
    # was loaded; if not present yet we skip — _tb_install_net runs every run, so once the user's
    # code triggers requests to load, the NEXT run's install (this branch) patches it. To also
    # cover the first run, we additionally hook PreparedRequest via a try below.
    try:
        import requests as _rq
        if not getattr(_rq.sessions.Session, "_tb_patched", False):
            _orig_send = _rq.sessions.Session.send
            def _proxied_send(self, request, **kwargs):
                try:
                    request.url = _tb_proxy_for(request.url)
                except Exception:
                    pass
                return _orig_send(self, request, **kwargs)
            _rq.sessions.Session.send = _proxied_send
            _rq.sessions.Session._tb_patched = True
    except Exception:
        pass

    _tb_net_installed = True

# Patch requests.Session.send on demand (covers requests imported DURING the current run, before
# the next _tb_install_net). Safe to call repeatedly; JS calls it just before reading results.
def _tb_patch_requests():
    if not _TB_PROXY_BASE:
        return
    try:
        import sys
        _rq = sys.modules.get("requests")
        if _rq is None:
            return
        if getattr(_rq.sessions.Session, "_tb_patched", False):
            return
        _orig_send = _rq.sessions.Session.send
        def _proxied_send(self, request, **kwargs):
            try:
                request.url = _tb_proxy_for(request.url)
            except Exception:
                pass
            return _orig_send(self, request, **kwargs)
        _rq.sessions.Session.send = _proxied_send
        _rq.sessions.Session._tb_patched = True
    except Exception:
        pass
`

async function bootstrap(py) {
  if (bootstrapped) return
  await py.runPythonAsync(BOOTSTRAP_PY)
  bootstrapped = true
}

// ---- cross-origin networking (CORS proxy) -----------------------------------------------
// The site backend exposes an SSRF-guarded CORS proxy at `<apiBase>/api/fetch?url=`. We install
// a Python-side patch (see _tb_install_net in BOOTSTRAP_PY) that transparently routes urllib /
// requests through it so user scripts can hit public APIs the browser would otherwise block.
// apiBase is '' (same-origin) in production; the UI passes it from useBackend().
let proxyBase = ''            // full proxy endpoint, e.g. '' + '/api/fetch'
let netInstalled = false

// Set the proxy origin (apiBase) the patched fetch points at. Cheap; the actual interpreter patch
// is (re)applied during runPython via ensureNet(). Pass '' for same-origin.
export function setProxyApiBase(apiBase = '') {
  proxyBase = `${String(apiBase || '')}${PROXY_PATH}`
}

// (Re)install the Python network patch with the current proxyBase. Loads the bundled pyodide_http
// package (synchronous-XHR transport so urllib/requests work in-browser) then layers proxy URL-
// rewriting. Idempotent on the Python side; runs each call so a freshly-imported requests gets
// patched. Best-effort — failure just means no transparent proxying.
async function ensureNet(py) {
  try {
    // pyodide_http is a bundled Pyodide package; loading it is what makes sync HTTP work.
    if (!netInstalled) {
      try { await py.loadPackage('pyodide_http') } catch { /* offline / unavailable — urllib still patched for URL rewrite */ }
    }
    const install = py.globals.get('_tb_install_net')
    install(proxyBase)
    install?.destroy?.()
    netInstalled = true
  } catch { /* networking patch is best-effort */ }
}

// Patch requests.Session.send if `requests` was imported during this run (after ensureNet). Cheap;
// called right before executing user code AND after package preload so requests.get is proxied on
// the very first run too.
function patchRequestsNow(py) {
  try {
    const fn = py.globals.get('_tb_patch_requests')
    fn()
    fn?.destroy?.()
  } catch { /* best-effort */ }
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
  let appKind = ''     // 'wsgi' | 'asgi' | '' — drives which preview path the UI uses

  try {
    // Since Pyodide 0.18, runPythonAsync does NOT auto-install packages referenced by import
    // statements. loadPackagesFromImports inspects the code and loads any packages that are
    // bundled with Pyodide (numpy, matplotlib, pandas, …) from the CDN lock. Scan EVERY file so a
    // bundled dependency imported only by a sibling module is still preloaded.
    try {
      const scanSrc = files ? Object.values(files).join('\n') : code
      await py.loadPackagesFromImports(scanSrc)
    } catch { /* unknown/3rd-party imports — let the run raise a clear ModuleNotFoundError */ }

    // Wire cross-origin networking AFTER package preload so a freshly-loaded requests/urllib is
    // patched to route through the CORS proxy before the user's code runs.
    await ensureNet(py)
    patchRequestsNow(py)

    // Clear any web app left in globals by a PREVIOUS run so a stale app can't keep the preview
    // pane popping up on later app-less runs (the reported auto-popup bug). Re-defined by this run
    // if the code still declares an app.
    try { py.runPython('_tb_clear_apps(globals())') } catch { /* non-fatal */ }

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

    // Detect a WSGI/ASGI app left in CURRENT globals so the UI can offer the preview pane. This
    // reflects only this run's globals, so a previous run's app does not keep the pane alive.
    try {
      appKind = String(py.runPython('_tb_app_kind(dict(globals()))') || '')
      hasApp = appKind === 'wsgi' || appKind === 'asgi'
    } catch { hasApp = false; appKind = '' }

    // Free the PyProxy of the returned value if one was created.
    if (value && typeof value.destroy === 'function') value.destroy()
  } catch (err) {
    error = err
  } finally {
    // Restore default streams so nothing leaks between runs.
    try { py.setStdout({}) } catch {}
    try { py.setStderr({}) } catch {}
  }

  return { ok: !error, result, figures, error, hasApp, appKind }
}

// Route a synthetic HTTP request to a user-defined WSGI **or ASGI** app left in globals by the
// last run, returning a normalised response. WSGI is invoked synchronously; ASGI (FastAPI/
// Starlette) is driven with a minimal scope/receive/send and AWAITED via runPythonAsync. Returns
// { ok, status, statusCode, contentType, body, isHtml, isJson } on success, or
// { ok:false, error, detail } if no app / an exception. See _tb_wsgi_call / _tb_asgi_call.
export async function callServer(path = '/', method = 'GET') {
  const py = pyodideInstance
  if (!py) return { ok: false, error: 'no-runtime', detail: 'Run your code first.' }
  const p = String(path || '/')
  const m = String(method || 'GET')

  // 1) Try the synchronous WSGI path. It returns {error:'asgi'} if the app is actually ASGI.
  let out = null
  try {
    const fn = py.globals.get('_tb_wsgi_call')
    const proxy = fn(p, m, py.globals)
    out = jsFromProxy(proxy)
    proxy?.destroy?.()
    fn?.destroy?.()
  } catch (err) {
    return { ok: false, error: 'exception', detail: (err && err.message) || String(err) }
  }

  // 2) ASGI app detected — drive it asynchronously. We build the scope's headers in JS (testable)
  //    and run a tiny async shim that awaits the user's coroutine app.
  if (out && out.error === 'asgi') {
    out = await callAsgi(py, p, m)
  }

  if (!out) return { ok: false, error: 'unknown', detail: 'No response.' }
  if (out.ok) return shapeServerResult(out)
  return out
}

// Drive an ASGI app to completion for one synthetic request. _tb_asgi_call is an async Python
// coroutine; runPythonAsync awaits it for us. We pass the request headers shaped by pythonNet so
// the wire format stays consistent and unit-tested.
async function callAsgi(py, path, method) {
  try {
    const scope = buildAsgiScope(path, method)
    // Stash the JS-shaped header pairs where Python can read them, then await the coroutine.
    py.globals.set('_tb_req_headers', py.toPy(scope.headers))
    py.globals.set('_tb_req_path', String(path || '/'))
    py.globals.set('_tb_req_method', String(method || 'GET'))
    const proxy = await py.runPythonAsync(
      'await _tb_asgi_call(_tb_req_path, _tb_req_method, dict(globals()), _tb_req_headers)'
    )
    const out = jsFromProxy(proxy)
    proxy?.destroy?.()
    return out
  } catch (err) {
    return { ok: false, error: 'exception', detail: (err && err.message) || String(err) }
  }
}

// Convert a possibly-PyProxy result into a plain JS object (recursively for dicts/lists).
function jsFromProxy(proxy) {
  if (proxy == null) return proxy
  return proxy.toJs ? proxy.toJs({ dict_converter: Object.fromEntries }) : proxy
}

// Normalise the Python response ({status, statusCode, headers:[[k,v]], body}) into the
// content-type-aware shape the preview renders. Reuses pythonNet.normalizeResponse semantics, but
// inline here to keep the (already-imported) helper surface minimal.
function shapeServerResult(out) {
  const headers = Array.isArray(out.headers) ? out.headers : []
  let contentType = ''
  for (const pair of headers) {
    if (pair && String(pair[0]).toLowerCase() === 'content-type') { contentType = String(pair[1] || ''); break }
  }
  if (!contentType) contentType = 'text/html; charset=utf-8'
  return {
    ok: true,
    status: out.status || '200 OK',
    statusCode: out.statusCode || 200,
    contentType,
    isHtml: /html/i.test(contentType),
    isJson: /json/i.test(contentType),
    body: String(out.body == null ? '' : out.body),
  }
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
  proxyBase = ''
  netInstalled = false
}
