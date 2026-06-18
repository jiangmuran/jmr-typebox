<script setup>
// Enticing home shown in the editor's empty state — feature cards (auto-discoverable),
// a start-writing action, and the ⌘K hint. Tasteful, not flashy.
import { useI18n } from '../composables/useI18n'

const emit = defineEmits(['write'])
const { t } = useI18n()

const CARDS = [
  { id: 'txt', to: '/txt', icon: 'file' },
  { id: 'image', to: '/image/compress', icon: 'image' },
  { id: 'convert', to: '/convert/markdown-to-pdf', icon: 'convert' },
  { id: 'media', to: '/media/mp3-to-wav', icon: 'media' },
  { id: 'tools', to: '/tools/base64', icon: 'tools' },
  { id: 'python', to: '/python', icon: 'python' },
]
</script>

<template>
  <div class="start">
    <div class="start-hero">
      <svg class="start-logo" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" class="logo-bg"/><path d="M9.5 11h13M16 11v12" class="logo-t" stroke-width="2.8" stroke-linecap="round" fill="none"/></svg>
      <h2>TypeBox</h2>
      <p class="tagline">{{ t('start.tagline') }}</p>
      <button class="write-btn" @click="emit('write')">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11.5 1.5l3 3L5 14H2v-3z"/></svg>
        {{ t('start.write') }}
      </button>
    </div>

    <div class="start-grid">
      <router-link v-for="c in CARDS" :key="c.id" :to="c.to" class="start-card" data-card>
        <span class="card-ic">
          <svg v-if="c.icon==='file'" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M4 1.5h5l4 4V14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V2.5a1 1 0 0 1 1-1z"/><path d="M9 1.5V6h4.5"/></svg>
          <svg v-else-if="c.icon==='image'" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><rect x="1.5" y="2.5" width="13" height="11" rx="1.5"/><circle cx="5" cy="6" r="1.2"/><path d="M14.5 11l-4-3.5-3 2.5-2-1.5L1.5 11.5"/></svg>
          <svg v-else-if="c.icon==='convert'" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M2 5h9l-2.5-2.5M14 11H5l2.5 2.5"/></svg>
          <svg v-else-if="c.icon==='media'" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 11V3.5l8-1.5V9.5"/><circle cx="3.5" cy="11.5" r="1.8"/><circle cx="11.5" cy="9.5" r="1.8"/></svg>
          <svg v-else-if="c.icon==='tools'" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M10.5 2.5a3 3 0 0 0-4 4l-4.5 4.5 2 2L8.5 8.5a3 3 0 0 0 4-4l-2 2-1.5-.5-.5-1.5z"/></svg>
          <svg v-else viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M8 1.5c-2 0-3 1-3 2.5V7h3M5 4.5H3.5C2 4.5 1.5 6 1.5 8s.5 3.5 2 3.5H5"/><path d="M8 14.5c2 0 3-1 3-2.5V9H8m3 2.5h1.5c1.5 0 2-1.5 2-3.5s-.5-3.5-2-3.5H11"/></svg>
        </span>
        <strong>{{ t('tab.' + c.id) }}</strong>
        <span class="card-desc">{{ t('start.desc.' + c.id) }}</span>
      </router-link>
    </div>

    <div class="start-tip">
      <kbd>⌘K</kbd> {{ t('start.tip') }}
    </div>
  </div>
</template>

<style scoped>
.start { max-width: 720px; margin: 0 auto; padding: 6vh 24px 40px; width: 100%; overflow-y: auto; animation: startIn 0.4s var(--ease-out); }
@keyframes startIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
.start-hero { text-align: center; margin-bottom: 32px; }
.start-logo { width: 44px; height: 44px; }
.logo-bg { fill: var(--text); }
.logo-t { stroke: var(--bg); }
.start-hero h2 { font-size: 26px; font-weight: 800; letter-spacing: -0.6px; margin-top: 12px; }
.tagline { color: var(--text-secondary); font-size: 14px; margin-top: 6px; }
.write-btn { display: inline-flex; align-items: center; gap: 7px; margin-top: 18px; padding: 9px 20px; border: none; border-radius: 10px; background: var(--text); color: var(--bg); font-size: 14px; font-weight: 600; font-family: var(--font-sans); cursor: pointer; transition: all 0.2s; }
.write-btn:hover { opacity: 0.9; transform: translateY(-1px); }
.write-btn svg { width: 14px; height: 14px; }
.start-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
.start-card { display: flex; flex-direction: column; align-items: flex-start; gap: 6px; padding: 16px; border: 1px solid var(--border-light); border-radius: 12px; background: var(--surface); text-decoration: none; color: var(--text); transition: all 0.22s var(--ease-out); }
.start-card:hover { border-color: var(--text-tertiary); transform: translateY(-2px); box-shadow: var(--shadow-md); }
.card-ic { display: flex; width: 30px; height: 30px; align-items: center; justify-content: center; border-radius: 8px; background: var(--surface-hover); color: var(--text); }
.card-ic svg { width: 16px; height: 16px; }
.start-card strong { font-size: 13px; font-weight: 650; }
.card-desc { font-size: 11px; color: var(--text-secondary); line-height: 1.4; }
.start-tip { text-align: center; margin-top: 28px; font-size: 12px; color: var(--text-tertiary); }
.start-tip kbd { font-family: var(--font-mono); background: var(--surface-hover); padding: 2px 6px; border-radius: 4px; margin-right: 4px; }
@media (max-width: 560px) { .start-grid { grid-template-columns: repeat(2, 1fr); } }
</style>
