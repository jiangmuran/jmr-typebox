// Persistent cache for large runtime assets (Pyodide, ffmpeg.wasm cores, theme fonts)
// via the Cache API. All calls are no-ops returning null when storage is unavailable
// (SSG/Node or privacy modes), so callers never need to guard.
const CACHE_NAME = 'tb-assets'

export const assetCache = {
  async get(url) {
    try {
      if (typeof caches === 'undefined') return null
      const c = await caches.open(CACHE_NAME)
      return (await c.match(url)) || null
    } catch { return null }
  },
  async put(url, response) {
    try {
      if (typeof caches === 'undefined') return
      const c = await caches.open(CACHE_NAME)
      await c.put(url, response)
    } catch { /* storage full or unavailable — ignore */ }
  },
}
