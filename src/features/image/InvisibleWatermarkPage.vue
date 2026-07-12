<script setup>
// Thin shell: mode tabs + window-paste routing. All embed/decode state lives in the panels,
// which stay mounted (v-show) so flipping to "Read" and back never drops the embed queue.
import { ref, onMounted, onUnmounted } from 'vue'
import { useRouteHead } from '../../composables/useRouteHead'
import { useI18n } from '../../composables/useI18n'
import ImageShell from './ImageShell.vue'
import InvisibleEmbedPanel from './InvisibleEmbedPanel.vue'
import InvisibleDecodePanel from './InvisibleDecodePanel.vue'
import { imageFilesFromEvent } from './canvasUtils'

const { meta: m } = useRouteHead()
const { t } = useI18n()

const mode = ref('embed')          // 'embed' | 'decode'
const embedPanel = ref(null)
const decodePanel = ref(null)

// Cmd/Ctrl+V anywhere on the page: embed mode queues the pasted image(s); decode mode reads the first.
function onPaste(e) {
  const files = imageFilesFromEvent(e)
  if (!files.length) return
  e.preventDefault()
  if (mode.value === 'decode') decodePanel.value?.read(files[0])
  else embedPanel.value?.addFiles(files)
}
onMounted(() => window.addEventListener('paste', onPaste))
onUnmounted(() => window.removeEventListener('paste', onPaste))
</script>

<template>
  <ImageShell wide :h1="m.h1" :title="t('img2.inv.title')" :sub="t('img2.inv.sub')">
    <div class="seg mode-seg">
      <button :class="{ on: mode === 'embed' }" @click="mode = 'embed'">{{ t('img2.inv.tabEmbed') }}</button>
      <button :class="{ on: mode === 'decode' }" @click="mode = 'decode'">{{ t('img2.inv.tabDecode') }}</button>
    </div>
    <div v-show="mode === 'embed'"><InvisibleEmbedPanel ref="embedPanel" /></div>
    <div v-show="mode === 'decode'"><InvisibleDecodePanel ref="decodePanel" /></div>
  </ImageShell>
</template>

<style scoped>
.mode-seg { margin-bottom: 16px; max-width: 320px; }
</style>
