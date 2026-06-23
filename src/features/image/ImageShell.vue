<script setup>
// Shared page skeleton for every image tool. Guarantees an identical outer
// structure across Compress / Convert / Watermark / Edit so the four pages feel
// like one product: same route-page root, same sr-only <h1> (kept OUTSIDE
// <ClientOnly> for SEO/SSG prerender), same sub-tool nav, same header, and a
// single default slot for the interactive body (which therefore stays inside
// <ClientOnly> — no window/Canvas access during SSG).
//
// The shared `.img-ui` stylesheet is imported here once; because the root
// element carries the `img-ui` class, those (non-scoped) rules can only ever
// match inside an image page.
import ClientOnly from '../../components/ClientOnly.vue'
import ImageToolNav from './ImageToolNav.vue'
import './image-ui.css'

defineProps({
  h1: { type: String, default: '' },      // SEO heading (from route meta), rendered sr-only
  title: { type: String, default: '' },   // visible page title
  sub: { type: String, default: '' },     // visible page subtitle
  wide: { type: Boolean, default: false },// opt into the wider workbench (Watermark / Edit)
})
</script>

<template>
  <div class="img-ui route-page">
    <h1 class="sr-only">{{ h1 }}</h1>
    <ClientOnly>
      <main class="img-wrap" :class="{ wide }">
        <ImageToolNav />
        <header class="img-head">
          <h2>{{ title }}</h2>
          <p>{{ sub }}</p>
        </header>
        <slot />
      </main>
    </ClientOnly>
  </div>
</template>
