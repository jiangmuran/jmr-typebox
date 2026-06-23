// Pure, SSG-safe helpers for the Pyodide Web Worker protocol and the in-page web-preview
// navigation. NO window/document/Worker/pyodide access here — everything operates on plain values
// so it can be unit-tested in node and imported anywhere. All impure worker plumbing lives in
// ./pythonRunner (main-thread proxy) and ./pyworker.js (the worker itself).
//
// Why a Web Worker at all: Pyodide previously ran on the MAIN THREAD, so a long/looping program
// blocked the event loop — output only appeared once the program finished ("全部输出完了才会显
// 示") and there was no way to force-stop an infinite loop ("没法强制停止程序"). Moving execution
// into a Worker keeps the UI thread free (stdout streams live) and makes Stop trivial: terminate()
// the worker and respawn a fresh one. This needs NO SharedArrayBuffer and therefore NO COOP/COEP
// headers (which would break the CDN-loaded ffmpeg/Pyodide and the analytics beacon).
//
// Three concerns live here, all pure string/object math:
//   1. Message constructors/validators for the postMessage protocol (so the shapes are tested).
//   2. Resolving a clicked link / submitted form inside the sandboxed preview iframe into the
//      next in-interpreter request ({path, method, body}) — only same-origin/relative navigation
//      is followed; external links and #fragments are ignored.
//   3. The tiny bridge <script> injected into the preview iframe that reports navigation intents
//      to the parent (kept here as a pure string so it is reviewable + testable).

// ---- worker message kinds ----------------------------------------------------------------
// Centralised so the worker and the main-thread proxy agree on the wire format (and a typo is a
// test failure, not a silent dropped message).
export const MSG = {
  // main -> worker
  RUN: 'run',
  INSTALL: 'install',
  CALL_SERVER: 'callServer',
  STDIN: 'stdin',
  LIST_PACKAGES: 'listPackages',
  UNINSTALL: 'uninstall',
  CACHE_STATUS: 'cacheStatus',
  // worker -> main
  STATUS: 'status',
  PROGRESS: 'progress',
  STDOUT: 'stdout',
  STDERR: 'stderr',
  INPUT: 'input',
  RESULT: 'result',
  INSTALLED: 'installed',
  SERVER: 'server',
  PACKAGES: 'packages',
  UNINSTALLED: 'uninstalled',
  CACHE_STATUS_REPLY: 'cacheStatus',
  READY: 'ready',
  ERROR: 'error',
}

// A run request the main thread posts to the worker. `id` ties streamed chunks + the final result
// back to one run so a late message from a terminated run can be ignored. `stdin` carries any lines
// the user pre-typed before pressing Run so they seed the queue AFTER the worker resets it for the
// run (a separate stdin message would be wiped by that reset).
export function runRequest(id, files, entry, proxyBase = '', stdin = []) {
  return {
    type: MSG.RUN,
    id,
    files: files || {},
    entry: entry || 'main.py',
    proxyBase: String(proxyBase || ''),
    stdin: Array.isArray(stdin) ? stdin : [],
  }
}

export function installRequest(id, specs, proxyBase = '') {
  return { type: MSG.INSTALL, id, specs: Array.isArray(specs) ? specs : [], proxyBase: String(proxyBase || '') }
}

export function callServerRequest(id, path = '/', method = 'GET', body = '', headers = []) {
  return {
    type: MSG.CALL_SERVER,
    id,
    path: String(path || '/'),
    method: String(method || 'GET').toUpperCase(),
    body: body == null ? '' : String(body),
    headers: Array.isArray(headers) ? headers : [],
  }
}

export function stdinMessage(text) {
  return { type: MSG.STDIN, text: text == null ? '' : String(text) }
}

export function listPackagesRequest(id) {
  return { type: MSG.LIST_PACKAGES, id }
}

export function uninstallRequest(id, name) {
  return { type: MSG.UNINSTALL, id, name: String(name || '') }
}

export function cacheStatusRequest(id) {
  return { type: MSG.CACHE_STATUS, id }
}

// ---- preview navigation resolution -------------------------------------------------------
// The preview iframe renders a response from the in-interpreter app but has no server, so a click
// on <a href> or a <form> submit does nothing by default ("链接和按钮都无法点击"). We intercept
// those intents in the iframe and re-route them to the app via callServer. These helpers decide
// WHETHER and WHERE to navigate — purely, so the routing logic is tested without a DOM.

// Should we follow this link inside the preview? Only same-app navigation: relative URLs, root-
// relative paths, and absolute URLs pointing at our synthetic preview host. External origins,
// mailto:/tel:/javascript:, and pure #fragments are NOT followed (let them be inert/!sandboxed).
// `base` is the current preview path (e.g. '/items'); returns { follow, path } where path is the
// resolved request path (with query) to hand to callServer.
export function resolveNav(base, href) {
  const cur = normalizePath(base)
  const raw = String(href == null ? '' : href).trim()
  if (!raw) return { follow: false, path: cur }
  const low = raw.toLowerCase()
  // Non-navigational or cross-app schemes.
  if (low.startsWith('mailto:') || low.startsWith('tel:') || low.startsWith('javascript:') || low.startsWith('data:')) {
    return { follow: false, path: cur }
  }
  // A pure fragment scrolls within the page — not a new request.
  if (raw.startsWith('#')) return { follow: false, path: cur }
  // Absolute URL: only follow if it targets the synthetic preview host; strip the origin to a path.
  if (/^https?:\/\//i.test(raw)) {
    const m = raw.match(/^https?:\/\/([^/]+)(\/[^#]*)?/i)
    const host = (m && m[1] || '').toLowerCase()
    if (host !== 'preview.local') return { follow: false, path: cur }
    const path = (m && m[2]) || '/'
    return { follow: true, path: stripFragment(path) }
  }
  // Root-relative path.
  if (raw.startsWith('/')) return { follow: true, path: stripFragment(raw) }
  // Relative path — resolve against the directory of the current path.
  return { follow: true, path: stripFragment(joinPath(cur, raw)) }
}

// Shape a <form> submission into a request. GET appends the URL-encoded fields to the action path's
// query; non-GET carries them as a urlencoded body (the in-interpreter apps read either). `fields`
// is an array of [name, value] string pairs. Returns { path, method, body, contentType }.
export function resolveForm(base, action, method = 'GET', fields = []) {
  const cur = normalizePath(base)
  const m = String(method || 'GET').toUpperCase()
  // Resolve the action exactly like a link (default to the current path when empty).
  const act = String(action == null ? '' : action).trim()
  const target = act ? resolveNav(cur, act) : { follow: true, path: cur }
  const path = target.follow ? target.path : cur
  const encoded = encodeForm(fields)
  if (m === 'GET') {
    const base2 = path.split('#')[0]
    const sep = base2.includes('?') ? '&' : '?'
    const qpath = encoded ? `${base2}${sep}${encoded}` : base2
    return { path: qpath, method: 'GET', body: '', contentType: '' }
  }
  return { path: path.split('#')[0], method: m, body: encoded, contentType: 'application/x-www-form-urlencoded' }
}

// URL-encode [name,value] pairs into an application/x-www-form-urlencoded string.
export function encodeForm(fields) {
  if (!Array.isArray(fields)) return ''
  const parts = []
  for (const pair of fields) {
    if (!pair) continue
    const k = encodeURIComponent(String(pair[0] == null ? '' : pair[0]))
    const v = encodeURIComponent(String(pair[1] == null ? '' : pair[1]))
    if (k) parts.push(`${k}=${v}`)
  }
  return parts.join('&')
}

// ---- small path utilities (shared by the nav resolvers) ----------------------------------
export function normalizePath(p) {
  let s = String(p == null ? '/' : p)
  if (!s) s = '/'
  if (!s.startsWith('/') && !/^https?:\/\//i.test(s)) s = '/' + s
  return s
}

function stripFragment(p) {
  const i = String(p).indexOf('#')
  return i >= 0 ? p.slice(0, i) : p
}

// Resolve a relative reference against the current path's "directory" (everything up to the last
// slash), collapsing . and .. segments. Query/fragment of the current path are dropped first.
function joinPath(cur, rel) {
  const curPath = stripFragment(String(cur).split('?')[0])
  const dir = curPath.endsWith('/') ? curPath : curPath.slice(0, curPath.lastIndexOf('/') + 1)
  // Split rel into path + query/fragment tail so '..' resolution only touches the path part.
  const tailIdx = rel.search(/[?#]/)
  const relPath = tailIdx >= 0 ? rel.slice(0, tailIdx) : rel
  const tail = tailIdx >= 0 ? rel.slice(tailIdx) : ''
  const stack = (dir + relPath).split('/')
  const out = []
  for (const seg of stack) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') { out.pop(); continue }
    out.push(seg)
  }
  return '/' + out.join('/') + tail
}

// ---- preview iframe bridge ---------------------------------------------------------------
// A minimal script injected (once) into the previewed HTML. It runs inside the sandboxed iframe
// (sandbox="allow-scripts") and reports link clicks + form submits to the parent via postMessage
// so the parent can re-route them through the in-interpreter app. It deliberately does NOT touch
// anything but its own document and never navigates the iframe itself (preventDefault). Exported as
// a string so it is reviewable and unit-tested for the message contract.
export const PREVIEW_BRIDGE = `(function(){
  function send(msg){ try{ parent.postMessage(Object.assign({__tbPreview:true}, msg), '*'); }catch(e){} }
  document.addEventListener('click', function(e){
    var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if(!a) return;
    if(a.target && a.target!=='_self') return;        // let real new-tab links be
    var href = a.getAttribute('href') || '';
    if(!href || href[0]==='#') return;                // in-page anchor: leave native
    if(/^(mailto:|tel:|javascript:|data:)/i.test(href)) return;
    e.preventDefault();
    send({ kind:'navigate', href: href });
  }, true);
  document.addEventListener('submit', function(e){
    var f = e.target;
    if(!f || f.tagName!=='FORM') return;
    e.preventDefault();
    var fields = [];
    try{
      var fd = new FormData(f);
      fd.forEach(function(v,k){ fields.push([k, typeof v==='string'? v : (v && v.name)||'']); });
    }catch(_){}
    send({ kind:'submit', action: f.getAttribute('action')||'', method:(f.getAttribute('method')||'GET'), fields: fields });
  }, true);
})();`

// Wrap a response body (HTML) so the bridge script + a <base> are present. Injecting <base
// target="_self"> keeps the few links the bridge can't catch from escaping the iframe, and the
// bridge script is appended right before </body> (or at the end). Pure string assembly.
export function injectPreviewBridge(html) {
  const body = String(html == null ? '' : html)
  const tag = `<script>${PREVIEW_BRIDGE}</script>`
  if (/<\/body>/i.test(body)) return body.replace(/<\/body>/i, tag + '</body>')
  return body + tag
}
