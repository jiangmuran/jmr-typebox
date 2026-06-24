<script setup>
// Synced-lyrics panel for the music player. Parses the current track's raw .lrc / plain text
// (store.lyricsText) and renders one of three states: empty (with paste/drop affordance),
// synced (auto-scrolling, click-to-seek, highlighted active line) or plain text. Editing is a
// prefilled <textarea> persisted via store.setLyricsForCurrent(). DOM (scroll, file read) is only
// touched inside handlers / watchers so the parent can mount it without SSR worries.
import { ref, computed, watch, nextTick } from 'vue'
import { useI18n } from '../../composables/useI18n'
import { usePlayerStore } from './usePlayerStore'
import { parseLrc, activeLineIndex } from './lrc'

const { t } = useI18n()
const store = usePlayerStore()

// ---- parse current lyrics (re-runs whenever the raw text changes) ----
const parsed = computed(() => parseLrc(store.lyricsText.value || ''))
const hasLyrics = computed(() => !!(store.lyricsText.value || '').trim() && parsed.value.lines.length > 0)
const isSynced = computed(() => parsed.value.synced)

// Active line for the synced view — recomputed on every currentTime tick (cheap binary search).
const activeIndex = computed(() =>
  isSynced.value ? activeLineIndex(parsed.value.lines, store.currentTime.value, parsed.value.offset) : -1,
)

// ---- editor state ----
const editing = ref(false)
const draft = ref('')
function openEditor() {
  draft.value = store.lyricsText.value || ''
  editing.value = true
}
function cancelEditor() {
  editing.value = false
}
async function saveEditor() {
  await store.setLyricsForCurrent(draft.value)
  editing.value = false
}

// ---- click-to-seek (synced lines only) ----
function onLineClick(line) {
  if (!isSynced.value || line.time < 0) return
  store.seek(line.time + parsed.value.offset)
}

// ---- auto-scroll: keep the active line centred in the scroll container ----
const scrollEl = ref(null)
const lineEls = ref([])
function setLineRef(el, i) {
  if (el) lineEls.value[i] = el
  else delete lineEls.value[i]
}
watch(activeIndex, async (idx) => {
  if (idx < 0 || !isSynced.value) return
  await nextTick()
  const el = lineEls.value[idx]
  if (el && typeof el.scrollIntoView === 'function') {
    el.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }
})
// Reset cached line refs when the rendered set changes (track / sync-state switch).
watch(
  () => parsed.value.lines,
  () => { lineEls.value = [] },
)

// ---- drag & drop a .lrc / .txt file onto the panel ----
const dragOver = ref(false)
let dragDepth = 0
function onDragEnter(e) {
  if (!hasFiles(e)) return
  dragDepth += 1
  dragOver.value = true
}
function onDragOver(e) {
  if (!hasFiles(e)) return
  e.preventDefault()
  e.dataTransfer.dropEffect = 'copy'
}
function onDragLeave() {
  dragDepth = Math.max(0, dragDepth - 1)
  if (dragDepth === 0) dragOver.value = false
}
async function onDrop(e) {
  e.preventDefault()
  dragDepth = 0
  dragOver.value = false
  const file = e.dataTransfer?.files?.[0]
  if (!file) return
  try {
    const text = await file.text()
    await store.setLyricsForCurrent(text)
  } catch { /* unreadable file — ignore */ }
}
function hasFiles(e) {
  const types = e.dataTransfer?.types
  return types && Array.from(types).includes('Files')
}
</script>

<template>
  <div
    class="lyrics"
    @dragenter="onDragEnter"
    @dragover="onDragOver"
    @dragleave="onDragLeave"
    @drop="onDrop"
  >
    <!-- Drop overlay -->
    <div v-if="dragOver" class="drop-overlay">
      <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="7 10 12 15 17 10" />
        <line x1="12" y1="15" x2="12" y2="3" />
      </svg>
      <span>{{ t('media.lyrics.dropHere') }}</span>
    </div>

    <!-- Editor -->
    <div v-if="editing" class="editor">
      <textarea
        v-model="draft"
        class="editor-area"
        spellcheck="false"
        :placeholder="t('media.lyrics.placeholder')"
      ></textarea>
      <div class="editor-actions">
        <button type="button" class="btn ghost" @click="cancelEditor">{{ t('media.lyrics.cancel') }}</button>
        <button type="button" class="btn primary" @click="saveEditor">{{ t('media.lyrics.save') }}</button>
      </div>
    </div>

    <!-- Empty state -->
    <div v-else-if="!hasLyrics" class="empty">
      <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M9 18V5l12-2v13" />
        <circle cx="6" cy="18" r="3" />
        <circle cx="18" cy="16" r="3" />
      </svg>
      <p class="empty-title">{{ t('media.lyrics.none') }}</p>
      <p class="empty-sub">{{ t('media.lyrics.addHint') }}</p>
      <button type="button" class="btn primary" @click="openEditor">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="9" y1="15" x2="15" y2="15" />
          <line x1="12" y1="12" x2="12" y2="18" />
        </svg>
        <span>{{ t('media.lyrics.paste') }}</span>
      </button>
    </div>

    <!-- Lyrics body (synced or plain) -->
    <template v-else>
      <button type="button" class="edit-btn" :title="t('media.lyrics.edit')" :aria-label="t('media.lyrics.edit')" @click="openEditor">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
          <path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z" />
        </svg>
      </button>

      <!-- Synced -->
      <ol v-if="isSynced" ref="scrollEl" class="lines synced">
        <li
          v-for="(line, i) in parsed.lines"
          :key="i"
          :ref="(el) => setLineRef(el, i)"
          class="line"
          :class="{ active: i === activeIndex, dim: i !== activeIndex }"
          @click="onLineClick(line)"
        >
          <span class="line-text">{{ line.text || ' ' }}</span>
        </li>
      </ol>

      <!-- Plain text -->
      <div v-else class="lines plain">
        <p class="plain-note">{{ t('media.lyrics.plainNote') }}</p>
        <p v-for="(line, i) in parsed.lines" :key="i" class="plain-line">{{ line.text || ' ' }}</p>
      </div>
    </template>
  </div>
</template>

<style scoped>
.lyrics {
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  width: 100%;
  background: var(--surface);
  color: var(--text);
  font-family: var(--font-sans);
  overflow: hidden;
}

/* ---- empty state ---- */
.empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 32px 20px;
  text-align: center;
  color: var(--text-tertiary);
}
.empty > svg { color: var(--text-tertiary); opacity: 0.7; margin-bottom: 4px; }
.empty-title { margin: 0; font-size: 15px; font-weight: 600; color: var(--text-secondary); }
.empty-sub { margin: 0 0 12px; font-size: 13px; color: var(--text-tertiary); max-width: 30ch; line-height: 1.5; }

/* ---- buttons ---- */
.btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  min-height: 38px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--text);
  font-family: inherit;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.18s var(--ease-out), border-color 0.18s var(--ease-out), color 0.18s var(--ease-out);
}
.btn:hover { background: var(--surface-hover); }
.btn:active { background: var(--surface-active); }
.btn.primary {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--accent-text);
}
.btn.primary:hover { background: var(--accent-hover); border-color: var(--accent-hover); }
.btn.ghost { background: transparent; }
.btn.ghost:hover { background: var(--surface-hover); }

/* ---- edit affordance ---- */
.edit-btn {
  position: absolute;
  top: 10px;
  right: 10px;
  z-index: 2;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  padding: 0;
  border: 1px solid var(--border-light);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--text-secondary);
  cursor: pointer;
  transition: background 0.18s var(--ease-out), color 0.18s var(--ease-out), border-color 0.18s var(--ease-out);
}
.edit-btn:hover { background: var(--surface-hover); color: var(--text); border-color: var(--border); }

/* ---- line lists ---- */
.lines {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  margin: 0;
  list-style: none;
  -webkit-overflow-scrolling: touch;
}
.lines.synced {
  padding: 40% 16px;
  text-align: center;
}

.line {
  display: block;
  padding: 7px 8px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  color: var(--text-secondary);
  font-size: 15px;
  line-height: 1.45;
  overflow-wrap: break-word;
  word-break: break-word;
  font-variant-numeric: tabular-nums;
  transition: color 0.25s var(--ease-out), opacity 0.25s var(--ease-out), transform 0.25s var(--ease-out);
}
.line:hover { background: var(--surface-hover); }
.line.dim {
  color: var(--text-secondary);
  opacity: 0.5;
  font-size: 14px;
}
.line.active {
  color: var(--text);
  opacity: 1;
  font-size: 17px;
  font-weight: 600;
  transform: scale(1.02);
}
.line-text { display: inline-block; }

/* ---- plain text ---- */
.lines.plain {
  padding: 16px 18px 28px;
  text-align: left;
}
.plain-note {
  margin: 0 0 14px;
  font-size: 12px;
  color: var(--text-tertiary);
  font-style: italic;
}
.plain-line {
  margin: 0;
  padding: 3px 0;
  font-size: 15px;
  line-height: 1.6;
  color: var(--text);
  overflow-wrap: break-word;
  word-break: break-word;
}

/* ---- editor ---- */
.editor {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  padding: 14px;
  gap: 12px;
}
.editor-area {
  flex: 1;
  min-height: 0;
  width: 100%;
  box-sizing: border-box;
  resize: none;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg);
  color: var(--text);
  font-family: var(--font-mono);
  font-size: 13px;
  line-height: 1.6;
  outline: none;
  transition: border-color 0.18s var(--ease-out);
}
.editor-area:focus { border-color: var(--accent); }
.editor-area::placeholder { color: var(--text-tertiary); }
.editor-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

/* ---- drop overlay ---- */
.drop-overlay {
  position: absolute;
  inset: 8px;
  z-index: 5;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  border: 2px dashed var(--accent);
  border-radius: var(--radius-lg);
  background: var(--accent-bg);
  color: var(--accent);
  font-size: 14px;
  font-weight: 600;
  pointer-events: none;
}

@media (max-width: 420px) {
  .lines.synced { padding: 40% 10px; }
  .line { padding: 9px 8px; }
}
</style>
