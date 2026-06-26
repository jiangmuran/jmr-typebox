<script setup>
// Renders its slot only after client mount, so interactive tools that touch
// window/document don't run during SSG prerender. SEO head/H1 live outside this.
import { ref, onMounted } from 'vue'
const mounted = ref(false)
onMounted(() => { mounted.value = true })
</script>

<template>
  <slot v-if="mounted" />
  <slot v-else name="fallback" />
</template>
