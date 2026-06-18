<script setup>
import { useRouteHead } from '../composables/useRouteHead'
const { meta: m } = useRouteHead()
</script>

<template>
  <main class="tool-stub">
    <h1>{{ m.h1 }}</h1>
    <p>{{ m.description }}</p>
    <p class="stub-note">This tool is being built (Phase 1).</p>
  </main>
</template>

<style scoped>
.tool-stub { max-width: 640px; margin: 0 auto; padding: 48px 24px; }
.tool-stub h1 { font-size: 28px; font-weight: 700; letter-spacing: -0.5px; }
.tool-stub p { margin-top: 12px; color: var(--text-secondary); line-height: 1.6; }
.stub-note { font-size: 13px; color: var(--text-tertiary); }
</style>
