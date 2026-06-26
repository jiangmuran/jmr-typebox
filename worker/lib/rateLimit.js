// Per-IP sliding-window rate limiter for the abuse-prone /api proxies (the open URL fetch,
// the OG preview, and the AI relay). In-memory per Worker isolate: isolates are ephemeral and
// distributed, so this is not a globally-exact counter, but it's zero-config and effectively
// throttles a single client hammering an endpoint (requests from one IP generally land on the
// same colo/isolate). Good enough to stop casual "刷接口" abuse without external state.

const buckets = new Map() // key -> number[] of request timestamps (ms, ascending)
let lastSweep = 0

/** The real client IP as seen by Cloudflare. */
export function clientIp(request) {
  return (
    request.headers.get('CF-Connecting-IP') ||
    request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ||
    'unknown'
  )
}

/**
 * Sliding-window check. Returns { ok, remaining } when allowed, or { ok:false, retryAfter }.
 * `now` is injectable for tests.
 */
export function rateLimit(key, limit, windowMs, now = Date.now()) {
  // Bound memory: occasionally drop buckets with no recent hits.
  if (now - lastSweep > 60_000) {
    lastSweep = now
    for (const [k, arr] of buckets) {
      if (!arr.length || arr[arr.length - 1] <= now - windowMs) buckets.delete(k)
    }
  }
  let arr = buckets.get(key)
  if (!arr) { arr = []; buckets.set(key, arr) }
  const cutoff = now - windowMs
  while (arr.length && arr[0] <= cutoff) arr.shift()
  if (arr.length >= limit) {
    return { ok: false, retryAfter: Math.max(1, Math.ceil((arr[0] + windowMs - now) / 1000)) }
  }
  arr.push(now)
  return { ok: true, remaining: limit - arr.length }
}

/** Standard 429 response with Retry-After. */
export function tooManyRequests(retryAfter) {
  return new Response(
    JSON.stringify({ error: 'rate_limited', message: 'Too many requests — please slow down.', retryAfter }),
    {
      status: 429,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'retry-after': String(retryAfter),
        'access-control-allow-origin': '*',
      },
    }
  )
}

// Test-only: reset the in-memory state.
export function _reset() { buckets.clear(); lastSweep = 0 }
