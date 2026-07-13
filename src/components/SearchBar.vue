<script setup>
import { ref, watch, onMounted, nextTick } from 'vue'
import { useI18n } from '../composables/useI18n'

const { t } = useI18n()

const props = defineProps({
  editorRef: Object,
  content: String,
})

const emit = defineEmits(['update-content', 'close'])

const searchText = ref('')
const replaceText = ref('')
const matches = ref([])
const currentIdx = ref(-1)
const searchInputRef = ref(null)

function escapeRegex(str) { return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }

function performSearch() {
  const q = searchText.value
  matches.value = []
  currentIdx.value = -1
  if (!q || !props.content) return

  const re = new RegExp(escapeRegex(q), 'gi')
  let m
  while ((m = re.exec(props.content)) !== null) {
    matches.value.push({ start: m.index, end: m.index + m[0].length })
  }
  if (matches.value.length > 0) {
    currentIdx.value = 0
    highlightMatch()
  }
}

function highlightMatch() {
  if (currentIdx.value < 0 || !matches.value[currentIdx.value]) return
  const { start, end } = matches.value[currentIdx.value]
  const el = props.editorRef
  if (!el) return
  el.focus()
  el.setSelectionRange(start, end)
}

function next() {
  if (!matches.value.length) return
  currentIdx.value = (currentIdx.value + 1) % matches.value.length
  highlightMatch()
}

function prev() {
  if (!matches.value.length) return
  currentIdx.value = (currentIdx.value - 1 + matches.value.length) % matches.value.length
  highlightMatch()
}

function replaceOne() {
  if (currentIdx.value < 0 || !matches.value[currentIdx.value]) return
  const { start, end } = matches.value[currentIdx.value]
  const el = props.editorRef
  if (!el) return
  el.focus()
  el.setSelectionRange(start, end)
  el.setRangeText(replaceText.value, start, end, 'end')
  emit('update-content', el.value)
  performSearch()
}

function replaceAllMatches() {
  const q = searchText.value
  if (!q) return
  const count = matches.value.length
  const re = new RegExp(escapeRegex(q), 'g')
  const el = props.editorRef
  if (!el) return
  el.value = el.value.replace(re, replaceText.value)
  emit('update-content', el.value)
  performSearch()
}

function onSearchKeydown(e) {
  if (e.key === 'Enter') { e.shiftKey ? prev() : next() }
  if (e.key === 'Escape') emit('close')
}

function onReplaceKeydown(e) {
  if (e.key === 'Enter') replaceOne()
  if (e.key === 'Escape') emit('close')
}

watch(searchText, performSearch)
watch(() => props.content, performSearch)

onMounted(async () => {
  await nextTick()
  // Pre-fill with selection
  const el = props.editorRef
  if (el) {
    const sel = el.value.substring(el.selectionStart, el.selectionEnd)
    if (sel) searchText.value = sel
  }
  searchInputRef.value?.focus()
})
</script>

<template>
  <div class="search-bar">
    <div class="search-field">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
        <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
      </svg>
      <input
        ref="searchInputRef"
        v-model="searchText"
        type="text"
        :placeholder="t('search.find')"
        :aria-label="t('search.findAria')"
        @keydown="onSearchKeydown"
      >
      <span class="search-count" role="status" aria-live="polite">
        {{ matches.length > 0 ? `${currentIdx + 1} / ${matches.length}` : (searchText ? t('search.noResults') : '') }}
      </span>
    </div>

    <div class="search-btns">
      <button @click="prev" :title="t('search.previous')" :aria-label="t('search.previous')">&#9650;</button>
      <button @click="next" :title="t('search.next')" :aria-label="t('search.next')">&#9660;</button>
    </div>

    <div class="replace-field">
      <input
        v-model="replaceText"
        type="text"
        :placeholder="t('search.replace')"
        :aria-label="t('search.replaceAria')"
        @keydown="onReplaceKeydown"
      >
      <button @click="replaceOne">{{ t('search.replaceBtn') }}</button>
      <button @click="replaceAllMatches">{{ t('search.replaceAll') }}</button>
    </div>

    <div class="search-btns">
      <button @click="emit('close')" :title="t('search.close')" :aria-label="t('search.close')">&times;</button>
    </div>
  </div>
</template>

<style scoped>
.search-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: var(--surface);
  border-bottom: 1px solid var(--border-light);
  flex-shrink: 0;
  animation: slideDown 0.25s cubic-bezier(0.16, 1, 0.3, 1);
}

@keyframes slideDown {
  from { opacity: 0; transform: translateY(-100%); }
  to { opacity: 1; transform: translateY(0); }
}

.search-field {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1;
  background: var(--surface-hover);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-sm);
  padding: 0 10px;
  transition: border-color var(--dur-1);
}

.search-field:focus-within { border-color: var(--accent); }
.search-field svg { width: 14px; height: 14px; color: var(--text-tertiary); flex-shrink: 0; }

.search-field input {
  flex: 1;
  border: none;
  background: transparent;
  font-size: 13px;
  font-family: var(--font-sans);
  color: var(--text);
  padding: 6px 0;
  outline: none;
  min-width: 60px;
}

.search-count { font-size: 11px; color: var(--text-tertiary); white-space: nowrap; flex-shrink: 0; }

.search-btns { display: flex; gap: 2px; flex-shrink: 0; }

.search-btns button {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 14px;
  transition: all var(--dur-1);
}

.search-btns button:hover { background: var(--surface-hover); }

.replace-field {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1;
}

.replace-field input {
  flex: 1;
  border: 1px solid var(--border-light);
  background: var(--surface-hover);
  border-radius: var(--radius-sm);
  font-size: 13px;
  font-family: var(--font-sans);
  color: var(--text);
  padding: 6px 10px;
  outline: none;
  min-width: 60px;
  transition: border-color var(--dur-1);
}

.replace-field input:focus { border-color: var(--accent); }

.replace-field button {
  padding: 5px 10px;
  border: 1px solid var(--border-light);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--text);
  font-size: 12px;
  font-family: var(--font-sans);
  cursor: pointer;
  white-space: nowrap;
  transition: all var(--dur-1);
}

.replace-field button:hover { background: var(--surface-hover); }

@media (max-width: 480px) {
  .search-bar { flex-wrap: wrap; }
  .replace-field { width: 100%; }
}
</style>
