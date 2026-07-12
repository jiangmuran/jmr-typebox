# Invisible (Robust) Watermark — Design

- **Date:** 2026-07-07
- **Status:** Approved (brainstorming) → ready for implementation plan
- **Area:** Image suite (`src/features/image/`)
- **Route:** `/image/invisible`

## 1. Goal

Add a new Image-suite tool that embeds an **invisible, robust** watermark into
image pixels — one that survives ordinary re-compression, resizing, and colour
adjustment, and can be **decoded back** into a **structured information card**:

- a per-image **custom content** string,
- the **timestamp** written at generation time,
- the generating **service** (`box.muran.tech`) and **version**.

It must support **batch** operation in two senses:

1. many images, each watermarked (1 image → 1 output), and
2. **one image → many watermarked versions**, each carrying different content
   (traitor-tracing / per-recipient distribution).

UI/UX must be polished and **mobile-responsive**, reusing the existing tool-kit
design system, SVG-only icons, no emoji.

### Non-goals (this iteration)

- SynthID-grade robustness (crop / rotation / AI-regeneration resistance). That
  requires server-side ML embedding and is explicitly deferred (see §5, §14).
- Removing/attacking third-party watermarks.
- Any change to the existing **visible** watermark tool (`/image/watermark`).

## 2. Background

The current `/image/watermark` (`WatermarkPage.vue`) draws a **visible** overlay
(text or image, opacity/position/rotation/tile) onto a canvas. This new tool is a
**different capability**: the mark is imperceptible and encoded into pixel
frequency data, and there is a **decoder** that reads it back. They share nothing
but the design system and the `useImageSource` / `canvasUtils` helpers.

## 3. Technology comparison (research)

| Technique | Type | Payload | Survives | Browser embed? | Availability |
|---|---|---|---|---|---|
| **DwtDctSvd** (invisible-watermark) | DWT+DCT+SVD | tens–hundreds of bits | JPEG, noise, brightness, colour; **not** crop/rotate | pure-JS portable | Stable Diffusion's default; OSS algorithm |
| jsSteg / DCT-LSB | JPEG coeff. stego | high | almost nothing (recompress destroys) | JS | high capacity, fragile — rejected |
| CryptoStego (DCT) | freq. stego | medium | resize, colour, light compression | JS | ready JS lib |
| RivaGAN | attention GAN | 32 bit | many filters | no (ML runtime) | OSS model |
| **TrustMark** (Adobe CAI) | GAN | **100 bit** | JPEG, resize, light crop | **decode-only in JS/ONNX**; embed = Python | OSS; browser can only *read* |
| StegaStamp / InvisMark | CNN | 100–256 bit | very strong (incl. print-photo) | no (server) | OSS, heavy |
| **Google SynthID** | dual co-trained NN | small provenance code | JPEG, filters, rotation, noise, resize, screenshot, some crop | no (closed) | **not available to embed with**; tied to Google models |

### Two framing insights that shaped the design

1. **Robustness ↔ capacity is a hard trade-off.** Every robust method carries a
   *small* payload (32–256 bits). You cannot robustly embed a long custom string +
   timestamp + URL + version directly. Even the SynthID-Image paper notes *code
   accuracy degrades with larger payload size*.
2. **SynthID is a provenance *detector*, not a data store.** It answers "is this
   AI / which model?" with a tiny code. Our goal is a **data-carrying** watermark.
   The correct pattern for rich structured data is: embed a **compact record/ID**
   robustly, and render the fixed provenance labels (`box.muran.tech`, version) in
   the reader; for arbitrarily long content, resolve an ID against our own service.

### Sources

- SynthID — DeepMind: <https://deepmind.google/blog/identifying-ai-generated-images-with-synthid/>
- SynthID-Image: watermarking at internet scale (arXiv 2510.09263): <https://arxiv.org/html/2510.09263v1>
- invisible-watermark (ShieldMnt): <https://github.com/ShieldMnt/invisible-watermark>
- TrustMark (Adobe): <https://github.com/adobe/trustmark> · <https://opensource.contentauthenticity.org/docs/trustmark/>
- WAVES watermark-robustness benchmark (arXiv 2401.08573): <https://arxiv.org/pdf/2401.08573>
- InvisMark (arXiv 2411.07795): <https://arxiv.org/html/2411.07795v1>

## 4. Key decisions

| # | Decision | Rationale |
|---|---|---|
| D1 | **Client-side, pure-JS codec** (no ML, no upload) | Matches the suite's privacy-first, fully-local ethos; Cloudflare Worker can't run PyTorch; TrustMark JS is decode-only. |
| D2 | **Self-contained offline payload** is primary; **box.muran.tech verify page is optional/opt-in** | Reading works with no network; rich/long content and public verification available when explicitly enabled. |
| D3 | **DCT-QIM** codec for v1 (no SVD) | Simplest robust scheme; JPEG compresses in the DCT domain, so mid-frequency QIM is naturally JPEG-robust. SVD/DWT and Reed–Solomon documented as upgrade paths. |
| D4 | **Custom content cap 16 bytes** offline (~16 ASCII **or ~5 CJK** chars, UTF-8) | Consequence of the capacity↔robustness trade-off at a conservative, image-size-independent payload budget. Longer/Chinese content → use the registered verify page (D2). |
| D5 | **Batch = unified job list**; output **ZIP** (+ single download / Send-to) | One model covers "N images" and "1 image → N versions". |
| D6 | Route `/image/invisible`, new tab in the Image suite | Consistent with existing sub-tools. |

## 5. Architecture

```
/image/invisible  (InvisibleWatermarkPage.vue)
├─ mode: Embed | Decode           (reuse .seg segmented control)
│
├─ Embed
│   ├─ ImageDropZone (multi)  → job list
│   ├─ job table [thumb · source · content(editable) · status]
│   │     • uniform default content + per-row override
│   │     • "duplicate as N versions" on a single image
│   ├─ options: content, (opt) register-verify-page toggle
│   ├─ generate → per-job PNG
│   └─ results: ZIP / per-item download / Send-to
│
└─ Decode
    ├─ ImageDropZone (single)
    └─ structured info card  { content, timestamp, service, version, confidence }

Modules
├─ invisibleWatermark.js   PURE, unit-testable: pack/unpack record, CRC-16,
│                          repetition ECC, 8×8 DCT/iDCT, QIM bit<->coeff,
│                          RGB↔YCbCr, multi-scale decode acceptance.
├─ invisibleWatermarkCanvas.js  thin adapter: Blob→ImageData→(pure)→Blob,
│                          built on existing canvasUtils.
└─ (phase 3) worker/api/watermark.js  register + resolve verify records
```

The **pure module holds all math and carries the tests**; the canvas adapter only
moves bytes between `ImageData` and the pure functions (mirrors the existing split
where `imageHelpers.js` is pure/SSG-safe and pages own the canvas).

## 6. Payload format (self-contained, offline-decodable)

Fixed, image-size-independent record (little-endian bit order defined in code):

```
field         bits   notes
---------------------------------------------------------------
sync header    12    fixed magic; presence + coarse alignment
version         8    format/tool version byte → rendered "box.muran.tech · vX.Y"
flags           4    bit0 = registered (content field carries verify ID)
timestamp      32    unix seconds, UTC (rendered localized by reader)
content len     8    0..CONTENT_MAX bytes
content     ≤128    UTF-8, CONTENT_MAX = 16 bytes (~16 ASCII / ~5 CJK chars)
CRC-16         16    CRC-16-CCITT over version..content
---------------------------------------------------------------
record total  ≤ 208 bits
```

- `box.muran.tech` is a **constant label**, never stored in pixels.
- **Registered mode:** `flags.registered=1`; the `content` field holds a short
  base32 **ID** (≤16 chars) that resolves at `box.muran.tech/w/{id}`; the full,
  arbitrarily-long custom content lives server-side (§11).
- The **record is repeated** across all available blocks; the decoder majority-
  votes per bit index and validates with CRC. CRC pass ⇒ "watermark found";
  CRC fail across all decode attempts ⇒ "none / too degraded".
- **Implementation note (finalized in the plan):** fields are **byte-aligned** for
  clean packing — `sync u16 · version u8 · flags u8 · timestamp u32 · len u8 ·
  content[16] · crc16 u16` = **fixed 27 bytes / 216 bits**. Content is always
  zero-padded to 16 bytes so the repetition period is constant and the decoder
  needs no length prefix to find it.

## 7. Codec — DCT-QIM (v1)

**Embed**
1. Blob → `ImageData` (RGBA) via `canvasUtils.makeCanvas` + `getImageData`.
2. RGB → YCbCr; embed in **Y (luma)** — survives JPEG chroma subsampling (4:2:0)
   and grayscale/colour ops better than chroma. Strength kept low for invisibility.
3. Tile Y into JPEG-aligned **8×8 blocks** (pad/crop working region to ×8).
4. Per block: 2D **DCT**; encode 1 bit via **QIM** on a fixed **mid-frequency**
   coefficient (quantize to even/odd multiple of step Δ). Δ = robustness↔visibility
   knob, tuned against the §15 test suite.
5. iDCT → write Y back → YCbCr→RGB → encode to output (PNG default; JPEG/WebP ok).
6. **Redundancy:** the ≤208-bit record is repeated over all blocks (e.g. a
   1024² image ≈ 16 384 blocks ⇒ ~80× repetition).

**Decode**
1. Blob → `ImageData`.
2. **Multi-scale acceptance:** try extraction at the received size and a small set
   of candidate rescales (e.g. ×0.5, ×1, ×2) to tolerate resizing; accept the first
   scale whose CRC validates.
3. Per block: DCT → read coefficient → QIM → bit.
4. Majority-vote per bit index across all repetitions.
5. Parse record; verify sync + CRC-16. Pass ⇒ decoded; else next scale; all fail ⇒
   "no watermark detected".

**Documented upgrade paths (not v1):** differential/pairwise QIM (brightness-scale
robustness), 1-level Haar DWT before block-DCT, per-block SVD (à la DwtDctSvd),
Reed–Solomon/BCH instead of repetition, image-size-scaled payload budget.

## 8. Batch / multi-version job model

- **Job** = `{ id, sourceImage, content, status }`. Uniform default content at the
  top; each row may override.
- **Add images** (multi drop/pick) → one job per file.
- **Duplicate as N versions** on a single job → N rows sharing the source image,
  each with its own content (per-recipient tracing).
- **Timestamp** is written per job at generation time (single "now" captured when
  the batch runs).
- **Output:** ZIP named by `source + content|index`; also per-item download and
  Send-to for a single result. (ZIP via a small client-side zip helper — store-only
  is sufficient since PNG/JPEG are already compressed.)
- Generation is chunked/async so large batches keep the UI responsive.

## 9. Reader → structured card

Decode renders a card:

- **Custom content** (or, if registered, resolved content + a "查看验证页 / View
  verify page" link to `box.muran.tech/w/{id}`),
- **Timestamp** localized,
- **Service** `box.muran.tech`, **Version** from the version byte,
- **Confidence** derived from per-bit majority-vote agreement.

No watermark / degraded → a clear empty state, not an error.

## 10. Optional: box.muran.tech verify page (Phase 3)

- Embed-side toggle **"register verify page"** (default **off**). On register:
  POST the full record (long content + timestamp + version) to
  `worker/api/watermark.js` → store in KV/D1 keyed by a short base32 ID → that ID
  is what gets embedded (`flags.registered=1`).
- Public route `box.muran.tech/w/{id}` (SPA page + Worker data) renders the same
  structured card plus "marked by box.muran.tech".
- This is the **only** non-local path and is strictly opt-in.

## 11. UI / mobile

- Reuse `ImageShell`, `ImageDropZone`, tool-kit `.card` / `.btn.primary` /
  `.seg` / `.ctrl`, and the `.img-nav` sub-tool bar.
- Desktop: two-column workbench (preview/results left, controls right), matching
  `WatermarkPage`.
- **Mobile:** job table collapses to stacked cards; preview drops `sticky`;
  controls stack; sub-nav scrolls with active tab revealed (existing pattern).
- **SVG-only icons, no emoji** (per project design rules).
- **Live byte-budget meter** on the content field (offline mode): show remaining
  bytes and warn/trim before the 16-byte cap, since CJK eats ~3 bytes/char.

## 12. Integration points (real files)

- **New:** `src/features/image/InvisibleWatermarkPage.vue`,
  `src/features/image/invisibleWatermark.js`,
  `src/features/image/invisibleWatermarkCanvas.js`,
  `src/features/image/__tests__/invisibleWatermark.test.js`.
- **Edit:** `src/features/image/index.js` (component map + `img2.inv.*` /
  `img2.nav.invisible` i18n, en+zh), `src/features/image/ImageToolNav.vue`
  (add `{ id: 'invisible', to: '/image/invisible' }`), `src/router/meta.js`
  (route + SEO meta), `src/router/routes.js` if the `/image/*` mapping needs it.
- **Phase 3:** `worker/api/watermark.js` + a `/w/:id` route + KV/D1 binding.

## 13. Robustness boundaries (honest, ship in the UI copy)

- **Survives:** JPEG re-compression (~q60+), moderate down/up-scaling,
  brightness/contrast/colour shifts, PNG↔JPEG↔WebP conversion.
- **Does not reliably survive:** heavy crop, rotation/skew, AI regeneration/
  inpainting, extreme compression (q<40). Those need the deferred server-ML tier.

## 14. Deferred: server-ML high-robustness tier

The payload format (§6) and reader (§9) are designed so a future server-side
embedder (TrustMark/InvisMark-class) can populate the **same** record and the
same reader can display it (TrustMark JS decode could even run client-side). No
redesign required to add a "high-robustness (server)" option later.

## 15. Testing strategy (TDD)

Pure-module tests in `invisibleWatermark.test.js`:

1. **Round-trip:** encode(record) → decode = record, across sizes & content lengths.
2. **CRC rejects noise:** random/unmarked images decode to "none" (low false-positive).
3. **JPEG survival:** encode → re-encode as JPEG (canvas, descending quality) →
   decode still recovers; assert the quality floor we claim.
4. **Resize survival:** encode → rescale (×0.5/×2) → multi-scale decode recovers.
5. **Colour/brightness survival:** small gain/offset on pixels → still decodes.
6. **Capacity guard:** content > CONTENT_MAX is truncated/rejected deterministically.
7. **Invisibility budget:** PSNR/SSIM between original and marked stays above a
   threshold (mark is imperceptible).

Canvas-adapter and Vue pages covered by lighter jsdom tests where practical
(mirroring existing `__tests__/` patterns). SSG-safety: the pure module imports no
`window`/`document`/canvas.

## 16. Phasing

- **Phase 1 — codec + tests (TDD).** `invisibleWatermark.js`: pack/unpack, CRC-16,
  repetition ECC, DCT/iDCT, QIM, YCbCr, multi-scale decode; the §15 suite green.
- **Phase 2 — UI.** Page with Embed (single + batch + duplicate-as-versions job
  table) and Decode (structured card); canvas adapter; ZIP; wiring
  (index/nav/meta/i18n); mobile-responsive; visible-watermark untouched.
- **Phase 3 — verify page (optional).** Register toggle, `worker/api/watermark.js`,
  KV/D1, public `/w/:id` page.

## 17. Open questions / future

- Exact DCT coefficient index and Δ — fixed empirically in Phase 1 against §15.
- Whether payload budget should scale with image area (bigger image → longer
  content) — deferred; v1 uses a fixed conservative budget for predictability.
- ZIP helper: hand-rolled store-only vs a tiny dependency (`fflate`) — decide in Phase 2.
