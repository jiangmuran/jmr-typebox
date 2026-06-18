<script setup>
// Shared chrome for the markdown-based convert pages: header, an input textarea
// pane (prefilled from the editor doc, drag & paste of .md/.txt), an optional
// export-theme picker, and an actions slot. Keeps each page tiny.

import { computed } from 'vue'
import { libLoadState, libMeta } from '../../../utils/loadLibrary.js'
import ThemePicker from './ThemePicker.vue'

const props = defineProps({
  t: { type: Function, required: true },
  title: { type: String, default: '' },
  subtitle: { type: String, default: '' },
  // v-model:text — the working markdown
  text: { type: String, default: '' },
  // v-model:theme — selected export theme id (omit showTheme to hide the picker)
  theme: { type: String, default: 'github' },
  showTheme: { type: Boolean, default: true },
  dragging: { type: Boolean, default: false },
  placeholder: { type: String, default: '' },
  // library keys to surface a "downloading N MB" hint for (e.g. ['docx'])
  busyKeys: { type: Array, default: () => [] },
})
const emit = defineEmits(['update:text', 'update:theme', 'pick', 'dragover', 'dragleave', 'drop'])

const loadingLib = computed(() =>
  props.busyKeys.find(k => libLoadState[k] === 'loading')
)
const loadingMB = computed(() => {
  const k = loadingLib.value
  return k && libMeta[k]?.sizeMB ? libMeta[k].sizeMB : 0
})

async function pasteIn() {
  try {
    const txt = await navigator.clipboard.readText()
    if (txt) emit('update:text', txt)
  } catch {}
}
</script>

<template>
  <main
    class="convert"
    @dragover="emit('dragover', $event)"
    @dragleave="emit('dragleave', $event)"
    @drop="emit('drop', $event)"
  >
    <header class="cv-head">
      <h2>{{ title }}</h2>
      <p>{{ subtitle }}</p>
    </header>

    <!-- Input -->
    <section class="cv-pane" :class="{ dragging }">
      <div class="cv-pane-head">
        <span>{{ t('convert.input') }}</span>
        <div class="cv-actions">
          <button type="button" @click="emit('pick')">{{ t('convert.openFile') }}</button>
          <button type="button" @click="pasteIn">{{ t('tool.paste') }}</button>
          <button type="button" @click="emit('update:text', '')">{{ t('tool.clear') }}</button>
        </div>
      </div>
      <textarea
        :value="text"
        spellcheck="false"
        :placeholder="placeholder || t('convert.placeholder')"
        @input="emit('update:text', $event.target.value)"
      ></textarea>
      <div v-if="dragging" class="cv-drop-overlay">{{ t('convert.dropHere') }}</div>
    </section>

    <!-- Theme picker -->
    <ThemePicker
      v-if="showTheme"
      :model-value="theme"
      :doc="text"
      :t="t"
      @update:model-value="emit('update:theme', $event)"
    />

    <!-- Actions (page supplies buttons) -->
    <div class="cv-run">
      <slot name="actions" />
    </div>

    <!-- Library download hint -->
    <p v-if="loadingLib" class="cv-libhint">
      <span class="cv-spinner"></span>
      {{ t('convert.loadingLib') }}<template v-if="loadingMB"> · {{ loadingMB }} MB</template>
    </p>

    <slot name="footer" />
  </main>
</template>

<style scoped>
.convert { flex: 1; overflow-y: auto; padding: 32px 24px 56px; max-width: 760px; margin: 0 auto; width: 100%; animation: cvIn 0.3s var(--ease-out); }
@keyframes cvIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
.cv-head { margin-bottom: 20px; }
.cv-head h2 { font-size: 24px; font-weight: 750; letter-spacing: -0.5px; }
.cv-head p { margin-top: 6px; color: var(--text-secondary); font-size: 13px; line-height: 1.5; }

.cv-pane { position: relative; border: 1px solid var(--border-light); border-radius: 12px; overflow: hidden; background: var(--surface); margin-bottom: 16px; transition: border-color 0.15s; }
.cv-pane.dragging { border-color: var(--accent); }
.cv-pane-head { display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; border-bottom: 1px solid var(--border-light); font-size: 11px; font-weight: 600; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.5px; }
.cv-actions { display: flex; gap: 4px; }
.cv-actions button { border: none; background: var(--surface-hover); color: var(--text-secondary); font-size: 11px; padding: 3px 9px; border-radius: 5px; cursor: pointer; font-family: var(--font-sans); }
.cv-actions button:hover { color: var(--text); }
.cv-pane textarea { width: 100%; min-height: 220px; border: none; background: transparent; padding: 14px; font-family: var(--font-mono); font-size: 13px; line-height: 1.6; color: var(--text); outline: none; resize: vertical; }
.cv-drop-overlay { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; background: var(--accent-bg); color: var(--accent); font-weight: 600; font-size: 14px; pointer-events: none; backdrop-filter: blur(2px); }

.cv-run { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 18px; }

.cv-libhint { display: flex; align-items: center; gap: 8px; margin-top: 14px; font-size: 12px; color: var(--text-secondary); }
.cv-spinner { width: 13px; height: 13px; border: 2px solid var(--border); border-top-color: var(--accent); border-radius: 50%; animation: cvSpin 0.7s linear infinite; }
@keyframes cvSpin { to { transform: rotate(360deg); } }
</style>
