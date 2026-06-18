<script setup>
// Shared presentational drop target for the media pages. Parent owns the file logic
// (useMediaFile) and passes handlers + drag state down.
defineProps({
  title: { type: String, default: '' },
  hint: { type: String, default: '' },
  dragOver: { type: Boolean, default: false },
  icon: { type: String, default: 'audio' }, // 'audio' | 'video' | 'subtitle'
})
const emit = defineEmits(['pick', 'drop', 'dragover', 'dragleave'])
</script>

<template>
  <div
    class="drop-zone"
    :class="{ over: dragOver }"
    role="button"
    tabindex="0"
    @click="emit('pick')"
    @keydown.enter.prevent="emit('pick')"
    @keydown.space.prevent="emit('pick')"
    @dragover.prevent="emit('dragover', $event)"
    @dragleave="emit('dragleave', $event)"
    @drop.prevent="emit('drop', $event)"
  >
    <svg v-if="icon === 'video'" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">
      <rect x="4" y="10" width="40" height="28" rx="4"/>
      <path d="M20 18l10 6-10 6z"/>
    </svg>
    <svg v-else-if="icon === 'subtitle'" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">
      <rect x="4" y="10" width="40" height="28" rx="4"/>
      <line x1="11" y1="28" x2="23" y2="28"/>
      <line x1="27" y1="28" x2="37" y2="28"/>
      <line x1="11" y1="33" x2="19" y2="33"/>
    </svg>
    <svg v-else viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M18 30V12l20-4v18"/>
      <circle cx="14" cy="30" r="4"/>
      <circle cx="34" cy="26" r="4"/>
    </svg>
    <h3>{{ title }}</h3>
    <p>{{ hint }}</p>
  </div>
</template>

<style scoped>
.drop-zone {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  padding: 52px 40px; border: 2px dashed var(--border); border-radius: var(--radius-lg);
  background: var(--surface); cursor: pointer; text-align: center;
  transition: all 0.25s var(--ease-out); outline: none;
}
.drop-zone:hover, .drop-zone:focus-visible, .drop-zone.over {
  border-color: var(--accent); background: var(--accent-bg); transform: translateY(-2px);
}
.drop-zone svg { width: 48px; height: 48px; color: var(--text-tertiary); margin-bottom: 14px; }
.drop-zone h3 { font-size: 15px; font-weight: 600; margin-bottom: 4px; }
.drop-zone p { font-size: 13px; color: var(--text-secondary); }
</style>
