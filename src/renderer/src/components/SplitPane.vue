<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useElementSize, useWindowSize } from '@vueuse/core'
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from './ui/resizable'
const props = withDefaults(defineProps<{ primaryPercent?: number; minPrimaryWindowRatio?: number; minSecondaryPx?: number }>(), { primaryPercent: 33.333, minPrimaryWindowRatio: .2, minSecondaryPx: 320 })
const emit = defineEmits<{ 'update:primaryPercent': [value: number] }>()
const container = ref<HTMLElement>()
const primary = ref<any>()
const { width } = useElementSize(container)
const { width: windowWidth } = useWindowSize()
const minimum = computed(() => width.value ? Math.min(80, windowWidth.value * props.minPrimaryWindowRatio / width.value * 100) : 20)
const secondaryMinimum = computed(() => width.value ? Math.min(100 - minimum.value, props.minSecondaryPx / width.value * 100) : 20)
const adjusted = ref(false)
let timer: ReturnType<typeof setTimeout> | undefined
function layout(values: number[]) {
  if (!adjusted.value || !Number.isFinite(values[0])) return
  clearTimeout(timer)
  timer = setTimeout(() => emit('update:primaryPercent', values[0]), 300)
}
watch(() => props.primaryPercent, value => { if (!adjusted.value) primary.value?.resize(value) }, { flush: 'post' })
onBeforeUnmount(() => clearTimeout(timer))
</script>
<template>
  <div ref="container" class="h-full min-h-0 min-w-0">
    <ResizablePanelGroup direction="horizontal" @layout="layout">
      <ResizablePanel ref="primary" :default-size="primaryPercent" :min-size="minimum" class="min-w-0 overflow-hidden"><slot name="primary" /></ResizablePanel>
      <ResizableHandle with-handle aria-label="调整项目列表宽度" data-testid="split-pane-divider" @pointerdown="adjusted = true" @keydown="adjusted = true" />
      <ResizablePanel :default-size="100 - primaryPercent" :min-size="secondaryMinimum" class="min-w-0 overflow-hidden"><slot name="secondary" /></ResizablePanel>
    </ResizablePanelGroup>
  </div>
</template>
