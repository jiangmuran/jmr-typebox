const PREFIX = 'tb-'

export function load(key, fallback = null) {
  try {
    const val = localStorage.getItem(PREFIX + key)
    return val !== null ? val : fallback
  } catch {
    return fallback
  }
}

// Returns true when the write succeeded — quota errors (and private-mode blocks)
// must not be mistaken for a successful save.
export function save(key, value) {
  try {
    localStorage.setItem(PREFIX + key, value)
    return true
  } catch {
    return false
  }
}
