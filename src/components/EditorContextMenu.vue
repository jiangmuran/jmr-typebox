<script setup>
import { computed } from 'vue'
import { useI18n } from '../composables/useI18n'
import { EDITOR_PLUGINS, PLUGIN_GROUPS } from '../tools/text/plugins'

defineProps({ show: Boolean, x: Number, y: Number, aiEnabled: Boolean })
const emit = defineEmits(['apply', 'apply-ai', 'close'])
const { locale, t } = useI18n()
const label = o => (locale.value === 'zh' ? o.zh : o.en)

const groups = computed(() => {
  const g = {}
  for (const p of EDITOR_PLUGINS) (g[p.group] ||= []).push(p)
  return Object.entries(g)
})

// AI selection actions surfaced in the right-click menu (when AI is enabled in Settings).
// These all REPLACE the selection in place; "explain" lives in the floating selection toolbar
// where it has a dedicated result popover.
const AI_ACTIONS = [
  { id: 'improve', scope: 'sel' },
  { id: 'polish', scope: 'sel' },
  { id: 'grammar', scope: 'sel' },
  { id: 'shorter', scope: 'sel' },
  { id: 'longer', scope: 'sel' },
]
</script>

<template>
  <template v-if="show">
    <div class="ctx-away" @click="emit('close')" @contextmenu.prevent="emit('close')" @wheel="emit('close')"></div>
    <div class="ctx" :style="{ left: x + 'px', top: y + 'px' }">
      <template v-if="aiEnabled">
        <div class="ctx-label ctx-ai-label">✨ {{ t('ai.menu') }}</div>
        <button v-for="a in AI_ACTIONS" :key="a.id" class="ctx-item ctx-ai-item" @click="emit('apply-ai', a)">{{ t('ai.act.' + a.id) }}</button>
        <div class="ctx-divider"></div>
      </template>
      <template v-for="[gid, plugins] in groups" :key="gid">
        <div class="ctx-label">{{ label(PLUGIN_GROUPS[gid]) }}</div>
        <button v-for="p in plugins" :key="p.id" class="ctx-item" @click="emit('apply', p)">{{ label(p) }}</button>
      </template>
    </div>
  </template>
</template>

<style scoped>
.ctx-away { position: fixed; inset: 0; z-index: 400; }
.ctx {
  position: fixed; z-index: 401; min-width: 180px; max-height: 70vh; overflow-y: auto;
  background: var(--surface); border: 1px solid var(--border-light); border-radius: 10px;
  box-shadow: var(--shadow-lg); padding: 5px; animation: ctxIn 0.12s var(--ease-out);
}
@keyframes ctxIn { from { opacity: 0; transform: scale(0.96); } to { opacity: 1; transform: scale(1); } }
.ctx-label { font-size: 10px; font-weight: 600; color: var(--text-tertiary); text-transform: uppercase; letter-spacing: 0.5px; padding: 6px 10px 3px; }
.ctx-item { display: block; width: 100%; text-align: left; padding: 6px 10px; border: none; border-radius: 6px; background: transparent; color: var(--text); font-size: 13px; font-family: var(--font-sans); cursor: pointer; }
.ctx-item:hover { background: var(--surface-hover); }
.ctx-ai-label { color: var(--accent); }
.ctx-ai-item { color: var(--text); }
.ctx-ai-item:hover { background: var(--accent-bg); }
.ctx-divider { height: 1px; background: var(--border-light); margin: 5px 6px; }
</style>
