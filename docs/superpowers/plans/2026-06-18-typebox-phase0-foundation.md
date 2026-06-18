# TypeBox Phase 0 — Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish the routed, SSG-prerendered, Worker-served app shell plus the shared contracts (settings, backend, command registry, converter registry, lazy-loader, cache) that every later feature phase consumes.

**Architecture:** Migrate the state-tab SPA to `vue-router` + `vite-ssg` (build-time prerender of every known route) with `@unhead/vue` for per-route SEO. A single Cloudflare Worker serves the static `dist/` via the `ASSETS` binding and handles optional `/api/*`. Cross-cutting systems are thin composables/registries with stable interfaces so Phase 1 agents A–H plug in without touching each other.

**Tech Stack:** Vue 3 (`<script setup>`), vue-router, vite-ssg, @unhead/vue, Vite 6, Vitest + @vue/test-utils + jsdom, Cloudflare Workers (wrangler), marked + DOMPurify + highlight.js (existing).

## Global Constraints

- **Spec source of truth:** `docs/superpowers/specs/2026-06-18-typebox-overhaul-design.md`. Every task implicitly inherits it.
- **No CDN for library JS.** All libraries are local npm deps and bundled/lazy-imported. The ONLY allowed external script is the Cloudflare Web Analytics beacon in `index.html`.
- **All implementation subagents MUST use the Opus model.** (`model: "opus"` on every Agent dispatch.)
- **Privacy/offline first.** No feature may break when offline or when the backend is absent; backend features degrade gracefully and are individually + globally disableable.
- **i18n:** every user-facing string goes through the existing `useI18n` (`t(...)`), zh + en.
- **localStorage prefix:** `tb-` (existing `utils/storage.js`).
- **GitHub repo:** `https://github.com/jiangmuran/jmr-typebox` (replace any `jmr/typebox`).
- **TDD:** pure logic (composables, registries, utils) is written test-first with Vitest. UI visual polish is iterated separately with real renders/screenshots (frontend-design) — not faked in this plan.
- **Commit after every task** with a conventional-commit message.

## File Structure (created/modified in Phase 0)

```
package.json                 MODIFY  add deps + scripts
vite.config.js               MODIFY  vite-ssg + vitest config
wrangler.toml                CREATE  single Worker: ASSETS + /api
index.html                   MODIFY  CF analytics beacon, meta base
worker/index.js              CREATE  /api router + assets fallback
worker/api/health.js         CREATE  GET /api/health
public/favicon.svg           MODIFY  B&W adaptive
public/robots.txt            CREATE  sitemap pointer
src/main.js                  MODIFY  ViteSSG entry (router + head)
src/router/routes.js         CREATE  route table (spec §4.1)
src/router/meta.js           CREATE  per-route SEO meta data
src/pages/*.vue              CREATE  one page per route (stub + real SEO head)
src/components/AppShell.vue  CREATE  top bar (7 tabs) + <router-view>
src/components/CommandPalette.vue   CREATE  ⌘K finder
src/components/BackendInfo.vue       CREATE  「i」popover
src/components/SettingsPanel.vue     CREATE  curated settings drawer
src/components/StartPanel.vue        CREATE  home / editor empty-state
src/composables/useSettings.js       CREATE  curated settings + persistence
src/composables/useBackend.js        CREATE  probe/toggle/degrade
src/composables/useCommands.js       CREATE  commandRegistry
src/converters/registry.js           CREATE  converter registry (contract)
src/utils/loadLibrary.js             CREATE  lazy lib loader + size hints
src/utils/assetCache.js              CREATE  Cache API / IndexedDB helpers
src/utils/seo.js                     CREATE  build sitemap from routes
scripts/gen-sitemap.js               CREATE  post-build sitemap writer
vitest.setup.js              CREATE  jsdom localStorage shim if needed
```

---

### Task 1: Dependencies, de-CDN, Vitest harness

**Files:**
- Modify: `package.json`
- Modify: `vite.config.js`
- Create: `vitest.setup.js`
- Test: `src/utils/__tests__/smoke.test.js`

**Interfaces:**
- Produces: working `npm test` (Vitest, jsdom env); local deps `pdfjs-dist`, `html2canvas`, `jspdf`, `vue-router`, `vite-ssg`, `@unhead/vue` installed.

- [ ] **Step 1: Add dependencies**

```bash
npm i vue-router@4 vite-ssg @unhead/vue pdfjs-dist html2canvas jspdf
npm i -D vitest @vue/test-utils jsdom wrangler
```

- [ ] **Step 2: Set scripts in `package.json`**

Replace the `scripts` block with:

```json
"scripts": {
  "dev": "vite",
  "build": "vite-ssg build && node scripts/gen-sitemap.js",
  "preview": "vite preview",
  "test": "vitest run",
  "test:watch": "vitest",
  "worker:dev": "wrangler dev",
  "deploy": "npm run build && wrangler deploy"
}
```

- [ ] **Step 3: Add Vitest config to `vite.config.js`**

```js
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  build: { outDir: 'dist', assetsInlineLimit: 8192 },
  ssgOptions: { script: 'async', formatting: 'minify' },
  test: { environment: 'jsdom', setupFiles: ['./vitest.setup.js'], globals: true },
})
```

- [ ] **Step 4: Create `vitest.setup.js`**

```js
// jsdom provides localStorage in recent versions; guard for older.
if (typeof globalThis.localStorage === 'undefined') {
  const store = new Map()
  globalThis.localStorage = {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k),
    clear: () => store.clear(),
    key: i => [...store.keys()][i] ?? null,
    get length() { return store.size },
  }
}
```

- [ ] **Step 5: Write smoke test `src/utils/__tests__/smoke.test.js`**

```js
import { describe, it, expect } from 'vitest'
import { load, save } from '../storage'

describe('storage', () => {
  it('round-trips a value with the tb- prefix', () => {
    save('phase0', 'ok')
    expect(load('phase0')).toBe('ok')
  })
  it('returns fallback for missing keys', () => {
    expect(load('nope', 'fallback')).toBe('fallback')
  })
})
```

- [ ] **Step 6: Run tests**

Run: `npm test`
Expected: PASS (2 tests).

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json vite.config.js vitest.setup.js src/utils/__tests__/smoke.test.js
git commit -m "chore: add router/ssg/test deps, local pdf/canvas/pdf libs, vitest harness"
```

---

### Task 2: Design tokens, B&W favicon, link fixes, analytics

**Files:**
- Modify: `src/styles/global.css`
- Modify: `public/favicon.svg`
- Create: `public/apple-touch-icon` step (generated)
- Modify: `index.html`
- Modify: `src/App.vue` (link), `src/utils/export.js` (footer link + B&W mark)

**Interfaces:**
- Produces: token CSS variables consumed app-wide; correct repo links; analytics beacon present.

- [ ] **Step 1: Audit existing tokens**

Run: `grep -n "^\s*--" src/styles/global.css | head -60`
Expected: list of current CSS variables. Keep their names; only add/organize.

- [ ] **Step 2: Ensure token groups exist in `src/styles/global.css`**

Add (or confirm) a `:root` block grouping — colors, surfaces, borders, text tiers, accent, shadows, radii, spacing, easing, font stacks. Do not rename variables already used by components. Example additions if missing:

```css
:root {
  --radius-sm: 6px; --radius-md: 10px; --radius-lg: 14px;
  --space-1: 4px; --space-2: 8px; --space-3: 12px; --space-4: 16px;
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
  --font-sans: -apple-system, BlinkMacSystemFont, "PingFang SC", "Segoe UI", Roboto, sans-serif;
  --font-mono: "SF Mono", ui-monospace, "JetBrains Mono", Menlo, Consolas, monospace;
}
```

- [ ] **Step 3: Replace `public/favicon.svg` with B&W adaptive mark**

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <style>
    .bgc { fill: #111; } .fgc { stroke: #fff; }
    @media (prefers-color-scheme: dark) { .bgc { fill: #f5f5f7; } .fgc { stroke: #111; } }
  </style>
  <rect class="bgc" width="100" height="100" rx="22"/>
  <path class="fgc" d="M30 33h40M50 33v38" stroke-width="8" stroke-linecap="round" fill="none"/>
</svg>
```

- [ ] **Step 4: Fix repo links + B&W export mark**

In `src/App.vue` change `https://github.com/jmr/typebox` → `https://github.com/jiangmuran/jmr-typebox`.
In `src/utils/export.js` change the footer `github.com/jmr/typebox` → `github.com/jiangmuran/jmr-typebox` and replace the purple gradient `<svg>` mark with a monochrome one:

```js
footer.innerHTML = `<svg viewBox="0 0 16 16" width="14" height="14"><rect width="16" height="16" rx="4" fill="${textColor}"/><path d="M5 5.5h6M8 5.5v6" stroke="${isDark ? '#1c1c1e' : '#fff'}" stroke-width="1.4" stroke-linecap="round"/></svg><span>Made with TypeBox · github.com/jiangmuran/jmr-typebox</span>`
```

- [ ] **Step 5: Add analytics beacon + base meta to `index.html` `<head>`**

```html
  <meta name="theme-color" content="#111111" media="(prefers-color-scheme: light)">
  <meta name="theme-color" content="#f5f5f7" media="(prefers-color-scheme: dark)">
  <link rel="apple-touch-icon" href="/apple-touch-icon.png">
  <!-- Cloudflare Web Analytics -->
  <script defer src='https://static.cloudflareinsights.com/beacon.min.js' data-cf-beacon='{"token": "212b43858f8a4b9c8cf9f1f6c060f413"}'></script>
  <!-- End Cloudflare Web Analytics -->
```

- [ ] **Step 6: Verify no stale links remain**

Run: `grep -rn "jmr/typebox" src index.html || echo CLEAN`
Expected: `CLEAN`.

- [ ] **Step 7: Commit**

```bash
git add src/styles/global.css public/favicon.svg index.html src/App.vue src/utils/export.js
git commit -m "feat: B&W adaptive favicon, design tokens, fix repo links, add CF analytics"
```

---

### Task 3: Route table + per-route SEO meta data

**Files:**
- Create: `src/router/routes.js`
- Create: `src/router/meta.js`
- Test: `src/router/__tests__/meta.test.js`

**Interfaces:**
- Produces:
  - `routes` (array of `{ path, name, component: () => import(...), meta: { tab } }`) consumed by `main.js` and `vite-ssg`.
  - `ROUTE_META` (object keyed by path → `{ title, description, h1, keywords }`) consumed by pages and sitemap.
  - `ALL_PATHS` (array of every static path) consumed by sitemap + SSG `includedRoutes`.

- [ ] **Step 1: Write the meta test `src/router/__tests__/meta.test.js`**

```js
import { describe, it, expect } from 'vitest'
import { ROUTE_META, ALL_PATHS } from '../meta'

describe('route meta', () => {
  it('every static path has unique non-empty title + description', () => {
    const titles = new Set()
    for (const p of ALL_PATHS) {
      const m = ROUTE_META[p]
      expect(m, `meta for ${p}`).toBeTruthy()
      expect(m.title.length).toBeGreaterThan(5)
      expect(m.description.length).toBeGreaterThan(10)
      expect(titles.has(m.title), `dup title ${m.title}`).toBe(false)
      titles.add(m.title)
    }
  })
  it('includes the core tool paths', () => {
    for (const p of ['/', '/image/compress', '/convert/markdown-to-pdf', '/python', '/tools/base64'])
      expect(ALL_PATHS).toContain(p)
  })
})
```

- [ ] **Step 2: Run test (fails)**

Run: `npm test -- meta`
Expected: FAIL (module not found).

- [ ] **Step 3: Create `src/router/meta.js`**

Provide real SEO copy for each path from spec §4.1. Keys are paths; values `{ title, description, h1, keywords }`. (English titles for SEO; `h1`/UI text localized at render via `t`.) Include all of: `/`, `/txt`, `/image/compress`, `/image/convert`, `/image/watermark`, `/image/edit`, `/convert/markdown-to-pdf`, `/convert/markdown-to-docx`, `/convert/markdown-to-html`, `/convert/pdf-to-markdown`, `/convert/pdf-to-word`, `/media/mp3-to-wav`, `/media/wav-to-mp3`, `/tools/word-count`, `/tools/base64`, `/tools/aes`, `/tools/hash`, `/tools/json`, `/tools/jwt`, `/python`. Example entries:

```js
export const ROUTE_META = {
  '/': { title: 'TypeBox — Markdown Editor & Format Toolkit', description: 'Fast, private, offline Markdown editor with live preview and one-click export to PDF, DOCX, HTML, and PNG. No login.', h1: 'Markdown Editor', keywords: 'markdown editor, online, offline, export pdf' },
  '/image/compress': { title: 'Compress Images Online — TypeBox', description: 'Compress PNG, JPG, and WebP images in your browser. Private, no upload, adjustable quality and size.', h1: 'Compress Images', keywords: 'image compressor, png, jpg, webp' },
  '/convert/markdown-to-pdf': { title: 'Markdown to PDF — TypeBox', description: 'Convert Markdown to a polished PDF with selectable text and themed styling, fully in your browser.', h1: 'Markdown to PDF', keywords: 'markdown to pdf, convert, export' },
  '/python': { title: 'Python Playground — Run Python in the Browser — TypeBox', description: 'Run Python online with Pyodide: plots, packages, and HTML output — no server, fully sandboxed.', h1: 'Python Playground', keywords: 'python online, pyodide, run python browser' },
  // ...one entry per path above (real copy, unique titles)
}
export const ALL_PATHS = Object.keys(ROUTE_META)
```

- [ ] **Step 4: Create `src/router/routes.js`**

```js
import { ALL_PATHS } from './meta'

// Map each path to its page component + owning tab.
const TAB_OF = p =>
  p === '/' ? 'markdown' : p === '/txt' ? 'txt'
  : p.startsWith('/image') ? 'image' : p.startsWith('/convert') ? 'convert'
  : p.startsWith('/media') ? 'media' : p.startsWith('/python') ? 'python' : 'tools'

// Stub page is replaced per-route by feature phases; ToolStub renders SEO head + H1 + mount note.
export const routes = ALL_PATHS.map(path => ({
  path,
  name: path === '/' ? 'home' : path.replace(/^\//, '').replace(/\//g, '-'),
  component: () => import('../pages/ToolStub.vue'),
  meta: { tab: TAB_OF(path), path },
}))
```

- [ ] **Step 5: Run test (passes)**

Run: `npm test -- meta`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/router/routes.js src/router/meta.js src/router/__tests__/meta.test.js
git commit -m "feat: route table + per-route SEO metadata"
```

---

### Task 4: ViteSSG entry + generic page + SEO head

**Files:**
- Modify: `src/main.js`
- Create: `src/pages/ToolStub.vue`
- Create: `src/components/AppShell.vue`
- Modify: `index.html` (ensure `<div id="app">` only)
- Test: build smoke (manual command)

**Interfaces:**
- Consumes: `routes` (Task 3), `ROUTE_META` (Task 3).
- Produces: `createApp = ViteSSG(...)`; `<AppShell>` renders top bar + `<router-view>`; every page sets `<head>` from `ROUTE_META`.

- [ ] **Step 1: Convert `src/main.js` to ViteSSG entry**

```js
import { ViteSSG } from 'vite-ssg'
import { createHead } from '@unhead/vue'
import App from './App.vue'
import { routes } from './router/routes'
import './styles/global.css'

export const createApp = ViteSSG(App, { routes }, ({ app }) => {
  app.use(createHead())
})
```

- [ ] **Step 2: Make `src/App.vue` render the shell**

Replace `App.vue`'s template body with `<AppShell />` (move existing markdown-editor markup into a page in Phase 1; for now App is the shell host). Keep global drag/keyboard wiring that is route-agnostic; route-specific logic moves to pages later. Minimum:

```vue
<script setup>
import AppShell from './components/AppShell.vue'
</script>
<template><AppShell /></template>
```

- [ ] **Step 3: Create `src/components/AppShell.vue`**

Top bar with the 7 tabs (编辑器/TXT/图片/转换/媒体/工具箱/Python) as `<router-link>`s driven by `meta.tab`, plus slots for theme/lang/settings/command-palette triggers, and `<router-view>` below. Tabs use existing topbar styles. Active tab = current route's `meta.tab`. Include a visible ⌘K search affordance (wired in Task 10).

- [ ] **Step 4: Create `src/pages/ToolStub.vue` (data-driven SEO page)**

```vue
<script setup>
import { useRoute } from 'vue-router'
import { useHead } from '@unhead/vue'
import { ROUTE_META } from '../router/meta'
const route = useRoute()
const m = ROUTE_META[route.meta.path] || ROUTE_META['/']
const canonical = `https://typebox.jiangmuran.com${route.meta.path}`
useHead({
  title: m.title,
  meta: [
    { name: 'description', content: m.description },
    { name: 'keywords', content: m.keywords },
    { property: 'og:title', content: m.title },
    { property: 'og:description', content: m.description },
    { property: 'og:type', content: 'website' },
    { property: 'og:url', content: canonical },
    { name: 'twitter:card', content: 'summary_large_image' },
  ],
  link: [{ rel: 'canonical', href: canonical }],
  script: [{ type: 'application/ld+json', children: JSON.stringify({ '@context': 'https://schema.org', '@type': 'WebApplication', name: m.title, applicationCategory: 'Utility', operatingSystem: 'Any', offers: { '@type': 'Offer', price: '0' } }) }],
})
</script>
<template>
  <main class="tool-stub">
    <h1>{{ m.h1 }}</h1>
    <p>{{ m.description }}</p>
    <p class="stub-note">This tool is being built. (Phase 1)</p>
  </main>
</template>
```

> Replace the canonical origin `typebox.jiangmuran.com` with the confirmed production domain before launch (single constant).

- [ ] **Step 5: Build to prove SSG + per-route HTML**

Run: `npm run build`
Expected: build succeeds; `dist/index.html`, `dist/image/compress/index.html`, `dist/python/index.html` exist.

Run: `grep -l "Python Playground" dist/python/index.html`
Expected: match (title prerendered into static HTML).

- [ ] **Step 6: Commit**

```bash
git add src/main.js src/App.vue src/components/AppShell.vue src/pages/ToolStub.vue index.html
git commit -m "feat: vite-ssg entry, app shell with 7 tabs, data-driven SEO pages"
```

---

### Task 5: Sitemap + robots

**Files:**
- Create: `src/utils/seo.js`
- Create: `scripts/gen-sitemap.js`
- Create: `public/robots.txt`
- Test: `src/utils/__tests__/seo.test.js`

**Interfaces:**
- Consumes: `ALL_PATHS` (Task 3).
- Produces: `buildSitemap(origin, paths)` → XML string; post-build writes `dist/sitemap.xml`.

- [ ] **Step 1: Write test `src/utils/__tests__/seo.test.js`**

```js
import { describe, it, expect } from 'vitest'
import { buildSitemap } from '../seo'

describe('buildSitemap', () => {
  it('emits one <url> per path with the origin prefixed', () => {
    const xml = buildSitemap('https://x.com', ['/', '/python'])
    expect(xml).toContain('<loc>https://x.com/</loc>')
    expect(xml).toContain('<loc>https://x.com/python</loc>')
    expect((xml.match(/<url>/g) || []).length).toBe(2)
  })
})
```

- [ ] **Step 2: Run (fails)** — `npm test -- seo` → FAIL.

- [ ] **Step 3: Create `src/utils/seo.js`**

```js
export function buildSitemap(origin, paths) {
  const urls = paths.map(p => `  <url><loc>${origin}${p}</loc></url>`).join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`
}
```

- [ ] **Step 4: Create `scripts/gen-sitemap.js`**

```js
import { writeFileSync } from 'node:fs'
import { ALL_PATHS } from '../src/router/meta.js'
import { buildSitemap } from '../src/utils/seo.js'
const origin = process.env.SITE_ORIGIN || 'https://typebox.jiangmuran.com'
writeFileSync('dist/sitemap.xml', buildSitemap(origin, ALL_PATHS))
console.log(`sitemap.xml: ${ALL_PATHS.length} urls`)
```

- [ ] **Step 5: Create `public/robots.txt`**

```
User-agent: *
Allow: /
Sitemap: https://typebox.jiangmuran.com/sitemap.xml
```

- [ ] **Step 6: Run test + build** — `npm test -- seo` PASS; `npm run build` writes `dist/sitemap.xml`.

- [ ] **Step 7: Commit**

```bash
git add src/utils/seo.js scripts/gen-sitemap.js public/robots.txt src/utils/__tests__/seo.test.js
git commit -m "feat: sitemap.xml generation + robots.txt"
```

---

### Task 6: `useSettings` composable + Settings panel

**Files:**
- Create: `src/composables/useSettings.js`
- Create: `src/components/SettingsPanel.vue`
- Test: `src/composables/__tests__/useSettings.test.js`

**Interfaces:**
- Produces: `useSettings()` → reactive `settings` + `setSetting(key, value)` + `resetSettings()` + `clearAllData()`. Keys: `theme` ('light'|'dark'|'system'), `accent` (string), `editorFont`, `editorFontSize` (number), `editorLineHeight` (number), `density` ('comfortable'|'compact'), `tabsVisible` (string[]), `tabsOrder` (string[]), `defaultTool` (path), `restoreLast` (bool), `writingTheme` (string), `exportTheme` (string), `backendEnabled` (bool), `locale` ('zh'|'en'). All persisted under `tb-settings` (single JSON).

- [ ] **Step 1: Write test `src/composables/__tests__/useSettings.test.js`**

```js
import { beforeEach, describe, it, expect } from 'vitest'
import { useSettings, DEFAULT_SETTINGS } from '../useSettings'

beforeEach(() => localStorage.clear())

describe('useSettings', () => {
  it('exposes defaults when storage is empty', () => {
    const { settings } = useSettings()
    expect(settings.theme).toBe(DEFAULT_SETTINGS.theme)
    expect(settings.backendEnabled).toBe(true)
  })
  it('persists a changed setting and rehydrates it', () => {
    const a = useSettings(); a.setSetting('density', 'compact')
    expect(JSON.parse(localStorage.getItem('tb-settings')).density).toBe('compact')
  })
  it('clearAllData removes tb- keys and restores defaults', () => {
    const s = useSettings(); s.setSetting('accent', '#f00')
    localStorage.setItem('tb-doc', 'x')
    s.clearAllData()
    expect(localStorage.getItem('tb-doc')).toBe(null)
    expect(s.settings.accent).toBe(DEFAULT_SETTINGS.accent)
  })
})
```

- [ ] **Step 2: Run (fails)** — `npm test -- useSettings` → FAIL.

- [ ] **Step 3: Implement `src/composables/useSettings.js`**

Module-singleton `reactive` state, hydrated from `tb-settings`, persisted on change via a `watch`. Provide `DEFAULT_SETTINGS`, `setSetting`, `resetSettings`, `clearAllData` (removes every `localStorage` key starting with `tb-`, then re-applies defaults). Apply `theme`/`accent`/font/density to `document.documentElement` via a small `applyTheme()` effect (guard `typeof document !== 'undefined'` for SSG).

- [ ] **Step 4: Run (passes)** — `npm test -- useSettings` → PASS.

- [ ] **Step 5: Build `src/components/SettingsPanel.vue`**

A drawer (right-side) rendering grouped controls bound to `useSettings`: appearance (theme/accent/density), editor (font/size/line-height), writing theme + export theme (selects, options filled by Phase 1 B; tolerate empty list), tools (visible tabs checkboxes + drag order), behavior (default tool, restore-last), backend master toggle (with `<BackendInfo>`), language, and a danger "clear all data" calling `clearAllData()` with confirm. Open/close via prop/emit; trigger lives in AppShell.

- [ ] **Step 6: Commit**

```bash
git add src/composables/useSettings.js src/components/SettingsPanel.vue src/composables/__tests__/useSettings.test.js
git commit -m "feat: useSettings composable + settings drawer"
```

---

### Task 7: `useBackend` + `BackendInfo`

**Files:**
- Create: `src/composables/useBackend.js`
- Create: `src/components/BackendInfo.vue`
- Test: `src/composables/__tests__/useBackend.test.js`

**Interfaces:**
- Consumes: `useSettings().settings.backendEnabled`.
- Produces: `useBackend()` → `{ available (ref bool), probe(), apiBase }`. `available` is `backendEnabled && lastProbeOk`. `probe()` fetches `${apiBase}/api/health`, sets `lastProbeOk`, caches for the session. `BackendInfo` is an inline `<i>` button → popover with localized text + repo link `https://github.com/jiangmuran/jmr-typebox/tree/main/worker`.

- [ ] **Step 1: Write test `src/composables/__tests__/useBackend.test.js`**

```js
import { beforeEach, describe, it, expect, vi } from 'vitest'
import { useSettings } from '../useSettings'
import { useBackend } from '../useBackend'

beforeEach(() => localStorage.clear())

describe('useBackend', () => {
  it('is unavailable when the master toggle is off, without probing', async () => {
    useSettings().setSetting('backendEnabled', false)
    const b = useBackend(); const fetchSpy = vi.fn()
    globalThis.fetch = fetchSpy
    await b.probe()
    expect(b.available.value).toBe(false)
    expect(fetchSpy).not.toHaveBeenCalled()
  })
  it('becomes available after a healthy probe when enabled', async () => {
    useSettings().setSetting('backendEnabled', true)
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) })
    const b = useBackend(); await b.probe()
    expect(b.available.value).toBe(true)
  })
  it('stays unavailable if the probe throws (offline)', async () => {
    useSettings().setSetting('backendEnabled', true)
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('offline'))
    const b = useBackend(); await b.probe()
    expect(b.available.value).toBe(false)
  })
})
```

- [ ] **Step 2: Run (fails)** — `npm test -- useBackend` → FAIL.

- [ ] **Step 3: Implement `src/composables/useBackend.js`**

```js
import { ref, computed } from 'vue'
import { useSettings } from './useSettings'

const lastProbeOk = ref(false)
let probed = false
const apiBase = '' // same-origin Worker

export function useBackend() {
  const { settings } = useSettings()
  const available = computed(() => settings.backendEnabled && lastProbeOk.value)
  async function probe(force = false) {
    if (!settings.backendEnabled) { lastProbeOk.value = false; return }
    if (probed && !force) return
    probed = true
    try {
      const r = await fetch(`${apiBase}/api/health`, { method: 'GET' })
      lastProbeOk.value = r.ok
    } catch { lastProbeOk.value = false }
  }
  return { available, probe, apiBase }
}
```

- [ ] **Step 4: Run (passes)** — `npm test -- useBackend` → PASS.

- [ ] **Step 5: Build `src/components/BackendInfo.vue`**

Small circular `i` button; on click shows a popover: localized "This feature needs the optional backend. It's open source and can be turned off in Settings." + link to `/tree/main/worker`. Props: none needed beyond slot text override. Uses `t()`.

- [ ] **Step 6: Commit**

```bash
git add src/composables/useBackend.js src/components/BackendInfo.vue src/composables/__tests__/useBackend.test.js
git commit -m "feat: useBackend probe/toggle/degrade + BackendInfo popover"
```

---

### Task 8: Cloudflare Worker skeleton (assets + /api/health)

**Files:**
- Create: `wrangler.toml`
- Create: `worker/index.js`
- Create: `worker/api/health.js`
- Test: `worker/__tests__/router.test.js`

**Interfaces:**
- Produces: Worker that routes `/api/*` to handlers and otherwise serves `env.ASSETS`. `/api/health` → `{ ok: true, features: ['fetch','preview'] }`.

- [ ] **Step 1: Write test `worker/__tests__/router.test.js`**

```js
import { describe, it, expect } from 'vitest'
import worker from '../index.js'

const env = { ASSETS: { fetch: async () => new Response('static', { status: 200 }) } }

describe('worker router', () => {
  it('answers /api/health as JSON', async () => {
    const res = await worker.fetch(new Request('https://x/api/health'), env)
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
  })
  it('delegates non-api paths to ASSETS', async () => {
    const res = await worker.fetch(new Request('https://x/python'), env)
    expect(await res.text()).toBe('static')
  })
})
```

- [ ] **Step 2: Run (fails)** — `npm test -- router` → FAIL.

- [ ] **Step 3: Create `worker/api/health.js`**

```js
export function health() {
  return Response.json({ ok: true, features: ['fetch', 'preview'] }, {
    headers: { 'cache-control': 'no-store', 'access-control-allow-origin': '*' },
  })
}
```

- [ ] **Step 4: Create `worker/index.js`**

```js
import { health } from './api/health.js'

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    if (url.pathname === '/api/health') return health()
    // Future: /api/fetch, /api/preview (Phase 1 E)
    if (url.pathname.startsWith('/api/')) return new Response('Not found', { status: 404 })
    return env.ASSETS.fetch(request)
  },
}
```

- [ ] **Step 5: Create `wrangler.toml`**

```toml
name = "typebox"
main = "worker/index.js"
compatibility_date = "2025-01-01"

[assets]
directory = "./dist"
binding = "ASSETS"
not_found_handling = "single-page-application"
```

- [ ] **Step 6: Run test (passes)** — `npm test -- router` → PASS.

- [ ] **Step 7: Verify local serve**

Run: `npm run build && npm run worker:dev` (Ctrl-C after confirming start). Expected: wrangler serves; `curl -s localhost:8787/api/health` → `{"ok":true,...}`.

- [ ] **Step 8: Commit**

```bash
git add wrangler.toml worker/
git commit -m "feat: single CF Worker serving assets + /api/health"
```

---

### Task 9: Lazy-library loader + persistent cache helpers

**Files:**
- Create: `src/utils/loadLibrary.js`
- Create: `src/utils/assetCache.js`
- Test: `src/utils/__tests__/loadLibrary.test.js`

**Interfaces:**
- Produces:
  - `loadLibrary(key, importer, { sizeMB })` → caches the resolved module by `key`, dedupes concurrent calls, emits `onLibLoadStart/End` events for UI hints. Returns the module.
  - `libLoadState` (reactive map key→'idle'|'loading'|'ready'|'error') for spinners/size hints.
  - `assetCache.get(url)/put(url, response)` over Cache API with IndexedDB fallback (for Pyodide/ffmpeg wheels).

- [ ] **Step 1: Write test `src/utils/__tests__/loadLibrary.test.js`**

```js
import { describe, it, expect, vi } from 'vitest'
import { loadLibrary, libLoadState } from '../loadLibrary'

describe('loadLibrary', () => {
  it('imports once and caches, deduping concurrent calls', async () => {
    const importer = vi.fn().mockResolvedValue({ hello: () => 'hi' })
    const [a, b] = await Promise.all([
      loadLibrary('demo', importer, { sizeMB: 1 }),
      loadLibrary('demo', importer, { sizeMB: 1 }),
    ])
    expect(importer).toHaveBeenCalledTimes(1)
    expect(a).toBe(b)
    expect(libLoadState.demo).toBe('ready')
  })
  it('marks error state on failure', async () => {
    await expect(loadLibrary('bad', () => Promise.reject(new Error('x')), {})).rejects.toThrow()
    expect(libLoadState.bad).toBe('error')
  })
})
```

- [ ] **Step 2: Run (fails)** — `npm test -- loadLibrary` → FAIL.

- [ ] **Step 3: Implement `src/utils/loadLibrary.js`**

`reactive` `libLoadState`; module-level `cache` Map of key→Promise. On first call set 'loading', await importer, set 'ready', cache the resolved module; on error set 'error' and delete the cache entry so retry is possible. Concurrent calls return the same in-flight promise.

- [ ] **Step 4: Implement `src/utils/assetCache.js`**

`get(url)`/`put(url, response)` using `caches.open('tb-assets')` when available, else IndexedDB; all wrapped in try/catch returning `null`/no-op when storage APIs are unavailable (SSG/Node). No test required beyond not throwing when `caches` is undefined — add a guard test:

```js
// in loadLibrary.test.js or a new assetCache.test.js
import { assetCache } from '../assetCache'
it('assetCache.get returns null when Cache API is absent', async () => {
  expect(await assetCache.get('x')).toBe(null)
})
```

- [ ] **Step 5: Run (passes)** — `npm test -- loadLibrary assetCache` → PASS.

- [ ] **Step 6: Commit**

```bash
git add src/utils/loadLibrary.js src/utils/assetCache.js src/utils/__tests__/loadLibrary.test.js
git commit -m "feat: lazy library loader + persistent asset cache helpers"
```

---

### Task 10: Command registry + Command Palette (⌘K)

**Files:**
- Create: `src/composables/useCommands.js`
- Create: `src/components/CommandPalette.vue`
- Modify: `src/components/AppShell.vue` (mount palette + ⌘K)
- Test: `src/composables/__tests__/useCommands.test.js`

**Interfaces:**
- Produces:
  - `registerCommand(cmd)` / `registerCommands(arr)` where `cmd = { id, title, aliases?: string[], group, icon?, run: () => void | Promise, needsBackend?: bool, keywords?: string }`.
  - `searchCommands(query)` → filtered, ranked array (fuzzy/substring over title+aliases+keywords).
  - `allCommands` reactive list. Routes from Task 3 auto-register as navigation commands at app init.

- [ ] **Step 1: Write test `src/composables/__tests__/useCommands.test.js`**

```js
import { beforeEach, describe, it, expect } from 'vitest'
import { registerCommand, searchCommands, allCommands, _resetCommands } from '../useCommands'

beforeEach(() => _resetCommands())

describe('useCommands', () => {
  it('registers and finds by title and alias', () => {
    registerCommand({ id: 'b64', title: 'Base64 Encode', aliases: ['encode'], group: 'Tools', run() {} })
    expect(searchCommands('base64').map(c => c.id)).toContain('b64')
    expect(searchCommands('encode').map(c => c.id)).toContain('b64')
  })
  it('dedupes by id and returns empty for no match', () => {
    registerCommand({ id: 'x', title: 'X', group: 'g', run() {} })
    registerCommand({ id: 'x', title: 'X2', group: 'g', run() {} })
    expect(allCommands.filter(c => c.id === 'x').length).toBe(1)
    expect(searchCommands('zzzz')).toEqual([])
  })
})
```

- [ ] **Step 2: Run (fails)** — `npm test -- useCommands` → FAIL.

- [ ] **Step 3: Implement `src/composables/useCommands.js`**

Module-level `reactive` array `allCommands`; `registerCommand` upserts by `id`; `searchCommands` lowercases query and ranks: exact title prefix > title substring > alias/keyword substring; returns sorted. Export `_resetCommands` for tests.

- [ ] **Step 4: Run (passes)** — `npm test -- useCommands` → PASS.

- [ ] **Step 5: Build `src/components/CommandPalette.vue`**

Modal overlay; input box; arrow-key navigation; Enter runs `cmd.run()`; groups by `cmd.group`; shows `BackendInfo` marker when `needsBackend`. Opens on `Cmd/Ctrl+K` (global keydown) and from the AppShell search affordance; Esc closes. On mount, register navigation commands for every route (`title = ROUTE_META[path].h1`, `run = () => router.push(path)`).

- [ ] **Step 6: Wire into `AppShell.vue`** — mount `<CommandPalette>`, add the global key listener, connect the visible search button.

- [ ] **Step 7: Commit**

```bash
git add src/composables/useCommands.js src/components/CommandPalette.vue src/components/AppShell.vue src/composables/__tests__/useCommands.test.js
git commit -m "feat: command registry + ⌘K command palette with route nav"
```

---

### Task 11: StartPanel (home / editor empty-state) + onboarding

**Files:**
- Create: `src/components/StartPanel.vue`
- Modify: `src/components/WelcomeDialog.vue` (rework to expanded onboarding)
- Modify: `src/components/AppShell.vue` (Home trigger via logo / ⌘K command)
- Test: render test `src/components/__tests__/StartPanel.test.js`

**Interfaces:**
- Consumes: `allCommands`/route nav (Task 10), `useSettings` recents (optional).
- Produces: `<StartPanel>` rendering a feature-card grid from the route/command list + quick actions (New / Open / smart paste) + recents + ⌘K tip. A `Home` command registered (`router.push('/')` + clears editor) and logo click opens it.

- [ ] **Step 1: Write render test `src/components/__tests__/StartPanel.test.js`**

```js
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import StartPanel from '../StartPanel.vue'

describe('StartPanel', () => {
  it('renders a feature card per top-level tool group', () => {
    const wrapper = mount(StartPanel, { global: { stubs: { 'router-link': true } } })
    const cards = wrapper.findAll('[data-card]')
    expect(cards.length).toBeGreaterThanOrEqual(6) // editor/image/convert/media/tools/python
  })
})
```

- [ ] **Step 2: Run (fails)** — `npm test -- StartPanel` → FAIL.

- [ ] **Step 3: Build `src/components/StartPanel.vue`**

Card grid (one per tab group, `data-card` attr, icon + localized title + one-liner + deep link), quick-action row, recents (from `tb-recents` if present, tolerate empty), and a `⌘K` hint. Tasteful, restrained styling using tokens. No flashy effects.

- [ ] **Step 4: Run (passes)** — `npm test -- StartPanel` → PASS.

- [ ] **Step 5: Rework onboarding** — turn `WelcomeDialog.vue` into a short, skippable, re-openable intro (what it is / workflows / how to start + teach ⌘K), shown on first visit (`tb-onboarded` flag), then dismiss to StartPanel/editor.

- [ ] **Step 6: Commit**

```bash
git add src/components/StartPanel.vue src/components/WelcomeDialog.vue src/components/AppShell.vue src/components/__tests__/StartPanel.test.js
git commit -m "feat: enticing StartPanel home + expanded onboarding"
```

---

### Task 12: Converter registry contract (consumed by Phase 1)

**Files:**
- Create: `src/converters/registry.js`
- Test: `src/converters/__tests__/registry.test.js`

**Interfaces:**
- Produces:
  - `registerConverter(c)` where `c = { id, route, inputs: string[], output: string, where: 'client'|'backend'|'auto', needsBackend: bool, lazyLoad?: () => Promise, run: (input, opts) => Promise<Blob|string> }`.
  - `getConverter(id)`, `convertersFor(inputType)`, `allConverters`. Phase 1 B/A/C register their converters here; each also registers a command (Task 10) so it appears in ⌘K.

- [ ] **Step 1: Write test `src/converters/__tests__/registry.test.js`**

```js
import { beforeEach, describe, it, expect } from 'vitest'
import { registerConverter, getConverter, convertersFor, _resetConverters } from '../registry'

beforeEach(() => _resetConverters())

describe('converter registry', () => {
  it('registers and looks up by id and input type', async () => {
    registerConverter({ id: 'md-html', route: '/convert/markdown-to-html', inputs: ['md'], output: 'html', where: 'client', needsBackend: false, run: async s => `<p>${s}</p>` })
    expect(getConverter('md-html').output).toBe('html')
    expect(convertersFor('md').map(c => c.id)).toContain('md-html')
    expect(await getConverter('md-html').run('hi')).toBe('<p>hi</p>')
  })
})
```

- [ ] **Step 2: Run (fails)** — `npm test -- registry` → FAIL.

- [ ] **Step 3: Implement `src/converters/registry.js`**

Module-level array; `registerConverter` upserts by id; `getConverter(id)`; `convertersFor(type)` filters by `inputs.includes(type)`; `allConverters` getter; `_resetConverters` for tests.

- [ ] **Step 4: Run (passes)** — `npm test -- registry` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/converters/registry.js src/converters/__tests__/registry.test.js
git commit -m "feat: converter registry contract for Phase 1"
```

---

### Task 13: Full build + test gate

**Files:** none (verification task)

- [ ] **Step 1: Run full test suite** — `npm test` → all PASS.
- [ ] **Step 2: Full production build** — `npm run build` → succeeds; `dist/` has per-route HTML + `sitemap.xml` + `robots.txt`.
- [ ] **Step 3: Worker serve smoke** — `npm run build && npm run worker:dev`; `curl localhost:8787/api/health` ok; `curl localhost:8787/python` returns prerendered HTML containing "Python Playground". Stop server.
- [ ] **Step 4: Commit any fixups** — `git commit -am "test: Phase 0 build + serve gate"` (if needed).

---

## Self-Review

**1. Spec coverage (Phase 0 scope):**
- Routing + SSG + per-route SEO → Tasks 3,4,5 ✓
- B&W favicon, links, analytics, tokens → Task 2 ✓
- Single Worker (assets + /api) → Task 8 ✓
- useSettings + curated customization + clear-data → Task 6 ✓
- useBackend + 「i」+ master toggle + degrade → Task 7 ✓ (consumes Task 6)
- Command palette + registry (discoverability core) → Task 10 ✓
- StartPanel + onboarding → Task 11 ✓
- Lazy-load + persistent cache infra + de-CDN deps → Tasks 1,9 ✓
- Converter registry contract → Task 12 ✓
- Vitest harness → Task 1 ✓
- (Deferred to Phase 1, intentionally: actual tool UIs, themes, ffmpeg, pyodide, plugins, /api/fetch+preview.)

**2. Placeholder scan:** `ToolStub.vue` and empty theme/option lists are real, intentional integration points filled by Phase 1, not vague TODOs. Canonical origin is a single named constant flagged for confirmation. No "add error handling"-style hand-waving.

**3. Type/name consistency:** `useSettings` keys referenced by `useBackend` (`backendEnabled`), SettingsPanel, StartPanel match. `loadLibrary(key, importer, opts)`, `registerCommand({id,title,...})`, `registerConverter({id,route,...})` signatures are used consistently across tasks and match the spec's registry shapes (§8, §5.1).

**Gaps fixed inline:** added Task 13 build/serve gate so the foundation is proven end-to-end before Phase 1 fan-out.
