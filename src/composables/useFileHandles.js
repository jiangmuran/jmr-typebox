// Tracks the FileSystemFileHandle backing an editor doc — set when a file is opened via the PWA
// file handler (launchQueue) or the File System Access picker. Lets Ctrl+S save edits straight back
// to the original file. In-memory only (handles aren't serializable); valid for the session.
const handles = new Map()

export function useFileHandles() {
  return {
    set(id, handle) { if (handle) handles.set(id, handle); else handles.delete(id) },
    get(id) { return handles.get(id) || null },
    has(id) { return handles.has(id) },
    remove(id) { handles.delete(id) },
  }
}
