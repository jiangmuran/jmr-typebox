<script setup>
import { useRouter } from 'vue-router'
import { useRouteHead } from '../composables/useRouteHead'
import { useI18n } from '../composables/useI18n'
import { useEditor } from '../composables/useEditor'
import { useToast } from '../composables/useToast'
import ClientOnly from '../components/ClientOnly.vue'
import PdfTools from '../components/PdfTools.vue'

const { meta: m } = useRouteHead()
const { t } = useI18n()
const { loadFile } = useEditor()
const { showToast } = useToast()
const router = useRouter()

function onSendToEditor(md, name) {
  loadFile(md, name)
  showToast(t('welcome.loadedToEditor'))
  router.push('/')
}
</script>

<template>
  <div class="route-page">
    <h1 class="sr-only">{{ m.h1 }}</h1>
    <ClientOnly><PdfTools :t="t" @send-to-editor="onSendToEditor" /></ClientOnly>
  </div>
</template>

<style scoped>
.route-page { flex: 1; display: flex; flex-direction: column; min-height: 0; overflow: hidden; }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }
</style>
