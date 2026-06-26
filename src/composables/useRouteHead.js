import { useRoute } from 'vue-router'
import { useHead } from '@unhead/vue'
import { ROUTE_META, SITE_ORIGIN } from '../router/meta'

// DRY per-route SEO head from ROUTE_META. Used by every page (ToolStub + real pages).
export function useRouteHead() {
  const route = useRoute()
  const path = route.meta?.path || route.path || '/'
  const m = ROUTE_META[path] || ROUTE_META['/']
  const canonical = `${SITE_ORIGIN}${path}`

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

  return { meta: m }
}
