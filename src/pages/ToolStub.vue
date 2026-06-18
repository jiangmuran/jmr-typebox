<script setup>
import { useRoute } from 'vue-router'
import { useHead } from '@unhead/vue'
import { ROUTE_META, SITE_ORIGIN } from '../router/meta'

const route = useRoute()
const m = ROUTE_META[route.meta?.path] || ROUTE_META['/']
const canonical = `${SITE_ORIGIN}${route.meta?.path || '/'}`

useHead({
  title: m.title,
  meta: [
    { name: 'description', content: m.description },
    { name: 'keywords', content: m.keywords },
    { property: 'og:title', content: m.title },
    { property: 'og:description', content: m.description },
    { property: 'og:type', content: 'website' },
    { property: 'og:url', content: canonical },
    { name: 'twitter:card', content: 'summary_large_image' },
    { name: 'twitter:title', content: m.title },
    { name: 'twitter:description', content: m.description },
  ],
  link: [{ rel: 'canonical', href: canonical }],
  script: [{
    type: 'application/ld+json',
    children: JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'WebApplication',
      name: m.title,
      description: m.description,
      applicationCategory: 'Utility',
      operatingSystem: 'Any',
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    }),
  }],
})
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
