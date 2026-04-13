<script setup>
defineProps({
  message: String,
  visible: Boolean,
})
</script>

<template>
  <Transition name="toast">
    <div v-if="visible" class="toast" role="status" aria-live="polite">{{ message }}</div>
  </Transition>
</template>

<style scoped>
.toast {
  position: fixed;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  background: var(--text);
  color: var(--bg);
  padding: 10px 22px;
  border-radius: 999px;
  font-size: 13px;
  font-weight: 500;
  box-shadow: var(--shadow-lg);
  z-index: 999;
  white-space: nowrap;
  pointer-events: none;
}

.toast-enter-active { transition: all 0.35s cubic-bezier(0.16, 1, 0.3, 1); }
.toast-leave-active { transition: all 0.25s ease; }

.toast-enter-from {
  opacity: 0;
  transform: translateX(-50%) translateY(16px);
}

.toast-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(8px);
}
</style>
