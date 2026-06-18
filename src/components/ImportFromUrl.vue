<script setup>
// Optional "import from URL" via the backend CORS proxy. Renders ONLY when the backend is
// available (master toggle on + probe ok), so it degrades away cleanly. Shows the ⓘ notice.
import { ref, onMounted } from 'vue'
import { useBackend } from '../composables/useBackend'
import { useI18n } from '../composables/useI18n'
import { useToast } from '../composables/useToast'
import BackendInfo from './BackendInfo.vue'

const props = defineProps({ accept: { type: String, default: '' } }) // mime prefix filter, e.g. 'image/'
const emit = defineEmits(['file'])
const { available, probe, apiBase } = useBackend()
const { t } = useI18n()
const { showToast } = useToast()
const url = ref('')
const busy = ref(false)

onMounted(() => probe())

async function fetchUrl() {
  const u = url.value.trim()
  if (!u || busy.value) return
  busy.value = true
  try {
    const res = await fetch(`${apiBase}/api/fetch?url=${encodeURIComponent(u)}`)
    if (!res.ok) throw new Error('fetch failed')
    const blob = await res.blob()
    if (props.accept && !blob.type.startsWith(props.accept)) throw new Error('wrong type')
    const name = u.split('/').pop()?.split('?')[0] || 'download'
    emit('file', new File([blob], name, { type: blob.type || 'application/octet-stream' }))
    url.value = ''
  } catch {
    showToast(t('importurl.failed'))
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div v-if="available" class="import-url">
    <input v-model="url" class="iu-input" :placeholder="t('importurl.placeholder')" spellcheck="false" @keydown.enter="fetchUrl" />
    <button class="iu-btn" :disabled="busy" @click="fetchUrl">{{ busy ? t('importurl.fetching') : t('importurl.fetch') }}</button>
    <BackendInfo />
  </div>
</template>

<style scoped>
.import-url { display: flex; align-items: center; gap: 6px; }
.iu-input { flex: 1; min-width: 0; padding: 7px 10px; border: 1px solid var(--border-light); border-radius: 8px; background: var(--surface); color: var(--text); font-size: 12px; font-family: var(--font-mono); outline: none; }
.iu-input:focus { border-color: var(--accent); }
.iu-btn { padding: 7px 12px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); color: var(--text); font-size: 12px; font-weight: 500; font-family: var(--font-sans); cursor: pointer; white-space: nowrap; }
.iu-btn:hover:not(:disabled) { background: var(--surface-hover); }
.iu-btn:disabled { opacity: 0.6; cursor: default; }
</style>
