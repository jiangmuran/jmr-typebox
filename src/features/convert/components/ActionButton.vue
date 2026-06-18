<script setup>
// Shared action button for convert pages. variant: 'primary' | 'secondary'.
defineProps({
  variant: { type: String, default: 'secondary' },
  disabled: { type: Boolean, default: false },
  busy: { type: Boolean, default: false },
})
</script>

<template>
  <button
    type="button"
    class="action-btn"
    :class="variant"
    :disabled="disabled || busy"
  >
    <span v-if="busy" class="ab-spinner"></span>
    <slot v-else name="icon" />
    <span class="ab-label"><slot /></span>
  </button>
</template>

<style scoped>
.action-btn {
  display: inline-flex; align-items: center; gap: 8px;
  padding: 10px 18px; border-radius: 10px; border: 1px solid var(--border);
  background: var(--surface); color: var(--text);
  font-size: 13px; font-weight: 600; font-family: var(--font-sans);
  cursor: pointer; transition: all 0.15s;
}
.action-btn:hover:not(:disabled) { background: var(--surface-hover); }
.action-btn:active:not(:disabled) { transform: scale(0.98); }
.action-btn:disabled { opacity: 0.55; cursor: default; }
.action-btn.primary { background: var(--text); color: var(--bg); border-color: var(--text); }
.action-btn.primary:hover:not(:disabled) { opacity: 0.9; }
:deep(svg) { width: 16px; height: 16px; }
.ab-spinner { width: 14px; height: 14px; border: 2px solid currentColor; border-top-color: transparent; border-radius: 50%; opacity: 0.7; animation: abSpin 0.7s linear infinite; }
@keyframes abSpin { to { transform: rotate(360deg); } }
</style>
