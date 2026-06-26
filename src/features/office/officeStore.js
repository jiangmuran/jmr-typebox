// Tiny module-level hand-off so the editor's open-file flow can pass a freshly picked/dropped
// File to the Office viewer across the router navigation to /office (a File can't ride in the URL).
//
// SSG-safe: this module holds a plain variable + a couple of functions — no window/DOM/lib/Vue
// reactivity at import. We deliberately keep the File in a plain variable (not a Vue ref) so it's
// handed off by identity and never wrapped in a reactive Proxy (which can break File methods like
// .arrayBuffer()). The viewer consumes the pending file on mount and clears it.

// The File staged by EditorPage, consumed once by OfficeViewer.
let pendingFile = null

// Stage a File to open in the Office viewer. Called right before router.push('/office').
export function stageOfficeFile(file) {
  pendingFile = file || null
}

// Consume (and clear) the staged File. Returns the File or null.
export function takeOfficeFile() {
  const f = pendingFile
  pendingFile = null
  return f
}

// Peek without consuming (used to decide initial UI state).
export function hasPendingOfficeFile() {
  return !!pendingFile
}
