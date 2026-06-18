<script setup>
// Page for the /python route. The sr-only <h1> lives OUTSIDE <ClientOnly> so it is present in
// the SSG-prerendered HTML for SEO; the interactive playground (which touches pyodide/wasm/
// window) renders only after client mount.
import { useRouteHead } from '../../composables/useRouteHead'
import ClientOnly from '../../components/ClientOnly.vue'
import PythonPlayground from './PythonPlayground.vue'

const { meta: m } = useRouteHead()
</script>

<template>
  <div class="route-page">
    <h1 class="sr-only">{{ m.h1 }}</h1>
    <ClientOnly><PythonPlayground /></ClientOnly>
  </div>
</template>

<style scoped>
.route-page { flex: 1; display: flex; flex-direction: column; min-height: 0; overflow: auto; }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }
</style>
