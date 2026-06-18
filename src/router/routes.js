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

// Phase 0 routes every path to ToolStub (renders correct SEO <head> + H1).
// Task 4 / Phase 1 swap individual paths to their real page components.
export const routes = ALL_PATHS.map(path => ({
  path,
  name: path === '/' ? 'home' : path.replace(/^\//, '').replace(/\//g, '-'),
  component: () => import('../pages/ToolStub.vue'),
  meta: { tab: tabOf(path), path },
}))
