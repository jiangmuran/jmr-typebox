<script setup>
// /convert/markdown-to-docx — renderMarkdown -> @turbodocx/html-to-docx -> .docx
import { ref } from 'vue'
import { useRouteHead } from '../../composables/useRouteHead.js'
import { useI18n } from '../../composables/useI18n.js'
import { useToast } from '../../composables/useToast.js'
import ClientOnly from '../../components/ClientOnly.vue'
import ConvertShell from './components/ConvertShell.vue'
import ActionButton from './components/ActionButton.vue'
import { useConvertDoc } from './composables/useConvertDoc.js'
import { withExt, deriveTitle, downloadBlob } from './utils/fileHelpers.js'

const { meta: m } = useRouteHead()
const { t } = useI18n()
const { showToast } = useToast()
const doc = useConvertDoc()

const busy = ref(false)

async function toDocx() {
  if (!doc.text.value.trim() || busy.value) return
  busy.value = true
  showToast(t('convert.mdToDocx.working'))
  try {
    const { markdownToDocxBlob } = await import('./utils/docx.js')
    const blob = await markdownToDocxBlob(doc.text.value, deriveTitle(doc.text.value, doc.name.value))
    const filename = withExt(doc.name.value, 'docx')
    downloadBlob(blob, filename)
    showToast(`${t('toast.downloaded')} ${filename}`)
  } catch (e) {
    console.error(e); showToast(t('toast.exportFailed'))
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="route-page">
    <h1 class="sr-only">{{ m.h1 }}</h1>
    <ClientOnly>
      <ConvertShell
        :t="t"
        :title="t('convert.mdToDocx.title')"
        :subtitle="t('convert.mdToDocx.sub')"
        v-model:text="doc.text.value"
        :show-theme="false"
        :dragging="doc.dragging.value"
        :busy-keys="['docx']"
        @pick="doc.pickMarkdownFile"
        @dragover="doc.onDragOver"
        @dragleave="doc.onDragLeave"
        @drop="doc.onDrop"
      >
        <template #actions>
          <ActionButton variant="primary" :busy="busy" :disabled="!doc.text.value.trim()" @click="toDocx">
            <template #icon><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 1.5h5l4 4V14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V2.5a1 1 0 0 1 1-1z"/><path d="M9 1.5V6h4.5"/><path d="M5.5 9l.8 3 .9-3 .9 3 .8-3"/></svg></template>
            {{ t('convert.mdToDocx.download') }}
          </ActionButton>
        </template>
        <template #footer>
          <p class="cv-note">{{ t('convert.mdToDocx.note') }}</p>
        </template>
      </ConvertShell>
    </ClientOnly>
  </div>
</template>

<style scoped>
.route-page { flex: 1; display: flex; flex-direction: column; min-height: 0; overflow: hidden; }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }
.cv-note { margin-top: 16px; font-size: 12px; color: var(--text-tertiary); line-height: 1.5; }
</style>
