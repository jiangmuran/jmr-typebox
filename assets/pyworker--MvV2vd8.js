(function(){"use strict";const F="314.0.0",T=`https://cdn.jsdelivr.net/pyodide/v${F}/full/`,B=`typebox-pyodide-v${F}`,Q=["cdn.jsdelivr.net","files.pythonhosted.org","pypi.org","unpkg.com"];let m=null,x=null,H=!1,L=!1,D=!1,G=!1,q=0,E="";const O=typeof self<"u"&&self.location&&self.location.origin||"";async function z(){if(G||(G=!0,typeof caches>"u"||typeof self.fetch!="function"))return;const e=self.fetch.bind(self);let t=null;try{t=await caches.open(B)}catch{t=null}t&&(self.fetch=async(s,a)=>{let r="";try{r=typeof s=="string"?s:s&&s.url||""}catch{r=""}let i="";try{i=new URL(r,O).hostname}catch{i=""}if(!(!!r&&(a==null||!a.method||String(a.method).toUpperCase()==="GET")&&Q.includes(i)))return e(s,a);try{const h=await t.match(r);if(h)return h.clone()}catch{}const l=await e(s,a);try{l&&l.ok&&l.type!=="opaque"&&await t.put(r,l.clone())}catch{}return l})}async function Z(e){let t=!1;try{typeof caches<"u"&&(t=!!await(await caches.open(B)).match(T+"pyodide.asm.wasm"))}catch{t=!1}o({type:"cacheStatus",id:e,runtimeCached:t})}const Y=0,j=1,ee=3,k=0,te=1,se=16;let v=null,f=null,A=null,R=null,N=[],S=!1;function o(e){try{self.postMessage(e)}catch{}}function re(e){v=e||null,e?(f=new Int32Array(e,0,4),A=new Uint8Array(e,se),R=typeof TextDecoder<"u"?new TextDecoder:null):f=A=R=null}function M(){if(v&&f&&typeof Atomics<"u"){for(Atomics.store(f,k,j),o({type:"input",id:q});Atomics.load(f,k)===j;)Atomics.wait(f,k,j);const e=Atomics.load(f,k);if(Atomics.store(f,k,Y),e===ee)return null;const t=Atomics.load(f,te)|0;if(t<=0)return"";const s=A.slice(0,Math.min(t,A.length));return R?R.decode(s):String.fromCharCode.apply(null,s)}return N.length?(S=!1,N.shift()):(S||(S=!0,o({type:"input",id:q})),null)}const I=[["pyodide.asm.wasm",96e5],["python_stdlib.zip",26e5]];async function ae(){if(typeof fetch!="function")return;const e=I.map(([,r])=>r);let t=e.reduce((r,i)=>r+i,0),s=0;const a=()=>o({type:"progress",loaded:s,total:t});a();for(let r=0;r<I.length;r++){const[i]=I[r];let n;try{n=await fetch(T+i,{cache:"force-cache"})}catch{s+=e[r],a();continue}if(!n.ok||!n.body){s+=e[r],a();continue}const l=Number(n.headers.get("content-length"))||0;l>0&&(t+=l-e[r],e[r]=l);try{const h=n.body.getReader();for(;;){const{done:g,value:b}=await h.read();if(g)break;s+=b.byteLength,a()}}catch{s+=Math.max(0,e[r]),a()}}s=t,a()}async function X(){if(m)return m;if(x)return x;x=(async()=>{await z(),o({type:"status",phase:"download"});const[e]=await Promise.all([import(`${T}pyodide.mjs`),ae()]);o({type:"status",phase:"init"});const t=await e.loadPyodide({indexURL:T});try{t.setStdin({stdin:M,autoEOF:!0})}catch{}return m=t,o({type:"status",phase:"ready"}),o({type:"ready"}),t})();try{await x}catch(e){throw x=null,e}return m}const ne=`
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
        raise RuntimeError("Network access is disabled. Enable the backend in Settings to allow Python requests/urllib.")
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
    # Always patch (even with no proxy): _tb_proxy_for raises a clear "backend off" error when
    # _TB_PROXY_BASE is empty, so a late-imported requests fails cleanly instead of via raw CORS.
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
`;async function oe(e){H||(await e.runPythonAsync(ne),H=!0)}function ie(){const e=String(E||"");return e?/^https?:\/\//i.test(e)?e:e.startsWith("/")&&O?O+e:e:""}async function le(e){var t;try{if(!D)try{await e.loadPackage("pyodide_http")}catch{}const s=e.globals.get("_tb_install_net");s(ie()),(t=s==null?void 0:s.destroy)==null||t.call(s),D=!0}catch{}}function ce(e){var t;try{const s=e.globals.get("_tb_patch_requests");s(),(t=s==null?void 0:s.destroy)==null||t.call(s)}catch{}}const P="/home/pyodide/project";let J=!1;const C=new Set;function de(e,t){const s=e.FS;if(!J){try{s.mkdirTree(P)}catch{}e.runPython(`import sys
_p = ${JSON.stringify(P)}
if _p not in sys.path:
    sys.path.insert(0, _p)
`),J=!0}const a=Object.keys(t||{}),r=new Set(a);for(const n of[...C])if(!r.has(n)){try{s.unlink(`${P}/${n}`)}catch{}C.delete(n)}for(const n of a)s.writeFile(`${P}/${n}`,String(t[n]??""),{encoding:"utf8"}),C.add(n);const i=a.filter(n=>n.endsWith(".py")).map(n=>n.slice(0,-3));e.runPython(`import importlib, sys
importlib.invalidate_caches()
_mods = ${JSON.stringify(i)}
for _m in _mods:
    sys.modules.pop(_m, None)
`)}async function pe(e){var U,K,W,V;const{id:t,files:s,entry:a}=e;q=t,v&&f&&Atomics.store(f,k,Y),N=v?[]:Array.isArray(e.stdin)?e.stdin.slice():[],S=!1,E=String(e.proxyBase||"");let r;try{r=await X(),await oe(r)}catch(_){o({type:"result",id:t,ok:!1,result:{kind:"none",data:""},figures:[],error:y(_),hasApp:!1,appKind:""});return}const i=Object.keys(s||{}),n=i.includes(a)?a:i.includes("main.py")?"main.py":i[0],l=String((s||{})[n]??"");try{de(r,s)}catch{}r.setStdout({batched:_=>o({type:"stdout",id:t,text:_+`
`})}),r.setStderr({batched:_=>o({type:"stderr",id:t,text:_+`
`})});try{r.setStdin({stdin:M,autoEOF:!0})}catch{}const h=[];let g={kind:"none",data:""},b=null,c=!1,u="";try{try{const p=i.length?Object.values(s).join(`
`):l;await r.loadPackagesFromImports(p)}catch{}await le(r),ce(r);try{r.runPython("_tb_clear_apps(globals())")}catch{}if(!L)try{await r.runPythonAsync("_tb_install_matplotlib()"),L=!0}catch{}const _=await r.runPythonAsync(l);try{const p=r.globals.get("_tb_take_figures"),d=p(),w=d!=null&&d.toJs?d.toJs():d;Array.isArray(w)&&h.push(...w),(U=d==null?void 0:d.destroy)==null||U.call(d),(K=p==null?void 0:p.destroy)==null||K.call(p)}catch{}try{const p=r.globals.get("_tb_repr"),d=p(_),w=d.toJs?d.toJs({dict_converter:Object.fromEntries}):d;w&&w.kind&&(g={kind:w.kind,data:w.data}),(W=d==null?void 0:d.destroy)==null||W.call(d),(V=p==null?void 0:p.destroy)==null||V.call(p)}catch{}try{u=String(r.runPython("_tb_app_kind(dict(globals()))")||""),c=u==="wsgi"||u==="asgi"}catch{c=!1,u=""}_&&typeof _.destroy=="function"&&_.destroy()}catch(_){b=y(_)}finally{try{r.setStdout({})}catch{}try{r.setStderr({})}catch{}}o({type:"result",id:t,ok:!b,result:g,figures:h,error:b,hasApp:c,appKind:u})}async function ue(e){var r;const{id:t,specs:s}=e;E=String(e.proxyBase||E);let a;try{a=await X()}catch(i){o({type:"installed",id:t,ok:!1,error:y(i)});return}try{await a.loadPackage("micropip");const i=a.pyimport("micropip");try{for(const n of s||[])o({type:"stdout",id:t,text:`micropip: ${n}
`}),await i.install(n,{keep_going:!0})}finally{(r=i==null?void 0:i.destroy)==null||r.call(i)}o({type:"installed",id:t,ok:!0})}catch(i){o({type:"installed",id:t,ok:!1,error:y(i)})}}async function _e(e){var h,g,b;const{id:t,path:s,method:a,body:r,headers:i}=e,n=m;if(!n){o({type:"server",id:t,ok:!1,error:"no-runtime",detail:"Run your code first."});return}let l=null;try{const c=n.globals.get("_tb_wsgi_call"),u=c(s,a,n.globals,r||"");l=$(u),(h=u==null?void 0:u.destroy)==null||h.call(u),(g=c==null?void 0:c.destroy)==null||g.call(c)}catch(c){o({type:"server",id:t,ok:!1,error:"exception",detail:y(c)});return}if(l&&l.error==="asgi")try{n.globals.set("_tb_req_headers",n.toPy(i||[])),n.globals.set("_tb_req_path",String(s||"/")),n.globals.set("_tb_req_method",String(a||"GET")),n.globals.set("_tb_req_body",String(r||""));const c=await n.runPythonAsync("await _tb_asgi_call(_tb_req_path, _tb_req_method, dict(globals()), _tb_req_headers, _tb_req_body)");l=$(c),(b=c==null?void 0:c.destroy)==null||b.call(c)}catch(c){o({type:"server",id:t,ok:!1,error:"exception",detail:y(c)});return}if(!l){o({type:"server",id:t,ok:!1,error:"unknown",detail:"No response."});return}if(l.ok){o({type:"server",id:t,...fe(l)});return}o({type:"server",id:t,...l})}function $(e){return e==null?e:e.toJs?e.toJs({dict_converter:Object.fromEntries}):e}function fe(e){const t=Array.isArray(e.headers)?e.headers:[];let s="";for(const a of t)if(a&&String(a[0]).toLowerCase()==="content-type"){s=String(a[1]||"");break}return s||(s="text/html; charset=utf-8"),{ok:!0,status:e.status||"200 OK",statusCode:e.statusCode||200,contentType:s,isHtml:/html/i.test(s),isJson:/json/i.test(s),body:String(e.body==null?"":e.body),headers:t}}function y(e){return e&&(e.message||e.toString())||String(e)}async function he(e){const t=m;if(!t){o({type:"packages",id:e,ok:!0,packages:[]});return}try{await t.loadPackage("micropip");const s=await t.runPythonAsync(`
import micropip, json
_pkgs = []
try:
    for name, info in micropip.list().items():
        _pkgs.append({"name": name, "version": getattr(info, "version", ""), "source": getattr(info, "source", "") or "", "installer": getattr(info, "installer", "") or ""})
except Exception:
    pass
json.dumps(_pkgs)
`);let a=[];try{a=JSON.parse(String(s||"[]"))}catch{a=[]}o({type:"packages",id:e,ok:!0,packages:a})}catch(s){o({type:"packages",id:e,ok:!1,error:y(s),packages:[]})}}async function ye(e){const{id:t,name:s}=e,a=m;if(!a){o({type:"uninstalled",id:t,ok:!1,error:"no-runtime"});return}try{await a.loadPackage("micropip"),a.globals.set("_tb_uninstall_name",String(s||"")),await a.runPythonAsync(`import micropip
micropip.uninstall(_tb_uninstall_name)`),o({type:"uninstalled",id:t,ok:!0,name:s})}catch(r){o({type:"uninstalled",id:t,ok:!1,error:y(r),name:s})}}self.onmessage=e=>{const t=e.data||{};switch(t.type){case"stdinBuffer":re(t.buffer||null);break;case"run":pe(t);break;case"install":ue(t);break;case"callServer":_e(t);break;case"listPackages":he(t.id);break;case"uninstall":ye(t);break;case"cacheStatus":Z(t.id);break;case"stdin":if(t.text!=null){for(const s of String(t.text).split(`
`))N.push(s);S=!1}break}}})();
