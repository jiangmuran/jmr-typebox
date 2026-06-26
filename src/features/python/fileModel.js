// Pure, SSG-safe file-set model for the Python mini-IDE. NO window/document/pyodide/Blob
// access here — this operates on plain values so it can be unit-tested in node and imported
// anywhere (including index.js, which must stay side-effect-free). All impure Pyodide/CodeMirror
// work lives in ./pythonRunner and ./cmEditor and is loaded lazily.
//
// A "project" is a flat set of `.py` files plus the name of the active file:
//   { files: { 'main.py': '...', 'utils.py': '...' }, active: 'main.py' }
// Files are stored as a plain object (a map of filename -> source) so it serializes cleanly to
// JSON for localStorage. Order is preserved by insertion order (which JSON round-trips).

// localStorage key (the `tb-` prefix is added by utils/storage). The spec asks for
// `tb-python-files`; we store under `python-files` so utils/storage prefixes it.
export const FILES_STORAGE_KEY = 'python-files'

// The first file every fresh project starts with.
export const ENTRY_FILE = 'main.py'

// Default source for a brand-new project's main.py. A friendly, runnable greeting.
export const DEFAULT_MAIN = [
  '# Welcome to the Python IDE — multiple files, real editor, runs in your browser.',
  '# Press Run (Cmd/Ctrl+Enter). Try adding another .py file and importing it.',
  'import sys',
  '',
  'print("Hello from Python", sys.version.split()[0])',
  '',
  'for i in range(1, 6):',
  '    print(f"{i} squared is {i * i}")',
  '',
  '# The value of the last expression is shown too:',
  'sum(range(101))',
  '',
].join('\n')

// ---- filename validation / normalization ------------------------------------------------
// We only allow simple, safe .py module filenames (no slashes, no traversal). This keeps the
// virtual FS flat and makes `import othermodule` predictable.
const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*\.py$/

// Coerce a user-typed name into a candidate filename: trim, strip any path parts, and ensure a
// `.py` extension. Returns '' if nothing usable remains.
export function normalizeFilename(raw) {
  let s = String(raw == null ? '' : raw).trim()
  if (!s) return ''
  // Strip directory components — keep only the final path segment.
  s = s.split(/[\\/]/).pop()
  if (!s) return ''
  // Drop a trailing .py (any case) so we can re-append a normalized one.
  s = s.replace(/\.py$/i, '')
  if (!s) return ''
  return s + '.py'
}

// Is `name` a valid, simple module filename?
export function isValidFilename(name) {
  return NAME_RE.test(String(name || ''))
}

// The importable module name for a file ('utils.py' -> 'utils').
export function moduleName(filename) {
  return String(filename || '').replace(/\.py$/i, '')
}

// ---- project construction / serialization -----------------------------------------------
// A fresh project: a single main.py with the default greeting, active.
export function createDefaultProject() {
  return { files: { [ENTRY_FILE]: DEFAULT_MAIN }, active: ENTRY_FILE }
}

// List filenames in stable (insertion) order.
export function fileNames(project) {
  return project && project.files ? Object.keys(project.files) : []
}

// Serialize a project to a JSON string for localStorage.
export function serializeProject(project) {
  const files = (project && project.files) || {}
  const names = Object.keys(files)
  const active = names.includes(project?.active) ? project.active : names[0] || ENTRY_FILE
  // Re-build the object so only string sources are persisted (defensive against proxies).
  const out = {}
  for (const n of names) out[n] = String(files[n] ?? '')
  return JSON.stringify({ version: 1, files: out, active })
}

// Parse a serialized project back into a clean model. Tolerates legacy / malformed payloads and
// always returns a valid project (falls back to a default main.py). An optional `legacyCode`
// (the old single-textarea draft, stored under `python-code`) seeds main.py on first migration.
export function deserializeProject(json, legacyCode) {
  let parsed = null
  try {
    parsed = typeof json === 'string' ? JSON.parse(json) : json
  } catch {
    parsed = null
  }

  const rawFiles = parsed && typeof parsed === 'object' && parsed.files && typeof parsed.files === 'object'
    ? parsed.files
    : null

  // Keep only entries with valid filenames + string-ish sources, preserving order.
  const files = {}
  if (rawFiles) {
    for (const key of Object.keys(rawFiles)) {
      const name = normalizeFilename(key)
      if (!name || !isValidFilename(name) || name in files) continue
      files[name] = String(rawFiles[key] ?? '')
    }
  }

  // Nothing usable persisted yet: build a fresh project, seeding main.py from a legacy draft if
  // one exists so returning users don't lose their single-file code on the upgrade.
  if (Object.keys(files).length === 0) {
    const seed = typeof legacyCode === 'string' && legacyCode.length ? legacyCode : DEFAULT_MAIN
    return { files: { [ENTRY_FILE]: seed }, active: ENTRY_FILE }
  }

  const names = Object.keys(files)
  const active = names.includes(parsed?.active) ? parsed.active : names[0]
  return { files, active }
}

// ---- mutations (pure — return a NEW project, never mutate the input) ---------------------
// Every operation returns a fresh {files, active}. The Vue layer assigns the result, keeping
// reactivity simple and the model trivially testable.

// Pick a unique "untitledN.py" (or a unique variant of `base`) not already present.
export function uniqueName(project, base = 'untitled') {
  const files = (project && project.files) || {}
  const stem = moduleName(normalizeFilename(base + '.py') || 'untitled.py') || 'untitled'
  let candidate = `${stem}.py`
  if (!(candidate in files)) return candidate
  let i = 1
  while ((candidate = `${stem}${i}.py`) in files) i++
  return candidate
}

// Add a new file. If `name` is omitted/taken, a unique untitledN.py is used. Returns
// { project, name, error }. `error` is a string code on failure (project unchanged).
export function addFile(project, name, content = '') {
  const files = { ...((project && project.files) || {}) }
  let target
  if (name == null || name === '') {
    target = uniqueName(project)
  } else {
    target = normalizeFilename(name)
    if (!isValidFilename(target)) return { project, name: null, error: 'invalid' }
    if (target in files) return { project, name: null, error: 'duplicate' }
  }
  files[target] = String(content ?? '')
  return { project: { files, active: target }, name: target, error: null }
}

// Rename a file, preserving its position in the order. Returns { project, name, error }.
export function renameFile(project, from, to) {
  const files = (project && project.files) || {}
  if (!(from in files)) return { project, name: null, error: 'missing' }
  const target = normalizeFilename(to)
  if (!isValidFilename(target)) return { project, name: null, error: 'invalid' }
  if (target === from) return { project, name: from, error: null } // no-op
  if (target in files) return { project, name: null, error: 'duplicate' }

  // Rebuild preserving insertion order, swapping the key in place.
  const next = {}
  for (const key of Object.keys(files)) {
    if (key === from) next[target] = files[key]
    else next[key] = files[key]
  }
  const active = project.active === from ? target : project.active
  return { project: { files: next, active }, name: target, error: null }
}

// Delete a file. The last remaining file cannot be deleted (a project always has ≥1 file).
// When the active file is removed, activate its neighbour. Returns { project, error }.
export function deleteFile(project, name) {
  const files = (project && project.files) || {}
  const names = Object.keys(files)
  if (!(name in files)) return { project, error: 'missing' }
  if (names.length <= 1) return { project, error: 'last' }

  const idx = names.indexOf(name)
  const next = {}
  for (const key of names) if (key !== name) next[key] = files[key]
  let active = project.active
  if (active === name) {
    const remaining = Object.keys(next)
    // Prefer the previous neighbour, else the next one.
    active = remaining[Math.max(0, idx - 1)] || remaining[0]
  }
  return { project: { files: next, active }, error: null }
}

// Switch the active file. No-op (same project) if the name is unknown.
export function setActive(project, name) {
  const files = (project && project.files) || {}
  if (!(name in files)) return project
  return { files: project.files, active: name }
}

// Update the source of a file (used as the editor types). Returns a new project; unknown files
// are ignored.
export function setContent(project, name, content) {
  const files = (project && project.files) || {}
  if (!(name in files)) return project
  return { files: { ...files, [name]: String(content ?? '') }, active: project.active }
}

// The source of the active file ('' if none).
export function activeContent(project) {
  const files = (project && project.files) || {}
  return files[project?.active] ?? ''
}
