<script setup>
// Library + queue + playlists pane. Add local files (drag/drop/pick/paste), search/filter, switch
// playlists, reorder the queue by drag, play a track, add-to-playlist, remove, and manage the
// IndexedDB cache (size + clear). Binds to the shared player store. Client-only (store touches
// Audio/IndexedDB) — the PlayerPage renders it inside the client-only body.
import { ref, computed } from 'vue'
import { usePlayerStore } from './usePlayerStore'
import { useI18n } from '../../composables/useI18n'
import { useToast } from '../../composables/useToast'
import { filterTracks, formatTime, formatBytes, initialOf, hashHue } from './playerHelpers'

const store = usePlayerStore()
const { t } = useI18n()
const { showToast } = useToast()

const source = ref('files')   // 'files' | 'online'
const dragOver = ref(false)
const menuFor = ref('')       // track id whose context menu is open
const newPlaylistOpen = ref(false)
const newPlaylistName = ref('')

// ---- online (official embeds) ----
const linkInput = ref('')
async function addLink() {
  const link = linkInput.value.trim()
  if (!link) return
  const r = await store.addEmbed(link)
  if (r?.error === 'unsupported') { showToast(t('media.online.unsupported')); return }
  linkInput.value = ''
}

// Active list = the playlist's tracks (or the whole library), filtered by the search box.
const list = computed(() => filterTracks(store.activeTracks.value, store.search.value))

const cacheLabel = computed(() => `${formatBytes(store.cacheBytes.value)} / ${formatBytes(store.cacheCap.value)}`)

// ---- file input ----
async function pickFiles() {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'audio/*'
  input.multiple = true
  input.onchange = async (e) => { await addFiles(e.target.files) }
  input.click()
}
async function addFiles(fileList) {
  const files = Array.from(fileList || [])
  if (!files.length) return
  let over = false
  for (const f of files) {
    const rec = await store.addFile(f)
    if (rec?.error === 'cap') over = true
  }
  if (over) showToast(t('media.player.cacheFull'))
}
function onDrop(e) {
  dragOver.value = false
  const files = e.dataTransfer?.files
  if (files?.length) addFiles(files)
}
function onPaste(e) {
  const files = e.clipboardData?.files
  if (files?.length) addFiles(files)
}

// ---- drag reorder of the queue (HTML5 DnD) ----
let dragIndex = -1
function onItemDragStart(i, e) { dragIndex = i; e.dataTransfer.effectAllowed = 'move' }
function onItemDragOver(i, e) { e.preventDefault(); e.dataTransfer.dropEffect = 'move' }
function onItemDrop(i) {
  if (dragIndex < 0 || dragIndex === i) { dragIndex = -1; return }
  // Map the visible list indices back to queue order only when on the library/full queue.
  store.reorderQueue(dragIndex, i)
  dragIndex = -1
}

function play(id) { store.playFromActive(id) }
function isCurrent(id) { return store.currentId.value === id && store.isPlaying.value }

async function removeOne(id) { menuFor.value = ''; await store.removeTrack(id) }
async function addToPl(playlistId, trackId) { menuFor.value = ''; await store.addTrackToPlaylist(playlistId, trackId); showToast(t('media.player.addedToPlaylist')) }

async function createPlaylist() {
  const name = newPlaylistName.value.trim()
  if (!name) return
  await store.createPlaylist(name)
  newPlaylistName.value = ''
  newPlaylistOpen.value = false
}
async function clearCache() {
  if (typeof window !== 'undefined' && !window.confirm(t('media.player.clearConfirm'))) return
  await store.clearCache()
  showToast(t('media.player.cacheCleared'))
}
</script>

<template>
  <div class="lib" @paste="onPaste">
    <!-- Source: local files vs official online embeds -->
    <div class="lib-source">
      <button :class="{ on: source === 'files' }" @click="source = 'files'">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 12V3.5l7-1.3V10"/><circle cx="4.3" cy="12" r="1.7"/><circle cx="11.3" cy="10" r="1.7"/></svg>
        {{ t('media.online.tabFiles') }}
      </button>
      <button :class="{ on: source === 'online' }" @click="source = 'online'">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="6.2"/><path d="M1.8 8h12.4M8 1.8c1.7 1.7 2.6 3.9 2.6 6.2S9.7 12.5 8 14.2c-1.7-1.7-2.6-3.9-2.6-6.2S6.3 3.5 8 1.8z"/></svg>
        {{ t('media.online.tabOnline') }}
        <span v-if="store.embeds.value.length" class="src-count">{{ store.embeds.value.length }}</span>
      </button>
    </div>

    <!-- ============ ONLINE (official embeds) ============ -->
    <div v-if="source === 'online'" class="online">
      <form class="online-add" @submit.prevent="addLink">
        <input v-model="linkInput" class="online-input" :placeholder="t('media.online.paste')" inputmode="url" autocomplete="off" spellcheck="false" />
        <button type="submit" class="online-go" :disabled="!linkInput.trim()">{{ t('media.online.addBtn') }}</button>
      </form>
      <p class="online-hint">{{ t('media.online.hint') }}</p>

      <div v-if="!store.embeds.value.length" class="lib-empty small online-empty">
        <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"><circle cx="24" cy="24" r="18"/><path d="M6 24h36M24 6c5 5 8 11 8 18s-3 13-8 18c-5-5-8-11-8-18S19 11 24 6z"/></svg>
        <p class="lib-empty-title">{{ t('media.online.emptyTitle') }}</p>
        <p class="lib-empty-sub">{{ t('media.online.emptySub') }}</p>
      </div>
      <ul v-else class="track-ul">
        <li v-for="e in store.embeds.value" :key="e.id" class="track" :class="{ current: store.currentEmbedId.value === e.id }" @click="store.selectEmbed(e.id)">
          <span class="embed-icon" :data-p="e.platform">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M8 5v14l11-7z"/></svg>
          </span>
          <div class="track-meta">
            <span class="track-title">{{ e.title }}</span>
            <span class="track-sub">{{ e.platform === 'netease' ? 'NetEase' : e.platform === 'bilibili' ? 'Bilibili' : 'YouTube' }} · {{ t('media.online.embedTag') }}</span>
          </div>
          <button class="track-menu-btn" @click.stop="store.removeEmbed(e.id)" :title="t('media.player.remove')">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M4 4l8 8M12 4l-8 8"/></svg>
          </button>
        </li>
      </ul>
    </div>

    <!-- ============ LOCAL FILES ============ -->
    <template v-if="source === 'files'">
    <!-- Playlist selector -->
    <div class="lib-playlists">
      <button class="pl-chip" :class="{ on: !store.activePlaylistId.value }" @click="store.setActivePlaylist('')">
        {{ t('media.player.allTracks') }} <span class="pl-count">{{ store.tracks.value.length }}</span>
      </button>
      <button v-for="p in store.playlists.value" :key="p.id" class="pl-chip" :class="{ on: store.activePlaylistId.value === p.id }" @click="store.setActivePlaylist(p.id)">
        {{ p.name }} <span class="pl-count">{{ p.trackIds.length }}</span>
        <span class="pl-del" @click.stop="store.deletePlaylistById(p.id)" :title="t('media.player.deletePlaylist')">×</span>
      </button>
      <button v-if="!newPlaylistOpen" class="pl-add" @click="newPlaylistOpen = true" :title="t('media.player.newPlaylist')">+</button>
      <form v-else class="pl-new" @submit.prevent="createPlaylist">
        <input v-model="newPlaylistName" class="pl-new-input" :placeholder="t('media.player.playlistName')" autofocus @blur="!newPlaylistName && (newPlaylistOpen = false)" />
      </form>
    </div>

    <!-- Search + add -->
    <div class="lib-bar">
      <div class="lib-search">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="7" cy="7" r="4.5"/><line x1="10.5" y1="10.5" x2="14" y2="14" stroke-linecap="round"/></svg>
        <input v-model="store.search.value" :placeholder="t('media.player.search')" />
      </div>
      <button class="add-btn" @click="pickFiles">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M8 3v10M3 8h10"/></svg>
        {{ t('media.player.add') }}
      </button>
    </div>

    <!-- Track list / drop zone -->
    <div
      class="lib-list"
      :class="{ over: dragOver }"
      @dragover.prevent="dragOver = true"
      @dragleave.prevent="dragOver = false"
      @drop.prevent="onDrop"
    >
      <div v-if="!store.tracks.value.length" class="lib-empty">
        <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"><path d="M18 30V12l20-4v18"/><circle cx="14" cy="30" r="4"/><circle cx="34" cy="26" r="4"/></svg>
        <p class="lib-empty-title">{{ t('media.player.emptyTitle') }}</p>
        <p class="lib-empty-sub">{{ t('media.player.emptySub') }}</p>
        <button class="add-btn solid" @click="pickFiles">{{ t('media.player.add') }}</button>
      </div>
      <div v-else-if="!list.length" class="lib-empty small"><p>{{ t('media.player.noMatch') }}</p></div>

      <ul v-else class="track-ul">
        <li
          v-for="(tr, i) in list"
          :key="tr.id"
          class="track"
          :class="{ current: store.currentId.value === tr.id }"
          draggable="true"
          @dragstart="onItemDragStart(i, $event)"
          @dragover="onItemDragOver(i, $event)"
          @drop="onItemDrop(i)"
          @dblclick="play(tr.id)"
        >
          <button class="track-art" @click="play(tr.id)" :title="t('media.player.play')">
            <img v-if="false" alt="" />
            <span class="track-art-ph" :style="{ '--ph-hue': hashHue(tr.title || tr.name) }">{{ initialOf(tr.title || tr.name) }}</span>
            <span class="track-play-overlay">
              <svg v-if="isCurrent(tr.id)" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>
              <svg v-else viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
            </span>
          </button>
          <div class="track-meta" @click="play(tr.id)">
            <span class="track-title">{{ tr.title }}</span>
            <span class="track-sub">{{ tr.artist || tr.album || tr.name }}</span>
          </div>
          <span class="track-dur">{{ tr.duration ? formatTime(tr.duration) : '' }}</span>
          <div class="track-menu-wrap">
            <button class="track-menu-btn" @click.stop="menuFor = menuFor === tr.id ? '' : tr.id" :title="t('media.player.more')">
              <svg viewBox="0 0 16 16" fill="currentColor"><circle cx="8" cy="3" r="1.4"/><circle cx="8" cy="8" r="1.4"/><circle cx="8" cy="13" r="1.4"/></svg>
            </button>
            <div v-if="menuFor === tr.id" class="track-menu" @click.stop>
              <div v-if="store.playlists.value.length" class="tm-section">{{ t('media.player.addTo') }}</div>
              <button v-for="p in store.playlists.value" :key="p.id" class="tm-item" @click="addToPl(p.id, tr.id)">{{ p.name }}</button>
              <button class="tm-item danger" @click="removeOne(tr.id)">{{ t('media.player.remove') }}</button>
            </div>
          </div>
        </li>
      </ul>
    </div>

    <!-- Cache footer -->
    <div class="lib-cache">
      <div class="cache-bar"><div class="cache-fill" :style="{ width: store.cacheUsedPct.value + '%' }"></div></div>
      <div class="cache-row">
        <span class="cache-label">{{ t('media.player.stored') }}: {{ cacheLabel }}</span>
        <button v-if="store.tracks.value.length" class="cache-clear" @click="clearCache">{{ t('media.player.clearCache') }}</button>
      </div>
    </div>
    </template>
  </div>
</template>

<style scoped>
.lib { display: flex; flex-direction: column; gap: 12px; min-height: 0; height: 100%; }

.lib-source { display: flex; gap: 3px; padding: 3px; background: var(--surface-hover); border-radius: 9px; }
.lib-source button { flex: 1; display: inline-flex; align-items: center; justify-content: center; gap: 7px; padding: 8px 10px; border: none; border-radius: 7px; font-size: 12.5px; font-weight: 600; background: transparent; color: var(--text-secondary); cursor: pointer; font-family: var(--font-sans); transition: all 0.15s; }
.lib-source button svg { width: 14px; height: 14px; }
.lib-source button.on { background: var(--surface); color: var(--text); box-shadow: var(--shadow-xs); }
.lib-source button.on svg { color: var(--accent); }
.src-count { font-size: 10px; opacity: 0.7; background: var(--surface-active); padding: 1px 6px; border-radius: 99px; }

.online { display: flex; flex-direction: column; gap: 10px; min-height: 0; flex: 1; }
.online-add { display: flex; gap: 8px; }
.online-input { flex: 1; min-width: 0; padding: 9px 12px; border: 1px solid var(--border); border-radius: 10px; background: var(--surface); color: var(--text); font-size: 13px; font-family: var(--font-sans); outline: none; }
.online-input:focus { border-color: var(--accent); }
.online-go { padding: 9px 16px; border: none; border-radius: 10px; background: var(--text); color: var(--bg); font-size: 12.5px; font-weight: 650; font-family: var(--font-sans); cursor: pointer; white-space: nowrap; }
.online-go:disabled { opacity: 0.5; cursor: default; }
.online-hint { font-size: 11px; color: var(--text-tertiary); line-height: 1.5; }
.online-empty { border: 1px solid var(--border-light); border-radius: 12px; background: var(--surface); }

.embed-icon { width: 38px; height: 38px; flex-shrink: 0; display: inline-flex; align-items: center; justify-content: center; border-radius: 7px; background: var(--surface-hover); color: var(--text-secondary); }
.embed-icon svg { width: 16px; height: 16px; }
.embed-icon[data-p="netease"] { color: #c20c0c; }
.embed-icon[data-p="bilibili"] { color: #00a1d6; }
.embed-icon[data-p="youtube"] { color: #ff0000; }
.online .track { cursor: pointer; border-radius: 0; }
.online .track-ul { border: 1px solid var(--border-light); border-radius: 12px; background: var(--surface); overflow: hidden; }

.lib-playlists { display: flex; flex-wrap: wrap; gap: 6px; }
.pl-chip { display: inline-flex; align-items: center; gap: 6px; padding: 6px 11px; border: 1px solid var(--border-light); border-radius: 99px; background: var(--surface); color: var(--text-secondary); font-size: 12px; font-weight: 600; font-family: var(--font-sans); cursor: pointer; transition: all 0.15s; }
.pl-chip:hover { color: var(--text); }
.pl-chip.on { background: var(--accent); border-color: var(--accent); color: var(--accent-text); }
.pl-count { font-size: 10px; opacity: 0.7; font-variant-numeric: tabular-nums; }
.pl-del { margin-left: 2px; font-size: 14px; line-height: 1; opacity: 0.6; }
.pl-del:hover { opacity: 1; }
.pl-add { width: 30px; height: 30px; border: 1px dashed var(--border); border-radius: 99px; background: none; color: var(--text-secondary); font-size: 16px; cursor: pointer; }
.pl-add:hover { color: var(--accent); border-color: var(--accent); }
.pl-new-input { padding: 6px 11px; border: 1px solid var(--accent); border-radius: 99px; background: var(--surface); color: var(--text); font-size: 12px; font-family: var(--font-sans); outline: none; width: 130px; }

.lib-bar { display: flex; gap: 8px; }
.lib-search { flex: 1; display: flex; align-items: center; gap: 8px; padding: 0 12px; border: 1px solid var(--border); border-radius: 10px; background: var(--surface); }
.lib-search svg { width: 15px; height: 15px; color: var(--text-tertiary); flex-shrink: 0; }
.lib-search input { flex: 1; border: none; background: none; color: var(--text); font-size: 13px; font-family: var(--font-sans); padding: 9px 0; outline: none; min-width: 0; }
.add-btn { display: inline-flex; align-items: center; gap: 6px; padding: 9px 14px; border: 1px solid var(--border); border-radius: 10px; background: var(--surface); color: var(--text); font-size: 12.5px; font-weight: 600; font-family: var(--font-sans); cursor: pointer; transition: all 0.15s; white-space: nowrap; }
.add-btn:hover { border-color: var(--accent); }
.add-btn svg { width: 14px; height: 14px; }
.add-btn.solid { background: var(--text); color: var(--bg); border: none; }

.lib-list { flex: 1; min-height: 160px; border: 1px solid var(--border-light); border-radius: 12px; background: var(--surface); overflow-y: auto; transition: border-color 0.2s, background 0.2s; }
.lib-list.over { border-color: var(--accent); border-style: dashed; background: var(--accent-bg); }
.lib-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; padding: 44px 24px; text-align: center; color: var(--text-tertiary); }
.lib-empty.small { padding: 30px; }
.lib-empty svg { width: 46px; height: 46px; margin-bottom: 4px; }
.lib-empty-title { font-size: 14px; font-weight: 650; color: var(--text-secondary); }
.lib-empty-sub { font-size: 12px; }
.lib-empty .add-btn { margin-top: 8px; }

.track-ul { list-style: none; }
.track { display: flex; align-items: center; gap: 11px; padding: 8px 12px; border-bottom: 1px solid var(--border-light); cursor: default; transition: background 0.12s; position: relative; }
.track:last-child { border-bottom: none; }
.track:hover { background: var(--surface-hover); }
.track.current { background: var(--accent-bg); }
.track-art { position: relative; width: 38px; height: 38px; flex-shrink: 0; border: none; padding: 0; border-radius: 7px; overflow: hidden; background: var(--surface-hover); cursor: pointer; }
.track-art-ph { display: flex; align-items: center; justify-content: center; width: 100%; height: 100%; font-size: 15px; font-weight: 700; color: var(--text); background: linear-gradient(135deg, color-mix(in srgb, hsl(var(--ph-hue, 40), 26%, 50%) 22%, var(--surface-hover)), var(--surface-hover)); }
.track-play-overlay { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,0.4); opacity: 0; transition: opacity 0.15s; }
.track-art:hover .track-play-overlay, .track.current .track-play-overlay { opacity: 1; }
.track-play-overlay svg { width: 18px; height: 18px; color: #fff; }
.track-meta { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; cursor: pointer; }
.track-title { font-size: 13px; font-weight: 600; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.track-sub { font-size: 11px; color: var(--text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.track-dur { font-size: 11px; color: var(--text-tertiary); font-variant-numeric: tabular-nums; flex-shrink: 0; }
.track-menu-wrap { position: relative; flex-shrink: 0; }
.track-menu-btn { width: 28px; height: 28px; display: inline-flex; align-items: center; justify-content: center; border: none; background: none; color: var(--text-tertiary); cursor: pointer; border-radius: 7px; }
.track-menu-btn:hover { background: var(--surface-active); color: var(--text); }
.track-menu-btn svg { width: 15px; height: 15px; }
.track-menu { position: absolute; right: 0; top: 32px; z-index: 20; min-width: 150px; padding: 5px; background: var(--surface); border: 1px solid var(--border-light); border-radius: 10px; box-shadow: var(--shadow-lg); }
.tm-section { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-tertiary); padding: 5px 9px 3px; }
.tm-item { display: block; width: 100%; text-align: left; padding: 7px 9px; border: none; background: none; color: var(--text); font-size: 12.5px; font-family: var(--font-sans); border-radius: 7px; cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tm-item:hover { background: var(--surface-hover); }
.tm-item.danger { color: #e5484d; border-top: 1px solid var(--border-light); margin-top: 3px; }

.lib-cache { flex-shrink: 0; }
.cache-bar { height: 4px; border-radius: 99px; background: var(--surface-hover); overflow: hidden; margin-bottom: 6px; }
.cache-fill { height: 100%; background: var(--accent); border-radius: 99px; transition: width 0.3s; }
.cache-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.cache-label { font-size: 11px; color: var(--text-secondary); font-variant-numeric: tabular-nums; }
.cache-clear { border: none; background: none; color: var(--text-tertiary); font-size: 11px; font-family: var(--font-sans); cursor: pointer; text-decoration: underline; }
.cache-clear:hover { color: #e5484d; }

@media (max-width: 768px) {
  .lib-list { min-height: 220px; }
  .track { padding: 9px 12px; }
  .track-art { width: 42px; height: 42px; }
}
</style>
