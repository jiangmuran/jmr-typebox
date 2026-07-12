// IP allowlist guard — gates /api/music/* and /api/admin/* to a comma-separated list of client
// IPs configured via the ALLOWED_IPS Worker secret/var. Cloudflare exposes the real client IP
// via CF-Connecting-IP (and falls back to the first X-Forwarded-For hop).
//
// Why allowlist (vs. just rate-limit): the music routes carry a server-side NCM cookie that
// represents a paid VIP account — anyone who can hit /api/music/song/url/:id can stream VIP
// content through that account. IP-allowlisting is the cheapest reliable gate for a personal
// deployment; biometric admin auth (added in phase 3) layers on top of this for /api/admin/*.

import { clientIp } from './rateLimit.js'

/**
 * Standard 403 JSON response with the (masked) caller IP for client-side debugging.
 */
export function forbidden(ip) {
  const masked = ip && ip.includes('.') ? ip.replace(/(\d+)\.(\d+)$/, '*.*') : ip
  return Response.json(
    { error: 'forbidden', message: `Your IP (${masked}) is not on the allowlist.` },
    { status: 403, headers: { 'access-control-allow-origin': '*', 'cache-control': 'no-store' } }
  )
}

/**
 * Parse the ALLOWED_IPS env string into a Set of trimmed IPs. Accepts comma- or newline-
 * separated, ignores blanks. Returns null when the var is unset/empty — see `isAllowed` for
 * how that's interpreted.
 */
export function parseAllowlist(raw) {
  if (!raw || typeof raw !== 'string') return null
  const out = new Set()
  for (const part of raw.split(/[\s,]+/)) {
    const trimmed = part.trim()
    if (trimmed) out.add(trimmed)
  }
  return out.size ? out : null
}

/**
 * Returns true if the caller is allowed.
 *
 * Policy:
 *   - allowlist unset (null)  → OPEN for all route kinds. Admin relies on the WebAuthn session
 *     gate (worker/index.js checks the JWT cookie next); music is intentionally public. This is
 *     the "no IP allowlist" deployment mode — IP filtering is an OPTIONAL hardening layer, not a
 *     prerequisite for admin access.
 *   - allowlist set           → caller IP must match exactly (applies to both music and admin).
 *
 * `routeKind` is kept for future per-kind policy but currently doesn't change the outcome.
 */
export function isAllowed(request, allowlist, routeKind = 'music') {
  if (!allowlist) return true
  const ip = clientIp(request)
  if (!ip || ip === 'unknown') return false
  return allowlist.has(ip)
}
