// Composable: load a single image from drag, click (file picker) or paste, exposing the
// decoded HTMLImageElement plus metadata. Client-only by construction — every browser API
// touch happens inside handlers or onMounted, never at setup top-level, so it is SSG-safe.
import { ref, shallowRef, onMounted, onBeforeUnmount } from 'vue'
import { loadImageFromBlob, pickImageFiles, imageFileFromEvent } from './canvasUtils'
import { useHandoff } from '../../composables/useHandoff'

export function useImageSource(onLoaded) {
  const handoff = useHandoff()
  // Set true once a cross-module "send to" payload has been loaded on mount, so the page can
  // toast handoff.received. A ref (not a return value) because the load is async.
  const received = ref(false)
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
    // Handoff payloads can arrive as a bare Blob (no name); accept any image-typed Blob/File.
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
  onMounted(async () => {
    window.addEventListener('paste', onPaste)
    // Pick up a cross-module "send to" image (e.g. from another image tool's result), if one is
    // staged. One-shot: take() clears it so a later navigation/refresh won't reload it.
    const h = handoff.take('image')
    if (h?.payload) {
      let f = h.payload
      // Give a bare Blob a filename so download/save names stay sensible downstream.
      if (h.name && !f.name) { try { f = new File([f], h.name, { type: f.type }) } catch { f.name = h.name } }
      if (await setFile(f)) received.value = true
    }
  })
  onBeforeUnmount(() => { window.removeEventListener('paste', onPaste); revoke() })

  return {
    file, name, size, type, width, height, image, objectUrl, loading, dragOver, received,
    setFile, openPicker, onDrop, onDragOver, onDragLeave, onPaste, reset,
  }
}
