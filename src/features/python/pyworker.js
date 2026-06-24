// Pyodide Web Worker. This file runs OFF the main thread, so a long or infinite Python program
// can no longer block the UI: stdout/stderr are posted back as they happen (live streaming) and a
// runaway loop is killed by the main thread calling worker.terminate() + respawning a fresh worker.
// Workers are client-only by nature, so there is no SSG concern here — Vite compiles this as a
// module worker (instantiated with `new Worker(new URL('./pyworker.js', import.meta.url), {type:
// 'module'})`). It needs NO SharedArrayBuffer and therefore NO COOP/COEP headers.
//
// Pyodide loads from the OFFICIAL jsDelivr CDN (same version as the npm package so loadPackage +
// micropip + bundled numpy/matplotlib resolve). We import the ESM glue from the CDN too (NOT the
// bundled npm package) because importing `pyodide` via Vite inside a worker pulls node shims; the
// CDN ESM is purpose-built for browsers/workers. The heavy wasm/stdlib are fetched by loadPyodide.
//
// The protocol mirrors workerProtocol.js (kept pure + tested on the main side). Messages in:
//   run {id,files,entry,proxyBase} · install {id,specs,proxyBase} · callServer {id,path,method,
//   body,headers} · stdin {text}. Messages out: status/progress/stdout/stderr/input/result/
//   installed/server/ready/error. `id` ties streamed output + the final result to one run.

const PYODIDE_VERSION = '314.0.0'
const PYODIDE_CDN_URL = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`

// Named Cache-API bucket for durable runtime/wheel caching. The user reported the ~12MB runtime and
// installed wheels re-downloaded on every visit ("完全没有缓存") — the HTTP cache alone is not
// reliable for cross-origin opaque CDN responses. We wrap fetch (installCacheFetch) so EVERY request
// to the Pyodide CDN and to PyPI/jsDelivr wheels is served cache-first from this bucket and stored on
// a miss. It survives reloads and fresh workers (Cache API is origin-persistent), so re-runs are
// genuinely offline-fast. Versioned so a Pyodide bump invalidates cleanly.
const CACHE_NAME = `typebox-pyodide-v${PYODIDE_VERSION}`
// Hosts whose responses we persist. Pyodide core + bundled wheels live on the jsDelivr CDN; micropip
// pulls user wheels from files.pythonhosted.org (PyPI) and sometimes jsDelivr.
const CACHEABLE_HOSTS = ['cdn.jsdelivr.net', 'files.pythonhosted.org', 'pypi.org', 'unpkg.com']

let pyodide = null
let loadPromise = null
let bootstrapped = false
let matplotlibPatched = false
let netInstalled = false
let cacheInstalled = false

let currentRunId = 0          // the run we are streaming for (0 = idle)
let proxyBase = ''            // full proxy endpoint, set per run/install

// The page origin, used to make the CORS-proxy URL ABSOLUTE. requests/urllib3 need a scheme+host to
// pick a connection adapter — a relative '/api/fetch?...' raised
// "InvalidSchema: No connection adapters were found for '/api/fetch?url=...'". self.location.origin
// is the page's origin (workers inherit it), so requests.get("https://…") is rewritten to a real
// same-origin absolute URL the synchronous-XHR transport can reach.
const PAGE_ORIGIN = (typeof self !== 'undefined' && self.location && self.location.origin) || ''

// Wrap self.fetch so cacheable CDN/wheel requests are served from (and stored into) the named Cache.
// Installed once, before loadPyodide, so the core download itself is cached. Best-effort: if the
// Cache API is unavailable or a put() fails (opaque/oversized), we fall through to the network.
async function installCacheFetch() {
  if (cacheInstalled) return
  cacheInstalled = true
  if (typeof caches === 'undefined' || typeof self.fetch !== 'function') return
  const orig = self.fetch.bind(self)
  let cache = null
  try { cache = await caches.open(CACHE_NAME) } catch { cache = null }
  if (!cache) return
  self.fetch = async (input, init) => {
    let url = ''
    try { url = typeof input === 'string' ? input : (input && input.url) || '' } catch { url = '' }
    let host = ''
    try { host = new URL(url, PAGE_ORIGIN).hostname } catch { host = '' }
    const cacheable = !!url && (init == null || !init.method || String(init.method).toUpperCase() === 'GET') &&
      CACHEABLE_HOSTS.includes(host)
    if (!cacheable) return orig(input, init)
    try {
      const hit = await cache.match(url)
      if (hit) return hit.clone()
    } catch { /* fall through to network */ }
    const res = await orig(input, init)
    // Only persist successful, non-opaque, readable responses. Opaque (no-cors) bodies can't be
    // re-read, so we skip them rather than cache an unusable entry.
    try {
      if (res && res.ok && res.type !== 'opaque') { await cache.put(url, res.clone()) }
    } catch { /* cache write best-effort (quota/opaque) */ }
    return res
  }
}

// Report which big assets are already cached so the UI can show "cached / will download". Best-effort.
async function reportCacheStatus(id) {
  let cached = false
  try {
    if (typeof caches !== 'undefined') {
      const cache = await caches.open(CACHE_NAME)
      const hit = await cache.match(PYODIDE_CDN_URL + 'pyodide.asm.wasm')
      cached = !!hit
    }
  } catch { cached = false }
  post({ type: 'cacheStatus', id, runtimeCached: cached })
}

// ---- interactive BLOCKING stdin (SharedArrayBuffer + Atomics.wait) ------------------------
// Pyodide's stdin callback is SYNCHRONOUS — it must return a line immediately. To make input()
// genuinely BLOCK the running program until the user types (like a real terminal), the worker waits
// on a SharedArrayBuffer with Atomics.wait(): readStdinLine() flips the control word to WAITING,
// notifies the UI, then blocks the worker thread until the main thread writes the typed line into
// the SAB and Atomics.notify()s. This needs cross-origin isolation (COOP/COEP) for SAB, which we
// enable via public/_headers (COEP credentialless keeps the CDN ffmpeg/Pyodide working).
//
// SAB layout (set up by the main thread, shared once via 'stdinBuffer' message):
//   control: Int32Array(4) over the first 16 bytes —
//     [0] STATE: IDLE(0) | WAITING(1) | READY(2) | EOF(3)
//     [1] LEN:   byte length of the line written into the data region
//   data: Uint8Array over the rest — the UTF-8 line bytes the user typed.
//
// Fallback: if no SAB was provided (isolation unavailable), input() uses the pre-typed QUEUE.
const ST_IDLE = 0, ST_WAITING = 1, ST_READY = 2, ST_EOF = 3
const CTRL_STATE = 0, CTRL_LEN = 1
const DATA_OFFSET = 16          // bytes; control Int32Array(4) occupies [0,16)

let stdinSAB = null             // SharedArrayBuffer for blocking stdin (or null → queue fallback)
let stdinCtrl = null            // Int32Array view over the control region
let stdinData = null            // Uint8Array view over the data region
let stdinDecoder = null

let stdinQueue = []             // queue-fed fallback (pre-typed lines)
let inputPrompted = false       // avoid spamming 'input' notices in fallback mode

function post(msg) { try { self.postMessage(msg) } catch { /* ignore */ } }

function setupStdinBuffer(sab) {
  stdinSAB = sab || null
  if (sab) {
    stdinCtrl = new Int32Array(sab, 0, 4)
    stdinData = new Uint8Array(sab, DATA_OFFSET)
    stdinDecoder = typeof TextDecoder !== 'undefined' ? new TextDecoder() : null
  } else {
    stdinCtrl = stdinData = stdinDecoder = null
  }
}

function readStdinLine() {
  // Blocking SAB path: pause the worker until the main thread provides a line (or EOF).
  if (stdinSAB && stdinCtrl && typeof Atomics !== 'undefined') {
    Atomics.store(stdinCtrl, CTRL_STATE, ST_WAITING)
    // Tell the UI a program is now PAUSED awaiting input (focus/highlight the terminal).
    post({ type: 'input', id: currentRunId })
    // Block this worker thread until notified. Loop guards against spurious wakeups.
    while (Atomics.load(stdinCtrl, CTRL_STATE) === ST_WAITING) {
      Atomics.wait(stdinCtrl, CTRL_STATE, ST_WAITING)
    }
    const state = Atomics.load(stdinCtrl, CTRL_STATE)
    Atomics.store(stdinCtrl, CTRL_STATE, ST_IDLE)
    if (state === ST_EOF) return null // EOF -> EOFError in input()
    const len = Atomics.load(stdinCtrl, CTRL_LEN) | 0
    // Return the typed line (no trailing newline). autoEOF:true appends EOF after this string, so
    // input()/readline gets exactly this one line from a SINGLE stdin() call (no re-block).
    if (len <= 0) return ''
    const bytes = stdinData.slice(0, Math.min(len, stdinData.length))
    return stdinDecoder ? stdinDecoder.decode(bytes) : String.fromCharCode.apply(null, bytes)
  }
  // Fallback: queue-fed (no blocking possible without SAB). One line per call; autoEOF terminates it.
  if (stdinQueue.length) { inputPrompted = false; return stdinQueue.shift() }
  if (!inputPrompted) {
    inputPrompted = true
    post({ type: 'input', id: currentRunId })
  }
  return null
}

// ---- core download with real progress ---------------------------------------------------
// loadPyodide has no progress hook for its big wasm/stdlib download, so we prefetch the two large
// files with a streaming fetch (tracking Content-Length + received bytes) to warm the HTTP cache;
// loadPyodide then reuses the cached responses, so the bar reflects the real ~12MB transfer.
const PREFETCH_FILES = [
  ['pyodide.asm.wasm', 9_600_000],
  ['python_stdlib.zip', 2_600_000],
]

async function prefetchCore() {
  if (typeof fetch !== 'function') return
  const totals = PREFETCH_FILES.map(([, approx]) => approx)
  let grandTotal = totals.reduce((a, b) => a + b, 0)
  let loaded = 0
  const report = () => post({ type: 'progress', loaded, total: grandTotal })
  report()
  for (let i = 0; i < PREFETCH_FILES.length; i++) {
    const [file] = PREFETCH_FILES[i]
    let res
    try {
      res = await fetch(PYODIDE_CDN_URL + file, { cache: 'force-cache' })
    } catch { loaded += totals[i]; report(); continue }
    if (!res.ok || !res.body) { loaded += totals[i]; report(); continue }
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
    } catch { loaded += Math.max(0, totals[i]); report() }
  }
  loaded = grandTotal
  report()
}

async function getPyodide() {
  if (pyodide) return pyodide
  if (loadPromise) return loadPromise
  loadPromise = (async () => {
    // Install the durable Cache-API layer BEFORE anything fetches, so the core download itself is
    // persisted (and served from cache on the next worker/reload).
    await installCacheFetch()
    post({ type: 'status', phase: 'download' })
    // Import the CDN ESM glue + warm the cache together.
    const [mod] = await Promise.all([
      import(/* @vite-ignore */ `${PYODIDE_CDN_URL}pyodide.mjs`),
      prefetchCore(),
    ])
    post({ type: 'status', phase: 'init' })
    const py = await mod.loadPyodide({ indexURL: PYODIDE_CDN_URL })
    try { py.setStdin({ stdin: readStdinLine, autoEOF: true }) } catch { /* older API */ }
    pyodide = py
    post({ type: 'status', phase: 'ready' })
    post({ type: 'ready' })
    return py
  })()
  try { await loadPromise } catch (err) { loadPromise = null; throw err }
  return pyodide
}

// ---- Python bootstrap (figure capture, rich repr, WSGI/ASGI drivers, CORS net patch) -----
// Identical capabilities to the previous main-thread runner, moved verbatim into the worker. See
// the inline comments for each helper. Defined once per worker lifetime.
const BOOTSTRAP_PY = `
import io, base64

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

def _tb_is_asgi(obj):
    import inspect
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
    names = [p.name for p in params]
    return len(params) == 3 and "scope" in names and ("receive" in names or "send" in names)

def _tb_find_app(ns):
    for name in ("app", "application", "asgi_app", "wsgi_app", "server", "api"):
        obj = ns.get(name)
        if obj is None:
            continue
        if callable(obj):
            return obj, ("asgi" if _tb_is_asgi(obj) else "wsgi"), name
        wsgi = getattr(obj, "wsgi_app", None)
        if callable(wsgi):
            return wsgi, "wsgi", name
        asgi = getattr(obj, "asgi_app", None)
        if callable(asgi):
            return asgi, "asgi", name
    return None, None, None

def _tb_app_kind(ns):
    _app, kind, _name = _tb_find_app(ns)
    return kind or ""

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

def _tb_call_wsgi(app, path, method, body):
    raw_path, query = _tb_split_path(path)
    body_bytes = (body or "").encode("utf-8")
    body_chunks = []
    status_holder = {}
    def start_response(status, headers, exc_info=None):
        status_holder["status"] = status
        status_holder["headers"] = headers
        return body_chunks.append
    is_form = bool(body_bytes) and str(method or "GET").upper() != "GET"
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
        "wsgi.input": io.BytesIO(body_bytes),
        "wsgi.errors": io.StringIO(),
        "wsgi.multithread": False,
        "wsgi.multiprocess": False,
        "wsgi.run_once": False,
        "CONTENT_LENGTH": str(len(body_bytes)),
    }
    if is_form:
        environ["CONTENT_TYPE"] = "application/x-www-form-urlencoded"
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

async def _tb_call_asgi(app, path, method, headers_in, body):
    raw_path, query = _tb_split_path(path)
    body_bytes = (body or "").encode("utf-8")
    req_headers = [(str(k).lower().encode("latin-1"), str(v).encode("latin-1"))
                   for k, v in (headers_in or [])]
    if body_bytes and str(method or "GET").upper() != "GET":
        has_ct = any(k == b"content-type" for k, _v in req_headers)
        if not has_ct:
            req_headers.append((b"content-type", b"application/x-www-form-urlencoded"))
        req_headers.append((b"content-length", str(len(body_bytes)).encode("latin-1")))
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
    _received = {"done": False}
    async def receive():
        if not _received["done"]:
            _received["done"] = True
            return {"type": "http.request", "body": body_bytes, "more_body": False}
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
            b = message.get("body", b"") or b""
            if isinstance(b, (bytes, bytearray)):
                state["body"].extend(b)
            else:
                state["body"].extend(str(b).encode("utf-8"))
    await app(scope, receive, send)
    body_out = bytes(state["body"]).decode("utf-8", "replace")
    return {"ok": True, "status": str(state["status"]), "statusCode": state["status"],
            "headers": state["headers"], "body": body_out}

def _tb_wsgi_call(path, method, ns, body):
    app, kind, _name = _tb_find_app(ns)
    if app is None:
        return {"ok": False, "error": "no-app",
                "detail": "No web app found. Define a callable named 'app' at module level — "
                          "a WSGI app (e.g. Flask's app) or an ASGI app (e.g. FastAPI())."}
    if kind == "asgi":
        return {"ok": False, "error": "asgi", "kind": "asgi"}
    try:
        return _tb_call_wsgi(app, path, method, body)
    except Exception as exc:
        import traceback
        return {"ok": False, "error": "exception",
                "detail": "".join(traceback.format_exception(type(exc), exc, exc.__traceback__))}

async def _tb_asgi_call(path, method, ns, headers_in, body):
    app, kind, _name = _tb_find_app(ns)
    if app is None:
        return {"ok": False, "error": "no-app",
                "detail": "No web app found. Define a callable named 'app' at module level."}
    try:
        return await _tb_call_asgi(app, path, method, headers_in, body)
    except Exception as exc:
        import traceback
        return {"ok": False, "error": "exception",
                "detail": "".join(traceback.format_exception(type(exc), exc, exc.__traceback__))}

_TB_PROXY_BASE = ""
def _tb_proxy_for(url):
    import urllib.parse as _up
    s = str(url or "")
    low = s.lower()
    if not (low.startswith("http://") or low.startswith("https://")):
        return s
    if not _TB_PROXY_BASE:
        return s
    if s.startswith(_TB_PROXY_BASE):
        return s
    return _TB_PROXY_BASE + "?url=" + _up.quote(s, safe="")

# A file-like response returned by our own urlopen. Backs read()/readline()/iteration with the
# already-buffered body so there is no chunked/streaming read (the cause of pyodide_http's
# urllib IncompleteRead). Mimics the http.client.HTTPResponse surface enough for json.load,
# resp.read(), .status/.getcode(), .headers/.getheader(), and use as a context manager.
import io as _io
class _TbResponse(_io.BytesIO):
    def __init__(self, data, status, url, headers):
        super().__init__(data)
        self.status = int(status)
        self.code = int(status)
        self.url = url
        self.headers = headers
        self.msg = headers
        self.reason = ""
    def getcode(self):
        return self.status
    def geturl(self):
        return self.url
    def info(self):
        return self.headers
    def getheader(self, name, default=None):
        try:
            return self.headers.get(name, default)
        except Exception:
            return default
    def __enter__(self):
        return self
    def __exit__(self, *a):
        try: self.close()
        except Exception: pass
        return False

# Synchronous XHR urlopen (no chunked read). Routes through the CORS proxy via _tb_proxy_for so
# cross-origin works, and faithfully sends method/body/headers. Raises urllib HTTPError on >=400 so
# error handling matches stdlib.
def _tb_xhr_urlopen(url, data=None, timeout=None, method=None, extra_headers=None):
    import email.message, json as _json
    from js import XMLHttpRequest
    from pyodide.ffi import to_js
    target = _tb_proxy_for(url)
    m = (method or ("POST" if data is not None else "GET")).upper()
    xhr = XMLHttpRequest.new()
    xhr.open(m, target, False)  # synchronous
    xhr.responseType = "arraybuffer"
    try:
        for k, v in (extra_headers or {}).items():
            xhr.setRequestHeader(k, v)
    except Exception:
        pass
    if data is not None and not isinstance(data, (bytes, bytearray)):
        if isinstance(data, str):
            data = data.encode("utf-8")
    if data is None:
        xhr.send()
    else:
        xhr.send(to_js(bytes(data)))
    buf = xhr.response
    body = bytes(buf.to_py()) if hasattr(buf, "to_py") else (bytes(memoryview(buf)) if buf is not None else b"")
    hdrs = email.message.Message()
    try:
        raw = xhr.getAllResponseHeaders() or ""
        for line in raw.splitlines():
            if ":" in line:
                hk, hv = line.split(":", 1)
                hdrs[hk.strip()] = hv.strip()
    except Exception:
        pass
    status = int(xhr.status or 0)
    resp = _TbResponse(body, status, url, hdrs)
    if status >= 400:
        import urllib.error
        raise urllib.error.HTTPError(url, status, xhr.statusText or "HTTP Error", hdrs, resp)
    return resp

_tb_net_installed = False
def _tb_install_net(proxy_base):
    global _TB_PROXY_BASE, _tb_net_installed
    _TB_PROXY_BASE = str(proxy_base or "")
    if _tb_net_installed:
        return
    try:
        import pyodide_http
        pyodide_http.patch_all()
    except Exception:
        pass
    # Replace urllib.request.urlopen with our synchronous-XHR version (buffered body, no chunked
    # read — fixes the IncompleteRead pyodide_http hits on urllib). Handles Request objects + bare
    # URLs, preserving method/data/headers, and routes through the CORS proxy.
    import urllib.request as _ur
    def _proxied_urlopen(url, data=None, timeout=None, *args, **kwargs):
        if isinstance(url, _ur.Request):
            hdrs = {hk: hv for hk, hv in url.header_items()}
            return _tb_xhr_urlopen(url.full_url, data=url.data if url.data is not None else data,
                                   timeout=timeout, method=url.get_method(), extra_headers=hdrs)
        return _tb_xhr_urlopen(url, data=data, timeout=timeout)
    _ur.urlopen = _proxied_urlopen
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

// Resolve the proxy endpoint to an ABSOLUTE URL. The main thread passes a root-relative
// '/api/fetch' (apiBase is '' same-origin); requests/urllib3 need scheme+host to select a
// connection adapter, so we prepend the page origin. An already-absolute base (custom backend)
// passes through unchanged.
function absoluteProxyBase() {
  const base = String(proxyBase || '')
  if (!base) return ''
  if (/^https?:\/\//i.test(base)) return base
  if (base.startsWith('/') && PAGE_ORIGIN) return PAGE_ORIGIN + base
  return base
}

async function ensureNet(py) {
  try {
    if (!netInstalled) {
      try { await py.loadPackage('pyodide_http') } catch { /* offline — urllib still URL-rewritten */ }
    }
    const install = py.globals.get('_tb_install_net')
    install(absoluteProxyBase())
    install?.destroy?.()
    netInstalled = true
  } catch { /* best-effort */ }
}

function patchRequestsNow(py) {
  try {
    const fn = py.globals.get('_tb_patch_requests')
    fn()
    fn?.destroy?.()
  } catch { /* best-effort */ }
}

// ---- virtual FS: mirror project files ----------------------------------------------------
const WORK_DIR = '/home/pyodide/project'
let workDirReady = false
const writtenFiles = new Set()

function writeFiles(py, files) {
  const FS = py.FS
  if (!workDirReady) {
    try { FS.mkdirTree(WORK_DIR) } catch { /* exists */ }
    py.runPython(
      'import sys\n' +
      `_p = ${JSON.stringify(WORK_DIR)}\n` +
      'if _p not in sys.path:\n    sys.path.insert(0, _p)\n'
    )
    workDirReady = true
  }
  const names = Object.keys(files || {})
  const keep = new Set(names)
  for (const old of [...writtenFiles]) {
    if (!keep.has(old)) {
      try { FS.unlink(`${WORK_DIR}/${old}`) } catch { /* gone */ }
      writtenFiles.delete(old)
    }
  }
  for (const name of names) {
    FS.writeFile(`${WORK_DIR}/${name}`, String(files[name] ?? ''), { encoding: 'utf8' })
    writtenFiles.add(name)
  }
  const modList = names.filter(n => n.endsWith('.py')).map(n => n.slice(0, -3))
  py.runPython(
    'import importlib, sys\n' +
    'importlib.invalidate_caches()\n' +
    `_mods = ${JSON.stringify(modList)}\n` +
    'for _m in _mods:\n' +
    '    sys.modules.pop(_m, None)\n'
  )
}

// ---- run a project -----------------------------------------------------------------------
async function handleRun(req) {
  const { id, files, entry } = req
  currentRunId = id
  // Reset stdin for this run. With a SAB present, input() BLOCKS via Atomics.wait (lines come from
  // the main thread through the SAB, so the local queue isn't used and is cleared); without it, the
  // queue-fed fallback is seeded with any pre-typed lines.
  if (stdinSAB && stdinCtrl) Atomics.store(stdinCtrl, CTRL_STATE, ST_IDLE)
  stdinQueue = stdinSAB ? [] : (Array.isArray(req.stdin) ? req.stdin.slice() : [])
  inputPrompted = false
  proxyBase = String(req.proxyBase || '')

  let py
  try {
    py = await getPyodide()
    await bootstrap(py)
  } catch (err) {
    post({ type: 'result', id, ok: false, result: { kind: 'none', data: '' }, figures: [], error: errString(err), hasApp: false, appKind: '' })
    return
  }

  const names = Object.keys(files || {})
  const realEntry = names.includes(entry) ? entry : (names.includes('main.py') ? 'main.py' : names[0])
  const code = String((files || {})[realEntry] ?? '')

  try { writeFiles(py, files) } catch { /* import error will surface */ }

  // Stream stdout/stderr live. Pyodide's batched writer strips the trailing newline (its default
  // handler re-adds one for console.log), so we re-append "\n" to faithfully reconstruct the
  // stream. We tag each chunk with the run id so a late chunk from a terminated run is ignorable.
  py.setStdout({ batched: (s) => post({ type: 'stdout', id, text: s + '\n' }) })
  py.setStderr({ batched: (s) => post({ type: 'stderr', id, text: s + '\n' }) })
  try { py.setStdin({ stdin: readStdinLine, autoEOF: true }) } catch { /* older API */ }

  const figures = []
  let result = { kind: 'none', data: '' }
  let error = null
  let hasApp = false
  let appKind = ''

  try {
    try {
      const scanSrc = names.length ? Object.values(files).join('\n') : code
      await py.loadPackagesFromImports(scanSrc)
    } catch { /* unknown 3rd-party imports raise a clear ModuleNotFoundError at run */ }

    await ensureNet(py)
    patchRequestsNow(py)

    try { py.runPython('_tb_clear_apps(globals())') } catch { /* non-fatal */ }

    if (!matplotlibPatched) {
      try { await py.runPythonAsync('_tb_install_matplotlib()'); matplotlibPatched = true } catch { /* no matplotlib */ }
    }

    const value = await py.runPythonAsync(code)

    try {
      const takeFigs = py.globals.get('_tb_take_figures')
      const figProxy = takeFigs()
      const arr = figProxy?.toJs ? figProxy.toJs() : figProxy
      if (Array.isArray(arr)) figures.push(...arr)
      figProxy?.destroy?.()
      takeFigs?.destroy?.()
    } catch { /* no matplotlib */ }

    try {
      const reprFn = py.globals.get('_tb_repr')
      const r = reprFn(value)
      const obj = r.toJs ? r.toJs({ dict_converter: Object.fromEntries }) : r
      if (obj && obj.kind) result = { kind: obj.kind, data: obj.data }
      r?.destroy?.()
      reprFn?.destroy?.()
    } catch { /* ignore repr failures */ }

    try {
      appKind = String(py.runPython('_tb_app_kind(dict(globals()))') || '')
      hasApp = appKind === 'wsgi' || appKind === 'asgi'
    } catch { hasApp = false; appKind = '' }

    if (value && typeof value.destroy === 'function') value.destroy()
  } catch (err) {
    error = errString(err)
  } finally {
    try { py.setStdout({}) } catch { /* ignore */ }
    try { py.setStderr({}) } catch { /* ignore */ }
  }

  post({ type: 'result', id, ok: !error, result, figures, error, hasApp, appKind })
}

// ---- install packages (micropip — network) ----------------------------------------------
async function handleInstall(req) {
  const { id, specs } = req
  proxyBase = String(req.proxyBase || proxyBase)
  let py
  try { py = await getPyodide() } catch (err) { post({ type: 'installed', id, ok: false, error: errString(err) }); return }
  try {
    await py.loadPackage('micropip')
    const micropip = py.pyimport('micropip')
    try {
      for (const spec of specs || []) {
        post({ type: 'stdout', id, text: `micropip: ${spec}\n` })
        await micropip.install(spec, { keep_going: true })
      }
    } finally { micropip?.destroy?.() }
    post({ type: 'installed', id, ok: true })
  } catch (err) {
    post({ type: 'installed', id, ok: false, error: errString(err) })
  }
}

// ---- route a synthetic HTTP request to the user's WSGI/ASGI app ---------------------------
async function handleCallServer(req) {
  const { id, path, method, body, headers } = req
  const py = pyodide
  if (!py) { post({ type: 'server', id, ok: false, error: 'no-runtime', detail: 'Run your code first.' }); return }
  let out = null
  try {
    const fn = py.globals.get('_tb_wsgi_call')
    const proxy = fn(path, method, py.globals, body || '')
    out = jsFromProxy(proxy)
    proxy?.destroy?.()
    fn?.destroy?.()
  } catch (err) {
    post({ type: 'server', id, ok: false, error: 'exception', detail: errString(err) })
    return
  }
  if (out && out.error === 'asgi') {
    try {
      py.globals.set('_tb_req_headers', py.toPy(headers || []))
      py.globals.set('_tb_req_path', String(path || '/'))
      py.globals.set('_tb_req_method', String(method || 'GET'))
      py.globals.set('_tb_req_body', String(body || ''))
      const proxy = await py.runPythonAsync(
        'await _tb_asgi_call(_tb_req_path, _tb_req_method, dict(globals()), _tb_req_headers, _tb_req_body)'
      )
      out = jsFromProxy(proxy)
      proxy?.destroy?.()
    } catch (err) {
      post({ type: 'server', id, ok: false, error: 'exception', detail: errString(err) })
      return
    }
  }
  if (!out) { post({ type: 'server', id, ok: false, error: 'unknown', detail: 'No response.' }); return }
  if (out.ok) { post({ type: 'server', id, ...shapeServerResult(out) }); return }
  post({ type: 'server', id, ...out })
}

function jsFromProxy(proxy) {
  if (proxy == null) return proxy
  return proxy.toJs ? proxy.toJs({ dict_converter: Object.fromEntries }) : proxy
}

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
    headers,
  }
}

function errString(err) {
  return (err && (err.message || err.toString())) || String(err)
}

// ---- package manager: list installed packages + versions, uninstall ----------------------
// micropip.list() returns every installed distribution (bundled + micropip-installed) with version
// + source. We surface name/version/source so the UI can show a manager. Uninstall uses
// micropip.uninstall (pure-python/micropip-installed packages only; bundled stdlib can't be removed).
async function handleListPackages(id) {
  const py = pyodide
  if (!py) { post({ type: 'packages', id, ok: true, packages: [] }); return }
  try {
    await py.loadPackage('micropip')
    const list = await py.runPythonAsync(`
import micropip, json
_pkgs = []
try:
    for name, info in micropip.list().items():
        _pkgs.append({"name": name, "version": getattr(info, "version", ""), "source": getattr(info, "source", "") or "", "installer": getattr(info, "installer", "") or ""})
except Exception:
    pass
json.dumps(_pkgs)
`)
    let packages = []
    try { packages = JSON.parse(String(list || '[]')) } catch { packages = [] }
    post({ type: 'packages', id, ok: true, packages })
  } catch (err) {
    post({ type: 'packages', id, ok: false, error: errString(err), packages: [] })
  }
}

async function handleUninstall(req) {
  const { id, name } = req
  const py = pyodide
  if (!py) { post({ type: 'uninstalled', id, ok: false, error: 'no-runtime' }); return }
  try {
    await py.loadPackage('micropip')
    py.globals.set('_tb_uninstall_name', String(name || ''))
    await py.runPythonAsync('import micropip\nmicropip.uninstall(_tb_uninstall_name)')
    post({ type: 'uninstalled', id, ok: true, name })
  } catch (err) {
    post({ type: 'uninstalled', id, ok: false, error: errString(err), name })
  }
}

// ---- message dispatch --------------------------------------------------------------------
self.onmessage = (e) => {
  const msg = e.data || {}
  switch (msg.type) {
    case 'stdinBuffer':
      // One-time setup: the SharedArrayBuffer the main thread uses to deliver blocking-input lines.
      setupStdinBuffer(msg.buffer || null)
      break
    case 'run': handleRun(msg); break
    case 'install': handleInstall(msg); break
    case 'callServer': handleCallServer(msg); break
    case 'listPackages': handleListPackages(msg.id); break
    case 'uninstall': handleUninstall(msg); break
    case 'cacheStatus': reportCacheStatus(msg.id); break
    case 'stdin':
      // Fallback (no SAB): queue typed lines for the next input() call(s).
      if (msg.text != null) {
        for (const part of String(msg.text).split('\n')) stdinQueue.push(part)
        inputPrompted = false
      }
      break
    default: break
  }
}
