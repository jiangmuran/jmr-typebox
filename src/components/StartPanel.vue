<script setup>
// Enticing home shown in the editor's empty state — feature cards (every top-level
// surface, including the converters and office viewer that used to be ⌘K-only),
// a start-writing action, the privacy promise, and the search hint.
import { useI18n } from '../composables/useI18n'
import { combo } from '../utils/platform'

const emit = defineEmits(['write'])
const { t } = useI18n()

const REPO_URL = 'https://github.com/jiangmuran/jmr-typebox'

const CARDS = [
  { id: 'txt', to: '/txt', icon: 'file' },
  { id: 'image', to: '/image/compress', icon: 'image' },
  { id: 'convert', to: '/convert/markdown-to-pdf', icon: 'convert' },
  { id: 'media', to: '/media/mp3-to-wav', icon: 'media' },
  { id: 'tools', to: '/tools/base64', icon: 'tools' },
  { id: 'python', to: '/python', icon: 'python' },
  { id: 'office', to: '/office', icon: 'office' },
]
</script>

<template>
  <div class="start">
    <div class="start-hero">
      <svg class="start-logo" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" class="logo-bg"/><path d="M9.5 11h13M16 11v12" class="logo-t" stroke-width="2.8" stroke-linecap="round" fill="none"/></svg>
      <h2>TypeBox</h2>
      <p class="tagline">{{ t('start.tagline') }}</p>
      <p class="privacy">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="7" width="10" height="7" rx="1.5"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2"/></svg>
        {{ t('privacy.note') }}
      </p>
      <button class="write-btn" @click="emit('write')">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11.5 1.5l3 3L5 14H2v-3z"/></svg>
        {{ t('start.write') }}
      </button>
    </div>

    <div class="start-or">{{ t('start.or') }}</div>
    <div class="start-grid">
      <router-link v-for="c in CARDS" :key="c.id" :to="c.to" class="start-card" data-card>
        <span class="card-ic">
          <svg v-if="c.icon==='file'" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M4 1.5h5l4 4V14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V2.5a1 1 0 0 1 1-1z"/><path d="M9 1.5V6h4.5"/></svg>
          <svg v-else-if="c.icon==='image'" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><rect x="1.5" y="2.5" width="13" height="11" rx="1.5"/><circle cx="5" cy="6" r="1.2"/><path d="M14.5 11l-4-3.5-3 2.5-2-1.5L1.5 11.5"/></svg>
          <svg v-else-if="c.icon==='convert'" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M2 5h9l-2.5-2.5M14 11H5l2.5 2.5"/></svg>
          <svg v-else-if="c.icon==='media'" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 11V3.5l8-1.5V9.5"/><circle cx="3.5" cy="11.5" r="1.8"/><circle cx="11.5" cy="9.5" r="1.8"/></svg>
          <svg v-else-if="c.icon==='tools'" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M10.5 2.5a3 3 0 0 0-4 4l-4.5 4.5 2 2L8.5 8.5a3 3 0 0 0 4-4l-2 2-1.5-.5-.5-1.5z"/></svg>
          <svg v-else-if="c.icon==='office'" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><rect x="1.5" y="2.5" width="13" height="11" rx="1.5"/><line x1="1.5" y1="6.5" x2="14.5" y2="6.5"/><line x1="6" y1="6.5" x2="6" y2="13.5"/></svg>
          <svg v-else viewBox="0 0 24 24" fill="currentColor"><path d="M14.25.18l.9.2.73.26.59.3.45.32.34.34.25.34.16.33.1.3.04.26.02.2-.01.13V8.5l-.05.63-.13.55-.21.46-.26.38-.3.31-.33.25-.35.19-.35.14-.33.1-.3.07-.26.04-.21.02H8.77l-.69.05-.59.14-.5.22-.41.27-.33.32-.27.35-.2.36-.15.37-.1.35-.07.32-.04.27-.02.21v3.06H3.17l-.21-.03-.28-.07-.32-.12-.35-.18-.36-.26-.36-.36-.35-.46-.32-.59-.28-.73-.21-.88-.14-1.05-.05-1.23.06-1.22.16-1.04.24-.87.32-.71.36-.57.4-.44.42-.33.42-.24.4-.16.36-.1.32-.05.24-.01h.16l.06.01h8.16v-.83H6.18l-.01-2.75-.02-.37.05-.34.11-.31.17-.28.25-.26.31-.23.38-.2.44-.18.51-.15.58-.12.64-.1.71-.06.77-.04.84-.02 1.27.05zm-6.3 1.98l-.23.33-.08.41.08.41.23.34.33.22.41.09.41-.09.33-.22.23-.34.08-.41-.08-.41-.23-.33-.33-.22-.41-.09-.41.09zm13.09 3.95l.28.06.32.12.35.18.36.27.36.35.35.47.32.59.28.73.21.88.14 1.04.05 1.23-.06 1.23-.16 1.04-.24.86-.32.71-.36.57-.4.45-.42.33-.42.24-.4.16-.36.09-.32.05-.24.02-.16-.01h-8.22v.82h5.84l.01 2.76.02.36-.05.34-.11.31-.17.29-.25.25-.31.24-.38.2-.44.17-.51.15-.58.13-.64.09-.71.07-.77.04-.84.01-1.27-.04-1.07-.14-.9-.2-.73-.25-.59-.3-.45-.33-.34-.34-.25-.34-.16-.33-.1-.3-.04-.25-.02-.2.01-.13v-5.34l.05-.64.13-.54.21-.46.26-.38.3-.32.33-.24.35-.2.35-.14.33-.1.3-.06.26-.04.21-.02.13-.01h5.84l.69-.05.59-.14.5-.21.41-.28.33-.32.27-.35.2-.36.15-.36.1-.35.07-.32.04-.28.02-.21V6.07h2.09l.14.01z"/></svg>
        </span>
        <strong>{{ t('tab.' + c.id) }}</strong>
        <span class="card-desc">{{ t('start.desc.' + c.id) }}</span>
      </router-link>
    </div>

    <div class="start-tip">
      <kbd>{{ combo('K') }}</kbd> {{ t('start.tip') }}
      <span class="tip-sep">·</span>
      <a class="repo-link" :href="REPO_URL" target="_blank" rel="noopener">
        GitHub
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 3.5h-3a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-3"/><path d="M9.5 2.5h4v4"/><line x1="7" y1="9" x2="13.2" y2="2.8"/></svg>
      </a>
    </div>
  </div>
</template>

<style scoped>
.start { max-width: 760px; margin: 0 auto; padding: 6vh 24px 40px; width: 100%; overflow-y: auto; animation: startIn 0.4s var(--ease-out); }
@keyframes startIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
.start-hero { text-align: center; margin-bottom: 32px; }
.start-logo { width: 44px; height: 44px; }
.logo-bg { fill: var(--text); }
.logo-t { stroke: var(--bg); }
.start-hero h2 { font-size: 26px; font-weight: 800; letter-spacing: -0.6px; margin-top: 12px; }
.tagline { color: var(--text-secondary); font-size: 14px; margin-top: 6px; }
.privacy { display: flex; align-items: center; justify-content: center; gap: 5px; color: var(--text-tertiary); font-size: 12px; margin-top: 8px; }
.privacy svg { width: 13px; height: 13px; flex-shrink: 0; }
.write-btn { display: inline-flex; align-items: center; gap: 7px; margin-top: 18px; padding: 9px 20px; border: none; border-radius: 10px; background: var(--text); color: var(--bg); font-size: 14px; font-weight: 600; font-family: var(--font-sans); cursor: pointer; transition: all 0.2s; }
.write-btn:hover { opacity: 0.9; transform: translateY(-1px); }
.write-btn svg { width: 14px; height: 14px; }
.start-or { text-align: center; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-tertiary); margin-bottom: 14px; }
/* Flex (not grid) so a short last row centers itself instead of leaving a hole. */
.start-grid { display: flex; flex-wrap: wrap; justify-content: center; gap: 12px; }
.start-card { flex: 0 1 168px; display: flex; flex-direction: column; align-items: flex-start; gap: 6px; padding: 16px; border: 1px solid var(--border-light); border-radius: 12px; background: var(--surface); text-decoration: none; color: var(--text); transition: all 0.22s var(--ease-out); }
.start-card:hover { border-color: var(--text-tertiary); transform: translateY(-2px); box-shadow: var(--shadow-md); }
.card-ic { display: flex; width: 30px; height: 30px; align-items: center; justify-content: center; border-radius: 8px; background: var(--surface-hover); color: var(--text); }
.card-ic svg { width: 16px; height: 16px; }
.start-card strong { font-size: 13px; font-weight: 650; }
.card-desc { font-size: 11px; color: var(--text-secondary); line-height: 1.4; }
.start-tip { display: flex; align-items: center; justify-content: center; margin-top: 28px; font-size: 12px; color: var(--text-tertiary); }
.start-tip kbd { font-family: var(--font-mono); background: var(--surface-hover); padding: 2px 6px; border-radius: 4px; margin-right: 4px; }
.tip-sep { margin: 0 8px; }
.repo-link { display: inline-flex; align-items: center; gap: 3px; color: var(--text-tertiary); text-decoration: none; }
.repo-link:hover { color: var(--text-secondary); text-decoration: underline; }
.repo-link svg { width: 11px; height: 11px; }
@media (max-width: 560px) { .start-card { flex: 1 1 40%; } }
</style>
