import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  server: {
    // Dev convenience: forward /api to a local `npm run worker:dev` (wrangler on :8787) so the
    // NCM player / watermark register / AI relay work under `npm run dev` too. Harmless when
    // wrangler isn't running — those calls just fail as before.
    proxy: { '/api': 'http://localhost:8787' },
  },
  optimizeDeps: {
    // @ffmpeg/ffmpeg spawns its class worker via `new Worker(new URL('./worker.js',
    // import.meta.url))`. Dev pre-bundling rewrites the module into .vite/deps/, where that
    // relative worker URL 404s — ffmpeg.load() then hangs forever at "Loading runtime…".
    // Excluding the package serves its real ESM files so the worker URL resolves. Dev-only
    // setting; production bundling emits the worker asset correctly either way.
    exclude: ['@ffmpeg/ffmpeg'],
  },
  build: {
    outDir: 'dist',
    assetsInlineLimit: 8192,
  },
  ssgOptions: {
    script: 'async',
    formatting: 'minify',
    // Dynamic param routes (e.g. /w/:id) can't be prerendered — serve them via the SPA fallback.
    includedRoutes: (paths) => paths.filter(p => !p.includes(':')),
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.js'],
    globals: true,
  },
})
