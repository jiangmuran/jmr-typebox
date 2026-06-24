<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRoute } from 'vue-router'
import { useTheme } from '../composables/useTheme'
import { useToast } from '../composables/useToast'
import { useI18n } from '../composables/useI18n'
import ToastNotification from './ToastNotification.vue'
import WelcomeDialog from './WelcomeDialog.vue'
import SettingsPanel from './SettingsPanel.vue'
import CommandPalette from './CommandPalette.vue'
import { useSettings } from '../composables/useSettings'

const route = useRoute()
const { theme, toggleTheme } = useTheme()
const { toastMessage, toastVisible } = useToast()
const { t, setLocale } = useI18n()
const { settings } = useSettings()

// Top-level tabs → primary route for each group.
// Editor-centric IA: only 4 top tabs. Convert/export, document import, and text tools
// live INSIDE the editor (+ right-click + ⌘K). Their /convert and /tools routes still
// exist for SEO + the command palette, just not as top-level tabs.
const TABS = [
  { id: 'markdown', to: '/', icon: 'edit' },
  { id: 'image', to: '/image/compress', icon: 'image' },
  { id: 'media', to: '/media/mp3-to-wav', icon: 'media' },
  { id: 'python', to: '/python', icon: 'python' },
  { id: 'tools', to: '/tools/base64', icon: 'tools' },
]
const activeTab = computed(() => route.meta?.tab || 'markdown')

// Tabs the user has chosen to show, in their chosen order (Settings → customization).
const visibleTabs = computed(() => {
  const order = settings.tabsOrder?.length ? settings.tabsOrder : TABS.map(t => t.id)
  const vis = new Set(settings.tabsVisible?.length ? settings.tabsVisible : TABS.map(t => t.id))
  const ordered = order.map(id => TABS.find(t => t.id === id)).filter(Boolean).filter(t => vis.has(t.id))
  return ordered.length ? ordered : TABS
})

const isMobile = ref(false)
function handleResize() { isMobile.value = window.innerWidth <= 768 }
onMounted(() => { handleResize(); window.addEventListener('resize', handleResize) })
onUnmounted(() => window.removeEventListener('resize', handleResize))

const settingsOpen = ref(false)
const paletteOpen = ref(false)
function openSettings() { settingsOpen.value = true }
</script>

<template>
  <div id="app-root">
    <header class="topbar">
      <router-link to="/" class="topbar-logo" :title="t('menu.about.title')">
        <svg class="logo-svg" viewBox="0 0 32 32">
          <rect width="32" height="32" rx="8" class="logo-bg" />
          <path d="M9.5 11h13M16 11v12" class="logo-t" stroke-width="2.8" stroke-linecap="round" fill="none" />
        </svg>
        <span v-if="!isMobile" class="logo-name">TypeBox</span>
      </router-link>

      <nav class="tool-tabs">
        <router-link v-for="tb in visibleTabs" :key="tb.id" :to="tb.to" :class="{ active: activeTab === tb.id }" :title="t('tab.' + tb.id)">
          <svg v-if="tb.icon==='edit'" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M11.5 1.5l3 3L5 14H2v-3z"/></svg>
          <svg v-else-if="tb.icon==='file'" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M4 1.5h5l4 4V14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V2.5a1 1 0 0 1 1-1z"/><path d="M9 1.5V6h4.5"/></svg>
          <svg v-else-if="tb.icon==='image'" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><rect x="1.5" y="2.5" width="13" height="11" rx="1.5"/><circle cx="5" cy="6" r="1.2"/><path d="M14.5 11l-4-3.5-3 2.5-2-1.5L1.5 11.5"/></svg>
          <svg v-else-if="tb.icon==='convert'" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M2 5h9l-2.5-2.5M14 11H5l2.5 2.5"/></svg>
          <svg v-else-if="tb.icon==='media'" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 11V3.5l8-1.5V9.5"/><circle cx="3.5" cy="11.5" r="1.8"/><circle cx="11.5" cy="9.5" r="1.8"/></svg>
          <svg v-else-if="tb.icon==='tools'" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M10.5 2.5a3 3 0 0 0-4 4l-4.5 4.5 2 2L8.5 8.5a3 3 0 0 0 4-4l-2 2-1.5-.5-.5-1.5z"/></svg>
          <svg v-else-if="tb.icon==='python'" class="tab-py" viewBox="0 0 24 24" fill="currentColor"><path d="M14.25.18l.9.2.73.26.59.3.45.32.34.34.25.34.16.33.1.3.04.26.02.2-.01.13V8.5l-.05.63-.13.55-.21.46-.26.38-.3.31-.33.25-.35.19-.35.14-.33.1-.3.07-.26.04-.21.02H8.77l-.69.05-.59.14-.5.22-.41.27-.33.32-.27.35-.2.36-.15.37-.1.35-.07.32-.04.27-.02.21v3.06H3.17l-.21-.03-.28-.07-.32-.12-.35-.18-.36-.26-.36-.36-.35-.46-.32-.59-.28-.73-.21-.88-.14-1.05-.05-1.23.06-1.22.16-1.04.24-.87.32-.71.36-.57.4-.44.42-.33.42-.24.4-.16.36-.1.32-.05.24-.01h.16l.06.01h8.16v-.83H6.18l-.01-2.75-.02-.37.05-.34.11-.31.17-.28.25-.26.31-.23.38-.2.44-.18.51-.15.58-.12.64-.1.71-.06.77-.04.84-.02 1.27.05zm-6.3 1.98l-.23.33-.08.41.08.41.23.34.33.22.41.09.41-.09.33-.22.23-.34.08-.41-.08-.41-.23-.33-.33-.22-.41-.09-.41.09zm13.09 3.95l.28.06.32.12.35.18.36.27.36.35.35.47.32.59.28.73.21.88.14 1.04.05 1.23-.06 1.23-.16 1.04-.24.86-.32.71-.36.57-.4.45-.42.33-.42.24-.4.16-.36.09-.32.05-.24.02-.16-.01h-8.22v.82h5.84l.01 2.76.02.36-.05.34-.11.31-.17.29-.25.25-.31.24-.38.2-.44.17-.51.15-.58.13-.64.09-.71.07-.77.04-.84.01-1.27-.04-1.07-.14-.9-.2-.73-.25-.59-.3-.45-.33-.34-.34-.25-.34-.16-.33-.1-.3-.04-.25-.02-.2.01-.13v-5.34l.05-.64.13-.54.21-.46.26-.38.3-.32.33-.24.35-.2.35-.14.33-.1.3-.06.26-.04.21-.02.13-.01h5.84l.69-.05.59-.14.5-.21.41-.28.33-.32.27-.35.2-.36.15-.36.1-.35.07-.32.04-.28.02-.21V6.07h2.09l.14.01z"/></svg>
          <span class="tab-text">{{ t('tab.' + tb.id) }}</span>
        </router-link>
      </nav>

      <div class="topbar-spacer"></div>

      <button class="topbar-btn" @click="paletteOpen = true" :title="t('cmdk.open') + ' (⌘K)'">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="7" cy="7" r="4.5"/><line x1="10.5" y1="10.5" x2="14" y2="14" stroke-linecap="round"/></svg>
      </button>

      <button class="topbar-btn" @click="toggleTheme" title="Toggle theme">
        <svg v-if="theme==='light'" class="theme-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round">
          <circle cx="8" cy="8" r="3.2"/><line x1="8" y1="1" x2="8" y2="2.5"/><line x1="8" y1="13.5" x2="8" y2="15"/>
          <line x1="2.9" y1="2.9" x2="4" y2="4"/><line x1="12" y1="12" x2="13.1" y2="13.1"/>
          <line x1="1" y1="8" x2="2.5" y2="8"/><line x1="13.5" y1="8" x2="15" y2="8"/>
          <line x1="2.9" y1="13.1" x2="4" y2="12"/><line x1="12" y1="4" x2="13.1" y2="2.9"/>
        </svg>
        <svg v-else class="theme-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round">
          <path d="M14 10.2A6.5 6.5 0 1 1 5.8 2a5 5 0 0 0 8.2 8.2z"/>
        </svg>
      </button>

      <button class="topbar-btn" @click="openSettings" :title="t('settings.open')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
      </button>
    </header>

    <main class="app-content">
      <router-view />
    </main>

    <SettingsPanel v-model:open="settingsOpen" />
    <CommandPalette v-model:open="paletteOpen" />
    <WelcomeDialog @set-locale="setLocale" />
    <ToastNotification :message="toastMessage" :visible="toastVisible" />
  </div>
</template>

<style scoped>
#app-root { display: flex; flex-direction: column; height: 100dvh; overflow: hidden; }

.topbar {
  display: flex; align-items: center; gap: 6px; padding: 6px 10px;
  background: var(--bar-bg);
  backdrop-filter: saturate(180%) blur(20px); -webkit-backdrop-filter: saturate(180%) blur(20px);
  border-bottom: 1px solid var(--border-light); z-index: 100; flex-shrink: 0; height: 46px;
}

.topbar-logo { display: flex; align-items: center; gap: 7px; flex-shrink: 0; text-decoration: none; color: inherit; }
.logo-svg { width: 26px; height: 26px; }
.logo-bg { fill: var(--text); transition: fill 0.5s var(--ease-out); }
.logo-t { stroke: var(--bg); transition: stroke 0.5s var(--ease-out); }
.logo-name { font-weight: 750; font-size: 14px; letter-spacing: -0.4px; }

.tool-tabs { display: flex; gap: 2px; background: var(--surface-hover); border-radius: 10px; padding: 3px; flex-shrink: 0; overflow-x: auto; }
.tool-tabs a {
  display: flex; align-items: center; gap: 4px; padding: 4px 10px; border: none; border-radius: 6px;
  background: transparent; color: var(--text-tertiary); font-size: 12px; font-weight: 500; cursor: pointer;
  transition: all 0.22s var(--ease-out); font-family: var(--font-sans); white-space: nowrap; text-decoration: none;
}
.tool-tabs a:hover { color: var(--text-secondary); }
.tool-tabs a.active { background: var(--surface); color: var(--text); box-shadow: var(--shadow-xs); }
.tool-tabs a svg { width: 13px; height: 13px; }

.topbar-spacer { flex: 1; }

.topbar-btn {
  width: 30px; height: 30px; display: flex; align-items: center; justify-content: center;
  border: none; border-radius: 6px; background: transparent; color: var(--text-secondary); cursor: pointer; transition: all 0.15s;
}
.topbar-btn:hover { background: var(--surface-hover); color: var(--text); }
.topbar-btn:active { transform: scale(0.88); }
.topbar-btn svg { width: 15px; height: 15px; }
.theme-icon { transition: transform 0.5s var(--ease-out); }
.topbar-btn:active .theme-icon { transform: rotate(180deg); }
.lang-btn span { font-size: 11px; font-weight: 700; letter-spacing: -0.3px; }

.dd-wrap { position: relative; }
.dd-menu {
  position: absolute; top: calc(100% + 6px); right: 0; min-width: 220px; max-height: 80vh; overflow-y: auto;
  background: var(--surface); border: 1px solid var(--border-light); border-radius: 12px; box-shadow: var(--shadow-lg); padding: 6px; z-index: 200;
}
.dd-menu button {
  display: flex; align-items: center; gap: 9px; width: 100%; padding: 7px 10px; border: none; border-radius: 7px;
  background: transparent; color: var(--text); font-size: 13px; font-family: var(--font-sans); cursor: pointer; text-align: left; transition: background 0.1s;
}
.dd-menu button:hover { background: var(--surface-hover); }
.dd-menu button.dd-danger { color: #ff453a; }
.dd-menu button.dd-danger:hover { background: rgba(255,69,58,0.08); }
.dd-menu button.dd-danger svg { color: #ff453a; }
.dd-menu button svg { width: 15px; height: 15px; flex-shrink: 0; color: var(--text-secondary); }
.dd-sep { height: 1px; background: var(--border-light); margin: 4px 6px; }
.dd-about { padding: 10px; font-size: 11px; color: var(--text-tertiary); line-height: 1.6; }
.dd-about strong { color: var(--text-secondary); font-weight: 600; }
.dd-about a { display: inline-flex; align-items: center; gap: 4px; color: var(--accent); text-decoration: none; margin-top: 4px; }
.dd-about a:hover { text-decoration: underline; }
.dd-about a svg { width: 12px; height: 12px; }
.dd-enter-active { transition: all 0.22s var(--ease-out); }
.dd-leave-active { transition: all 0.12s ease; }
.dd-enter-from, .dd-leave-to { opacity: 0; transform: scale(0.95) translateY(-4px); }
.click-away { position: fixed; inset: 0; z-index: 90; }

.app-content { flex: 1; min-height: 0; display: flex; flex-direction: column; overflow: hidden; }

@media (max-width: 768px) {
  .topbar { padding: 4px 6px; height: 46px; gap: 3px; }
  .topbar-btn { width: 34px; height: 34px; }
  .topbar-btn svg { width: 14px; height: 14px; }
  .tab-text { display: none; }
  .tool-tabs a { padding: 8px 8px; }
  .tool-tabs a svg { width: 14px; height: 14px; }
}
@media (max-width: 420px) { .logo-name { display: none; } }
@media print { .topbar, .click-away { display: none !important; } }
</style>
