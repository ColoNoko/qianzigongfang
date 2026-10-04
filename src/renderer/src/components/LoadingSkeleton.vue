<script setup lang="ts">
// LoadingSkeleton — shimmer placeholder blocks shown while data is loading
// (e.g. during slow-NAS IPC calls). Renders a `rows` x `columns` grid of
// pulsing grey blocks using Tailwind tokens (bg-card-bg-hover + animate-pulse).
//
// Props:
//   rows    (default 3)  — number of skeleton rows
//   columns (default 1)  — number of skeleton columns per row
import { computed } from 'vue'

const props = withDefaults(defineProps<{ rows?: number; columns?: number }>(), {
  rows: 3,
  columns: 1
})

// Template-driven row/column arrays so v-for can iterate deterministically.
const rowList = computed(() => Array.from({ length: props.rows }, (_, i) => i))
const colList = computed(() => Array.from({ length: props.columns }, (_, i) => i))
</script>

<template>
  <div
    class="flex flex-col gap-3"
    role="status"
    aria-label="加载中"
  >
    <div
      v-for="r in rowList"
      :key="`skel-row-${r}`"
      class="flex gap-3"
    >
      <div
        v-for="c in colList"
        :key="`skel-${r}-${c}`"
        class="h-10 flex-1 rounded-badge bg-media-bg animate-pulse"
        data-testid="skeleton-block"
      />
    </div>
  </div>
</template>