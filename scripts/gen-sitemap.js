// Post-build: write dist/sitemap.xml from the route table. Run after `vite-ssg build`.
// Skips routes marked `noindex: true` in ROUTE_META (e.g. /admin — the auth-gated dashboard).
import { writeFileSync } from 'node:fs'
import { ALL_PATHS, SITE_ORIGIN, ROUTE_META } from '../src/router/meta.js'
import { buildSitemap } from '../src/utils/seo.js'

const origin = process.env.SITE_ORIGIN || SITE_ORIGIN
const indexed = ALL_PATHS.filter((p) => !ROUTE_META[p]?.noindex)
writeFileSync('dist/sitemap.xml', buildSitemap(origin, indexed))
console.log(`sitemap.xml: ${indexed.length} urls @ ${origin} (${ALL_PATHS.length - indexed.length} skipped)`)
