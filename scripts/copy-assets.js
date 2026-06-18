// Copy self-hosted runtime cores out of node_modules into public/ (no CDN).
// Runs on postinstall and before build. Idempotent; skips anything not installed.
import { mkdirSync, copyFileSync, existsSync } from 'node:fs'

// eslint-disable-next-line no-unused-vars
function copyInto(srcDir, destDir, files) {
  if (!existsSync(srcDir)) { console.warn(`[copy-assets] ${srcDir} not found; skipping`); return }
  mkdirSync(destDir, { recursive: true })
  let n = 0
  for (const f of files) {
    if (existsSync(`${srcDir}/${f}`)) { copyFileSync(`${srcDir}/${f}`, `${destDir}/${f}`); n++ }
  }
  console.log(`[copy-assets] ${destDir} ← ${n} file(s)`)
}

// Pyodide is now loaded from the official jsDelivr CDN at runtime (see
// src/features/python/pythonRunner.js -> PYODIDE_CDN_URL), which is required for loadPackage +
// micropip + numpy/matplotlib wheels to resolve. The ~12MB runtime is cached by the browser after
// the first visit, so we no longer self-host it under public/pyodide/.
//
// (Left copyInto in place so future self-hosted cores can reuse it.)
