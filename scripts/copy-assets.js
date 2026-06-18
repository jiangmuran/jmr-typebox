// Copy self-hosted runtime cores out of node_modules into public/ (no CDN).
// Runs on postinstall and before build. Idempotent; skips anything not installed.
import { mkdirSync, copyFileSync, existsSync } from 'node:fs'

function copyInto(srcDir, destDir, files) {
  if (!existsSync(srcDir)) { console.warn(`[copy-assets] ${srcDir} not found; skipping`); return }
  mkdirSync(destDir, { recursive: true })
  let n = 0
  for (const f of files) {
    if (existsSync(`${srcDir}/${f}`)) { copyFileSync(`${srcDir}/${f}`, `${destDir}/${f}`); n++ }
  }
  console.log(`[copy-assets] ${destDir} ← ${n} file(s)`)
}

// Pyodide core (base Python runs offline; package wheels are fetched on demand by the Python tool)
copyInto('node_modules/pyodide', 'public/pyodide', ['pyodide.mjs', 'pyodide.asm.mjs', 'pyodide.asm.wasm', 'python_stdlib.zip', 'pyodide-lock.json'])
