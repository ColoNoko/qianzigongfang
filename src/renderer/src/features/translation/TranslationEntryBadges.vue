<script setup lang="ts">
import { computed } from 'vue'
import { lpGroupVarFor } from './group-colors'

const props = defineProps<{
  index: number
  group: string
  groups: string[]
}>()
const groupColor = computed(() => {
  const token =
    props.group === '框内'
      ? '--lp-group-1'
      : props.group === '框外'
        ? '--lp-group-2'
        : lpGroupVarFor(props.groups, props.group)
  return `var(${token.replace('--lp-group-', '--lp-label-')})`
})
</script>

<template>
  <span
    class="mr-1 mt-1 inline-flex shrink-0 self-start"
    :data-testid="`translation-labels-${index}`"
  >
    <span
      class="flex size-[34px] flex-col overflow-hidden rounded-md border text-text-primary"
      :style="{
        borderColor: `color-mix(in srgb, ${groupColor} 60%, var(--card-bg))`,
        backgroundColor: `color-mix(in srgb, ${groupColor} 10%, var(--card-bg))`
      }"
    >
      <span class="flex min-h-0 flex-[2] items-center justify-center font-mono text-xs tabular-nums">{{
        String(index).padStart(2, '0')
      }}</span>
      <span
        class="flex min-h-0 flex-1 items-center justify-center px-0.5 text-[9px] leading-none"
        :style="{ color: groupColor }"
        :title="group"
        ><span class="truncate">{{ group }}</span></span
      >
    </span>
  </span>
</template>
