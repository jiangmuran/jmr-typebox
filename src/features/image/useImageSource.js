// Composable: load a single image from drag, click (file picker) or paste, exposing the
// decoded HTMLImageElement plus metadata. Client-only by construction — every browser API
// touch happens inside handlers or onMounted, never at setup top-level, so it is SSG-safe.
import { ref, shallowRef, onMounted, onBeforeUnmount } from 'vue'
import { loadImageFromBlob, pickImageFiles, imageFileFromEvent } from './canvasUtils'

export function useImageSource(onLoaded) {
  const file = ref(null)
  const name = ref('')
  const size = ref(0)
  const type = ref('')
  const width = ref(0)
  const height = ref(0)
  const image = shallowRef(null) // HTMLImageElement
  const objectUrl = ref('')
  const loading = ref(false)
  const dragOver = ref(false)

  async function setFile(f) {
    if (!f || !f.type?.startsWith('image/')) return false
    loading.value = true
    try {
      const img = await loadImageFromBlob(f)
      revoke()
      file.value = f
      name.value = f.name || 'image'
      size.value = f.size || 0
      type.value = f.type
      image.value = img
      width.value = img.naturalWidth
      height.value = img.naturalHeight
      objectUrl.value = URL.createObjectURL(f)
      if (typeof onLoaded === 'function') onLoaded({ file: f, image: img })
      return true
    } catch {
      return false
    } finally {
      loading.value = false
    }
  }

  async function openPicker() {
    const files = await pickImageFiles({ multiple: false })
    if (files[0]) await setFile(files[0])
  }

  function onDrop(e) {
    e.preventDefault()
    dragOver.value = false
    const f = imageFileFromEvent(e)
    if (f) setFile(f)
  }
  function onDragOver(e) { e.preventDefault(); dragOver.value = true }
  function onDragLeave() { dragOver.value = false }

  function onPaste(e) {
    const f = imageFileFromEvent(e)
    if (f) { e.preventDefault(); setFile(f) }
  }

  function revoke() {
    if (objectUrl.value) { URL.revokeObjectURL(objectUrl.value); objectUrl.value = '' }
  }

  function reset() {
    revoke()
    file.value = null; name.value = ''; size.value = 0; type.value = ''
    width.value = 0; height.value = 0; image.value = null
  }

  // Global paste so users can Ctrl/Cmd+V anywhere on the page.
  onMounted(() => { window.addEventListener('paste', onPaste) })
  onBeforeUnmount(() => { window.removeEventListener('paste', onPaste); revoke() })

  return {
    file, name, size, type, width, height, image, objectUrl, loading, dragOver,
    setFile, openPicker, onDrop, onDragOver, onDragLeave, onPaste, reset,
  }
}
