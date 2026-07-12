# Invisible Watermark — box.muran.tech Verify Page (Phase 3) — Design

- **Date:** 2026-07-11
- **Status:** Approved (brainstorming) → ready for implementation plan
- **Depends on:** Phase 1/2 (`docs/superpowers/specs/2026-07-07-invisible-watermark-design.md`) — the shipped `/image/invisible` tool + codec.
- **Area:** Worker (`worker/`) + Image suite (`src/features/image/`) + router.

## 1. Goal

Add the **optional, opt-in** server-backed half of the invisible-watermark tool: a
user can **register** a watermark record so its (now arbitrarily long) content lives
on `box.muran.tech`, the image carries only a compact **id**, and anyone can look up
the record at a public, shareable **`/w/:id`** verify page.

This lifts the offline 16-byte content cap for registered images and gives a canonical,
linkable provenance record — while the fully-offline path (Phase 2) stays the default.

### Non-goals
- Storing the **image** server-side (only the small text record is stored — privacy).
- User accounts / per-user ownership of records (there is no multi-user tier).
- Editing or deleting records via UI (records are write-once; retention is permanent).
- Server-rendered verify HTML with OG tags (client-side SPA page only this phase).
- The deferred server-side **ML** high-robustness tier (unrelated; still out of scope).

## 2. Key decisions (from brainstorming)

| # | Decision | Rationale |
|---|---|---|
| D1 | **Registration is public + rate-limited** (no auth) | The tool is public; there is no "logged-in user" tier (auth = the owner only). DO-based rate limiting is the established abuse control. |
| D2 | **Storage = a new Cloudflare KV namespace** | Public write / read-by-id / read-heavy / tiny records — KV's edge-cached eventual-consistent reads are the right primitive. A singleton DO would bottleneck public reads; the project has no KV/D1 yet, but this is exactly KV's use case. |
| D3 | **Verify page = client-side SPA route `/w/:id`** | Simplest, consistent with the SPA; reuses the decode card. SPA fallback already serves it. (Server-rendered OG-tag HTML is a possible later enhancement.) |
| D4 | Registered image embeds **only the id**; full content lives in KV | Consequence of the capacity↔robustness limit; matches "self-contained primary + optional verify page" (Phase 2 chose this). |

## 3. End-to-end flow

```
Embed (register ON):
  client POST /api/watermark { records:[{content, timestamp, version}] }
    → server stores each in KV under a fresh id → returns { ids:[…] }
  client embeds a record with flags.registered=1, content=id  → PNG

Decode (of a registered image):
  codec extracts flags.registered=1, content=id
    → client GET /api/watermark/:id
       → hit: show full content + timestamp + version + link box.muran.tech/w/{id}
       → miss: show id + "marked as registered, record not found"

Verify page (shareable):
  /w/:id  → client GET /api/watermark/:id → render structured card
```

The Phase 1 codec already supports this: `flags` bit0 = registered, and the 16-byte
`content` field holds the id. **No codec change needed.**

## 4. Data model

- **id:** server-generated **10-char Crockford base32** (alphabet `0-9A-Z` minus
  `I L O U`; URL-safe, unambiguous; ~50 bits). On register, generate, `KV.get` to
  reject the rare collision, retry. 10 ASCII bytes ≤ the 16-byte content field.
- **KV value** (`id → JSON`):
  ```json
  { "v": 1, "content": "<user text, unbounded up to cap>", "timestamp": 1700000000, "version": 1, "createdAt": 1752000000 }
  ```
  `timestamp` = the watermark's embed time (client-provided); `createdAt` = server
  receive time; `content` may now be long (including full CJK paragraphs).
- **No image, no IP, no PII** stored in the record.

## 5. Worker — `worker/api/watermark.js`

Two handlers, wired into `worker/index.js` dispatch (following the existing `/api/*`
pattern: `RATE_CFG` entry, CORS/JSON helpers, `checkLimit`):

- **`POST /api/watermark`** (register):
  - Body `{ records: [{ content, timestamp, version }, …] }`, **1..50** records.
  - Validate each: `content` is a string, **≤ 2 KB** (UTF-8); `timestamp`/`version`
    are sane integers. Reject the whole call on any invalid record (400).
  - Generate an id per record, `KV.put(id, JSON, …)`, return `{ ids: [...] }` (same order).
  - **Public, no auth.** Rate-limited **20 req/min/IP** (reuse `checkLimit` + a new
    `RATE_CFG['/api/watermark']`). The ≤50-records cap bounds a single call.
- **`GET /api/watermark/:id`** (resolve):
  - `KV.get(id)` → the JSON (200, cacheable headers to ride KV's edge cache) or 404.
  - Public read, **not** in `RATE_CFG` (KV reads are cheap and edge-cached); a rate
    limit can be added later if scraping appears. Register (POST, the write path) is
    the only rate-limited half.

**Retention:** permanent (a watermark must verify long-term); abuse is bounded by the
rate limit + the 2 KB content cap, not by expiry.

**Binding:** add `[[kv_namespaces]]` (`binding = "WATERMARKS"`) to `wrangler.toml`.
The handler degrades gracefully if the binding is absent (like other optional `/api/*`):
register → 503, resolve → 404, and the client falls back to offline behavior.

## 6. Client — Embed (register)

In `InvisibleWatermarkPage.vue` embed mode:
- A **"注册验证页 / Register verify page"** toggle, **default OFF**, available to everyone.
- When **ON**: the offline 16-byte content cap is **lifted** (content may be long; the
  byte meter is hidden), and a clear notice renders beside it: **"注册后内容将公开可查 /
  Registered content becomes publicly viewable."**
- On generate with register ON: collect each job's `{content, timestamp, version}`,
  POST once as a batch, receive `ids`, then embed each image with `flags.registered=1`
  and `content=id`. On POST failure: toast an error and **do not** silently fall back to
  writing raw content as a registered id (fail the batch clearly).
- With register OFF: unchanged Phase 2 behavior (16-byte offline payload).

## 7. Client — Decode (resolve)

When decode yields `flags.registered`:
- `GET /api/watermark/:id`; on hit render the full content + timestamp + version +
  "已在 box.muran.tech 注册" + a link to `/w/{id}`.
- On miss/offline: show the id and "标记为已注册,但未找到记录 / marked registered, record
  not found", plus whatever offline fields decoded.
- Non-registered images: the existing offline card, unchanged.

## 8. Verify page — `/w/:id`

- New component `src/features/image/VerifyPage.vue`.
- Route **appended** to `src/router/routes.js` (NOT via `ROUTE_META`), e.g.
  `{ path: '/w/:id', name: 'verify', component: () => import('../features/image/VerifyPage.vue'), meta: { tab: 'tools', path: '/w' } }`.
  Because it is not in `ROUTE_META`/`ALL_PATHS`, it is **not** prerendered by vite-ssg,
  not in the sitemap, and not indexed — served via the SPA fallback and matched client-side.
  (Confirm vite-ssg skips the param route during build; add an `includedRoutes` filter if needed.)
- Fetches `/api/watermark/:id`, renders the structured card (reuse the decode-card
  styling); loading, found, and 404 states.

## 9. Security / privacy

- **Public content:** the register UI states plainly that content becomes public.
- **XSS:** the verify page and decode card render user content via Vue **text
  interpolation only** (`{{ }}`, auto-escaped). **Never `v-html`.** No content is
  interpreted as markup anywhere.
- **No image / IP / PII** in the stored record.
- **Abuse:** DO rate limit (20/min/IP) + 2 KB content cap + ≤50 records/call. No open
  redirect (the id only maps to a JSON record).

## 10. Testing

- **Worker** (`worker/__tests__/watermark/…`, following the existing `worker/__tests__/`
  harness with a mock KV exposing `get`/`put`): register validation (missing/oversized
  content → 400, >50 records → 400), id generation + collision retry, `KV.put` shape,
  resolve hit + 404, rate-limit path, and graceful 503/404 when the binding is absent.
- **Client:** id/resolve handling and the register batch-shape as pure logic; the
  register toggle relaxing the cap. Canvas parts verified via the app.
- **E2E (real browser):** register ON → embed id → decode resolves the full content →
  `/w/{id}` shows the record; plus a 404 id.

## 11. Files

- **New:** `worker/api/watermark.js`, `worker/__tests__/watermark/…`,
  `src/features/image/VerifyPage.vue`.
- **Modify:** `wrangler.toml` (`[[kv_namespaces]]`), `worker/index.js` (dispatch +
  `RATE_CFG`), `src/router/routes.js` (append `/w/:id`),
  `src/features/image/InvisibleWatermarkPage.vue` (register toggle + wiring + decode
  resolve), `src/features/image/index.js` (i18n `img2.inv.*` register/verify keys, en+zh).

## 12. Phasing

- **P3a — Worker + KV + endpoints + tests.** `watermark.js`, wrangler binding,
  dispatch wiring, the §10 worker suite green.
- **P3b — Client register + resolve.** Embed toggle (cap-lift + privacy notice + batch
  POST + embed id) and decode resolve.
- **P3c — `/w/:id` verify page.** Route + `VerifyPage.vue` + states.

## 13. Defaults (tunable knobs, recorded so they're explicit)

id = 10-char Crockford base32 · content cap = 2 KB/record · rate limit = 20/min/IP ·
≤ 50 records/register call · retention = permanent · registration = no auth (rate-limited).
