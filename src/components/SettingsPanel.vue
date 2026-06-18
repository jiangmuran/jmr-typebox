<script setup>
import { useSettings } from '../composables/useSettings'
import { useI18n } from '../composables/useI18n'
import BackendInfo from './BackendInfo.vue'

const open = defineModel('open', { default: false })
const { settings, setSetting, resetSettings, clearAllData } = useSettings()
const { t, locale, setLocale } = useI18n()

const THEMES = ['light', 'dark', 'system']
const DENSITIES = ['comfortable', 'compact']
const ACCENTS = ['', '#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899']
const TOOLS = [
  { id: 'markdown', path: '/' },
  { id: 'image', path: '/image/compress' },
  { id: 'media', path: '/media/mp3-to-wav' },
  { id: 'python', path: '/python' },
]

function toggleTool(id) {
  const set = new Set(settings.tabsVisible)
  set.has(id) ? set.delete(id) : set.add(id)
  if (set.size === 0) return // keep at least one
  setSetting('tabsVisible', TOOLS.map(x => x.id).filter(x => set.has(x)))
}

function onClear() {
  if (confirm(t('menu.clearAllConfirm'))) { clearAllData(); location.reload() }
}

function doPrint() { if (typeof window !== 'undefined') window.print() }
const REPO = 'https://github.com/jiangmuran/jmr-typebox'
</script>

<template>
  <Transition name="drawer">
    <div v-if="open" class="drawer-root">
      <div class="drawer-scrim" @click="open = false"></div>
      <aside class="drawer" role="dialog" aria-modal="true">
        <header class="drawer-head">
          <h2>{{ t('settings.title') }}</h2>
          <button class="x-btn" @click="open = false" aria-label="Close">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><line x1="3" y1="3" x2="13" y2="13"/><line x1="13" y1="3" x2="3" y2="13"/></svg>
          </button>
        </header>

        <div class="drawer-body">
          <!-- Appearance -->
          <section>
            <h3>{{ t('settings.appearance') }}</h3>
            <label class="row">{{ t('settings.theme') }}
              <div class="seg">
                <button v-for="th in THEMES" :key="th" :class="{on: settings.theme===th}" @click="setSetting('theme', th)">{{ t('settings.theme.' + th) }}</button>
              </div>
            </label>
            <label class="row">{{ t('settings.accent') }}
              <div class="swatches">
                <button v-for="c in ACCENTS" :key="c||'default'" class="swatch" :class="{on: settings.accent===c}" :style="c ? { background: c } : {}" :title="c || t('settings.accent.default')" @click="setSetting('accent', c)">
                  <span v-if="!c" class="sw-default">A</span>
                </button>
              </div>
            </label>
            <label class="row">{{ t('settings.density') }}
              <div class="seg">
                <button v-for="d in DENSITIES" :key="d" :class="{on: settings.density===d}" @click="setSetting('density', d)">{{ t('settings.density.' + d) }}</button>
              </div>
            </label>
          </section>

          <!-- Editor -->
          <section>
            <h3>{{ t('settings.editor') }}</h3>
            <label class="row col">{{ t('settings.fontSize') }}: {{ settings.editorFontSize }}px
              <input type="range" min="12" max="22" step="1" :value="settings.editorFontSize" @input="setSetting('editorFontSize', +$event.target.value)">
            </label>
            <label class="row col">{{ t('settings.lineHeight') }}: {{ settings.editorLineHeight }}
              <input type="range" min="1.3" max="2.2" step="0.1" :value="settings.editorLineHeight" @input="setSetting('editorLineHeight', +$event.target.value)">
            </label>
          </section>

          <!-- Tools -->
          <section>
            <h3>{{ t('settings.tools') }}</h3>
            <div class="checks">
              <label v-for="tool in TOOLS" :key="tool.id" class="chk">
                <input type="checkbox" :checked="settings.tabsVisible.includes(tool.id)" @change="toggleTool(tool.id)">
                {{ t('tab.' + tool.id) }}
              </label>
            </div>
          </section>

          <!-- Behavior -->
          <section>
            <h3>{{ t('settings.behavior') }}</h3>
            <label class="row">{{ t('settings.defaultTool') }}
              <select :value="settings.defaultTool" @change="setSetting('defaultTool', $event.target.value)">
                <option v-for="tool in TOOLS" :key="tool.id" :value="tool.path">{{ t('tab.' + tool.id) }}</option>
              </select>
            </label>
            <label class="row">{{ t('settings.restoreLast') }}
              <input type="checkbox" :checked="settings.restoreLast" @change="setSetting('restoreLast', $event.target.checked)">
            </label>
          </section>

          <!-- Backend -->
          <section>
            <h3>{{ t('settings.backend') }}</h3>
            <label class="row"><span class="lbl">{{ t('settings.backendEnabled') }} <BackendInfo /></span>
              <input type="checkbox" :checked="settings.backendEnabled" @change="setSetting('backendEnabled', $event.target.checked)">
            </label>
          </section>

          <!-- Language -->
          <section>
            <h3>{{ t('settings.language') }}</h3>
            <div class="seg">
              <button :class="{on: locale==='en'}" @click="setLocale('en')">English</button>
              <button :class="{on: locale==='zh'}" @click="setLocale('zh')">中文</button>
            </div>
          </section>

          <!-- About -->
          <section>
            <h3>{{ t('menu.about.title') }}</h3>
            <p class="about-desc">{{ t('menu.about.desc') }} · {{ t('menu.about.privacy') }}</p>
            <div class="about-row">
              <button class="ghost" @click="doPrint">{{ t('menu.print') }}</button>
              <a class="ghost about-link" :href="REPO" target="_blank" rel="noopener">GitHub →</a>
            </div>
          </section>

          <!-- Danger -->
          <section>
            <h3 class="danger">{{ t('settings.danger') }}</h3>
            <button class="ghost" @click="resetSettings">{{ t('settings.reset') }}</button>
            <button class="danger-btn" @click="onClear">{{ t('menu.clearAll') }}</button>
          </section>
        </div>
      </aside>
    </div>
  </Transition>
</template>

<style scoped>
.drawer-root { position: fixed; inset: 0; z-index: 500; }
.drawer-scrim { position: absolute; inset: 0; background: rgba(0,0,0,0.35); backdrop-filter: blur(2px); }
.drawer { position: absolute; top: 0; right: 0; height: 100%; width: 340px; max-width: 90vw; background: var(--surface); border-left: 1px solid var(--border-light); box-shadow: var(--shadow-lg); display: flex; flex-direction: column; }
.drawer-head { display: flex; align-items: center; justify-content: space-between; padding: 16px 18px; border-bottom: 1px solid var(--border-light); flex-shrink: 0; }
.drawer-head h2 { font-size: 17px; font-weight: 700; }
.x-btn { width: 30px; height: 30px; display: flex; align-items: center; justify-content: center; border: none; border-radius: 8px; background: transparent; color: var(--text-secondary); cursor: pointer; }
.x-btn:hover { background: var(--surface-hover); }
.x-btn svg { width: 16px; height: 16px; }
.drawer-body { flex: 1; overflow-y: auto; padding: 8px 18px 32px; }
section { padding: 14px 0; border-bottom: 1px solid var(--border-light); }
section:last-child { border-bottom: none; }
h3 { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.6px; color: var(--text-tertiary); margin-bottom: 12px; }
h3.danger { color: #ff453a; }
.row { display: flex; align-items: center; justify-content: space-between; gap: 12px; font-size: 13px; color: var(--text); margin-bottom: 12px; }
.row:last-child { margin-bottom: 0; }
.row.col { flex-direction: column; align-items: stretch; gap: 8px; }
.lbl { display: inline-flex; align-items: center; gap: 6px; }
.seg { display: flex; gap: 1px; background: var(--surface-hover); border-radius: 7px; padding: 2px; }
.seg button { flex: 1; padding: 5px 8px; border: none; border-radius: 5px; font-size: 12px; font-weight: 500; background: transparent; color: var(--text-secondary); cursor: pointer; font-family: var(--font-sans); white-space: nowrap; }
.seg button.on { background: var(--surface); color: var(--text); box-shadow: var(--shadow-xs); }
.swatches { display: flex; gap: 6px; flex-wrap: wrap; }
.swatch { width: 24px; height: 24px; border-radius: 50%; border: 2px solid var(--border-light); cursor: pointer; display: flex; align-items: center; justify-content: center; background: var(--surface-hover); }
.swatch.on { border-color: var(--text); transform: scale(1.1); }
.sw-default { font-size: 11px; font-weight: 700; color: var(--text-secondary); }
input[type="range"] { width: 100%; accent-color: var(--accent); }
select { padding: 5px 8px; border: 1px solid var(--border-light); border-radius: 6px; background: var(--surface); color: var(--text); font-size: 12px; font-family: var(--font-sans); }
input[type="checkbox"] { width: 16px; height: 16px; accent-color: var(--accent); cursor: pointer; }
.checks { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.chk { display: flex; align-items: center; gap: 7px; font-size: 13px; cursor: pointer; }
.ghost { width: 100%; padding: 8px; margin-bottom: 8px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); color: var(--text); font-size: 13px; cursor: pointer; font-family: var(--font-sans); }
.ghost:hover { background: var(--surface-hover); }
.about-desc { font-size: 12px; color: var(--text-secondary); line-height: 1.5; margin-bottom: 10px; }
.about-row { display: flex; gap: 8px; }
.about-link { text-decoration: none; text-align: center; display: flex; align-items: center; justify-content: center; }
.danger-btn { width: 100%; padding: 8px; border: 1px solid rgba(255,69,58,0.3); border-radius: 8px; background: rgba(255,69,58,0.06); color: #ff453a; font-size: 13px; cursor: pointer; font-family: var(--font-sans); }
.danger-btn:hover { background: rgba(255,69,58,0.12); }

.drawer-enter-active .drawer, .drawer-leave-active .drawer { transition: transform 0.28s var(--ease-out); }
.drawer-enter-active .drawer-scrim, .drawer-leave-active .drawer-scrim { transition: opacity 0.28s ease; }
.drawer-enter-from .drawer, .drawer-leave-to .drawer { transform: translateX(100%); }
.drawer-enter-from .drawer-scrim, .drawer-leave-to .drawer-scrim { opacity: 0; }
</style>
