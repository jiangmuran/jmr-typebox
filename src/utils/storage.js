const PREFIX = 'tb-'

export function load(key, fallback = null) {
  try {
    const val = localStorage.getItem(PREFIX + key)
    return val !== null ? val : fallback
  } catch {
    return fallback
  }
}

export function save(key, value) {
  try {
    localStorage.setItem(PREFIX + key, value)
  } catch {}
}
