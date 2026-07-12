# Invisible Watermark — Verify Page (Phase 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the opt-in server-backed half of the invisible-watermark tool: register a watermark record (unbounded content) on `box.muran.tech`, embed only a short id in the image, and resolve it at a public `/w/:id` verify page.

**Architecture:** A new public, rate-limited Worker endpoint (`worker/api/watermark.js`) stores `id → {content,timestamp,version}` in a Cloudflare **KV** namespace and resolves by id. The client registers records, embeds the returned id (with the codec's `flags.registered` bit), resolves on decode, and a client-side `/w/:id` SPA route renders the record. The Phase-1 codec is unchanged.

**Tech Stack:** Cloudflare Worker (`worker/index.js` dispatch + KV binding), Vitest (node env for worker, jsdom for client), Vue 3 SPA route, existing `invisibleWatermarkCanvas` adapter.

## Global Constraints

- **Registration is public, no auth, rate-limited 20 req/min/IP** (via `RATE_CFG['/api/watermark']`). Resolve (GET) is not rate-limited (KV edge-cached).
- **KV binding name: `WATERMARKS`.** Handler degrades gracefully when absent: register → 503, resolve → 404.
- **id = 10-char Crockford base32**, alphabet `0123456789ABCDEFGHJKMNPQRSTVWXYZ` (no I/L/O/U).
- **content cap = 2048 bytes UTF-8 per record; ≤ 50 records per register call.** Retention permanent.
- **KV record shape:** `{ v:1, content, timestamp, version, createdAt }`.
- **Codec unchanged:** registered image = `flags` bit0 set (`flags: 1`) + `content` = id. `embedImageBlob(blob, {content, timestamp, flags, version})` already accepts `flags`.
- **Security:** verify page + decode card render content via Vue text interpolation only — **never `v-html`**. No image/IP/PII stored.
- **i18n:** every user string via `t()`, `img2.*` namespace, en+zh parity (enforced by `src/features/image/__tests__/module.test.js`). SVG-only icons, no emoji.
- **Commits:** conventional, `feat(image):` / `feat(worker):`. Test command: `npx vitest run <path>`.

---

## File Structure

- `worker/api/watermark.js` — **new**: pure helpers (`makeId`, `validateRegisterBody`) + `watermark(request, env)` handler (register POST + resolve GET).
- `worker/__tests__/watermark.test.js` — **new**: node-env tests with a Map-backed KV mock.
- `worker/index.js` — **modify**: `RATE_CFG` entry + dispatch.
- `wrangler.toml` — **modify**: `[[kv_namespaces]]` binding.
- `src/features/image/watermarkApi.js` — **new**: `registerRecords`, `resolveWatermark` (client fetch).
- `src/features/image/__tests__/watermarkApi.test.js` — **new**: fetch-mock tests.
- `src/features/image/InvisibleWatermarkPage.vue` — **modify**: embed register toggle + wiring; decode resolve.
- `src/features/image/VerifyPage.vue` — **new**: `/w/:id` page.
- `src/router/routes.js` — **modify**: append `/w/:id` route.
- `vite.config.js` — **modify**: `ssgOptions.includedRoutes` to skip param routes.
- `src/features/image/index.js` — **modify**: `img2.inv.*` + `img2.verify.*` i18n (en+zh).

---

## Task 1: Worker — id + validation helpers

**Files:**
- Create: `worker/api/watermark.js`
- Test: `worker/__tests__/watermark.test.js`

**Interfaces:**
- Produces: `makeId(): string` (10 Crockford-base32 chars), `CONTENT_MAX_BYTES` (2048), `MAX_RECORDS` (50), `validateRegisterBody(body): { ok:true, records:[{content,timestamp,version}] } | { ok:false, error }`.

- [ ] **Step 1: Write the failing test**

```js
// worker/__tests__/watermark.test.js
// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { makeId, validateRegisterBody, CONTENT_MAX_BYTES, MAX_RECORDS } from '../api/watermark.js'

const CROCKFORD = /^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{10}$/

describe('makeId', () => {
  it('returns 10 Crockford base32 chars', () => {
    for (let i = 0; i < 50; i++) expect(makeId()).toMatch(CROCKFORD)
  })
  it('is not constant', () => {
    expect(makeId()).not.toBe(makeId())
  })
})

describe('validateRegisterBody', () => {
  it('accepts a valid batch and coerces missing ts/version', () => {
    const v = validateRegisterBody({ records: [{ content: 'hi' }, { content: '你好', timestamp: 5, version: 2 }] })
    expect(v.ok).toBe(true)
    expect(v.records).toEqual([{ content: 'hi', timestamp: 0, version: 1 }, { content: '你好', timestamp: 5, version: 2 }])
  })
  it('rejects a non-array', () => {
    expect(validateRegisterBody({ records: 'x' }).ok).toBe(false)
    expect(validateRegisterBody(null).ok).toBe(false)
  })
  it('rejects empty and oversized batches', () => {
    expect(validateRegisterBody({ records: [] }).ok).toBe(false)
    const many = Array.from({ length: MAX_RECORDS + 1 }, () => ({ content: 'x' }))
    expect(validateRegisterBody({ records: many }).ok).toBe(false)
  })
  it('rejects non-string content and content over the byte cap', () => {
    expect(validateRegisterBody({ records: [{ content: 42 }] }).ok).toBe(false)
    const big = 'a'.repeat(CONTENT_MAX_BYTES + 1)
    expect(validateRegisterBody({ records: [{ content: big }] }).ok).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run worker/__tests__/watermark.test.js`
Expected: FAIL — module not found / exports undefined.

- [ ] **Step 3: Write minimal implementation**

```js
// worker/api/watermark.js
// POST /api/watermark  — register 1..50 records, returns { ids }. Public, rate-limited in index.js.
// GET  /api/watermark/:id — resolve a record by id. Public, KV-edge-cached.
// Records live in the KV namespace bound as env.WATERMARKS; no image/IP is ever stored.

const ID_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ' // Crockford base32 (no I L O U)
const ID_LEN = 10
export const CONTENT_MAX_BYTES = 2048
export const MAX_RECORDS = 50

// 10 random Crockford chars. 256 % 32 === 0, so byte % 32 is unbiased.
export function makeId() {
  const bytes = new Uint8Array(ID_LEN)
  crypto.getRandomValues(bytes)
  let s = ''
  for (let i = 0; i < ID_LEN; i++) s += ID_ALPHABET[bytes[i] % 32]
  return s
}

export function validateRegisterBody(body) {
  if (!body || !Array.isArray(body.records)) return { ok: false, error: 'records must be an array' }
  const recs = body.records
  if (recs.length < 1 || recs.length > MAX_RECORDS) return { ok: false, error: `records length must be 1..${MAX_RECORDS}` }
  const enc = new TextEncoder()
  const out = []
  for (const r of recs) {
    if (!r || typeof r.content !== 'string') return { ok: false, error: 'content must be a string' }
    if (enc.encode(r.content).length > CONTENT_MAX_BYTES) return { ok: false, error: 'content exceeds 2KB' }
    out.push({
      content: r.content,
      timestamp: Number.isInteger(r.timestamp) ? r.timestamp : 0,
      version: Number.isInteger(r.version) ? r.version : 1,
    })
  }
  return { ok: true, records: out }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run worker/__tests__/watermark.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add worker/api/watermark.js worker/__tests__/watermark.test.js
git commit -m "feat(worker): watermark id generation + register validation"
```

---

## Task 2: Worker — register + resolve handler

**Files:**
- Modify: `worker/api/watermark.js`
- Test: `worker/__tests__/watermark.test.js`

**Interfaces:**
- Consumes: `makeId`, `validateRegisterBody`.
- Produces: `watermark(request, env): Promise<Response>` — routes `POST /api/watermark` → register, `GET /api/watermark/:id` → resolve, `OPTIONS` → 204. Uses `env.WATERMARKS` (KV: `.get(id)→string|null`, `.put(id,string)`).

- [ ] **Step 1: Write the failing test**

```js
// append to worker/__tests__/watermark.test.js
import { watermark } from '../api/watermark.js'

function kvMock() {
  const m = new Map()
  return { _m: m, get: async k => (m.has(k) ? m.get(k) : null), put: async (k, v) => { m.set(k, v) } }
}
function req(path, { method = 'GET', body } = {}) {
  return new Request('https://x' + path, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

describe('watermark handler', () => {
  it('answers OPTIONS preflight', async () => {
    const res = await watermark(req('/api/watermark', { method: 'OPTIONS' }), { WATERMARKS: kvMock() })
    expect(res.status).toBe(204)
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
  })
  it('registers records and stores them under returned ids', async () => {
    const env = { WATERMARKS: kvMock() }
    const res = await watermark(req('/api/watermark', { method: 'POST', body: { records: [{ content: 'a', timestamp: 7, version: 1 }, { content: 'b' }] } }), env)
    expect(res.status).toBe(200)
    const { ids } = await res.json()
    expect(ids).toHaveLength(2)
    const stored = JSON.parse(env.WATERMARKS._m.get(ids[0]))
    expect(stored).toMatchObject({ v: 1, content: 'a', timestamp: 7, version: 1 })
    expect(typeof stored.createdAt).toBe('number')
  })
  it('400s an oversized batch and non-JSON', async () => {
    const env = { WATERMARKS: kvMock() }
    const many = Array.from({ length: 51 }, () => ({ content: 'x' }))
    expect((await watermark(req('/api/watermark', { method: 'POST', body: { records: many } }), env)).status).toBe(400)
    const bad = new Request('https://x/api/watermark', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' })
    expect((await watermark(bad, env)).status).toBe(400)
  })
  it('503s register when the binding is absent', async () => {
    expect((await watermark(req('/api/watermark', { method: 'POST', body: { records: [{ content: 'a' }] } }), {})).status).toBe(503)
  })
  it('resolves an existing id and 404s a missing one', async () => {
    const env = { WATERMARKS: kvMock() }
    const { ids } = await (await watermark(req('/api/watermark', { method: 'POST', body: { records: [{ content: 'hello' }] } }), env)).json()
    const hit = await watermark(req('/api/watermark/' + ids[0]), env)
    expect(hit.status).toBe(200)
    expect((await hit.json()).content).toBe('hello')
    expect((await watermark(req('/api/watermark/NOPE0NOPE0'), env)).status).toBe(404)
  })
  it('404s resolve when the binding is absent', async () => {
    expect((await watermark(req('/api/watermark/anything00'), {})).status).toBe(404)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run worker/__tests__/watermark.test.js`
Expected: FAIL — `watermark` is not exported.

- [ ] **Step 3: Write minimal implementation**

```js
// append to worker/api/watermark.js
const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
}
function json(obj, status = 200) {
  return Response.json(obj, { status, headers: { ...cors, 'cache-control': status === 200 ? 'public, max-age=60' : 'no-store' } })
}

async function register(request, env) {
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)
  if (!env || !env.WATERMARKS) return json({ error: 'unavailable' }, 503)
  let body
  try { body = await request.json() } catch { return json({ error: 'invalid_json' }, 400) }
  const v = validateRegisterBody(body)
  if (!v.ok) return json({ error: v.error }, 400)
  const now = Date.now()
  const ids = []
  for (const rec of v.records) {
    let id = makeId()
    for (let t = 0; t < 3 && (await env.WATERMARKS.get(id)) !== null; t++) id = makeId()
    await env.WATERMARKS.put(id, JSON.stringify({ v: 1, content: rec.content, timestamp: rec.timestamp, version: rec.version, createdAt: now }))
    ids.push(id)
  }
  return json({ ids })
}

async function resolve(id, env) {
  if (!env || !env.WATERMARKS) return json({ error: 'not_found' }, 404)
  const raw = await env.WATERMARKS.get(id)
  if (raw === null) return json({ error: 'not_found' }, 404)
  let rec
  try { rec = JSON.parse(raw) } catch { return json({ error: 'not_found' }, 404) }
  return json(rec)
}

export async function watermark(request, env) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
  const url = new URL(request.url)
  const rest = url.pathname.slice('/api/watermark'.length) // '' | '/' | '/<id>'
  if (rest === '' || rest === '/') return register(request, env)
  if (request.method !== 'GET') return json({ error: 'method_not_allowed' }, 405)
  return resolve(decodeURIComponent(rest.slice(1)), env)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run worker/__tests__/watermark.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add worker/api/watermark.js worker/__tests__/watermark.test.js
git commit -m "feat(worker): watermark register + resolve handler (KV-backed)"
```

---

## Task 3: Worker — wire dispatch + KV binding

**Files:**
- Modify: `worker/index.js`
- Modify: `wrangler.toml`
- Test: `worker/__tests__/watermark.test.js`

**Interfaces:**
- Consumes: `watermark(request, env)`.
- Produces: `POST /api/watermark` and `GET /api/watermark/:id` reachable via `worker.fetch`, register rate-limited under the `watermark` bucket.

- [ ] **Step 1: Write the failing integration test**

```js
// append to worker/__tests__/watermark.test.js
import worker from '../index.js'

describe('watermark via worker.fetch', () => {
  const env = { WATERMARKS: kvMock(), ASSETS: { fetch: async () => new Response('static') } }
  it('registers then resolves end-to-end through the router', async () => {
    const reg = await worker.fetch(req('/api/watermark', { method: 'POST', body: { records: [{ content: 'roundtrip', timestamp: 9, version: 1 }] } }), env)
    expect(reg.status).toBe(200)
    const { ids } = await reg.json()
    const got = await worker.fetch(req('/api/watermark/' + ids[0]), env)
    expect(got.status).toBe(200)
    expect((await got.json())).toMatchObject({ content: 'roundtrip', timestamp: 9 })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run worker/__tests__/watermark.test.js`
Expected: FAIL — `worker.fetch` returns 404 for `/api/watermark` (not yet dispatched).

- [ ] **Step 3: Wire `worker/index.js`**

Add the import near the other `./api/*` imports (after `import { stats } from './api/stats.js'`):

```js
import { watermark } from './api/watermark.js'
```

Add to the `RATE_CFG` object:

```js
  '/api/watermark': { name: 'watermark', limit: 20 },
```

Add the dispatch alongside the other flat `/api/*` routes (after the `if (url.pathname === '/api/asr') …` line):

```js
    if (url.pathname === '/api/watermark' || url.pathname.startsWith('/api/watermark/')) return watermark(request, env)
```

(The early `RATE_CFG[url.pathname]` block already rate-limits the exact `POST /api/watermark`; the `/api/watermark/<id>` resolve path does not match the exact key, so it stays unlimited — as intended.)

- [ ] **Step 4: Add the KV binding to `wrangler.toml`**

Append:

```toml
# Invisible-watermark verify records (id -> {content,timestamp,version,createdAt}).
# Create the namespace and paste its printed id here:
#   npx wrangler kv namespace create WATERMARKS
# Local `wrangler dev` and unit tests do not need the id (Miniflare / a mock provide the binding);
# it is only required for production deploy.
[[kv_namespaces]]
binding = "WATERMARKS"
id = "REPLACE_WITH_ID_FROM_wrangler_kv_namespace_create"
```

- [ ] **Step 5: Run test + full worker suite**

Run: `npx vitest run worker/__tests__/watermark.test.js`
Expected: PASS.
Run: `npx vitest run worker/__tests__/router.test.js`
Expected: PASS (no regression in routing).

- [ ] **Step 6: Commit**

```bash
git add worker/index.js wrangler.toml worker/api/watermark.js worker/__tests__/watermark.test.js
git commit -m "feat(worker): dispatch /api/watermark + WATERMARKS KV binding"
```

---

## Task 4: Client — watermark API module

**Files:**
- Create: `src/features/image/watermarkApi.js`
- Test: `src/features/image/__tests__/watermarkApi.test.js`

**Interfaces:**
- Produces: `registerRecords(records: Array<{content,timestamp,version}>): Promise<string[]>` (POSTs `/api/watermark`, returns ids, throws on failure/length-mismatch); `resolveWatermark(id: string): Promise<object|null>` (GET `/api/watermark/:id`, record or `null` on 404, throws on other errors).

- [ ] **Step 1: Write the failing test**

```js
// src/features/image/__tests__/watermarkApi.test.js
import { describe, it, expect, vi, afterEach } from 'vitest'
import { registerRecords, resolveWatermark } from '../watermarkApi'

afterEach(() => { vi.restoreAllMocks() })

describe('registerRecords', () => {
  it('POSTs the records and returns ids', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ids: ['ABC0000001'] }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const ids = await registerRecords([{ content: 'x', timestamp: 1, version: 1 }])
    expect(ids).toEqual(['ABC0000001'])
    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/watermark')
    expect(opts.method).toBe('POST')
    expect(JSON.parse(opts.body)).toEqual({ records: [{ content: 'x', timestamp: 1, version: 1 }] })
  })
  it('throws when the server errors or the id count mismatches', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 503 })))
    await expect(registerRecords([{ content: 'x' }])).rejects.toThrow()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ids: [] }), { status: 200 })))
    await expect(registerRecords([{ content: 'x' }])).rejects.toThrow()
  })
})

describe('resolveWatermark', () => {
  it('returns the record on 200', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ content: 'hi', version: 1 }), { status: 200 })))
    expect(await resolveWatermark('ABC0000001')).toEqual({ content: 'hi', version: 1 })
  })
  it('returns null on 404 and throws on 500', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })))
    expect(await resolveWatermark('missing0000')).toBeNull()
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 500 })))
    await expect(resolveWatermark('x')).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/image/__tests__/watermarkApi.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```js
// src/features/image/watermarkApi.js
// Same-origin client for the optional /api/watermark backend (Phase 3). Callers must handle
// rejection (backend disabled / offline) and fall back to the offline watermark behavior.

export async function registerRecords(records) {
  const res = await fetch('/api/watermark', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ records }),
  })
  if (!res.ok) throw new Error('register failed: ' + res.status)
  const data = await res.json()
  if (!Array.isArray(data.ids) || data.ids.length !== records.length) throw new Error('register: unexpected response')
  return data.ids
}

export async function resolveWatermark(id) {
  const res = await fetch('/api/watermark/' + encodeURIComponent(id))
  if (res.status === 404) return null
  if (!res.ok) throw new Error('resolve failed: ' + res.status)
  return res.json()
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/image/__tests__/watermarkApi.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/image/watermarkApi.js src/features/image/__tests__/watermarkApi.test.js
git commit -m "feat(image): client watermark register/resolve API"
```

---

## Task 5: Client — embed register toggle + wiring

**Files:**
- Modify: `src/features/image/InvisibleWatermarkPage.vue`
- Modify: `src/features/image/index.js` (i18n)

**Interfaces:**
- Consumes: `registerRecords` (Task 4), `FORMAT_VERSION`/`contentByteLength` (`invisibleWatermark`), `embedImageBlob` (adapter, accepts `{content, timestamp, flags, version}`).
- Produces: an embed-mode "Register verify page" toggle that, when on, lifts the 16-byte cap (client cap 2048 bytes), batch-registers, and embeds `flags:1` + `content=id`.

**Verification:** end-to-end via the app (Task E) + `npm run build`; jsdom has no canvas.

- [ ] **Step 1: Add i18n keys (en + zh) in `index.js`**

Add to `i18n.en` (in the `img2.inv.*` block):

```js
      'img2.inv.register': 'Register verify page',
      'img2.inv.registerHint': 'Registered content becomes publicly viewable at box.muran.tech and can be any length.',
      'img2.inv.registering': 'Registering…',
      'img2.inv.registerFailed': 'Registration failed — the backend may be unavailable.',
```

Add the parity block to `i18n.zh`:

```js
      'img2.inv.register': '注册验证页',
      'img2.inv.registerHint': '注册后内容将在 box.muran.tech 公开可查，且长度不限。',
      'img2.inv.registering': '注册中…',
      'img2.inv.registerFailed': '注册失败 —— 后端可能不可用。',
```

- [ ] **Step 2: Add state + wiring in `<script setup>`**

Add import:

```js
import { registerRecords } from './watermarkApi'
import { FORMAT_VERSION } from './invisibleWatermark'
```

Add state (near the embed state):

```js
const registerOn = ref(false)
const CONTENT_MAX_BYTES = 2048
```

Replace the body of `generate()` so that, when `registerOn` is true, it registers first and embeds ids. Full replacement:

```js
async function generate() {
  if (!jobs.value.length) return
  generating.value = true
  const stamp = Math.floor(Date.now() / 1000)
  try {
    let ids = null
    if (registerOn.value) {
      const records = jobs.value.map(j => ({ content: (j.content || uniform.value), timestamp: stamp, version: FORMAT_VERSION }))
      const over = records.find(r => contentByteLength(r.content) > CONTENT_MAX_BYTES)
      if (over) { showToast(t('img2.inv.registerFailed')); generating.value = false; return }
      try { ids = await registerRecords(records) }
      catch { showToast(t('img2.inv.registerFailed')); generating.value = false; return }
    }
    for (let i = 0; i < jobs.value.length; i++) {
      const job = jobs.value[i]
      job.status = 'working'
      try {
        if (job.url) URL.revokeObjectURL(job.url)
        if (registerOn.value) {
          job.blob = await embedImageBlob(job.source, { content: ids[i], timestamp: stamp, flags: 1 })
        } else {
          job.blob = await embedImageBlob(job.source, { content: fitContent(job.content || uniform.value, CONTENT_MAX), timestamp: stamp })
        }
        job.url = URL.createObjectURL(job.blob)
        job.status = 'done'
      } catch (err) {
        job.status = 'error'
        showToast(/too small/i.test(err?.message) ? t('img2.inv.tooSmall') : t('img2.unsupported'))
      }
    }
    lastSingleBlob.value = jobs.value.length === 1 && jobs.value[0].blob ? jobs.value[0].blob : null
  } finally { generating.value = false }
}
```

- [ ] **Step 3: Add the toggle + notice to the embed template**

Inside the uniform-content card (after the content input's `.hint`), add:

```vue
          <label class="check reg-toggle">
            <input type="checkbox" v-model="registerOn" />
            <span>{{ t('img2.inv.register') }}</span>
          </label>
          <p v-if="registerOn" class="hint reg-note">{{ t('img2.inv.registerHint') }}</p>
```

When `registerOn` is true the 16-byte meter is not a hard limit; keep showing the uniform input but the byte meter (`bytesLeft`) is only meaningful offline — hide it when registered:

```vue
<!-- change the ctrl-label line to: -->
            <div class="ctrl-label"><span>{{ t('img2.inv.uniform') }}</span><span v-if="!registerOn" class="val">{{ t('img2.inv.bytesLeft').replace('{n}', bytesLeft) }}</span></div>
```

And do not clamp the uniform input when registered — change `onUniformInput`:

```js
function onUniformInput() { if (!registerOn.value) uniform.value = fitContent(uniform.value, CONTENT_MAX) }
```

- [ ] **Step 4: Verify build + module test**

Run: `npx vitest run src/features/image/__tests__/module.test.js`
Expected: PASS (en/zh parity holds with the 4 new keys).
Run: `npm run build`
Expected: completes, emits `dist/image/invisible.html`.

- [ ] **Step 5: Commit**

```bash
git add src/features/image/InvisibleWatermarkPage.vue src/features/image/index.js
git commit -m "feat(image): register-verify-page toggle in embed mode"
```

---

## Task 6: Client — decode resolve

**Files:**
- Modify: `src/features/image/InvisibleWatermarkPage.vue`
- Modify: `src/features/image/index.js` (i18n)

**Interfaces:**
- Consumes: `resolveWatermark` (Task 4). Decode result already includes `flags` and `content` (Phase 1 `decodeMultiScale`).
- Produces: when a decoded record has `flags & 1`, resolve the id and show full content + a `/w/:id` link, or a not-found note.

**Verification:** app (Task E) + build.

- [ ] **Step 1: Add i18n keys (en + zh) in `index.js`**

`i18n.en`:

```js
      'img2.inv.registered': 'Registered at box.muran.tech',
      'img2.inv.viewVerify': 'Open verify page',
      'img2.inv.regNotFound': 'Marked as registered, but no record was found.',
```

`i18n.zh`:

```js
      'img2.inv.registered': '已在 box.muran.tech 注册',
      'img2.inv.viewVerify': '打开验证页',
      'img2.inv.regNotFound': '标记为已注册，但未找到记录。',
```

- [ ] **Step 2: Resolve on decode in `<script setup>`**

Add import + state:

```js
import { resolveWatermark } from './watermarkApi'
const resolved = ref(null)     // { content, timestamp, version } from the server, when registered
const verifyId = ref('')
```

In `readBlob`, after `result.value = await decodeImageBlob(blob)`, add resolution:

```js
    resolved.value = null; verifyId.value = ''
    if (result.value?.ok && (result.value.flags & 1)) {
      verifyId.value = result.value.content
      try { resolved.value = await resolveWatermark(verifyId.value) } catch { resolved.value = null }
    }
```

- [ ] **Step 3: Show resolved content in the decode card template**

In the `result.ok` card, replace the single content row with a registered-aware block:

```vue
        <div class="info-row">
          <span class="k">{{ t('img2.inv.fldContent') }}</span>
          <span class="v mono">{{ (result.flags & 1) ? (resolved ? resolved.content : ('#' + verifyId)) : (result.content || '—') }}</span>
        </div>
        <div v-if="result.flags & 1" class="info-row">
          <span class="k">{{ t('img2.inv.fldService') }}</span>
          <span class="v">
            <template v-if="resolved">
              {{ t('img2.inv.registered') }} · <router-link :to="'/w/' + verifyId">{{ t('img2.inv.viewVerify') }}</router-link>
            </template>
            <template v-else>{{ t('img2.inv.regNotFound') }}</template>
          </span>
        </div>
```

(Leave the existing service/version/confidence rows for non-registered images unchanged — guard the plain service row with `v-if="!(result.flags & 1)"`.)

- [ ] **Step 4: Verify build + module test**

Run: `npx vitest run src/features/image/__tests__/module.test.js`
Expected: PASS.
Run: `npm run build`
Expected: completes cleanly.

- [ ] **Step 5: Commit**

```bash
git add src/features/image/InvisibleWatermarkPage.vue src/features/image/index.js
git commit -m "feat(image): resolve registered watermarks on decode"
```

---

## Task 7: Verify page `/w/:id`

**Files:**
- Create: `src/features/image/VerifyPage.vue`
- Modify: `src/router/routes.js`
- Modify: `vite.config.js`
- Modify: `src/features/image/index.js` (i18n)

**Interfaces:**
- Consumes: `resolveWatermark` (Task 4), `useRoute` (`vue-router`).
- Produces: a client-side `/w/:id` page that renders a record or a not-found state.

**Verification:** app (Task E) + build (param route must not break SSG).

- [ ] **Step 1: Add i18n keys (en + zh) in `index.js`**

`i18n.en`:

```js
      'img2.verify.title': 'Watermark record',
      'img2.verify.loading': 'Looking up…',
      'img2.verify.notFound': 'No record found for this id.',
      'img2.verify.service': 'Marked by box.muran.tech',
```

`i18n.zh`:

```js
      'img2.verify.title': '水印记录',
      'img2.verify.loading': '查询中…',
      'img2.verify.notFound': '未找到该 id 对应的记录。',
      'img2.verify.service': '由 box.muran.tech 标记',
```

- [ ] **Step 2: Filter param routes out of SSG prerender in `vite.config.js`**

Change the `ssgOptions` block to:

```js
  ssgOptions: {
    script: 'async',
    formatting: 'minify',
    // Dynamic param routes (e.g. /w/:id) can't be prerendered — serve them via the SPA fallback.
    includedRoutes: (paths) => paths.filter(p => !p.includes(':')),
  },
```

- [ ] **Step 3: Append the route in `src/router/routes.js`**

Change the `export const routes = ALL_PATHS.map(...)` to append the verify route:

```js
export const routes = [
  ...ALL_PATHS.map(path => ({
    path,
    name: path === '/' ? 'home' : path.replace(/^\//, '').replace(/\//g, '-'),
    component: componentFor(path),
    meta: { tab: tabOf(path), path },
  })),
  {
    path: '/w/:id',
    name: 'verify',
    component: () => import('../features/image/VerifyPage.vue'),
    meta: { tab: 'tools', path: '/w' },
  },
]
```

- [ ] **Step 4: Create `VerifyPage.vue`**

```vue
<!-- src/features/image/VerifyPage.vue -->
<script setup>
import { ref, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from '../../composables/useI18n'
import { resolveWatermark } from './watermarkApi'
import { SERVICE } from './invisibleWatermark'

const route = useRoute()
const { t, locale } = useI18n()
const state = ref('loading')   // 'loading' | 'found' | 'missing'
const record = ref(null)

function fmtTime(sec) { try { return new Date(sec * 1000).toLocaleString(locale.value) } catch { return String(sec) } }

onMounted(async () => {
  try {
    const r = await resolveWatermark(String(route.params.id))
    if (r) { record.value = r; state.value = 'found' } else { state.value = 'missing' }
  } catch { state.value = 'missing' }
})
</script>

<template>
  <div class="verify-wrap">
    <h1>{{ t('img2.verify.title') }}</h1>
    <p v-if="state === 'loading'" class="ctrl">{{ t('img2.verify.loading') }}</p>
    <div v-else-if="state === 'found'" class="card info-card">
      <div class="info-row"><span class="k">{{ t('img2.inv.fldContent') }}</span><span class="v mono">{{ record.content || '—' }}</span></div>
      <div class="info-row"><span class="k">{{ t('img2.inv.fldTime') }}</span><span class="v">{{ fmtTime(record.timestamp) }}</span></div>
      <div class="info-row"><span class="k">{{ t('img2.inv.fldService') }}</span><span class="v mono">{{ SERVICE }}</span></div>
      <div class="info-row"><span class="k">{{ t('img2.inv.fldVersion') }}</span><span class="v">v{{ record.version }}</span></div>
      <p class="hint">{{ t('img2.verify.service') }}</p>
    </div>
    <div v-else class="card empty">{{ t('img2.verify.notFound') }}</div>
  </div>
</template>

<style scoped>
.verify-wrap { max-width: 560px; margin: 0 auto; padding: 24px 16px; }
.info-card { display: flex; flex-direction: column; gap: 8px; }
.info-row { display: flex; justify-content: space-between; gap: 16px; }
.info-row .k { color: var(--text-tertiary); }
.info-row .v.mono { font-family: var(--font-mono); }
.empty { color: var(--text-tertiary); text-align: center; padding: 24px; }
@media (max-width: 768px) { .info-row { flex-direction: column; gap: 2px; } }
</style>
```

- [ ] **Step 5: Verify build + module test**

Run: `npx vitest run src/features/image/__tests__/module.test.js`
Expected: PASS (en/zh parity holds).
Run: `npm run build`
Expected: completes; does NOT error on `/w/:id` (filtered from prerender); `dist/` has no `w/` prerender.

- [ ] **Step 6: Commit**

```bash
git add src/features/image/VerifyPage.vue src/router/routes.js vite.config.js src/features/image/index.js
git commit -m "feat(image): public /w/:id watermark verify page"
```

---

## Task E: End-to-end verification (controller)

Not a code task — the controller runs this after Task 7 (real browser, like Phase 2). Drive the live dev server:

1. `/image/invisible` Embed → enter long content (e.g. a full CJK sentence > 16 bytes), turn ON "Register verify page", Generate, Download.
2. Switch to Read, drop the PNG → card shows the FULL content + "Open verify page" link.
3. Open `/w/{id}` → record renders (content, timestamp, box.muran.tech, version).
4. Visit `/w/NONEXISTENT0` → "No record found" state.
5. Register OFF path still works (offline 16-byte content).

Requires `WATERMARKS` locally: `npx wrangler dev` (Miniflare provides a local KV), or point the dev server's `/api` at a `wrangler dev` instance. If the backend is not running, verify the graceful fallback (register toast error; decode shows the id).

---

## Self-Review (completed while writing)

**Spec coverage:**
- §5 Worker endpoints (register/resolve, caps, rate-limit, no-binding degrade) → Tasks 1–3. ✅
- §4 data model (id, KV record shape) → Tasks 1–2. ✅
- §6 embed register (toggle, cap-lift, batch POST, embed id, privacy notice) → Task 5. ✅
- §7 decode resolve → Task 6. ✅
- §8 `/w/:id` page + routing (append route, SSG param skip) → Task 7. ✅
- §9 security (text-interpolation only, no v-html; no image/IP stored) → Tasks 6/7 use `{{ }}`; Task 2 stores only the text record. ✅
- §10 testing (worker mock-KV suite, client fetch-mock, E2E) → Tasks 1–4 + Task E. ✅
- §2/§13 decisions & knobs (public+ratelimited, KV, SPA, 10-char id, 2KB, 20/min, ≤50, permanent) → Global Constraints + Tasks 1–3. ✅

**Placeholder scan:** No vague placeholders. The one non-code literal — the KV `id` in `wrangler.toml` — is a genuine external value created by `wrangler kv namespace create` (exact command given); local dev/tests do not need it.

**Type consistency:** `makeId`/`validateRegisterBody`/`watermark` (worker) and `registerRecords`/`resolveWatermark` (client) are named identically across producer/consumer tasks. `embedImageBlob({content,timestamp,flags,version})` matches the Phase-2 adapter signature. Decode result exposes `flags`/`content` (Phase-1 `decodeMultiScale`). i18n keys added in Tasks 5–7 are all `img2.*` with en+zh parity.
