import { ALL_PATHS } from './meta'
import { featureComponents } from '../features/index.js'

// Owning top-level tab for a path (drives AppShell tab highlight + grouping).
export function tabOf(p) {
  if (p === '/') return 'markdown'
  if (p === '/txt') return 'txt'
  if (p.startsWith('/image')) return 'image'
  if (p.startsWith('/convert')) return 'convert'
  if (p.startsWith('/media')) return 'media'
  if (p.startsWith('/python')) return 'python'
  // /admin has its own pseudo-tab — AppShell won't match any known nav tab, so no tab is
  // highlighted when on the admin surface (which is exactly what we want).
  if (p.startsWith('/admin')) return 'admin'
  return 'tools'
}

// Existing, already-working tools keep their real component so the routing refactor
// does not regress functionality; not-yet-built routes use ToolStub (Phase 1 fills them in).
function componentFor(p) {
  if (featureComponents[p]) return featureComponents[p] // Phase 1 feature pages override stubs/legacy
  if (p === '/') return () => import('../pages/EditorPage.vue')
  if (p === '/txt') return () => import('../pages/TxtPage.vue')
  if (p === '/convert/pdf-to-markdown') return () => import('../pages/PdfToMarkdownPage.vue')
  if (p === '/image/compress' || p === '/image/convert') return () => import('../pages/ImageLegacyPage.vue')
  if (p.startsWith('/tools/')) return () => import('../pages/ToolboxPage.vue')
  if (p === '/admin') return () => import('../pages/AdminPage.vue')
  return () => import('../pages/ToolStub.vue')
}

export const routes = [
  ...ALL_PATHS.map(path => ({
    path,
    name: path === '/' ? 'home' : path.replace(/^\//, '').replace(/\//g, '-'),
    component: componentFor(path),
    meta: { tab: tabOf(path), path },
  })),
  {
    path: '/w/:id',
    name: 'verify',
    component: () => import('../features/image/VerifyPage.vue'),
    meta: { tab: 'image', path: '/w' },
  },
  // Catch-all 404 — unknown paths previously rendered an empty shell. Excluded from SSG
  // prerender (path contains ':') and from the palette/route-count logic for the same reason.
  {
    path: '/:pathMatch(.*)*',
    name: 'not-found',
    component: () => import('../pages/NotFoundPage.vue'),
    // tab 'none' matches no top-nav id, so nothing highlights on a 404.
    meta: { tab: 'none', path: '/404' },
  },
]
