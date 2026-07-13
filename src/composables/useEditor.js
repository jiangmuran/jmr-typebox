import { ref, reactive, computed, watch } from 'vue'
import { load, save } from '../utils/storage'
import { useToast } from './useToast'
import { useI18n } from './useI18n'

// Multi-document editor model. The editor is a workspace: multiple open documents with
// tabs, like an IDE. State is a single reactive object persisted under `tb-docs`.
function hydrate() {
  try {
    const raw = load('docs')
    if (raw) {
      const parsed = JSON.parse(raw)
      if (parsed && Array.isArray(parsed.docs) && parsed.docs.length) return parsed
    }
  } catch { /* fall through to migration */ }
  // Migrate the old single-document storage (tb-content / tb-filename) into one doc.
  const oldContent = load('content')
  // New users start with an empty document so the StartPanel welcome guide is visible
  // (an auto-loaded sample would hide it). Existing content is preserved.
  const first = { id: 1, name: load('filename', 'untitled') || 'untitled', content: oldContent ?? '' }
  return { docs: [first], activeId: 1 }
}

const state = reactive(hydrate())
let _seq = Math.max(0, ...state.docs.map(d => Number(d.id) || 0))
function nextId() { return ++_seq }

const dirty = ref(false)
const active = computed(() => state.docs.find(d => d.id === state.activeId) || state.docs[0])
const content = computed(() => active.value?.content ?? '')
const filename = computed(() => active.value?.name ?? 'untitled')

let saveTimer = null
let lastSaveOk = true
function saveNow() {
  clearTimeout(saveTimer)
  const ok = save('docs', JSON.stringify({ docs: state.docs, activeId: state.activeId }))
  if (ok) {
    dirty.value = false
  } else if (lastSaveOk) {
    // Warn only on the ok→failed transition so typing doesn't re-toast every 600ms.
    const { showToast } = useToast()
    const { t } = useI18n()
    showToast(t('toast.saveFailed'))
  }
  lastSaveOk = ok
  return ok
}
function debouncedSave() {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(saveNow, 600)
}

// Conservative cross-tab merge. `storage` events only fire in *other* tabs than the
// writer, so there's no feedback loop. Rules (never drop what this tab is editing):
//   - remote-only docs (id not present locally) → add
//   - local-only docs (id not present remotely) → keep (can't tell "deleted" from
//     "not-yet-synced", so prefer not to lose data)
//   - docs on both sides → take remote content, UNLESS this is the active doc with
//     unsaved edits (dirty), in which case keep local.
// activeId is always kept local.
export function mergeRemoteDocs(localDocs, remoteDocs, { activeId, dirty } = {}) {
  const remoteById = new Map((remoteDocs || []).map(d => [Number(d.id), d]))
  const seen = new Set()
  const out = []
  for (const ld of localDocs) {
    const id = Number(ld.id)
    seen.add(id)
    const rd = remoteById.get(id)
    if (rd && !(id === activeId && dirty)) {
      out.push({ id, name: rd.name, content: rd.content })
    } else {
      out.push({ id, name: ld.name, content: ld.content })
    }
  }
  for (const rd of (remoteDocs || [])) {
    const id = Number(rd.id)
    if (!seen.has(id)) out.push({ id, name: rd.name, content: rd.content })
  }
  return out
}

// Apply a remote docs snapshot into the live reactive state in place, preserving the
// identity of existing reactive doc objects (components hold the `state.docs` array
// reference) and bumping the id counter so new local docs never collide.
function applyRemote(remote) {
  if (!remote || !Array.isArray(remote.docs)) return
  const merged = mergeRemoteDocs(state.docs, remote.docs, { activeId: state.activeId, dirty: dirty.value })
  const localById = new Map(state.docs.map(d => [Number(d.id), d]))
  const next = merged.map(m => {
    const existing = localById.get(Number(m.id))
    if (existing) {
      existing.name = m.name
      existing.content = m.content
      return existing
    }
    return reactive({ id: m.id, name: m.name, content: m.content })
  })
  state.docs.splice(0, state.docs.length, ...next)
  _seq = Math.max(_seq, ...state.docs.map(d => Number(d.id) || 0))
}

// Flush the debounce window when the page is being closed/backgrounded — otherwise the
// last keystrokes within 600ms of a tab close are silently lost.
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => { if (dirty.value) saveNow() })
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && dirty.value) saveNow()
  })
  // Coordinate with other tabs: merge in whatever they persisted to `tb-docs`.
  window.addEventListener('storage', (e) => {
    if (e.key !== 'tb-docs' || !e.newValue) return
    try { applyRemote(JSON.parse(e.newValue)) } catch { /* ignore malformed remote */ }
  })
}

const stats = computed(() => {
  const text = content.value
  const words = text.trim() ? text.trim().split(/\s+/).length : 0
  return { chars: text.length, words, lines: text.split('\n').length, readMin: Math.max(1, Math.ceil(words / 250)) }
})

export function useEditor() {
  function updateContent(val) {
    if (!active.value) return
    active.value.content = val
    dirty.value = true
    debouncedSave()
  }
  function updateFilename(val) {
    if (!active.value) return
    active.value.name = val.trim() || 'untitled'
    debouncedSave()
  }
  function newDocument(name = 'untitled') {
    const doc = reactive({ id: nextId(), name, content: '' })
    state.docs.push(doc)
    state.activeId = doc.id
    dirty.value = false
    saveNow()
    return doc
  }
  // Open imported/converted text as a NEW document tab (no overwrite).
  function loadFile(text, name) {
    const doc = reactive({ id: nextId(), name: name || 'untitled', content: text })
    state.docs.push(doc)
    state.activeId = doc.id
    saveNow()
    return doc
  }
  function openDoc(id) {
    // Flush pending edits BEFORE switching: `dirty` is a single global flag, so once
    // activeId moves on, a cross-tab storage merge would treat the previous doc as
    // clean and overwrite its still-unsaved content with the remote copy.
    if (dirty.value) saveNow()
    state.activeId = id
  }
  function closeDoc(id) {
    const i = state.docs.findIndex(d => d.id === id)
    if (i < 0) return
    state.docs.splice(i, 1)
    if (!state.docs.length) {
      const doc = reactive({ id: nextId(), name: 'untitled', content: '' })
      state.docs.push(doc)
      state.activeId = doc.id
    } else if (state.activeId === id) {
      state.activeId = state.docs[Math.max(0, i - 1)].id
    }
    saveNow()
  }

  return {
    docs: state.docs,
    activeId: computed(() => state.activeId),
    active,
    content,
    filename,
    dirty,
    stats,
    updateContent,
    updateFilename,
    saveNow,
    newDocument,
    loadFile,
    openDoc,
    closeDoc,
  }
}
