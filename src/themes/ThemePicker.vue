<script setup>
/**
 * ThemePicker — compact dropdown of vendored Typora themes.
 *
 * Props:
 *   modelValue        (v-model) selected theme id
 *   previewMarkdown   markdown source; its first chunk is rendered as the
 *                     hover-preview body so each theme is shown on real content
 *   label             optional button label override
 *
 * Emits:
 *   update:modelValue(id)  on select (via defineModel)
 *   preview(id|null)       on hover (null when the pointer leaves)
 *
 * Hover renders the previewed theme inside an isolated <iframe srcdoc>, so the
 * theme CSS applies verbatim with zero leakage into the app. Loaded CSS is
 * cached by the registry, so re-hovering a theme is instant.
 */
import { ref, computed, watch, onBeforeUnmount, nextTick } from 'vue'
import { THEMES, getThemeCss, buildThemedHtmlSync } from './registry'
import { renderMarkdown } from '../utils/markdown'

const model = defineModel({ type: String, default: '' })

const props = defineProps({
  previewMarkdown: { type: String, default: '' },
  label: { type: String, default: '' },
})

const emit = defineEmits(['preview'])

const open = ref(false)
const hoverId = ref('')
const previewHtml = ref('') // iframe srcdoc for the hovered theme
const rootEl = ref(null)
const triggerEl = ref(null)
const popEl = ref(null)
const popStyle = ref({}) // fixed-position style so the popover escapes any clipping ancestor

const selected = computed(() => THEMES.find((t) => t.id === model.value) || null)
const buttonLabel = computed(() => props.label || selected.value?.name || (model.value === 'default' ? 'Default' : 'Theme'))

const lightThemes = computed(() => THEMES.filter((t) => !t.dark))
const darkThemes = computed(() => THEMES.filter((t) => t.dark))

// Render only the first slice of the doc for a fast, representative preview.
const previewBody = computed(() => {
  const src = (props.previewMarkdown || '').slice(0, 1200).trim()
  const md = src || '# Heading\n\nThe quick brown fox jumps over the lazy dog.\n\n> A blockquote with `inline code`.\n\n```js\nconst x = 42\n```\n\n- List item one\n- List item two'
  return renderMarkdown(md)
})

let previewSeq = 0
async function showPreview(id) {
  hoverId.value = id
  emit('preview', id)
  const seq = ++previewSeq
  try {
    const css = await getThemeCss(id)
    if (seq !== previewSeq) return // a newer hover won
    previewHtml.value = buildThemedHtmlSync(previewBody.value, css)
  } catch {
    /* ignore — preview is best-effort */
  }
}

function clearPreview() {
  hoverId.value = ''
  previewHtml.value = ''
  emit('preview', null)
}

function choose(id) {
  model.value = id
  open.value = false
  clearPreview()
}

async function toggle() {
  open.value = !open.value
  if (open.value) { await nextTick(); positionPop() }
  else clearPreview()
}
function positionPop() {
  const el = triggerEl.value
  if (!el || typeof window === 'undefined') return
  const r = el.getBoundingClientRect()
  popStyle.value = {
    position: 'fixed',
    top: `${Math.round(r.bottom + 6)}px`,
    right: `${Math.round(Math.max(8, window.innerWidth - r.right))}px`,
    left: 'auto',
  }
}

// Warm the selected theme so the editor can paint immediately.
watch(model, (id) => { if (id && id !== 'default') getThemeCss(id) }, { immediate: true })

function onDocClick(e) {
  const inRoot = rootEl.value && rootEl.value.contains(e.target)
  const inPop = popEl.value && popEl.value.contains(e.target)
  if (!inRoot && !inPop) {
    open.value = false
    clearPreview()
  }
}
function onKeydown(e) {
  if (e.key === 'Escape') { open.value = false; clearPreview() }
}
watch(open, (v) => {
  if (v) { document.addEventListener('mousedown', onDocClick); document.addEventListener('keydown', onKeydown) }
  else { document.removeEventListener('mousedown', onDocClick); document.removeEventListener('keydown', onKeydown) }
})
onBeforeUnmount(() => { document.removeEventListener('mousedown', onDocClick); document.removeEventListener('keydown', onKeydown) })
</script>

<template>
  <div ref="rootEl" class="theme-picker">
    <button ref="triggerEl" type="button" class="tp-trigger" :aria-expanded="open" @click="toggle">
      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
        <path d="M8 1.5a6.5 6.5 0 1 0 0 13c.83 0 1.5-.67 1.5-1.5 0-.39-.15-.74-.39-1-.24-.27-.39-.62-.39-1 0-.83.67-1.5 1.5-1.5H12a3 3 0 0 0 3-3c0-3.31-3.13-5.5-7-5.5Z" fill="none" stroke="currentColor" stroke-width="1.2"/>
        <circle cx="5" cy="6.5" r="1" fill="currentColor"/>
        <circle cx="8" cy="5" r="1" fill="currentColor"/>
        <circle cx="11" cy="6.5" r="1" fill="currentColor"/>
      </svg>
      <span class="tp-trigger-label">{{ buttonLabel }}</span>
      <svg class="tp-caret" :class="{ up: open }" viewBox="0 0 12 12" width="10" height="10" aria-hidden="true">
        <path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </button>

    <Teleport to="body">
    <div v-if="open" ref="popEl" class="tp-pop" role="listbox" :style="popStyle">
      <div class="tp-list" @mouseleave="clearPreview">
        <button
          type="button" role="option" class="tp-item" :class="{ active: !model || model === 'default' }"
          :aria-selected="!model || model === 'default'"
          @mouseenter="clearPreview()" @click="choose('default')"
        >
          <span class="tp-swatch" aria-hidden="true" style="background: var(--surface-hover)"></span>
          <span class="tp-name">Default</span>
          <svg v-if="!model || model === 'default'" class="tp-check" viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
            <path d="M3 8.5 6.5 12 13 4.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
        <div class="tp-group-label">Light</div>
        <button
          v-for="t in lightThemes" :key="t.id" type="button" role="option"
          class="tp-item" :class="{ active: t.id === model, hover: t.id === hoverId }"
          :aria-selected="t.id === model"
          @mouseenter="showPreview(t.id)" @focus="showPreview(t.id)"
          @click="choose(t.id)"
        >
          <span class="tp-swatch light" aria-hidden="true"></span>
          <span class="tp-name">{{ t.name }}</span>
          <svg v-if="t.id === model" class="tp-check" viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
            <path d="M3 8.5 6.5 12 13 4.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>

        <div class="tp-group-label">Dark</div>
        <button
          v-for="t in darkThemes" :key="t.id" type="button" role="option"
          class="tp-item" :class="{ active: t.id === model, hover: t.id === hoverId }"
          :aria-selected="t.id === model"
          @mouseenter="showPreview(t.id)" @focus="showPreview(t.id)"
          @click="choose(t.id)"
        >
          <span class="tp-swatch dark" aria-hidden="true"></span>
          <span class="tp-name">{{ t.name }}</span>
          <svg v-if="t.id === model" class="tp-check" viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
            <path d="M3 8.5 6.5 12 13 4.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
      </div>

      <div class="tp-preview" :class="{ empty: !previewHtml }">
        <iframe
          v-if="previewHtml"
          class="tp-preview-frame"
          :srcdoc="previewHtml"
          sandbox="allow-same-origin"
          title="Theme preview"
          loading="lazy"
        ></iframe>
        <div v-else class="tp-preview-hint">Hover a theme to preview</div>
      </div>
    </div>
    </Teleport>
  </div>
</template>

<style scoped>
.theme-picker { position: relative; display: inline-block; font-family: var(--font-sans); }

.tp-trigger {
  display: inline-flex; align-items: center; gap: var(--space-2);
  height: 34px; padding: 0 var(--space-3);
  background: var(--surface); color: var(--text);
  border: 1px solid var(--border); border-radius: var(--radius-sm);
  font-size: 13px; font-weight: 500; cursor: pointer;
  transition: background var(--transition), border-color var(--transition);
}
.tp-trigger:hover { background: var(--surface-hover); border-color: var(--text-tertiary); }
.tp-trigger-label { max-width: 160px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tp-caret { color: var(--text-secondary); transition: transform var(--transition); }
.tp-caret.up { transform: rotate(180deg); }

.tp-pop {
  position: absolute; z-index: 600; top: calc(100% + 6px); right: 0;
  display: flex; gap: 0; max-width: 92vw;
  background: var(--surface); border: 1px solid var(--border);
  border-radius: var(--radius); box-shadow: var(--shadow-lg);
  overflow: hidden; animation: scaleIn 0.16s var(--ease-out);
  transform-origin: top right;
}

.tp-list {
  width: 220px; max-height: 340px; overflow-y: auto;
  padding: var(--space-2); border-right: 1px solid var(--border-light);
}
.tp-group-label {
  padding: var(--space-2) var(--space-2) var(--space-1);
  font-size: 11px; font-weight: 600; letter-spacing: 0.04em;
  text-transform: uppercase; color: var(--text-tertiary);
}
.tp-item {
  display: flex; align-items: center; gap: var(--space-2); width: 100%;
  padding: var(--space-2); border: none; background: transparent;
  border-radius: var(--radius-sm); cursor: pointer; text-align: left;
  color: var(--text); font-size: 13px; line-height: 1.2;
  transition: background var(--transition);
}
.tp-item:hover, .tp-item.hover, .tp-item:focus-visible { background: var(--surface-hover); outline: none; }
.tp-item.active { background: var(--accent-bg); color: var(--accent); font-weight: 600; }
.tp-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tp-check { color: var(--accent); flex: none; }
.tp-swatch {
  flex: none; width: 14px; height: 14px; border-radius: 4px;
  border: 1px solid var(--border);
}
.tp-swatch.light { background: linear-gradient(135deg, #fafafa, #ececec); }
.tp-swatch.dark { background: linear-gradient(135deg, #2a2a30, #131316); border-color: #3a3a3c; }

.tp-preview {
  width: 280px; height: 340px; background: var(--bg);
  display: flex; align-items: center; justify-content: center;
}
.tp-preview-frame { width: 100%; height: 100%; border: 0; background: #fff; }
.tp-preview-hint, .tp-preview.empty .tp-preview-hint {
  color: var(--text-tertiary); font-size: 12px; padding: var(--space-4); text-align: center;
}

@media (max-width: 560px) {
  .tp-preview { display: none; }
  .tp-list { border-right: none; }
}
</style>
