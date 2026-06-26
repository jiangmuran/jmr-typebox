<script setup>
// /convert/markdown-to-html — standalone .html with the selected theme inlined.
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
import { withExt, deriveTitle, downloadText, MIME } from './utils/fileHelpers.js'

const { meta: m } = useRouteHead()
const { t } = useI18n()
const { settings, setSetting } = useSettings()
const { showToast } = useToast()
const doc = useConvertDoc()

const busy = ref(false)

function setTheme(id) { setSetting('exportTheme', resolveThemeId(id)) }

async function buildHtml() {
  const { buildThemedHTML } = await import('./utils/renderFrame.js')
  return buildThemedHTML(doc.text.value, deriveTitle(doc.text.value, doc.name.value), resolveThemeId(settings.exportTheme))
}

async function downloadHtml() {
  if (!doc.text.value.trim() || busy.value) return
  busy.value = true
  try {
    const html = await buildHtml()
    const filename = withExt(doc.name.value, 'html')
    downloadText(html, filename, MIME.html)
    showToast(`${t('toast.downloaded')} ${filename}`)
  } catch (e) {
    console.error(e); showToast(t('toast.exportFailed'))
  } finally {
    busy.value = false
  }
}

async function copyHtml() {
  if (!doc.text.value.trim()) return
  try {
    const html = await buildHtml()
    await navigator.clipboard.writeText(html)
    showToast(t('convert.mdToHtml.copied'))
  } catch (e) {
    console.error(e); showToast(t('toast.exportFailed'))
  }
}
</script>

<template>
  <div class="route-page">
    <h1 class="sr-only">{{ m.h1 }}</h1>
    <ClientOnly>
      <ConvertShell
        :t="t"
        :title="t('convert.mdToHtml.title')"
        :subtitle="t('convert.mdToHtml.sub')"
        v-model:text="doc.text.value"
        :theme="settings.exportTheme"
        :dragging="doc.dragging.value"
        @update:theme="setTheme"
        @pick="doc.pickMarkdownFile"
        @dragover="doc.onDragOver"
        @dragleave="doc.onDragLeave"
        @drop="doc.onDrop"
      >
        <template #actions>
          <ActionButton variant="primary" :busy="busy" :disabled="!doc.text.value.trim()" @click="downloadHtml">
            <template #icon><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M8 1v9m0 0L5 7m3 3l3-3"/><path d="M2 11v2a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-2"/></svg></template>
            {{ t('convert.mdToHtml.download') }}
          </ActionButton>
          <ActionButton :disabled="!doc.text.value.trim()" @click="copyHtml">
            <template #icon><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="5" y="5" width="9" height="9" rx="1"/><path d="M3.5 11H3a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1h7a1 1 0 0 1 1 1v.5"/></svg></template>
            {{ t('convert.mdToHtml.copy') }}
          </ActionButton>
        </template>
      </ConvertShell>
    </ClientOnly>
  </div>
</template>

<style scoped>
.route-page { flex: 1; display: flex; flex-direction: column; min-height: 0; overflow: hidden; }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }
</style>
