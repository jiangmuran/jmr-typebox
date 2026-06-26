// Small client-only composable: pick / drop / paste a single media file, track an object URL for
// in-page preview, and clean up on unmount. Used by the converter + subtitle pages. Touches
// document/URL but only inside functions invoked from event handlers / mounted components.
import { ref, onBeforeUnmount } from 'vue'

// useMediaFile({ accept, validate }) where validate(File) -> boolean controls what is accepted.
export function useMediaFile({ accept = '*/*', validate } = {}) {
  const file = ref(null)
  const name = ref('')
  const size = ref(0)
  const url = ref('')        // object URL for <audio>/<video> preview of the input
  const dragOver = ref(false)

  function revoke() {
    if (url.value) { try { URL.revokeObjectURL(url.value) } catch { /* ignore */ } url.value = '' }
  }

  // Returns true if accepted.
  function set(f) {
    if (!f) return false
    if (validate && !validate(f)) return false
    revoke()
    file.value = f
    name.value = f.name || 'file'
    size.value = f.size || 0
    url.value = URL.createObjectURL(f)
    return true
  }

  function clear() {
    revoke()
    file.value = null
    name.value = ''
    size.value = 0
  }

  function openPicker() {
    const input = document.createElement('input')
    input.type = 'file'
    if (accept) input.accept = accept
    input.onchange = (e) => { const f = e.target.files?.[0]; if (f) set(f) }
    input.click()
  }

  function onDrop(e) {
    dragOver.value = false
    const f = e.dataTransfer?.files?.[0]
    return f ? set(f) : false
  }

  function onDragOver() { dragOver.value = true }
  function onDragLeave() { dragOver.value = false }

  function onPaste(e) {
    const f = e.clipboardData?.files?.[0]
    if (f) return set(f)
    for (const it of e.clipboardData?.items || []) {
      if (it.kind === 'file') { const g = it.getAsFile(); if (g) return set(g) }
    }
    return false
  }

  onBeforeUnmount(revoke)

  return { file, name, size, url, dragOver, set, clear, openPicker, onDrop, onDragOver, onDragLeave, onPaste, revoke }
}
