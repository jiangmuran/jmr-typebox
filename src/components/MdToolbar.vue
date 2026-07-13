<script setup>
import { combo } from '../utils/platform'
defineProps({ t: { type: Function, required: true } })
const emit = defineEmits(['insert', 'insert-line'])
function ins(b, a, p) { emit('insert', b, a, p) }
function insL(p, ph) { emit('insert-line', p, ph) }
</script>

<template>
  <div class="md-toolbar">
    <button @click="ins('**','**','bold')" :title="`${t('md.bold')} (${combo('B')})`" :aria-label="`${t('md.bold')} (${combo('B')})`"><strong>B</strong></button>
    <button @click="ins('*','*','italic')" :title="`${t('md.italic')} (${combo('I')})`" :aria-label="`${t('md.italic')} (${combo('I')})`"><em>I</em></button>
    <button @click="ins('~~','~~','text')" :title="t('md.strikethrough')" :aria-label="t('md.strikethrough')" class="tb-s"><s>S</s></button>
    <div class="tb-sep"></div>

    <button @click="insL('# ','Heading')" :title="t('md.h1')" :aria-label="t('md.h1')">H<sub>1</sub></button>
    <button @click="insL('## ','Heading')" :title="t('md.h2')" :aria-label="t('md.h2')">H<sub>2</sub></button>
    <button @click="insL('### ','Heading')" :title="t('md.h3')" :aria-label="t('md.h3')">H<sub>3</sub></button>
    <div class="tb-sep"></div>

    <!-- Link -->
    <button @click="ins('[','](url)', 'text')" :title="`${t('md.link')} (${combo('K')})`" :aria-label="`${t('md.link')} (${combo('K')})`">
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round">
        <path d="M6.5 8.5a3.5 3.5 0 0 0 5.3.4l2-2a3.5 3.5 0 0 0-5-5l-1.2 1.2"/>
        <path d="M9.5 7.5a3.5 3.5 0 0 0-5.3-.4l-2 2a3.5 3.5 0 0 0 5 5l1.2-1.2"/>
      </svg>
    </button>
    <!-- Image -->
    <button @click="ins('![','](url)', 'alt')" :title="t('md.image')" :aria-label="t('md.image')">
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
        <rect x="1.5" y="2.5" width="13" height="11" rx="1.5"/><circle cx="5" cy="6" r="1.2"/><path d="M14.5 11l-4-3.5-3 2.5-2-1.5L1.5 11.5"/>
      </svg>
    </button>
    <div class="tb-sep"></div>

    <!-- Inline code -->
    <button @click="ins('`','`','code')" :title="`${t('md.code')} (${combo('E')})`" :aria-label="`${t('md.code')} (${combo('E')})`">
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="10 12.5 14 8 10 3.5"/><polyline points="6 3.5 2 8 6 12.5"/>
      </svg>
    </button>
    <!-- Code block -->
    <button @click="ins('\n```\n','\n```\n','code')" :title="t('md.codeBlock')" :aria-label="t('md.codeBlock')">
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round">
        <rect x="1.5" y="1.5" width="13" height="13" rx="2"/><path d="M5 6.5l2 2-2 2"/><line x1="9" y1="10.5" x2="12" y2="10.5"/>
      </svg>
    </button>
    <div class="tb-sep"></div>

    <!-- Bullet list -->
    <button @click="insL('- ','item')" :title="t('md.bulletList')" :aria-label="t('md.bulletList')">
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round">
        <line x1="6" y1="4" x2="14" y2="4"/><line x1="6" y1="8" x2="14" y2="8"/><line x1="6" y1="12" x2="14" y2="12"/>
        <circle cx="3" cy="4" r="1" fill="currentColor" stroke="none"/><circle cx="3" cy="8" r="1" fill="currentColor" stroke="none"/><circle cx="3" cy="12" r="1" fill="currentColor" stroke="none"/>
      </svg>
    </button>
    <!-- Numbered list -->
    <button @click="insL('1. ','item')" :title="t('md.numberedList')" :aria-label="t('md.numberedList')">
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round">
        <line x1="7" y1="4" x2="14" y2="4"/><line x1="7" y1="8" x2="14" y2="8"/><line x1="7" y1="12" x2="14" y2="12"/>
        <text x="3" y="5.5" font-size="5" fill="currentColor" stroke="none" font-weight="700" font-family="system-ui">1</text>
        <text x="3" y="9.5" font-size="5" fill="currentColor" stroke="none" font-weight="700" font-family="system-ui">2</text>
        <text x="3" y="13.5" font-size="5" fill="currentColor" stroke="none" font-weight="700" font-family="system-ui">3</text>
      </svg>
    </button>
    <!-- Checkbox -->
    <button @click="insL('- [ ] ','task')" :title="t('md.checkbox')" :aria-label="t('md.checkbox')">
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
        <rect x="2" y="3" width="10" height="10" rx="2"/><polyline points="5 8 7 10.5 11.5 5.5"/>
      </svg>
    </button>
    <div class="tb-sep"></div>

    <!-- Quote -->
    <button @click="insL('> ','quote')" :title="t('md.blockquote')" :aria-label="t('md.blockquote')">
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
        <line x1="2" y1="3.5" x2="2" y2="12.5"/><line x1="6" y1="4" x2="14" y2="4"/><line x1="6" y1="8" x2="12" y2="8"/><line x1="6" y1="12" x2="10" y2="12"/>
      </svg>
    </button>
    <!-- Table -->
    <button @click="ins('\n| Col 1 | Col 2 | Col 3 |\n| --- | --- | --- |\n| | | |\n','','')" :title="t('md.table')" :aria-label="t('md.table')">
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round">
        <rect x="1.5" y="1.5" width="13" height="13" rx="2"/><line x1="1.5" y1="5.5" x2="14.5" y2="5.5"/><line x1="1.5" y1="10" x2="14.5" y2="10"/><line x1="6" y1="1.5" x2="6" y2="14.5"/><line x1="10.5" y1="1.5" x2="10.5" y2="14.5"/>
      </svg>
    </button>
    <!-- Horizontal rule -->
    <button @click="ins('\n\n---\n\n','','')" :title="t('md.hr')" :aria-label="t('md.hr')">
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
        <line x1="1" y1="8" x2="15" y2="8"/>
      </svg>
    </button>
  </div>
</template>

<style scoped>
.md-toolbar {
  display: flex;
  align-items: center;
  gap: 1px;
  padding: 4px 10px;
  border-bottom: 1px solid var(--border-light);
  background: var(--bar-bg);
  backdrop-filter: saturate(180%) blur(20px);
  -webkit-backdrop-filter: saturate(180%) blur(20px);
  overflow-x: auto;
  flex-shrink: 0;
  scrollbar-width: none;
  z-index: 20;
  height: 38px;
}

.md-toolbar::-webkit-scrollbar { display: none; }

.md-toolbar button {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 30px;
  height: 28px;
  padding: 0 5px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  flex-shrink: 0;
  transition: all var(--dur-1) ease;
  font-family: var(--font-sans);
  font-size: 13px;
  font-weight: 600;
}

.md-toolbar button:hover { background: var(--surface-hover); color: var(--text); }
.md-toolbar button:active { transform: scale(0.9); background: var(--surface-active); }
.md-toolbar button svg { width: 15px; height: 15px; }
.md-toolbar .tb-s { text-decoration: line-through; }

.tb-sep {
  width: 1px;
  height: 16px;
  background: var(--border-light);
  margin: 0 3px;
  flex-shrink: 0;
}

@media (max-width: 768px) {
  /* Scrollable formatting strip: give the icon buttons a more thumb-friendly height (they were
     26px — too small to tap reliably) while keeping the bar compact. */
  .md-toolbar { padding: 3px 6px; height: 42px; gap: 2px; }
  .md-toolbar button { min-width: 36px; height: 34px; font-size: 12.5px; }
  .md-toolbar button svg { width: 14px; height: 14px; }
}
</style>
