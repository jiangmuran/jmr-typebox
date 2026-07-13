// In-memory metrics for the admin dashboard. Per-isolate (NOT cross-isolate consistent, NOT
// persistent across restarts) — a deliberate trade-off for a single-user personal deployment where
// the cost of a Durable Object + per-request storage writes outweighs the benefit. All requests
// from one user generally land on the same isolate (same colo), so the numbers are accurate
// enough for "how many times did I hit /search today" + "what got blocked".
//
// Three stores:
//   • counters — Map<path-prefix, { total, ok, blocked_ip, blocked_rate, blocked_auth, errors }>
//   • recent   — ring buffer of the last 200 requests { ts, path, ip, status, latencyMs }
//   • logs     — ring buffer of the last 500 structured log entries { ts, level, msg, ctx }
//
// SSE: subscribers (the /api/admin/stats/stream EventSource on the admin page) get a push for
// every request + log event in real time. Heartbeat is the stats route's job.

const counters = new Map()
const recent = []
const logs = []
const RECENT_MAX = 200
const LOG_MAX = 500
const COUNTERS_MAX = 200
const subscribers = new Set()

/** Collapse `/api/music/stream/12345` → `/api/music/stream/:id` so counters stay small.
 *  A segment is an id when it's purely numeric, or long (≥12 chars) and contains a digit
 *  (QR check keys, CDN hashes). Short digit-bearing names like `/media/mp3-to-wav` are
 *  real routes and must keep their own bucket. Unknown alphabetic segments still get
 *  through, so the map is also hard-capped (overflow lands in '(other)'). */
function normalizePath(path) {
  return String(path || '').replace(/\/[^/]+/g, (seg) => {
    const s = seg.slice(1)
    return /^\d+$/.test(s) || (s.length >= 12 && /\d/.test(s)) ? '/:id' : seg
  })
}

/**
 * Record one request. Fire-and-forget from the dispatcher's perspective (never throws).
 */
export function recordRequest(path, ip, status, latencyMs) {
  let prefix = normalizePath(path)
  if (!counters.has(prefix) && counters.size >= COUNTERS_MAX) prefix = '(other)'
  const c = counters.get(prefix) || { total: 0, ok: 0, blocked_ip: 0, blocked_rate: 0, blocked_auth: 0, errors: 0 }
  c.total++
  if (status >= 200 && status < 300) c.ok++
  else if (status === 403) c.blocked_ip++
  else if (status === 429) c.blocked_rate++
  else if (status === 401) c.blocked_auth++
  else if (status >= 500) c.errors++
  counters.set(prefix, c)

  const entry = { ts: Date.now(), path: prefix, ip: maskIp(ip), status, latencyMs }
  recent.push(entry)
  if (recent.length > RECENT_MAX) recent.shift()

  broadcast({ type: 'request', data: entry })
}

/**
 * Append a structured log entry. `level` is 'debug' | 'info' | 'warn' | 'error'.
 */
export function logEvent(level, msg, ctx = {}) {
  const entry = { ts: Date.now(), level, msg: String(msg).slice(0, 500), ctx }
  logs.push(entry)
  if (logs.length > LOG_MAX) logs.shift()
  broadcast({ type: 'log', data: entry })
}

/**
 * Snapshot the current state for GET /api/admin/stats. Returns the counter map + the last 50
 * requests + the last 100 logs (enough to render the dashboard without overflowing the response).
 */
export function getStats() {
  const c = Object.fromEntries(counters)
  const totals = { total: 0, ok: 0, blocked_ip: 0, blocked_rate: 0, blocked_auth: 0, errors: 0 }
  for (const v of Object.values(c)) {
    for (const k of Object.keys(totals)) totals[k] += v[k] || 0
  }
  return {
    counters: c,
    totals,
    recent: recent.slice(-50),
    logs: logs.slice(-100),
  }
}

// ---- SSE plumbing ----

/** Subscribe a ReadableStream controller to live updates. Returns an unsubscribe function. */
export function subscribe(controller) {
  subscribers.add(controller)
  return () => subscribers.delete(controller)
}

function broadcast(msg) {
  if (!subscribers.size) return
  const data = `data: ${JSON.stringify(msg)}\n\n`
  const bytes = new TextEncoder().encode(data)
  for (const ctrl of subscribers) {
    try { ctrl.enqueue(bytes) } catch { subscribers.delete(ctrl) }
  }
}

/** Mask an IP for display: `1.2.3.4` → `1.2.*.*` (last two octets hidden). */
function maskIp(ip) {
  if (!ip || typeof ip !== 'string') return ip
  const parts = ip.split('.')
  if (parts.length === 4) return `${parts[0]}.${parts[1]}.*.*`
  return ip.replace(/\d+$/, '*')
}

// Test-only: wipe all state.
export function _reset() {
  counters.clear()
  recent.length = 0
  logs.length = 0
  subscribers.clear()
}
