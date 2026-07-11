import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
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
