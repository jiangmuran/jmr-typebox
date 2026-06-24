<script setup>
// Renders the OFFICIAL, first-party embed player for an online entry (NetEase / Bilibili / YouTube)
// in a sandboxed <iframe>. This is playback-only via the platform's own player — NOT a download or
// extraction, and it uses no unofficial APIs. We guard the iframe src with isAllowedEmbedUrl so only
// the exact official embed origins can ever load.
import { computed } from 'vue'
import { useI18n } from '../../composables/useI18n'
import { isAllowedEmbedUrl, platformLabel } from './embed'

const props = defineProps({
  entry: { type: Object, required: true }, // { platform, kind, embedUrl, title, ... }
})
const { t } = useI18n()

// Defense-in-depth: never put a non-official URL in the iframe.
const safeSrc = computed(() => (props.entry && isAllowedEmbedUrl(props.entry.embedUrl) ? props.entry.embedUrl : ''))
const label = computed(() => platformLabel(props.entry?.platform))
// NetEase's official outchain player is a fixed-height audio widget; the others are video players.
const isAudioWidget = computed(() => props.entry?.platform === 'netease')
</script>

<template>
  <div class="embed">
    <div class="embed-head">
      <span class="embed-badge">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 9.5a2.5 2.5 0 0 0 3.5 0l2-2a2.5 2.5 0 0 0-3.5-3.5l-1 1"/><path d="M9.5 6.5a2.5 2.5 0 0 0-3.5 0l-2 2a2.5 2.5 0 0 0 3.5 3.5l1-1"/></svg>
        {{ label }}
      </span>
      <span class="embed-official">{{ t('media.online.officialBadge') }}</span>
    </div>

    <div v-if="safeSrc" class="embed-frame" :class="{ audio: isAudioWidget }">
      <iframe
        :src="safeSrc"
        :title="entry.title"
        frameborder="0"
        :height="isAudioWidget ? 86 : undefined"
        allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
        allowfullscreen
        referrerpolicy="strict-origin-when-cross-origin"
        sandbox="allow-scripts allow-same-origin allow-popups allow-presentation allow-forms"
        loading="lazy"
      ></iframe>
    </div>
    <div v-else class="embed-bad">{{ t('media.online.badUrl') }}</div>

    <p class="embed-note">{{ t('media.online.playbackNote') }}</p>
  </div>
</template>

<style scoped>
.embed { display: flex; flex-direction: column; gap: 12px; }
.embed-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.embed-badge { display: inline-flex; align-items: center; gap: 7px; font-size: 13px; font-weight: 700; color: var(--text); }
.embed-badge svg { width: 16px; height: 16px; color: var(--accent); }
.embed-official { font-size: 10.5px; font-weight: 600; letter-spacing: 0.02em; color: var(--text-secondary); background: var(--surface-hover); padding: 3px 9px; border-radius: 99px; }

.embed-frame { width: 100%; border-radius: 14px; overflow: hidden; background: #000; box-shadow: var(--shadow-md); }
.embed-frame:not(.audio) { aspect-ratio: 16 / 9; }
.embed-frame.audio { background: var(--surface-hover); box-shadow: none; border: 1px solid var(--border-light); }
.embed-frame iframe { width: 100%; height: 100%; display: block; border: 0; }
.embed-frame.audio iframe { height: 86px; }

.embed-bad { padding: 30px; text-align: center; color: var(--text-tertiary); font-size: 13px; border: 1px dashed var(--border); border-radius: 12px; }
.embed-note { font-size: 11px; color: var(--text-tertiary); line-height: 1.5; }

@media (max-width: 768px) {
  .embed-frame:not(.audio) { border-radius: 12px; }
}
</style>
