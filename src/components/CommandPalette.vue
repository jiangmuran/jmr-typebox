<script setup>
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from '../composables/useI18n'
import { registerCommands, searchCommands } from '../composables/useCommands'
import { routes } from '../router/routes'
import { ROUTE_META } from '../router/meta'

const open = defineModel('open', { default: false })
const { t } = useI18n()
const router = useRouter()
const query = ref('')
const sel = ref(0)
const inputEl = ref(null)

const results = computed(() => searchCommands(query.value))

watch(open, async v => {
  if (v) { query.value = ''; sel.value = 0; await nextTick(); inputEl.value?.focus() }
})
watch(results, () => { sel.value = 0 })

function run(cmd) { if (!cmd) return; open.value = false; cmd.run?.() }

function onKey(e) {
  const mod = e.metaKey || e.ctrlKey
  // ⌘K (no shift) toggles the palette from anywhere.
  if (mod && !e.shiftKey && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); open.value = !open.value; return }
  if (!open.value) return
  if (e.key === 'ArrowDown') { e.preventDefault(); sel.value = Math.min(sel.value + 1, results.value.length - 1) }
  else if (e.key === 'ArrowUp') { e.preventDefault(); sel.value = Math.max(sel.value - 1, 0) }
  else if (e.key === 'Enter') { e.preventDefault(); run(results.value[sel.value]) }
  else if (e.key === 'Escape') { e.preventDefault(); open.value = false }
}

onMounted(() => {
  // Every route becomes a navigation command — new tools are findable automatically.
  // Skip routes marked inCommandPalette:false in ROUTE_META (e.g. /admin, which is auth-gated
  // and not meant to be discoverable by accident).
  registerCommands(routes.filter(r => !r.path.includes(':') && ROUTE_META[r.path]?.inCommandPalette !== false).map(r => ({
    id: 'nav:' + r.path,
    title: ROUTE_META[r.path]?.h1 || r.path,
    group: 'Navigate',
    keywords: ROUTE_META[r.path]?.keywords || '',
    run: () => router.push(r.path),
  })))
  window.addEventListener('keydown', onKey)
})
onUnmounted(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <Transition name="cmdk">
    <div v-if="open" class="cmdk-root" @click.self="open = false">
      <div class="cmdk-box" role="dialog" aria-modal="true">
        <div class="cmdk-search">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="7" cy="7" r="4.5"/><line x1="10.5" y1="10.5" x2="14" y2="14" stroke-linecap="round"/></svg>
          <input ref="inputEl" v-model="query" class="cmdk-input" :placeholder="t('cmdk.placeholder')" spellcheck="false" autocomplete="off" />
          <kbd>ESC</kbd>
        </div>
        <div class="cmdk-list">
          <button v-for="(c, i) in results" :key="c.id" class="cmdk-item" :class="{ sel: i === sel }" @click="run(c)" @mousemove="sel = i">
            <span class="cmdk-title">{{ c.title }}</span>
            <span class="cmdk-group">{{ c.group }}</span>
          </button>
          <div v-if="!results.length" class="cmdk-empty">{{ t('cmdk.empty') }}</div>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.cmdk-root { position: fixed; inset: 0; z-index: 600; display: flex; align-items: flex-start; justify-content: center; padding-top: 12vh; background: rgba(0,0,0,0.35); backdrop-filter: blur(3px); }
.cmdk-box { width: 560px; max-width: 92vw; max-height: 60vh; display: flex; flex-direction: column; background: var(--surface); border: 1px solid var(--border-light); border-radius: 14px; box-shadow: var(--shadow-lg); overflow: hidden; }
.cmdk-search { display: flex; align-items: center; gap: 10px; padding: 14px 16px; border-bottom: 1px solid var(--border-light); }
.cmdk-search svg { width: 16px; height: 16px; color: var(--text-tertiary); flex-shrink: 0; }
.cmdk-input { flex: 1; border: none; background: transparent; outline: none; font-size: 15px; color: var(--text); font-family: var(--font-sans); }
.cmdk-search kbd { font-size: 10px; color: var(--text-tertiary); background: var(--surface-hover); padding: 2px 6px; border-radius: 4px; }
.cmdk-list { overflow-y: auto; padding: 6px; }
.cmdk-item { display: flex; align-items: center; gap: 10px; width: 100%; padding: 9px 12px; border: none; border-radius: 8px; background: transparent; color: var(--text); font-size: 13px; font-family: var(--font-sans); cursor: pointer; text-align: left; }
.cmdk-item.sel { background: var(--surface-hover); }
.cmdk-title { flex: 1; }
.cmdk-group { font-size: 10px; color: var(--text-tertiary); text-transform: uppercase; letter-spacing: 0.4px; }
.cmdk-empty { padding: 24px; text-align: center; color: var(--text-tertiary); font-size: 13px; }
.cmdk-enter-active, .cmdk-leave-active { transition: opacity 0.15s; }
.cmdk-enter-active .cmdk-box, .cmdk-leave-active .cmdk-box { transition: transform 0.18s var(--ease-out); }
.cmdk-enter-from, .cmdk-leave-to { opacity: 0; }
.cmdk-enter-from .cmdk-box, .cmdk-leave-to .cmdk-box { transform: scale(0.97) translateY(-8px); }
</style>
