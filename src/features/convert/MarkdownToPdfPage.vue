<script setup>
// /convert/markdown-to-pdf
// Primary: "Print / Save as PDF" — themed offscreen iframe + window.print()
//          (vector, selectable text). Secondary: "Image PDF" via html2canvas+jspdf.
import { ref } from 'vue'
import { useRouteHead } from '../../composables/useRouteHead.js'
import { useI18n } from '../../composables/useI18n.js'
import { useSettings } from '../../composables/useSettings.js'
import { useToast } from '../../composables/useToast.js'
import ClientOnly from '../../components/ClientOnly.vue'
import ConvertShell from './components/ConvertShell.vue'
import ActionButton from './components/ActionButton.vue'
import { useConvertDoc } from './composables/useConvertDoc.js'
import { resolveThemeId } from './themes/registry.js'
import { withExt, deriveTitle } from './utils/fileHelpers.js'

const { meta: m } = useRouteHead()
const { t } = useI18n()
const { settings, setSetting } = useSettings()
const { showToast } = useToast()
const doc = useConvertDoc()

const printing = ref(false)
const imaging = ref(false)

function setTheme(id) { setSetting('exportTheme', resolveThemeId(id)) }

async function printPdf() {
  if (!doc.text.value.trim() || printing.value) return
  printing.value = true
  try {
    const { printThemed } = await import('./utils/renderFrame.js')
    await printThemed(doc.text.value, deriveTitle(doc.text.value, doc.name.value), resolveThemeId(settings.exportTheme))
  } catch (e) {
    console.error(e); showToast(t('toast.exportFailed'))
  } finally {
    printing.value = false
  }
}

async function imagePdf() {
  if (!doc.text.value.trim() || imaging.value) return
  imaging.value = true
  showToast(t('toast.genPdf'))
  try {
    const { imagePdf: run } = await import('./utils/renderFrame.js')
    await run(doc.text.value, deriveTitle(doc.text.value, doc.name.value), resolveThemeId(settings.exportTheme), withExt(doc.name.value, 'pdf'))
    showToast(t('toast.pdfDone'))
  } catch (e) {
    console.error(e); showToast(t('toast.exportFailed'))
  } finally {
    imaging.value = false
  }
}
</script>

<template>
  <div class="route-page">
    <h1 class="sr-only">{{ m.h1 }}</h1>
    <ClientOnly>
      <ConvertShell
        :t="t"
        :title="t('convert.mdToPdf.title')"
        :subtitle="t('convert.mdToPdf.sub')"
        v-model:text="doc.text.value"
        :theme="settings.exportTheme"
        :dragging="doc.dragging.value"
        :busy-keys="['html2canvas', 'jspdf']"
        @update:theme="setTheme"
        @pick="doc.pickMarkdownFile"
        @dragover="doc.onDragOver"
        @dragleave="doc.onDragLeave"
        @drop="doc.onDrop"
      >
        <template #actions>
          <ActionButton variant="primary" :busy="printing" :disabled="!doc.text.value.trim()" @click="printPdf">
            <template #icon><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6V2h8v4"/><rect x="3" y="6" width="10" height="5" rx="1"/><path d="M4 11h8v3H4z"/></svg></template>
            {{ t('convert.mdToPdf.print') }}
          </ActionButton>
          <ActionButton :busy="imaging" :disabled="!doc.text.value.trim()" @click="imagePdf">
            <template #icon><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="12" height="10" rx="1.5"/><circle cx="5.5" cy="6.5" r="1"/><path d="M3 11l3-2.5 2.5 2L11 8l2 2"/></svg></template>
            {{ t('convert.mdToPdf.image') }}
          </ActionButton>
        </template>
        <template #footer>
          <p class="cv-note">{{ t('convert.mdToPdf.note') }}</p>
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
