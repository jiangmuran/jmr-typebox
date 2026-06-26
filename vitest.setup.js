// Deterministic, complete in-memory localStorage for tests.
// jsdom's implementation can be missing methods (e.g. clear) depending on version,
// so we always install our own full mock.
function makeStorage() {
  const store = new Map()
  return {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k),
    clear: () => store.clear(),
    key: i => [...store.keys()][i] ?? null,
    get length() { return store.size },
  }
}

try {
  Object.defineProperty(globalThis, 'localStorage', {
    value: makeStorage(),
    configurable: true,
    writable: true,
  })
} catch {
  globalThis.localStorage = makeStorage()
}
