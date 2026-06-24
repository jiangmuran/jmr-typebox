<script setup>
// The ONE shared AI glyph used everywhere AI is represented (context-menu label, toolbar AI
// button, AI panel header/empty state). A plain stroked SQUARE chat/speech bubble (Feather
// "message-square"). To swap the icon across the whole app, edit ONLY the <path> below — every
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
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </svg>
</template>

<style scoped>
.ai-icon { display: block; color: var(--accent); }
</style>
