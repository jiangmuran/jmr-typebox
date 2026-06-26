// Pure, SSG-safe helpers for the Python IDE's networking + web-preview request shaping.
// NO window/document/pyodide access here — these operate on plain values so they can be
// unit-tested in node and imported anywhere. All impure Pyodide work lives in ./pythonRunner.
//
// Two concerns live here, both pure string/object math:
//   1. Building the same-origin CORS-proxy URL Python requests are routed through
//      (`/api/fetch?url=<encoded>`), with an SSRF-style allow-list mirroring worker/api/fetch.js
//      so example scripts can hit public APIs that the browser would otherwise block.
//   2. Shaping a synthetic HTTP request into the WSGI environ / ASGI scope a user app expects,
//      and normalising the response — so the web-preview's request handling is testable without
//      a live interpreter.

// ---- CORS proxy URL building ------------------------------------------------------------
// The site backend exposes an SSRF-guarded CORS proxy at `<apiBase>/api/fetch?url=<encoded>`
// (see worker/api/fetch.js). Python's urllib/requests are patched (in pythonRunner) so their
// requests transparently go through it. We mirror the worker's host guard here so a clearly
// blocked URL fails fast in-interpreter with a helpful message instead of a confusing 403.

// Path of the backend proxy (same-origin; apiBase is '' in production).
export const PROXY_PATH = '/api/fetch'

// Mirror of worker/api/fetch.js isBlockedHost — private/loopback/link-local hosts are refused
// by the proxy, so we reject them early with a clear error.
export function isBlockedProxyHost(hostname) {
  const h = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '')
  if (!h) return true
  if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal')) return true
  if (h === '::1' || h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80')) return true
  if (/^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) || /^169\.254\./.test(h) || /^0\./.test(h)) return true
  const m = h.match(/^172\.(\d+)\./)
  if (m && +m[1] >= 16 && +m[1] <= 31) return true
  return false
}

// Is this an absolute http(s) URL the proxy will accept? Returns { ok, reason }.
export function classifyProxyTarget(rawUrl) {
  const s = String(rawUrl || '').trim()
  if (!s) return { ok: false, reason: 'empty' }
  let u
  try {
    // Use a base so protocol-relative or relative inputs are clearly rejected (proxy needs absolute).
    u = new URL(s)
  } catch {
    return { ok: false, reason: 'invalid' }
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false, reason: 'protocol' }
  if (isBlockedProxyHost(u.hostname)) return { ok: false, reason: 'blocked' }
  return { ok: true, reason: '' }
}

// Build the proxy URL for a target. `apiBase` is the backend origin ('' = same-origin).
// Returns the absolute (or root-relative) URL the patched Python fetch should hit. The target is
// fully percent-encoded as a single query value so query strings/anchors survive intact.
export function buildProxyUrl(targetUrl, apiBase = '') {
  const base = String(apiBase || '')
  return `${base}${PROXY_PATH}?url=${encodeURIComponent(String(targetUrl || ''))}`
}

// ---- synthetic request → WSGI environ ---------------------------------------------------
// Split a request path into a clean PATH_INFO + QUERY_STRING the way a server would. Always
// yields a leading slash on the path and an unprefixed (no '?') query string.
export function splitPath(path) {
  let p = String(path == null ? '/' : path)
  if (!p) p = '/'
  let query = ''
  const q = p.indexOf('?')
  if (q >= 0) {
    query = p.slice(q + 1)
    p = p.slice(0, q)
  }
  if (!p.startsWith('/')) p = '/' + p
  return { path: p, query }
}

// ---- ASGI scope shaping -----------------------------------------------------------------
// Build the ASGI HTTP `scope` dict for a synthetic request. This is the value the user's ASGI
// app (e.g. FastAPI/Starlette) is driven with. Headers are a list of [name, value] BYTES pairs
// per the ASGI spec, but since we shape this in JS and hand plain arrays to Python (which encodes
// them), we keep them as lower-case string pairs here and let the Python side bytes-encode.
//   method  — upper-cased HTTP verb
//   path    — decoded path (no query)
//   query   — raw query string (no leading '?')
//   headers — array of [lowerName, value] string pairs
export function buildAsgiScope(path, method = 'GET', extraHeaders = []) {
  const { path: rawPath, query } = splitPath(path)
  const headers = [
    ['host', 'preview.local'],
    ['accept', 'text/html,application/json,*/*'],
    ['user-agent', 'TypeBox-Preview/1.0'],
    ...(Array.isArray(extraHeaders) ? extraHeaders : []),
  ]
  return {
    type: 'http',
    asgi: { version: '3.0', spec_version: '2.3' },
    http_version: '1.1',
    method: String(method || 'GET').toUpperCase(),
    scheme: 'http',
    path: rawPath,
    raw_path: rawPath,
    query_string: query,
    root_path: '',
    headers,
    server: ['preview.local', 80],
    client: ['127.0.0.1', 0],
  }
}

// ---- response normalisation -------------------------------------------------------------
// Given a status int + a headers list ([name,value] pairs, any case) + a decoded body string,
// produce the { status, contentType, body, isHtml } the preview iframe renders. Shared by the
// WSGI and ASGI paths so both report a consistent shape.
export function normalizeResponse({ status = 200, headers = [], body = '' } = {}) {
  let contentType = ''
  for (const pair of headers || []) {
    if (!pair) continue
    const name = String(pair[0] || '').toLowerCase()
    if (name === 'content-type') { contentType = String(pair[1] || ''); break }
  }
  if (!contentType) contentType = 'text/html; charset=utf-8'
  const statusNum = Number(status) || 200
  const statusText = STATUS_TEXT[statusNum] || ''
  return {
    status: statusText ? `${statusNum} ${statusText}` : String(statusNum),
    statusCode: statusNum,
    contentType,
    isHtml: /html/i.test(contentType),
    isJson: /json/i.test(contentType),
    body: String(body == null ? '' : body),
  }
}

// A compact reason-phrase table for the statuses a preview is likely to surface.
export const STATUS_TEXT = {
  200: 'OK', 201: 'Created', 202: 'Accepted', 204: 'No Content',
  301: 'Moved Permanently', 302: 'Found', 303: 'See Other', 304: 'Not Modified', 307: 'Temporary Redirect', 308: 'Permanent Redirect',
  400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found', 405: 'Method Not Allowed', 409: 'Conflict', 422: 'Unprocessable Entity', 429: 'Too Many Requests',
  500: 'Internal Server Error', 501: 'Not Implemented', 502: 'Bad Gateway', 503: 'Service Unavailable',
}

// Pretty-print a JSON body for display when the response is application/json. Falls back to the
// raw text if it doesn't parse. Pure — used to make API responses readable in the preview pane.
export function prettyJson(body) {
  const s = String(body == null ? '' : body)
  try {
    return JSON.stringify(JSON.parse(s), null, 2)
  } catch {
    return s
  }
}
