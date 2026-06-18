// Copy the self-hosted single-thread ffmpeg.wasm core out of node_modules so it's served
// locally (no CDN). Runs on postinstall and before build. Idempotent; skips if dep absent.
import { mkdirSync, copyFileSync, existsSync } from 'node:fs'

const src = 'node_modules/@ffmpeg/core/dist/umd'
const dest = 'public/ffmpeg'

if (!existsSync(`${src}/ffmpeg-core.wasm`)) {
  console.warn('[copy-ffmpeg] @ffmpeg/core not installed; skipping')
  process.exit(0)
}
mkdirSync(dest, { recursive: true })
for (const f of ['ffmpeg-core.js', 'ffmpeg-core.wasm']) copyFileSync(`${src}/${f}`, `${dest}/${f}`)
console.log('[copy-ffmpeg] copied ffmpeg core → public/ffmpeg/')
