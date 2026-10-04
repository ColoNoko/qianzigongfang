<script setup lang="ts">
// Global notification renderer. Auto-dismiss is owned by the toast store;
// TransitionGroup keeps removed notices mounted briefly for the fade-out.
import { storeToRefs } from 'pinia'
import { useToastStore } from '@renderer/stores/toast'

const store = useToastStore()
const { toasts } = storeToRefs(store)
</script>

<template>
  <TransitionGroup
    name="global-notification"
    tag="div"
    class="pointer-events-none fixed left-1/2 top-4 z-[100] flex -translate-x-1/2 flex-col items-center gap-2"
    data-testid="error-toast-container"
  >
    <button
      v-for="toast in toasts"
      :key="toast.id"
      type="button"
      class="pointer-events-auto min-w-64 max-w-[min(560px,calc(100vw-32px))] cursor-pointer rounded-lg px-5 py-3 text-center text-sm font-bold shadow-[var(--shadow-2)]"
      :class="
        toast.type === 'success' ? 'bg-accent text-text-on-accent' : 'bg-danger text-danger-fg'
      "
      @click="store.removeToast(toast.id)"
    >
      {{ toast.message }}
    </button>
  </TransitionGroup>
</template>

<style scoped>
.global-notification-enter-active,
.global-notification-leave-active {
  transition:
    opacity 300ms ease,
    transform 300ms ease;
}

.global-notification-enter-from,
.global-notification-leave-to {
  opacity: 0;
  transform: translateY(-10px);
}
</style>
