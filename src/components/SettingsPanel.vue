<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { useSettings } from '../composables/useSettings'
import { useI18n } from '../composables/useI18n'
import BackendInfo from './BackendInfo.vue'
import AiInfo from './AiInfo.vue'

const open = defineModel('open', { default: false })
const { settings, setSetting, resetSettings, clearAllData } = useSettings()
const { t, locale, setLocale } = useI18n()

const THEMES = ['light', 'dark', 'system']
const DENSITIES = ['comfortable', 'compact']
// Curated, understated palette (the empty default = the dark-gold theme accent).
const ACCENTS = ['', '#9c6b3a', '#2d7d7d', '#3f5b9e', '#8c3b4a', '#5a7d45', '#5a6478']
const TOOLS = [
  { id: 'markdown', path: '/' },
  { id: 'image', path: '/image/compress' },
  { id: 'media', path: '/media/mp3-to-wav' },
  { id: 'python', path: '/python' },
  { id: 'tools', path: '/tools/base64' },
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

// AI: reveal the key field on demand (it's a password input otherwise).
const showKey = ref(false)
// Image host: same reveal toggle for the custom-host upload key.
const showImgKey = ref(false)

// Allow any part of the app (e.g. the AI panel's "Open Settings" CTA) to open this drawer
// and focus the AI section via a global event, without prop-drilling.
function onOpenRequest(e) {
  open.value = true
  if (e?.detail?.section === 'ai') setSetting('aiEnabled', settings.aiEnabled) // no-op; ensures section renders
}
onMounted(() => { if (typeof window !== 'undefined') window.addEventListener('tb-open-settings', onOpenRequest) })
onUnmounted(() => { if (typeof window !== 'undefined') window.removeEventListener('tb-open-settings', onOpenRequest) })
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

          <!-- AI assistant -->
          <section>
            <h3><span class="lbl">{{ t('settings.ai') }} <AiInfo /></span></h3>
            <label class="row"><span class="lbl">{{ t('settings.aiEnabled') }}</span>
              <input type="checkbox" :checked="settings.aiEnabled" @change="setSetting('aiEnabled', $event.target.checked)">
            </label>
            <template v-if="settings.aiEnabled">
              <label class="row col">{{ t('settings.aiBaseUrl') }}
                <input class="text-in" type="text" spellcheck="false" autocomplete="off" :value="settings.aiBaseUrl" :placeholder="'https://api.openai.com/v1'" @input="setSetting('aiBaseUrl', $event.target.value)">
              </label>
              <label class="row col">{{ t('settings.aiKey') }}
                <span class="key-wrap">
                  <input class="text-in" :type="showKey ? 'text' : 'password'" spellcheck="false" autocomplete="off" :value="settings.aiKey" placeholder="sk-..." @input="setSetting('aiKey', $event.target.value)">
                  <button type="button" class="key-eye" :title="showKey ? t('settings.aiKeyHide') : t('settings.aiKeyShow')" @click="showKey = !showKey">
                    <svg v-if="showKey" width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M2 2.5l11.5 11.5"/><path d="M6.3 6.4a2 2 0 0 0 2.8 2.8"/><path d="M5 3.6A6.6 6.6 0 0 1 8 3c3.6 0 5.9 3.2 6.5 5-.2.7-.7 1.6-1.5 2.4M3.2 5.2C2.1 6.1 1.6 7.2 1.5 8c.6 1.8 2.9 5 6.5 5 .8 0 1.6-.2 2.3-.5"/></svg>
                    <svg v-else width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M1.5 8S4 3 8 3s6.5 5 6.5 5-2.5 5-6.5 5S1.5 8 1.5 8z"/><circle cx="8" cy="8" r="2"/></svg>
                  </button>
                </span>
              </label>
              <label class="row col">{{ t('settings.aiModel') }}
                <input class="text-in" type="text" spellcheck="false" autocomplete="off" :value="settings.aiModel" placeholder="gpt-4o-mini" @input="setSetting('aiModel', $event.target.value)">
              </label>
              <label class="row col">{{ t('settings.aiTemperature') }}: {{ settings.aiTemperature }}
                <input type="range" min="0" max="2" step="0.1" :value="settings.aiTemperature" @input="setSetting('aiTemperature', +$event.target.value)">
              </label>
              <label class="row"><span class="lbl">{{ t('settings.aiInlineComplete') }}</span>
                <input type="checkbox" :checked="settings.aiInlineComplete" @change="setSetting('aiInlineComplete', $event.target.checked)">
              </label>
              <label class="row"><span class="lbl">{{ t('settings.aiDirect') }}</span>
                <input type="checkbox" :checked="settings.aiDirect" @change="setSetting('aiDirect', $event.target.checked)">
              </label>
              <p class="ai-hint">{{ settings.aiDirect ? t('settings.aiDirectHint') : t('settings.aiProxyHint') }}</p>
            </template>
          </section>

          <!-- Image host (图床) -->
          <section>
            <h3>{{ t('settings.imageHost') }}</h3>
            <p class="ai-hint hint-lead">{{ t('settings.imageHostHint') }}</p>
            <label class="row col">{{ t('settings.imageHostUrl') }}
              <input class="text-in" type="text" spellcheck="false" autocomplete="off" :value="settings.imageHostUrl" placeholder="https://files.example.com/api/upload" @input="setSetting('imageHostUrl', $event.target.value)">
            </label>
            <label class="row col" v-if="settings.imageHostUrl.trim()">{{ t('settings.imageHostKey') }}
              <span class="key-wrap">
                <input class="text-in" :type="showImgKey ? 'text' : 'password'" spellcheck="false" autocomplete="off" :value="settings.imageHostKey" placeholder="••••••••" @input="setSetting('imageHostKey', $event.target.value)">
                <button type="button" class="key-eye" :title="showImgKey ? t('settings.aiKeyHide') : t('settings.aiKeyShow')" @click="showImgKey = !showImgKey">
                  <svg v-if="showImgKey" width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M2 2.5l11.5 11.5"/><path d="M6.3 6.4a2 2 0 0 0 2.8 2.8"/><path d="M5 3.6A6.6 6.6 0 0 1 8 3c3.6 0 5.9 3.2 6.5 5-.2.7-.7 1.6-1.5 2.4M3.2 5.2C2.1 6.1 1.6 7.2 1.5 8c.6 1.8 2.9 5 6.5 5 .8 0 1.6-.2 2.3-.5"/></svg>
                  <svg v-else width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M1.5 8S4 3 8 3s6.5 5 6.5 5-2.5 5-6.5 5S1.5 8 1.5 8z"/><circle cx="8" cy="8" r="2"/></svg>
                </button>
              </span>
            </label>
            <p class="ai-hint">{{ t('settings.imageHostDefaultHint') }}</p>
            <a class="ghost about-link img-repo" href="https://github.com/jiangmuran/user_files" target="_blank" rel="noopener">{{ t('settings.imageHostRepo') }} →</a>
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
.seg button { flex: 1; padding: 7px 8px; border: none; border-radius: 5px; font-size: 12px; font-weight: 500; background: transparent; color: var(--text-secondary); cursor: pointer; font-family: var(--font-sans); white-space: nowrap; }
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

.text-in { width: 100%; padding: 7px 9px; border: 1px solid var(--border-light); border-radius: 7px; background: var(--surface); color: var(--text); font-size: 12px; font-family: var(--font-mono); outline: none; transition: border-color 0.15s; }
.text-in:focus { border-color: var(--accent); }
.key-wrap { position: relative; display: flex; }
.key-wrap .text-in { padding-right: 34px; }
.key-eye { position: absolute; right: 4px; top: 50%; transform: translateY(-50%); width: 26px; height: 26px; border: none; background: transparent; cursor: pointer; font-size: 13px; border-radius: 6px; line-height: 1; }
.key-eye:hover { background: var(--surface-hover); }
.ai-hint { font-size: 11px; color: var(--text-tertiary); line-height: 1.5; margin-top: -4px; }
.hint-lead { margin-top: 0; margin-bottom: 12px; }
.img-repo { margin-top: 10px; font-size: 12px; }

.drawer-enter-active .drawer, .drawer-leave-active .drawer { transition: transform 0.28s var(--ease-out); }
.drawer-enter-active .drawer-scrim, .drawer-leave-active .drawer-scrim { transition: opacity 0.28s ease; }
.drawer-enter-from .drawer, .drawer-leave-to .drawer { transform: translateX(100%); }
.drawer-enter-from .drawer-scrim, .drawer-leave-to .drawer-scrim { opacity: 0; }
</style>
