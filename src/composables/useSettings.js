import { reactive, computed, watch, ref } from 'vue'
import { load, save } from '../utils/storage'

export const DEFAULT_SETTINGS = {
  theme: 'system',          // 'light' | 'dark' | 'system'
  accent: '',               // '' = use stylesheet default
  editorFont: '',           // '' = default mono stack
  editorFontSize: 15,
  editorLineHeight: 1.7,
  density: 'comfortable',   // 'comfortable' | 'compact'
  tabsVisible: ['markdown', 'image', 'media', 'python', 'tools'],
  tabsOrder: ['markdown', 'image', 'media', 'python', 'tools'],
  defaultTool: '/',
  restoreLast: true,
  writingTheme: 'default',
  exportTheme: 'inkwell',
  backendEnabled: true,
  // AI assistant (OpenAI-compatible /chat/completions). Keys are stored locally in the
  // browser; requests go to the configured endpoint (via the same-origin proxy by default).
  aiEnabled: false,
  aiBaseUrl: 'https://api.openai.com/v1',
  aiKey: '',
  aiModel: 'gpt-4o-mini',
  aiTemperature: 0.7,
  aiDirect: false,          // false = route through /api/ai proxy (beats CORS); true = call endpoint directly
  aiInlineComplete: true,   // enable ⌃Space "continue writing" in the editor
  // Image host (图床): pasting/dropping an image in the editor uploads it and inserts
  // ![name](url). Empty imageHostUrl = use the built-in same-origin /api/upload proxy (the
  // shared host's key stays a server secret). Set both to point at your own host (key stored
  // locally only). https://github.com/jiangmuran/user_files
  imageHostUrl: '',         // '' = built-in proxy; otherwise a direct upload endpoint
  imageHostKey: '',         // Bearer key for a custom host (local only; password field)
}

function hydrate() {
  try { return JSON.parse(load('settings') || '{}') } catch { return {} }
}

const settings = reactive({ ...structuredClone(DEFAULT_SETTINGS), ...hydrate() })

// One-time migration: surface the Toolbox tab for users whose saved settings predate it.
if (Array.isArray(settings.tabsOrder) && !settings.tabsOrder.includes('tools')) settings.tabsOrder.push('tools')
if (Array.isArray(settings.tabsVisible) && !settings.tabsVisible.includes('tools')) settings.tabsVisible.push('tools')

// Track the system color scheme so resolvedTheme reacts to it.
const systemDark = ref(false)
if (typeof window !== 'undefined' && window.matchMedia) {
  const mq = window.matchMedia('(prefers-color-scheme: dark)')
  systemDark.value = mq.matches
  mq.addEventListener?.('change', e => { systemDark.value = e.matches })
}

const resolvedTheme = computed(() =>
  settings.theme === 'system' ? (systemDark.value ? 'dark' : 'light') : settings.theme
)

let started = false
function start() {
  if (started) return
  started = true
  // Persist on any change (sync so it lands immediately).
  watch(settings, () => save('settings', JSON.stringify(settings)), { deep: true, flush: 'sync' })
  // Apply appearance to <html>.
  watch(
    [resolvedTheme, () => settings.accent, () => settings.density, () => settings.editorFont, () => settings.editorFontSize, () => settings.editorLineHeight],
    applyAppearance,
    { immediate: true }
  )
}

function applyAppearance() {
  if (typeof document === 'undefined') return
  const el = document.documentElement
  el.dataset.theme = resolvedTheme.value
  el.dataset.density = settings.density
  if (settings.accent) el.style.setProperty('--accent', settings.accent)
  else el.style.removeProperty('--accent')
  if (settings.editorFont) el.style.setProperty('--editor-font', settings.editorFont)
  else el.style.removeProperty('--editor-font')
  el.style.setProperty('--editor-font-size', settings.editorFontSize + 'px')
  el.style.setProperty('--editor-line-height', String(settings.editorLineHeight))
}

export function useSettings() {
  start()

  function setSetting(key, value) { settings[key] = value }
  function resetSettings() { Object.assign(settings, structuredClone(DEFAULT_SETTINGS)) }
  function clearAllData() {
    if (typeof localStorage !== 'undefined') {
      const keys = []
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)
        if (k && k.startsWith('tb-')) keys.push(k)
      }
      keys.forEach(k => localStorage.removeItem(k))
    }
    resetSettings()
  }

  return { settings, resolvedTheme, setSetting, resetSettings, clearAllData, applyAppearance }
}
