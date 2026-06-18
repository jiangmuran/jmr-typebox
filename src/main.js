import { ViteSSG } from 'vite-ssg'
import App from './App.vue'
import { routes } from './router/routes'
import { registerFeatures } from './features/index.js'
import './styles/global.css'

// vite-ssg@28 auto-installs unhead (useHead:true) with @unhead/vue v2 (its bundled dep).
// Pages call useHead()/useRouteHead() and share this head context. Do NOT call createHead() here.
export const createApp = ViteSSG(App, { routes }, ({ app, router }) => {
  registerFeatures() // Phase 1 suites register their commands here
})
