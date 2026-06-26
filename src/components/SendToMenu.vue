<script setup>
// Shared "Send to →" control for cross-module file flow. Given a payload (File/Blob/string) and a
// `kind`, it lists the sensible target modules (from useHandoff's HANDOFF_TARGETS), stages the
// payload, and navigates there. The target module picks it up on mount via handoff.take().
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from '../composables/useI18n'
import { useHandoff } from '../composables/useHandoff'

const props = defineProps({
  payload: { default: null },                 // File | Blob | string to hand off
  kind: { type: String, required: true },     // 'image' | 'audio' | 'video' | 'text' | 'subtitle'
  from: { type: String, default: '' },        // origin route (excluded from the target list)
})
const { t } = useI18n()
const router = useRouter()
const handoff = useHandoff()
const open = ref(false)
const targets = computed(() => handoff.targetsFor(props.kind).filter(tg => tg.route !== props.from))

function go(target) {
  open.value = false
  if (props.payload == null) return
  handoff.send(props.payload, { kind: target.kind, from: props.from })
  router.push(target.route)
}
</script>

<template>
  <div v-if="targets.length" class="sendto">
    <button class="sendto-btn" :disabled="payload == null" @click="open = !open">
      <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 1.5L7 9"/><path d="M14.5 1.5l-4.7 13-2.6-5.7L1.5 6.2z"/></svg>
      <span>{{ t('handoff.sendTo') }}</span>
    </button>
    <template v-if="open">
      <div class="sendto-away" @click="open = false"></div>
      <div class="sendto-menu">
        <button v-for="tg in targets" :key="tg.route" class="sendto-item" @click="go(tg)">{{ t(tg.i18n) }}</button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.sendto { position: relative; display: inline-block; }
.sendto-btn { display: inline-flex; align-items: center; gap: 6px; padding: 8px 13px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); color: var(--text); font-size: 12.5px; font-family: var(--font-sans); cursor: pointer; }
.sendto-btn:hover { background: var(--surface-hover); }
.sendto-btn:disabled { opacity: 0.45; cursor: default; }
.sendto-btn svg { color: var(--accent); }
.sendto-away { position: fixed; inset: 0; z-index: 60; }
.sendto-menu { position: absolute; z-index: 61; top: calc(100% + 5px); left: 0; min-width: 190px; background: var(--surface); border: 1px solid var(--border-light); border-radius: 10px; box-shadow: var(--shadow-lg); padding: 5px; animation: stIn 0.12s var(--ease-out); }
@keyframes stIn { from { opacity: 0; transform: translateY(-3px); } to { opacity: 1; transform: translateY(0); } }
.sendto-item { display: block; width: 100%; text-align: left; padding: 9px 11px; border: none; border-radius: 6px; background: transparent; color: var(--text); font-size: 13px; font-family: var(--font-sans); cursor: pointer; }
.sendto-item:hover { background: var(--surface-hover); }
</style>
