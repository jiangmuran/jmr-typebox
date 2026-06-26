// Shared input-doc state for the markdown-based convert pages. Prefills from the
// shared editor doc, supports drag & paste of .md/.txt files, and tracks a base
// filename for output naming. SSG-safe: reads window/FileReader only in handlers.

import { ref } from 'vue'
import { useEditor } from '../../../composables/useEditor.js'
import { fileKind, stripExt } from '../utils/fileHelpers.js'

export function useConvertDoc() {
  const { content, filename } = useEditor()

  // A local working copy seeded from the shared editor doc. We do NOT write back
  // to the editor — convert pages are a read/transform surface.
  const text = ref(content.value || '')
  const name = ref(stripExt(filename.value) || 'document')
  const dragging = ref(false)

  function readFileAsText(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader()
      r.onload = () => resolve(String(r.result || ''))
      r.onerror = reject
      r.readAsText(file)
    })
  }

  async function loadMarkdownFile(file) {
    if (!file) return false
    if (fileKind(file) !== 'markdown') return false
    text.value = await readFileAsText(file)
    name.value = stripExt(file.name) || 'document'
    return true
  }

  function pickMarkdownFile() {
    if (typeof document === 'undefined') return
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.md,.markdown,.txt,text/markdown,text/plain'
    input.onchange = e => { const f = e.target.files?.[0]; if (f) loadMarkdownFile(f) }
    input.click()
  }

  function onDragOver(e) { e.preventDefault(); dragging.value = true }
  function onDragLeave() { dragging.value = false }
  async function onDrop(e) {
    e.preventDefault()
    dragging.value = false
    const f = e.dataTransfer?.files?.[0]
    if (f) await loadMarkdownFile(f)
  }

  return {
    text, name, dragging,
    loadMarkdownFile, pickMarkdownFile,
    onDragOver, onDragLeave, onDrop,
  }
}
