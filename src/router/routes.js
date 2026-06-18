import { ALL_PATHS } from './meta'

// Owning top-level tab for a path (drives AppShell tab highlight + grouping).
export function tabOf(p) {
  if (p === '/') return 'markdown'
  if (p === '/txt') return 'txt'
  if (p.startsWith('/image')) return 'image'
  if (p.startsWith('/convert')) return 'convert'
  if (p.startsWith('/media')) return 'media'
  if (p.startsWith('/python')) return 'python'
  return 'tools'
}

// Existing, already-working tools keep their real component so the routing refactor
// does not regress functionality; not-yet-built routes use ToolStub (Phase 1 fills them in).
function componentFor(p) {
  if (p === '/') return () => import('../pages/EditorPage.vue')
  if (p === '/txt') return () => import('../pages/TxtPage.vue')
  if (p === '/convert/pdf-to-markdown') return () => import('../pages/PdfToMarkdownPage.vue')
  if (p === '/image/compress' || p === '/image/convert') return () => import('../pages/ImageLegacyPage.vue')
  if (p.startsWith('/tools/')) return () => import('../pages/ToolboxPage.vue')
  return () => import('../pages/ToolStub.vue')
}

export const routes = ALL_PATHS.map(path => ({
  path,
  name: path === '/' ? 'home' : path.replace(/^\//, '').replace(/\//g, '-'),
  component: componentFor(path),
  meta: { tab: tabOf(path), path },
}))
