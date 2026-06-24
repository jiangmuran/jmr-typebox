<script setup>
// The ONE shared AI glyph used everywhere AI is represented (context-menu label, toolbar AI
// button, AI panel header/empty state). A plain stroked chat/speech bubble (Feather
// "message-circle"). To swap the icon across the whole app, edit ONLY the <path> below — every
// surface picks it up from here.
//
// Stroked in currentColor so callers control the hue via `color` (we default to var(--accent)).
defineProps({ size: { type: [Number, String], default: 16 } })
</script>

<template>
  <svg
    class="ai-icon" :width="size" :height="size" viewBox="0 0 24 24"
    fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"
    aria-hidden="true"
  >
    <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
  </svg>
</template>

<style scoped>
.ai-icon { display: block; color: var(--accent); }
</style>
