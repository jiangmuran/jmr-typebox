# Contributing to TypeBox

Thanks for your interest! TypeBox is a Vue 3 + Vite app that prerenders every route (vite-ssg) and ships as a single Cloudflare Worker.

## Dev setup

```bash
npm install        # also copies the self-hosted ffmpeg core into public/ffmpeg/
npm run dev        # http://localhost:5173
npm test           # Vitest
npm run build      # SSG build + sitemap
```

## Adding a tool (drop-in)

Tools live under `src/features/<name>/` and **auto-register** — no edits to routing or i18n needed. Create `src/features/<name>/index.js`:

```js
export default {
  components: { '/your/route': () => import('./YourPage.vue') }, // overrides the stub
  i18n: { en: { 'yourkey': '...' }, zh: { 'yourkey': '...' } },
  register() { /* optional: registerConverter(...) / registerCommand(...) */ },
}
```

The route path + SEO metadata must exist in `src/router/meta.js` (`ROUTE_META`). The glob registry in `src/features/index.js` discovers your folder automatically.

## Conventions

- **SSG-safe:** never touch `window`/`document`/`navigator`/Canvas/`Blob`/`crypto` at module top level or in synchronous `setup()` — only inside `onMounted` or event handlers. Wrap interactive bodies in `<ClientOnly>`; keep the SEO `<h1 class="sr-only">` outside it.
- **No CDN** for libraries — bundle locally or self-host. The only allowed external script is the analytics beacon in `index.html`.
- **Lazy-load** heavy libraries via `src/utils/loadLibrary.js` and self-host their assets.
- **i18n:** every user-facing string goes through `useI18n` (`t(...)`), with zh + en.
- **Test pure logic** with Vitest. Keep browser/wasm glue in thin, separately-imported modules.
- Follow the existing visual style (see `src/pages/ToolboxPage.vue`); use the CSS tokens in `src/styles/global.css`.
- Small, focused commits with conventional-commit messages.

## Backend

Optional `/api/*` handlers live in `worker/`. Any feature that needs them must show the `<BackendInfo>` ⓘ marker and degrade gracefully when the backend is unavailable or disabled.
