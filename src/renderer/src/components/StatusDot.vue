<script setup lang="ts">
// StatusDot — 8px status indicator for a PsdEntry's TypesetStatus.
//   done    → solid completion-coloured dot (--done)，与缩略图卡片上的状态点同色
//   pending → hollow ring (border-strong, transparent centre)
//   none    → renders nothing (v-if false)
import type { TypesetStatus } from '@shared/types'

defineProps<{ status: TypesetStatus }>()
</script>

<template>
  <span
    v-if="status !== 'none'"
    class="inline-block w-2 h-2 rounded-full"
    :class="
      status === 'done'
        ? 'bg-done'
        : 'border-[1.5px] border-border-strong bg-transparent'
    "
    :aria-label="status === 'done' ? '已嵌字' : '待嵌字'"
  />
</template>