import { reactive } from 'vue'

// Lazy-load heavy libraries once, dedupe concurrent calls, and expose load state +
// size hints so the UI can show "downloading N MB" spinners.
export const libLoadState = reactive({}) // key -> 'loading' | 'ready' | 'error'
export const libMeta = reactive({})      // key -> { sizeMB }

const cache = new Map() // key -> Promise<module>

export function loadLibrary(key, importer, opts = {}) {
  if (cache.has(key)) return cache.get(key)
  libLoadState[key] = 'loading'
  libMeta[key] = { sizeMB: opts.sizeMB || 0 }
  const p = Promise.resolve()
    .then(importer)
    .then(mod => { libLoadState[key] = 'ready'; return mod })
    .catch(err => { libLoadState[key] = 'error'; cache.delete(key); throw err })
  cache.set(key, p)
  return p
}

export function _resetLibraries() {
  cache.clear()
  Object.keys(libLoadState).forEach(k => delete libLoadState[k])
  Object.keys(libMeta).forEach(k => delete libMeta[k])
}
