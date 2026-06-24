import { ViteSSG } from 'vite-ssg'
import App from './App.vue'
import { routes } from './router/routes'
import { registerFeatures } from './features/index.js'
import { useSettings } from './composables/useSettings'
import { load, save } from './utils/storage'
import './styles/global.css'
import './styles/tool-kit.css'

// vite-ssg@28 auto-installs unhead (useHead:true) with @unhead/vue v2 (its bundled dep).
// Pages call useHead()/useRouteHead() and share this head context. Do NOT call createHead() here.
export const createApp = ViteSSG(App, { routes }, ({ app, router }) => {
  registerFeatures() // Phase 1 suites register their commands here

  // Remember last position: save the route on each navigation, and (if enabled) resume it
  // when the user lands on the root. Client-only; never runs during SSG prerender.
  if (typeof window !== 'undefined') {
    router.afterEach(to => save('last', to.path))
    router.isReady().then(() => {
      try {
        const { settings } = useSettings()
        const last = load('last')
        if (settings.restoreLast && router.currentRoute.value.path === '/' && last && last !== '/') {
          router.replace(last)
        }
      } catch { /* ignore */ }
    })
  }
})
