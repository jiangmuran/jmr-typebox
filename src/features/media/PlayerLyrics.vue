<script setup>
// Lyrics panel — Phase 2 redesign. Four views (原文/翻译/罗马音/KTV), sentence-level click-to-
// seek, long-press context menu (set A/B · loop this line · copy · send to MD editor), and KTV
// per-syllable highlighting driven by yrc.
//
// The lyric text comes from the shared store (`liveLyrics` reactive ref), which is populated by
// usePlayerStore.loadCoverAndLyrics — either from the local IndexedDB bundle or freshly fetched
// from /api/music/lyric for an NCM track on first play.
import { ref, computed, watch, nextTick } from 'vue'
import { usePlayerStore } from './usePlayerStore'
import { useI18n } from '../../composables/useI18n'
import { useHandoff } from '../../composables/useHandoff'
import { useRouter } from 'vue-router'
import { parseLrc, parseYrc, activeLineIndex, activeYrcIndices } from './lrc'

const store = usePlayerStore()
const { t } = useI18n()
const handoff = useHandoff()
const router = useRouter()

// View switcher: 0 original · 1 translation · 2 romaji · 3 KTV (yrc per-syllable).
const view = ref(0)
const VIEWS = [
  { id: 0, key: 'original', label: 'media.lyrics.original' },
  { id: 1, key: 'translation', label: 'media.lyrics.translation' },
  { id: 2, key: 'romaji', label: 'media.lyrics.romaji' },
  { id: 3, key: 'yrc', label: 'media.lyrics.ktv' },
]

// Parse the active view's text on demand. yrc gets its own structured shape (lines + words).
const parsedLrc = computed(() => {
  const v = VIEWS[view.value]
  if (!v) return { lines: [], synced: false }
  const text = store.liveLyrics.value?.[v.key] || ''
  if (!text.trim()) return { lines: [], synced: false }
  if (v.key === 'yrc') return parseYrc(text)
  return parseLrc(text)
})
// For KTV we render the yrc structure; everything else renders lrc lines uniformly.
const isKtv = computed(() => view.value === 3 && parsedLrc.value.synced)

// Active line for the current playback time, used for highlighting + auto-scroll.
const activeIdx = computed(() => {
  if (!parsedLrc.value.synced) return -1
  if (isKtv.value) return activeYrcIndices(parsedLrc.value.lines, store.currentTime.value).lineIndex
  return activeLineIndex(parsedLrc.value.lines, store.currentTime.value)
})
// Active WORD index inside the active line — only used in KTV view.
const activeWordIdx = computed(() => {
  if (!isKtv.value) return -1
  return activeYrcIndices(parsedLrc.value.lines, store.currentTime.value).wordIndex
})

// Auto-scroll the active line into the centre of the panel. Idempotent: re-runs when the active
// index changes or the view switches. Throttled via requestAnimationFrame to keep cost low during
// rapid timeupdate events.
const containerEl = ref(null)
watch(activeIdx, async () => {
  await nextTick()
  const root = containerEl.value
  if (!root) return
  const active = root.querySelector('[data-active="true"]')
  if (!active) return
  // Manual scroll — scrollIntoView would scroll ALL ancestors (including the page), causing the
  // whole viewport to jump. Keep the active line ~1/4 down (reads more naturally than dead-centre —
  // the upcoming lines stay visible below).
  const target = active.offsetTop - root.clientHeight / 4 + active.clientHeight / 2
  root.scrollTo({ top: Math.max(0, target), behavior: 'smooth' })
})

function lineClasses(i) {
  const cls = ['ll-line']
  if (i === activeIdx.value) cls.push('active')
  // Distance-based opacity for non-active lines (景深效果).
  const dist = Math.abs(i - activeIdx.value)
  if (dist === 1) cls.push('near')
  else if (dist >= 2 && dist <= 3) cls.push('far')
  else if (dist > 3) cls.push('veryfar')
  return cls
}

function onLineClick(line) {
  if (line.time >= 0) store.seek(line.time)
}

// Long-press context menu (mobile) / right-click (desktop). Coordinates are clamped to the
// viewport HERE — the template previously did `Math.min(x, window.innerWidth - 220)` inline,
// but `window` doesn't exist in a Vue template scope, so opening the menu threw and killed
// the whole panel render.
const menuFor = ref(null) // { line, x, y }
function openLineMenu(line, x, y) {
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1280
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800
  menuFor.value = { line, x: Math.max(8, Math.min(x || 0, vw - 220)), y: Math.max(8, Math.min(y || 0, vh - 280)) }
}
let pressTimer = null
function onLineTouchStart(line, e) {
  if (pressTimer) clearTimeout(pressTimer)
  const touch = e.touches?.[0]
  pressTimer = setTimeout(() => { openLineMenu(line, touch?.clientX, touch?.clientY) }, 500)
}
function onLineTouchEnd() { if (pressTimer) { clearTimeout(pressTimer); pressTimer = null } }
function onLineContextMenu(line, e) {
  e.preventDefault()
  openLineMenu(line, e.clientX, e.clientY)
}
function closeMenu() { menuFor.value = null }

function playFromLine() {
  const m = menuFor.value
  if (!m || m.line.time < 0) return closeMenu()
  store.seek(m.line.time)
  if (!store.isPlaying.value) store.play()
  closeMenu()
}
function setA() { const m = menuFor.value; if (m) { store.abStart.value = m.line.time } closeMenu() }
function setB() { const m = menuFor.value; if (m) { store.abEnd.value = m.line.time + (m.line.duration || 3) } closeMenu() }
function copyLine() {
  const m = menuFor.value
  if (m && typeof navigator !== 'undefined' && navigator.clipboard) {
    navigator.clipboard.writeText(m.line.text || '').catch(() => {})
  }
  closeMenu()
}
function sendToEditor() {
  const m = menuFor.value
  if (!m) return closeMenu()
  handoff.send(m.line.text || '', { kind: 'text', from: 'lyrics', name: 'lyric-line.txt' })
  router.push('/')
  closeMenu()
}

// Switch to a view only when it has content; KTV and romaji often won't, so we fall back to
// "original" silently.
watch(() => store.currentId.value, () => {
  const ll = store.liveLyrics.value || {}
  if (view.value === 1 && !ll.translation) view.value = 0
  if (view.value === 2 && !ll.romaji) view.value = 0
  if (view.value === 3 && !ll.yrc) view.value = 0
})

function hasViewContent(key) {
  const text = store.liveLyrics.value?.[key] || ''
  return !!text.trim()
}
</script>

<template>
  <div class="lp">
    <div class="lp-tabs segbar">
      <button v-for="v in VIEWS" :key="v.id" v-show="v.id === 0 || hasViewContent(v.key)"
        class="segbar-item" :class="{ active: view === v.id }" @click="view = v.id">
        {{ t(v.label) }}
      </button>
    </div>

    <div v-if="!parsedLrc.synced && !parsedLrc.lines.length" class="lp-empty">
      <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 14h32M8 24h32M8 34h20"/></svg>
      <p>{{ t('media.lyrics.empty') }}</p>
    </div>

    <div v-else ref="containerEl" class="lp-scroll" :class="{ ktv: isKtv }">
      <!-- LRC views (original / translation / romaji): uniform line rendering. -->
      <template v-if="!isKtv">
        <div v-for="(line, i) in parsedLrc.lines" :key="i"
          :data-active="i === activeIdx"
          :class="lineClasses(i)"
          @click="onLineClick(line)"
          @touchstart.passive="onLineTouchStart(line, $event)" @touchend="onLineTouchEnd" @touchmove="onLineTouchEnd"
          @contextmenu="onLineContextMenu(line, $event)">
          {{ line.text || '·' }}
        </div>
      </template>
      <!-- KTV view: render each word of the active line as a span with progress-driven highlight. -->
      <template v-else>
        <div v-for="(line, i) in parsedLrc.lines" :key="i"
          :data-active="i === activeIdx"
          :class="lineClasses(i)"
          @click="onLineClick(line)"
          @contextmenu="onLineContextMenu(line, $event)">
          <span v-for="(w, wi) in line.words" :key="wi" class="ll-word" :class="{ on: i === activeIdx && wi <= activeWordIdx }">{{ w.text }}</span>
        </div>
      </template>
    </div>

    <!-- Long-press / right-click context menu. Teleported to body via inline positioning. -->
    <div v-if="menuFor" class="ll-menu" :style="{ left: menuFor.x + 'px', top: menuFor.y + 'px' }" @click.stop>
      <div class="ll-menu-line">{{ menuFor.line.text || '·' }}</div>
      <button class="ll-menu-item" @click="playFromLine">▶ {{ t('media.lyrics.menuPlayFrom') }}</button>
      <button class="ll-menu-item" @click="setA">A {{ t('media.lyrics.menuSetA') }}</button>
      <button class="ll-menu-item" @click="setB">B {{ t('media.lyrics.menuSetB') }}</button>
      <div class="ll-menu-sep"></div>
      <button class="ll-menu-item" @click="copyLine">📋 {{ t('media.lyrics.menuCopy') }}</button>
      <button class="ll-menu-item" @click="sendToEditor">📝 {{ t('media.lyrics.menuSendMd') }}</button>
    </div>
    <div v-if="menuFor" class="ll-menu-scrim" @click="closeMenu" @contextmenu.prevent="closeMenu"></div>
  </div>
</template>

<style scoped>
.lp { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.lp-tabs { margin-bottom: 8px; flex-shrink: 0; }
.lp-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; padding: 50px 20px; color: var(--text-tertiary); text-align: center; flex: 1; }
.lp-empty svg { width: 42px; height: 42px; opacity: 0.5; }
.lp-empty p { font-size: 13px; }

.lp-scroll { flex: 1; min-height: 0; overflow-y: auto; padding: 60px 16px; scroll-behavior: smooth; -webkit-overflow-scrolling: touch; }
.lp-scroll.ktv { padding-top: 80px; }

.ll-line { font-size: 16px; line-height: 1.65; padding: 8px 6px; text-align: center; color: var(--text-tertiary); cursor: pointer; transition: color var(--dur-2), transform var(--dur-2), opacity var(--dur-2); user-select: none; }
.ll-line:hover { color: var(--text-secondary); }
.ll-line.near { color: var(--text-secondary); opacity: 0.8; }
.ll-line.far { opacity: 0.55; }
.ll-line.veryfar { opacity: 0.32; }
.ll-line.active { color: var(--accent); font-weight: 650; transform: scale(1.04); }

.lp-scroll.ktv .ll-line { font-size: 18px; line-height: 2; font-weight: 600; }
.lp-scroll.ktv .ll-word { color: var(--text-tertiary); transition: color 0.08s; padding: 0 1px; }
.lp-scroll.ktv .ll-word.on { color: var(--accent); }

/* Long-press / right-click menu. */
.ll-menu { position: fixed; z-index: 1000; min-width: 200px; padding: 6px; background: var(--surface); border: 1px solid var(--border-light); border-radius: 12px; box-shadow: var(--shadow-lg); }
.ll-menu-line { font-size: 11px; color: var(--text-secondary); padding: 8px 10px 6px; border-bottom: 1px solid var(--border-light); margin-bottom: 4px; font-style: italic; max-height: 60px; overflow: hidden; }
.ll-menu-item { display: block; width: 100%; padding: 8px 10px; text-align: left; background: none; border: none; color: var(--text); font-family: var(--font-sans); font-size: 13px; cursor: pointer; border-radius: 7px; }
.ll-menu-item:hover { background: var(--surface-hover); }
.ll-menu-sep { height: 1px; background: var(--border-light); margin: 4px 0; }
.ll-menu-scrim { position: fixed; inset: 0; z-index: 999; }

@media (max-width: 768px) {
  .ll-line { font-size: 15px; padding: 9px 4px; }
  .lp-scroll.ktv .ll-line { font-size: 17px; }
}
</style>
