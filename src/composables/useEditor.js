import { ref, reactive, computed, watch } from 'vue'
import { load, save } from '../utils/storage'

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
function saveNow() {
  clearTimeout(saveTimer)
  save('docs', JSON.stringify({ docs: state.docs, activeId: state.activeId }))
  dirty.value = false
}
function debouncedSave() {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(saveNow, 600)
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
  function openDoc(id) { state.activeId = id }
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
