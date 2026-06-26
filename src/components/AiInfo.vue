<script setup>
// 「i」 marker for the AI settings — explains that the API key is stored locally and that
// requests go to the user's configured endpoint. Popover teleported to <body> so it never
// clips inside the Settings drawer (same pattern as BackendInfo).
import { ref, nextTick } from 'vue'
import { useI18n } from '../composables/useI18n'

const { t } = useI18n()
const open = ref(false)
const triggerEl = ref(null)
const popStyle = ref({})

async function toggle() {
  open.value = !open.value
  if (open.value) { await nextTick(); position() }
}
function position() {
  const el = triggerEl.value
  if (!el || typeof window === 'undefined') return
  const r = el.getBoundingClientRect()
  popStyle.value = {
    top: `${Math.round(r.bottom + 6)}px`,
    right: `${Math.round(Math.max(8, window.innerWidth - r.right))}px`,
  }
}
</script>

<template>
  <span class="bi">
    <button ref="triggerEl" class="bi-btn" type="button" :aria-label="t('settings.aiPrivacy')" @click.stop="toggle">i</button>
    <Teleport to="body">
      <span v-if="open" class="bi-away" @click="open = false"></span>
      <Transition name="bi-fade">
        <span v-if="open" class="bi-pop" :style="popStyle">{{ t('settings.aiPrivacy') }}</span>
      </Transition>
    </Teleport>
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
  position: fixed; z-index: 600; width: 240px; max-width: 88vw;
  background: var(--surface); border: 1px solid var(--border-light); border-radius: 10px;
  box-shadow: var(--shadow-lg); padding: 10px 12px; font-size: 11px; line-height: 1.5;
  color: var(--text-secondary); font-style: normal; font-weight: 400; text-align: left;
}
.bi-away { position: fixed; inset: 0; z-index: 590; }
.bi-fade-enter-active, .bi-fade-leave-active { transition: opacity 0.15s, transform 0.15s; }
.bi-fade-enter-from, .bi-fade-leave-to { opacity: 0; transform: translateY(-4px); }
</style>
