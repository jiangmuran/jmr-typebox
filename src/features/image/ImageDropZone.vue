<script setup>
// Shared empty-state drop target used by every image page. Pure presentational —
// the parent owns the loading logic (useImageSource) and passes handlers down.
defineProps({
  title: { type: String, default: '' },
  hint: { type: String, default: '' },
  dragOver: { type: Boolean, default: false },
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
    <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">
      <rect x="4" y="8" width="40" height="32" rx="4"/>
      <circle cx="16" cy="20" r="4"/>
      <path d="M44 32l-12-10-10 8-6-4L4 34"/>
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
