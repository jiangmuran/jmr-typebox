<script setup>
// Lightweight modal to edit a track's ID3 metadata (title / artist / album) and optionally export a
// re-tagged copy of the file (ffmpeg `-c copy` rewrite). Binds to the shared player store.
import { ref, watch, computed } from 'vue'
import { usePlayerStore } from './usePlayerStore'
import { useI18n } from '../../composables/useI18n'
import { useToast } from '../../composables/useToast'

const props = defineProps({ trackId: { type: String, default: '' } })
const emit = defineEmits(['close'])

const store = usePlayerStore()
const { t } = useI18n()
const { showToast } = useToast()

const track = computed(() => store.tracks.value.find((x) => x.id === props.trackId) || null)
const title = ref('')
const artist = ref('')
const album = ref('')
const exporting = ref(false)

watch(() => props.trackId, () => {
  const tr = track.value
  title.value = tr?.title || ''
  artist.value = tr?.artist || ''
  album.value = tr?.album || ''
}, { immediate: true })

async function save() {
  if (!props.trackId) return
  await store.updateMetadata(props.trackId, { title: title.value.trim(), artist: artist.value.trim(), album: album.value.trim() })
  showToast(t('media.player.tagsSaved'))
  emit('close')
}

async function exportTagged() {
  if (!props.trackId || exporting.value) return
  await store.updateMetadata(props.trackId, { title: title.value.trim(), artist: artist.value.trim(), album: album.value.trim() })
  exporting.value = true
  try {
    const blob = await store.exportTagged(props.trackId)
    if (!blob) { showToast(t('media.failed')); return }
    const { downloadBlob } = await import('./mediaDom')
    const name = (title.value.trim() || track.value?.name || 'tagged').replace(/[\\/:*?"<>|]/g, '_')
    const ext = (track.value?.name?.match(/\.([^.]+)$/)?.[1] || 'mp3')
    downloadBlob(blob, `${name}.${ext}`)
    showToast(t('media.done'))
  } catch { showToast(t('media.failed')) } finally { exporting.value = false }
}
</script>

<template>
  <div class="tag-overlay" @click.self="emit('close')">
    <div class="tag-modal" role="dialog" aria-modal="true">
      <header class="tag-head">
        <h3>{{ t('media.player.editTags') }}</h3>
        <button class="tag-x" @click="emit('close')" aria-label="Close">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M4 4l8 8M12 4l-8 8"/></svg>
        </button>
      </header>
      <div class="tag-body">
        <label class="tag-field">
          <span>{{ t('media.player.fieldTitle') }}</span>
          <input v-model="title" type="text" :placeholder="track?.name || ''" />
        </label>
        <label class="tag-field">
          <span>{{ t('media.player.fieldArtist') }}</span>
          <input v-model="artist" type="text" />
        </label>
        <label class="tag-field">
          <span>{{ t('media.player.fieldAlbum') }}</span>
          <input v-model="album" type="text" />
        </label>
        <p class="tag-note">{{ t('media.player.exportNote') }}</p>
      </div>
      <footer class="tag-foot">
        <button class="tag-btn ghost" :disabled="exporting" @click="exportTagged">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2v8M5 7l3 3 3-3"/><path d="M3 13h10"/></svg>
          {{ exporting ? t('media.converting') : t('media.player.exportTagged') }}
        </button>
        <button class="tag-btn solid" @click="save">{{ t('media.lyrics.save') }}</button>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.tag-overlay { position: fixed; inset: 0; z-index: 1000; display: flex; align-items: center; justify-content: center; padding: 20px; background: rgba(0,0,0,0.4); backdrop-filter: blur(3px); animation: fade 0.18s var(--ease-out); }
@keyframes fade { from { opacity: 0; } to { opacity: 1; } }
.tag-modal { width: 100%; max-width: 400px; background: var(--surface); border: 1px solid var(--border-light); border-radius: 16px; box-shadow: var(--shadow-lg); overflow: hidden; animation: pop 0.2s var(--ease-out); }
@keyframes pop { from { opacity: 0; transform: translateY(10px) scale(0.98); } to { opacity: 1; transform: none; } }
.tag-head { display: flex; align-items: center; justify-content: space-between; padding: 16px 18px; border-bottom: 1px solid var(--border-light); }
.tag-head h3 { font-size: 15px; font-weight: 700; }
.tag-x { width: 30px; height: 30px; display: inline-flex; align-items: center; justify-content: center; border: none; background: none; color: var(--text-secondary); cursor: pointer; border-radius: 8px; }
.tag-x:hover { background: var(--surface-hover); color: var(--text); }
.tag-x svg { width: 16px; height: 16px; }
.tag-body { padding: 18px; display: flex; flex-direction: column; gap: 13px; }
.tag-field { display: flex; flex-direction: column; gap: 6px; }
.tag-field span { font-size: 12px; font-weight: 600; color: var(--text-secondary); }
.tag-field input { padding: 9px 12px; border: 1px solid var(--border); border-radius: 9px; background: var(--bg); color: var(--text); font-size: 13.5px; font-family: var(--font-sans); outline: none; }
.tag-field input:focus { border-color: var(--accent); }
.tag-note { font-size: 11px; color: var(--text-tertiary); line-height: 1.5; }
.tag-foot { display: flex; gap: 8px; padding: 0 18px 18px; }
.tag-btn { display: inline-flex; align-items: center; justify-content: center; gap: 7px; padding: 10px 14px; border-radius: 10px; font-size: 13px; font-weight: 650; font-family: var(--font-sans); cursor: pointer; transition: all var(--dur-1); }
.tag-btn svg { width: 15px; height: 15px; }
.tag-btn.ghost { flex: 1; border: 1px solid var(--border); background: var(--surface); color: var(--text-secondary); }
.tag-btn.ghost:hover:not(:disabled) { color: var(--text); border-color: var(--accent); }
.tag-btn.ghost:disabled { opacity: 0.6; cursor: default; }
.tag-btn.solid { border: none; background: var(--text); color: var(--bg); padding-left: 22px; padding-right: 22px; }
.tag-btn.solid:hover { opacity: 0.9; }
</style>
