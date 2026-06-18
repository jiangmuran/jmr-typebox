<script setup>
// Export-theme picker with hover live-preview. On hover, renders the FIRST PAGE
// of the current doc in that theme inside a scoped, sandboxed iframe. Loaded
// theme CSS is cached in memory by the registry, so previews are instant after
// the first hover. Selecting a theme emits update:modelValue (the page persists
// it via useSettings).

import { ref } from 'vue'
import { listThemes, getThemeCss } from '../themes/registry.js'
import { renderMarkdown } from '../../../utils/markdown.js'

const props = defineProps({
  modelValue: { type: String, default: 'github' },
  // Source markdown — only the first chunk is used for the live preview.
  doc: { type: String, default: '' },
  t: { type: Function, default: k => k },
})
const emit = defineEmits(['update:modelValue'])

const themes = listThemes()
const hovered = ref(null)
const previewHtml = ref('')      // srcdoc for the iframe
const previewName = ref('')

// Take roughly the first page worth of markdown so preview is light.
function firstPage(md) {
  const text = String(md || '')
  if (!text.trim()) return '# Preview\n\nHover a theme to see your document in it.'
  return text.slice(0, 1600)
}

async function showPreview(theme) {
  hovered.value = theme.id
  previewName.value = theme.name
  const css = await getThemeCss(theme.id)
  // Guard against a stale hover resolving after the user moved away.
  if (hovered.value !== theme.id) return
  const body = renderMarkdown(firstPage(props.doc))
  previewHtml.value = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;background:${theme.swatch.bg};}
    .markdown-body{padding:20px 22px;font-size:13px;}
    ${css}
  </style></head><body><article class="markdown-body">${body}</article></body></html>`
}

function hidePreview() {
  hovered.value = null
  previewHtml.value = ''
}

function select(id) {
  emit('update:modelValue', id)
}
</script>

<template>
  <div class="theme-picker">
    <div class="tp-label">{{ t('convert.theme') }}</div>
    <div class="tp-grid" @mouseleave="hidePreview">
      <button
        v-for="theme in themes"
        :key="theme.id"
        class="tp-chip"
        :class="{ active: modelValue === theme.id }"
        type="button"
        @click="select(theme.id)"
        @mouseenter="showPreview(theme)"
        @focus="showPreview(theme)"
        @blur="hidePreview"
      >
        <span class="tp-swatch" :style="{ background: theme.swatch.bg }">
          <span class="tp-swatch-fg" :style="{ background: theme.swatch.fg }"></span>
          <span class="tp-swatch-accent" :style="{ background: theme.swatch.accent }"></span>
        </span>
        <span class="tp-name">{{ theme.name }}</span>
        <svg v-if="modelValue === theme.id" class="tp-check" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8.5l3.5 3.5L13 4.5"/></svg>
      </button>
    </div>

    <!-- Hover live-preview -->
    <transition name="tp-fade">
      <div v-if="previewHtml" class="tp-preview">
        <div class="tp-preview-head">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="8" cy="8" r="3"/><path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z"/></svg>
          {{ t('convert.preview') }} · {{ previewName }}
        </div>
        <iframe class="tp-preview-frame" :srcdoc="previewHtml" sandbox="allow-same-origin" title="theme preview"></iframe>
      </div>
    </transition>
  </div>
</template>

<style scoped>
.theme-picker { display: flex; flex-direction: column; gap: 8px; }
.tp-label { font-size: 11px; font-weight: 600; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.5px; }
.tp-grid { display: flex; flex-wrap: wrap; gap: 6px; }
.tp-chip {
  display: inline-flex; align-items: center; gap: 8px;
  padding: 6px 10px 6px 6px; border: 1px solid var(--border-light); border-radius: 999px;
  background: var(--surface); color: var(--text); font-size: 12px; font-weight: 500;
  font-family: var(--font-sans); cursor: pointer; transition: all 0.15s;
}
.tp-chip:hover { background: var(--surface-hover); border-color: var(--border); }
.tp-chip.active { border-color: var(--accent); background: var(--accent-bg); }
.tp-swatch {
  position: relative; width: 22px; height: 22px; border-radius: 50%;
  border: 1px solid rgba(0,0,0,0.12); flex-shrink: 0; overflow: hidden;
}
.tp-swatch-fg { position: absolute; left: 4px; top: 6px; width: 9px; height: 2px; border-radius: 2px; }
.tp-swatch-accent { position: absolute; left: 4px; top: 11px; width: 6px; height: 2px; border-radius: 2px; }
.tp-name { white-space: nowrap; }
.tp-check { width: 13px; height: 13px; color: var(--accent); }

.tp-preview {
  margin-top: 4px; border: 1px solid var(--border-light); border-radius: 12px;
  overflow: hidden; background: var(--surface); box-shadow: var(--shadow-sm);
}
.tp-preview-head {
  display: flex; align-items: center; gap: 6px; padding: 7px 12px;
  font-size: 11px; font-weight: 600; color: var(--text-secondary);
  border-bottom: 1px solid var(--border-light); background: var(--surface-hover);
}
.tp-preview-head svg { width: 13px; height: 13px; }
.tp-preview-frame { width: 100%; height: 280px; border: 0; display: block; background: #fff; }

.tp-fade-enter-active, .tp-fade-leave-active { transition: opacity 0.18s ease; }
.tp-fade-enter-from, .tp-fade-leave-to { opacity: 0; }
</style>
