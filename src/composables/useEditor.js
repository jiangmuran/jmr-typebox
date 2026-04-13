import { ref, computed, watch } from 'vue'
import { load, save } from '../utils/storage'
import { defaultContent } from '../utils/defaultContent'

const content = ref(load('content') ?? defaultContent)
const filename = ref(load('filename', 'untitled'))
const dirty = ref(false)

let saveTimer = null

function debouncedSave() {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    save('content', content.value)
    save('filename', filename.value)
    dirty.value = false
  }, 800)
}

export function useEditor() {
  const stats = computed(() => {
    const text = content.value
    const chars = text.length
    const words = text.trim() ? text.trim().split(/\s+/).length : 0
    const lines = text.split('\n').length
    const readMin = Math.max(1, Math.ceil(words / 250))
    return { chars, words, lines, readMin }
  })

  function updateContent(val) {
    content.value = val
    dirty.value = true
    debouncedSave()
  }

  function updateFilename(val) {
    filename.value = val.trim() || 'untitled'
    debouncedSave()
  }

  function saveNow() {
    clearTimeout(saveTimer)
    save('content', content.value)
    save('filename', filename.value)
    dirty.value = false
  }

  function newDocument() {
    content.value = ''
    filename.value = 'untitled'
    dirty.value = false
    saveNow()
  }

  function loadFile(text, name) {
    content.value = text
    filename.value = name
    dirty.value = false
    saveNow()
  }

  return {
    content,
    filename,
    dirty,
    stats,
    updateContent,
    updateFilename,
    saveNow,
    newDocument,
    loadFile,
  }
}
