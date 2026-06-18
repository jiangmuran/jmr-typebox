<script setup>
// Inline 「i」 marker shown next to any backend-dependent control. Explains that the
// backend is optional + open source. Used across Phase 1 features.
import { ref } from 'vue'
import { useI18n } from '../composables/useI18n'
import { useBackend } from '../composables/useBackend'

const { t } = useI18n()
const { repoUrl } = useBackend()
const open = ref(false)
</script>

<template>
  <span class="bi">
    <button class="bi-btn" type="button" :aria-label="t('backend.notice')" @click.stop="open = !open">i</button>
    <Transition name="bi-fade">
      <span v-if="open" class="bi-pop">
        {{ t('backend.notice') }}
        <a :href="repoUrl" target="_blank" rel="noopener">{{ t('backend.viewSource') }} →</a>
      </span>
    </Transition>
    <span v-if="open" class="bi-away" @click="open = false"></span>
  </span>
</template>

<style scoped>
.bi { position: relative; display: inline-flex; }
.bi-btn {
  width: 15px; height: 15px; border-radius: 50%; border: 1px solid var(--border);
  background: var(--surface-hover); color: var(--text-secondary);
  font-size: 10px; font-weight: 700; font-style: italic; line-height: 1; cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center; font-family: Georgia, serif;
}
.bi-btn:hover { color: var(--text); border-color: var(--text-tertiary); }
.bi-pop {
  position: absolute; top: calc(100% + 6px); right: 0; z-index: 300; width: 220px;
  background: var(--surface); border: 1px solid var(--border-light); border-radius: 10px;
  box-shadow: var(--shadow-lg); padding: 10px 12px; font-size: 11px; line-height: 1.5;
  color: var(--text-secondary); font-style: normal; font-weight: 400; text-align: left;
}
.bi-pop a { display: inline-block; margin-top: 6px; color: var(--accent); text-decoration: none; }
.bi-pop a:hover { text-decoration: underline; }
.bi-away { position: fixed; inset: 0; z-index: 290; }
.bi-fade-enter-active, .bi-fade-leave-active { transition: opacity 0.15s, transform 0.15s; }
.bi-fade-enter-from, .bi-fade-leave-to { opacity: 0; transform: translateY(-4px); }
</style>
