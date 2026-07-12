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

  // Phase 3: admin route guard. /admin handles its own auth state machine (bind/login/dashboard)
  // so we DON'T redirect away when there's no session — but we DO hide the route from the command
  // palette navigation entries (filtered in useCommands). What we DO here: strip ?otp= from the
  // URL once consumed (handled inside AdminPage.vue itself).
  // Client-only; never runs during SSG prerender.
  if (typeof window !== 'undefined') {
    router.afterEach(to => {
      // /admin isn't the kind of route we want to "remember as last position" — otherwise users
      // landing on / next time would auto-resume into the admin surface.
      if (!to.path.startsWith('/admin')) save('last', to.path)
    })
    router.isReady().then(() => {
      try {
        const { settings } = useSettings()
        const last = load('last')
        if (settings.restoreLast && router.currentRoute.value.path === '/' && last && last !== '/') {
          router.replace(last)
        }
      } catch { /* ignore */ }
    })

    // PWA file handling: when the OS opens a .md/.txt with TypeBox (manifest file_handlers →
    // launchQueue), stage its text for the editor and route there. The editor consumes it on mount
    // or via the 'tb-handoff' re-check event.
    if ('launchQueue' in window && 'setConsumer' in window.launchQueue) {
      window.launchQueue.setConsumer(async (params) => {
        try {
          if (!params.files?.length) return
          const fileHandle = params.files[0]
          const file = await fileHandle.getFile()
          const text = await file.text()
          const { useHandoff } = await import('./composables/useHandoff')
          // Keep the handle so the editor can save edits straight back to the opened file.
          useHandoff().send(text, { kind: 'text', name: file.name, handle: fileHandle })
          if (router.currentRoute.value.path !== '/') await router.push('/')
          window.dispatchEvent(new CustomEvent('tb-handoff'))
        } catch { /* ignore */ }
      })
    }
  }
})
