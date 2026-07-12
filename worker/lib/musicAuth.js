// MusicAuth Durable Object — strongly-consistent auth state for the player's admin surface.
//
// Why a DO (and not KV): the bootstrap token must be SINGLE-USE (use it once to bind the first
// passkey, then it's dead forever), and one-time login links must be SINGLE-USE too. KV is
// eventually-consistent so a link could be redeemed twice on a fast double-click; a DO gives us
// a serial transaction per id, which is exactly what those flows need.
//
// Storage shape (SQLite-backed, all JSON via state.storage.put):
//   • bootstrap_token_hash : string | null   (sha-256 of the user-set bootstrap token)
//   • bootstrap_used       : boolean         (flipped true after the first passkey binds)
//   • passkeys             : Array<{ id, publicKey, counter, transports, nickname, addedAt }>
//   • challenges           : { register?: {challenge, expiresAt}, login?: {challenge, expiresAt} }
//   • one_time_links       : Array<{ tokenHash, scope, expiresAt, used }>
//   • ncm_cookie           : string          (the encrypted MUSIC_U cookie, set via /admin/ncm-cookie)
//   • ip_allowlist         : string[]        (mirrors the ALLOWED_IPS env var, but editable from UI)
//
// The DO exposes a tiny JSON-over-fetch RPC: every method is a POST with { op, ...payload } and
// returns { ok, ...fields } or { ok: false, error }. Mirrors the RateLimiter DO's protocol style.

const SINGLETON_ID = 'singleton'

/**
 * Client helper: call an op on the singleton MusicAuth DO. Routes use this instead of fiddling
 * with `env.MUSIC_AUTH.get(env.MUSIC_AUTH.idFromName(...)).fetch(...)` at every call site.
 * Returns the parsed JSON response ({ ok, ...fields } or { ok:false, error }).
 */
export async function callAuth(env, op, payload = {}) {
  const ns = env?.MUSIC_AUTH
  if (!ns || typeof ns.idFromName !== 'function') {
    return { ok: false, error: 'MUSIC_AUTH_DO_NOT_BOUND' }
  }
  const stub = ns.get(ns.idFromName(SINGLETON_ID))
  const res = await stub.fetch('https://auth/', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ op, ...payload }),
  })
  try { return await res.json() } catch { return { ok: false, error: 'bad_do_response' } }
}

export class MusicAuth {
  constructor(state) {
    this.state = state
    // Per-instance in-memory cache of the small root fields so we don't await storage.get on
    // every call. Hydrated lazily on first use; writes invalidate.
    this._cache = null
  }

  async _load() {
    if (this._cache) return this._cache
    this._cache = {
      bootstrap_token_hash: await this.state.storage.get('bootstrap_token_hash'),
      bootstrap_used: !!(await this.state.storage.get('bootstrap_used')),
      passkeys: (await this.state.storage.get('passkeys')) || [],
      challenges: (await this.state.storage.get('challenges')) || {},
      one_time_links: (await this.state.storage.get('one_time_links')) || [],
      ncm_cookie: await this.state.storage.get('ncm_cookie') || '',
      ip_allowlist: (await this.state.storage.get('ip_allowlist')) || [],
    }
    return this._cache
  }

  async _save(keys) {
    if (!this._cache) return
    const writes = {}
    for (const k of keys) writes[k] = this._cache[k]
    await this.state.storage.put(writes)
  }

  async fetch(request) {
    let body = {}
    try { body = await request.json() } catch { /* empty body ok */ }
    const { op } = body
    try {
      const fn = this[`_op_${op}`]
      if (typeof fn !== 'function') return Response.json({ ok: false, error: `unknown op: ${op}` })
      const out = await fn.call(this, body)
      return Response.json(out)
    } catch (e) {
      return Response.json({ ok: false, error: String(e && e.message || e) })
    }
  }

  // ---- bootstrap (first-time token → bind first passkey) ----
  // Returns the stored hash so the route can compare against the user-supplied token's hash.
  // We don't compare INSIDE the DO because hashing the user's input is the route's job (it
  // has the Web Crypto API just the same, but route-side keeps the DO purely structural).
  async _op_getBootstrap() {
    const c = await this._load()
    return { ok: true, hash: c.bootstrap_token_hash || null, used: c.bootstrap_used }
  }

  // Set the bootstrap token hash. Called once from the deploy script (or the first /api/auth/
  // bootstrap call) — the route hashes the user's token and stores the hash here. Idempotent
  // until bootstrap_used is flipped.
  async _op_setBootstrap({ hash }) {
    if (!hash || typeof hash !== 'string') return { ok: false, error: 'missing hash' }
    const c = await this._load()
    if (c.bootstrap_token_hash && c.bootstrap_token_hash !== hash) {
      return { ok: false, error: 'bootstrap already set to a different token' }
    }
    c.bootstrap_token_hash = hash
    await this._save(['bootstrap_token_hash'])
    return { ok: true }
  }

  // Mark bootstrap as consumed (called by finish-passkey after the first passkey is bound).
  async _op_consumeBootstrap() {
    const c = await this._load()
    c.bootstrap_used = true
    await this._save(['bootstrap_used'])
    return { ok: true }
  }

  // ---- passkeys ----
  async _op_listPasskeys() {
    const c = await this._load()
    // Strip the public key bytes from the listing (it's bulky and not needed for the UI).
    return {
      ok: true,
      passkeys: c.passkeys.map((p) => ({
        id: p.id, nickname: p.nickname, addedAt: p.addedAt, transports: p.transports || [],
      })),
    }
  }

  async _op_addPasskey({ credential }) {
    if (!credential || !credential.id) return { ok: false, error: 'missing credential' }
    const c = await this._load()
    const filtered = c.passkeys.filter((p) => p.id !== credential.id)
    filtered.push({
      id: credential.id,
      publicKey: credential.publicKey,
      counter: credential.counter || 0,
      transports: credential.transports || [],
      nickname: credential.nickname || `Device ${filtered.length + 1}`,
      addedAt: Date.now(),
    })
    c.passkeys = filtered
    await this._save(['passkeys'])
    return { ok: true }
  }

  async _op_removePasskey({ id }) {
    if (!id) return { ok: false, error: 'missing id' }
    const c = await this._load()
    if (c.passkeys.length <= 1) return { ok: false, error: 'refuse last passkey' }
    c.passkeys = c.passkeys.filter((p) => p.id !== id)
    await this._save(['passkeys'])
    return { ok: true }
  }

  async _op_getPasskey({ id }) {
    const c = await this._load()
    return { ok: true, passkey: c.passkeys.find((p) => p.id === id) || null }
  }

  async _op_getAllPasskeys() {
    const c = await this._load()
    return { ok: true, passkeys: c.passkeys }
  }

  async _op_updateCounter({ id, counter }) {
    const c = await this._load()
    c.passkeys = c.passkeys.map((p) => (p.id === id ? { ...p, counter } : p))
    await this._save(['passkeys'])
    return { ok: true }
  }

  // ---- challenges (short-lived single-use WebAuthn nonces) ----
  async _op_putChallenge({ kind, challenge, expiresAt }) {
    if (kind !== 'register' && kind !== 'login') return { ok: false, error: 'bad kind' }
    const c = await this._load()
    c.challenges[kind] = { challenge, expiresAt: expiresAt || (Date.now() + 5 * 60 * 1000) }
    await this._save(['challenges'])
    return { ok: true }
  }

  // Take + REMOVE the challenge (single-use). Returns null if missing / expired / mismatched.
  async _op_takeChallenge({ kind, challenge }) {
    const c = await this._load()
    const stored = c.challenges[kind]
    // Always clear it (single-use semantics — even on mismatch).
    delete c.challenges[kind]
    await this._save(['challenges'])
    if (!stored) return { ok: true, valid: false, reason: 'no_challenge' }
    if (stored.expiresAt < Date.now()) return { ok: true, valid: false, reason: 'expired' }
    if (stored.challenge !== challenge) return { ok: true, valid: false, reason: 'mismatch' }
    return { ok: true, valid: true }
  }

  // ---- one-time login links (add-passkey from a new device) ----
  async _op_createOneTimeLink({ tokenHash, scope = 'add-passkey', ttlMs = 10 * 60 * 1000 }) {
    if (!tokenHash) return { ok: false, error: 'missing tokenHash' }
    const c = await this._load()
    const entry = { tokenHash, scope, expiresAt: Date.now() + ttlMs, used: false, createdAt: Date.now() }
    c.one_time_links.push(entry)
    // Self-clean: drop expired/used entries on every write.
    c.one_time_links = c.one_time_links.filter((l) => !l.used && l.expiresAt > Date.now())
    await this._save(['one_time_links'])
    return { ok: true, expiresAt: entry.expiresAt }
  }

  // Take + consume a one-time link. Returns valid:true only if the link exists, hasn't been
  // used, hasn't expired, and the hash matches. Otherwise valid:false (and the link is NOT
  // consumed — caller may have typed it wrong).
  async _op_consumeOneTimeLink({ tokenHash, scope }) {
    const c = await this._load()
    const now = Date.now()
    const link = c.one_time_links.find(
      (l) => l.tokenHash === tokenHash && l.scope === scope && !l.used && l.expiresAt > now
    )
    if (!link) return { ok: true, valid: false }
    link.used = true
    // Clean expired/used.
    c.one_time_links = c.one_time_links.filter((l) => !l.used && l.expiresAt > now)
    await this._save(['one_time_links'])
    return { ok: true, valid: true }
  }

  // ---- NCM cookie (encrypted ciphertext stored verbatim) ----
  async _op_setNcmCookie({ cookie }) {
    if (typeof cookie !== 'string') return { ok: false, error: 'cookie must be string' }
    const c = await this._load()
    c.ncm_cookie = cookie
    await this._save(['ncm_cookie'])
    return { ok: true }
  }
  async _op_getNcmCookie() {
    const c = await this._load()
    return { ok: true, cookie: c.ncm_cookie }
  }
  async _op_clearNcmCookie() {
    const c = await this._load()
    c.ncm_cookie = ''
    await this._save(['ncm_cookie'])
    return { ok: true }
  }

  // ---- IP allowlist (UI-editable mirror of ALLOWED_IPS) ----
  async _op_getIpAllowlist() {
    const c = await this._load()
    return { ok: true, ips: c.ip_allowlist }
  }
  async _op_setIpAllowlist({ ips }) {
    if (!Array.isArray(ips)) return { ok: false, error: 'ips must be array' }
    const c = await this._load()
    c.ip_allowlist = ips.map((s) => String(s).trim()).filter(Boolean)
    await this._save(['ip_allowlist'])
    return { ok: true }
  }

  // ---- hard reset (clears ALL state — used when the bootstrap token is rotated) ----
  async _op_hardReset() {
    this._cache = {
      bootstrap_token_hash: null,
      bootstrap_used: false,
      passkeys: [],
      challenges: {},
      one_time_links: [],
      ncm_cookie: this._cache?.ncm_cookie || '', // keep the NCM cookie if set (don't force re-login)
      ip_allowlist: this._cache?.ip_allowlist || [],
    }
    await this._save(['bootstrap_token_hash', 'bootstrap_used', 'passkeys', 'challenges', 'one_time_links'])
    return { ok: true }
  }

  // ---- status (single round-trip overview for /admin) ----
  async _op_status() {
    const c = await this._load()
    return {
      ok: true,
      bootstrap: { hasToken: !!c.bootstrap_token_hash, used: c.bootstrap_used },
      passkeyCount: c.passkeys.length,
      passkeys: c.passkeys.map((p) => ({
        id: p.id, nickname: p.nickname, addedAt: p.addedAt, transports: p.transports || [],
      })),
      hasNcmCookie: !!c.ncm_cookie,
      ipAllowlist: c.ip_allowlist,
      pendingOneTimeLinks: c.one_time_links.filter((l) => !l.used && l.expiresAt > Date.now()).length,
    }
  }
}
