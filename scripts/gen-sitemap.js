// Post-build: write dist/sitemap.xml from the route table. Run after `vite-ssg build`.
import { writeFileSync } from 'node:fs'
import { ALL_PATHS, SITE_ORIGIN } from '../src/router/meta.js'
import { buildSitemap } from '../src/utils/seo.js'

const origin = process.env.SITE_ORIGIN || SITE_ORIGIN
writeFileSync('dist/sitemap.xml', buildSitemap(origin, ALL_PATHS))
console.log(`sitemap.xml: ${ALL_PATHS.length} urls @ ${origin}`)
