// Build a sitemap.xml string from an origin + list of paths.
export function buildSitemap(origin, paths) {
  const urls = paths.map(p => `  <url><loc>${origin}${p}</loc></url>`).join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`
}
