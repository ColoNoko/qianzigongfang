<script setup lang="ts">
// NetworkRetry — slow-NAS / disconnect overlay. Shown when an IPC load is
// taking too long or has failed. Displays a loading message, an optional
// error string, and a retry button that emits `retry`.
//
// Props:
//   message (default '网络较慢，正在加载...') — loading hint text
//   error   (string | null)                  — error text, shown when non-null
//
// Emits:
//   retry — fired when the retry button is clicked
import { computed } from 'vue'

const props = withDefaults(defineProps<{ message?: string; error?: string | null }>(), {
  message: '网络较慢，正在加载...',
  error: null
})
const emit = defineEmits<{ (event: 'retry'): void }>()

const hasError = computed(() => props.error !== null && props.error !== '')
</script>

<template>
  <div
    class="flex flex-col items-center justify-center gap-4 p-6 text-center"
    role="alert"
    :aria-live="hasError ? 'assertive' : 'polite'"
  >
    <!-- Loading message -->
    <p class="text-text-secondary text-sm">{{ message }}</p>

    <!-- Error text (only when error prop is non-empty) -->
    <p v-if="hasError" class="text-danger text-xs">{{ error }}</p>

    <!-- Retry button -->
    <button
      type="button"
      class="rounded-badge bg-accent px-4 py-2 text-text-on-accent text-sm transition-colors hover:bg-primary-hover active:bg-primary-active"
      data-testid="retry-button"
      @click="emit('retry')"
    >
      重试
    </button>
  </div>
</template>
