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

const route = useRoute()
const { theme, toggleTheme } = useTheme()
const { toastMessage, toastVisible } = useToast()
const { locale, t, toggleLocale, setLocale } = useI18n()

// Top-level tabs → primary route for each group.
const TABS = [
  { id: 'markdown', to: '/', icon: 'edit' },
  { id: 'txt', to: '/txt', icon: 'file' },
  { id: 'image', to: '/image/compress', icon: 'image' },
  { id: 'convert', to: '/convert/markdown-to-pdf', icon: 'convert' },
  { id: 'media', to: '/media/mp3-to-wav', icon: 'media' },
  { id: 'tools', to: '/tools/base64', icon: 'tools' },
  { id: 'python', to: '/python', icon: 'python' },
]
const activeTab = computed(() => route.meta?.tab || 'markdown')

const isMobile = ref(false)
function handleResize() { isMobile.value = window.innerWidth <= 768 }
onMounted(() => { handleResize(); window.addEventListener('resize', handleResize) })
onUnmounted(() => window.removeEventListener('resize', handleResize))

const menuOpen = ref(false)
const settingsOpen = ref(false)
const paletteOpen = ref(false)
function closeMenu() { menuOpen.value = false }
function openSettings() { closeMenu(); settingsOpen.value = true }
function doPrint() { closeMenu(); if (typeof window !== 'undefined') window.print() }
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
        <router-link v-for="tb in TABS" :key="tb.id" :to="tb.to" :class="{ active: activeTab === tb.id }" :title="t('tab.' + tb.id)">
          <svg v-if="tb.icon==='edit'" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M11.5 1.5l3 3L5 14H2v-3z"/></svg>
          <svg v-else-if="tb.icon==='file'" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M4 1.5h5l4 4V14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V2.5a1 1 0 0 1 1-1z"/><path d="M9 1.5V6h4.5"/></svg>
          <svg v-else-if="tb.icon==='image'" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><rect x="1.5" y="2.5" width="13" height="11" rx="1.5"/><circle cx="5" cy="6" r="1.2"/><path d="M14.5 11l-4-3.5-3 2.5-2-1.5L1.5 11.5"/></svg>
          <svg v-else-if="tb.icon==='convert'" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M2 5h9l-2.5-2.5M14 11H5l2.5 2.5"/></svg>
          <svg v-else-if="tb.icon==='media'" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 11V3.5l8-1.5V9.5"/><circle cx="3.5" cy="11.5" r="1.8"/><circle cx="11.5" cy="9.5" r="1.8"/></svg>
          <svg v-else-if="tb.icon==='tools'" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M10.5 2.5a3 3 0 0 0-4 4l-4.5 4.5 2 2L8.5 8.5a3 3 0 0 0 4-4l-2 2-1.5-.5-.5-1.5z"/></svg>
          <svg v-else-if="tb.icon==='python'" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M8 1.5c-2 0-3 1-3 2.5V7h3M5 4.5H3.5C2 4.5 1.5 6 1.5 8s.5 3.5 2 3.5H5"/><path d="M8 14.5c2 0 3-1 3-2.5V9H8m3 2.5h1.5c1.5 0 2-1.5 2-3.5s-.5-3.5-2-3.5H11"/></svg>
          <span class="tab-text">{{ t('tab.' + tb.id) }}</span>
        </router-link>
      </nav>

      <div class="topbar-spacer"></div>

      <button class="topbar-btn" @click="paletteOpen = true" :title="t('cmdk.open') + ' (⌘K)'">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="7" cy="7" r="4.5"/><line x1="10.5" y1="10.5" x2="14" y2="14" stroke-linecap="round"/></svg>
      </button>

      <button class="topbar-btn lang-btn" @click="toggleLocale" :title="locale === 'zh' ? 'Switch to English' : '切换到中文'">
        <span>{{ locale === 'zh' ? 'EN' : '中' }}</span>
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
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="2"/><path d="M8 1.2v1.8M8 13v1.8M14.8 8H13M3 8H1.2M12.7 3.3l-1.3 1.3M4.6 11.4l-1.3 1.3M12.7 12.7l-1.3-1.3M4.6 4.6L3.3 3.3"/></svg>
      </button>
      <div class="dd-wrap">
        <button class="topbar-btn" @click="menuOpen = !menuOpen" title="Menu">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round">
            <line x1="2" y1="4" x2="14" y2="4"/><line x1="2" y1="8" x2="14" y2="8"/><line x1="2" y1="12" x2="14" y2="12"/>
          </svg>
        </button>
        <Transition name="dd">
          <div v-if="menuOpen" class="dd-menu">
            <button @click="doPrint()"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="3" y="8.5" width="10" height="5" rx="1"/><path d="M4 8.5V3.5a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v5"/></svg>{{ t('menu.print') }}</button>
            <div class="dd-sep"></div>
            <div class="dd-about">
              <strong>{{ t('menu.about.title') }}</strong> — {{ t('menu.about.desc') }}<br>
              {{ t('menu.about.privacy') }}<br>
              <a href="https://github.com/jiangmuran/jmr-typebox" target="_blank" rel="noopener">
                <svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z"/></svg>
                GitHub
              </a>
            </div>
          </div>
        </Transition>
      </div>
    </header>

    <div v-if="menuOpen" class="click-away" @click="closeMenu"></div>

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

.tool-tabs { display: flex; gap: 1px; background: var(--surface-hover); border-radius: 8px; padding: 3px; flex-shrink: 0; overflow-x: auto; }
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
  .topbar { padding: 4px 6px; height: 42px; gap: 3px; }
  .topbar-btn { width: 28px; height: 28px; }
  .topbar-btn svg { width: 14px; height: 14px; }
  .tab-text { display: none; }
  .tool-tabs a { padding: 5px 8px; }
  .tool-tabs a svg { width: 14px; height: 14px; }
}
@media (max-width: 420px) { .logo-name { display: none; } }
@media print { .topbar, .click-away { display: none !important; } }
</style>
