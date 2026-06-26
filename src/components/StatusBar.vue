<script setup>
const props = defineProps({ stats: Object, dirty: Boolean, t: Function })
</script>

<template>
  <footer class="status-bar">
    <div class="sl">
      <span class="saved-pill" :class="{ unsaved: dirty }">
        <svg v-if="!dirty" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><polyline points="2.5 6 5 8.5 9.5 3.5"/></svg>
        <svg v-else viewBox="0 0 12 12" fill="currentColor"><circle cx="6" cy="6" r="2.5"/></svg>
        {{ dirty ? t('status.editing') : t('status.saved') }}
      </span>
      <span class="stat">{{ stats.chars }} {{ t('status.chars') }}</span>
      <span class="stat">{{ stats.words }} {{ t('status.words') }}</span>
      <span class="stat">{{ stats.lines }} {{ t('status.lines') }}</span>
    </div>
    <div class="sr">
      <span class="stat">~{{ stats.readMin }} {{ t('status.minRead') }}</span>
      <span class="stat fmt-badge">Markdown</span>
    </div>
  </footer>
</template>

<style scoped>
.status-bar {
  display: flex; align-items: center; justify-content: space-between;
  padding: 0 14px; background: var(--bar-bg);
  backdrop-filter: saturate(180%) blur(20px); -webkit-backdrop-filter: saturate(180%) blur(20px);
  border-top: 1px solid var(--border-light);
  font-size: 11px; color: var(--text-tertiary); flex-shrink: 0; height: 26px; z-index: 10;
}
.sl, .sr { display: flex; align-items: center; gap: 10px; }
.stat { white-space: nowrap; }
.saved-pill {
  display: inline-flex; align-items: center; gap: 3px;
  padding: 1px 7px 1px 4px; border-radius: 999px;
  background: var(--status-ok-bg); color: var(--status-ok);
  font-weight: 500; font-size: 10px; transition: all 0.3s;
}
.saved-pill svg { width: 10px; height: 10px; }
.saved-pill.unsaved { background: var(--status-warn-bg); color: var(--status-warn); }
.fmt-badge { padding: 1px 6px; border-radius: 3px; background: var(--surface-hover); font-weight: 500; }
@media (max-width: 640px) { .status-bar { font-size: 11px; padding: 0 10px; } .sr { display: none; } }
</style>
