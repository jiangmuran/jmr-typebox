<script setup>
// Convert-page action button. Thin wrapper over the GLOBAL shared `.btn` kit
// (src/styles/tool-kit.css) — its old bespoke `.action-btn` styling was one of
// the drifted button copies and has been removed. Logic only lives here now:
// a busy spinner and the variant→shared-class mapping.
//
// variant: 'primary' renders the gold CTA (.btn.cta) because on every convert
// page the primary action IS the produce/download/print action — the single
// call-to-action per screen. 'secondary' renders the neutral bordered .btn.
import { computed } from 'vue'
const props = defineProps({
  variant: { type: String, default: 'secondary' },
  disabled: { type: Boolean, default: false },
  busy: { type: Boolean, default: false },
})
const cls = computed(() => (props.variant === 'primary' ? 'btn cta' : 'btn'))
</script>

<template>
  <button
    type="button"
    class="action-btn"
    :class="cls"
    :disabled="disabled || busy"
  >
    <span v-if="busy" class="ab-spinner"></span>
    <slot v-else name="icon" />
    <span class="ab-label"><slot /></span>
  </button>
</template>

<style scoped>
/* Visual styling comes from the global .btn / .btn.cta. Only the busy spinner
   is component-local. */
.ab-spinner { width: 14px; height: 14px; border: 2px solid currentColor; border-top-color: transparent; border-radius: 50%; opacity: 0.7; animation: abSpin 0.7s linear infinite; }
@keyframes abSpin { to { transform: rotate(360deg); } }
</style>
