<script setup lang="ts">
import type { SplitterResizeHandleEmits, SplitterResizeHandleProps } from "reka-ui"
import type { HTMLAttributes } from "vue"
import { ref, onBeforeUnmount } from "vue"
import { reactiveOmit } from "@vueuse/core"
import { SplitterResizeHandle, useForwardPropsEmits } from "reka-ui"
import { cn } from "@renderer/lib/utils"

const props = defineProps<SplitterResizeHandleProps & { class?: HTMLAttributes["class"], withHandle?: boolean }>()
const emits = defineEmits<SplitterResizeHandleEmits>()

const delegatedProps = reactiveOmit(props, "class", "withHandle")

const forwarded = useForwardPropsEmits(delegatedProps, emits)
const handlePosition = ref<Record<string, string>>()
let activeHandle: HTMLElement | null = null
function followPointer(event: PointerEvent, element = event.currentTarget as HTMLElement) {
  if (!element) return
  const rect = element.getBoundingClientRect()
  const vertical = element.dataset.orientation === 'vertical'
  const length = vertical ? rect.width : rect.height
  const offset = vertical ? event.clientX - rect.left : event.clientY - rect.top
  const position = Math.max(Math.min(20, length / 2), Math.min(length - Math.min(20, length / 2), offset))
  handlePosition.value = vertical
    ? { left: `${position}px`, top: '50%', transform: 'translate(-50%, -50%) rotate(90deg)' }
    : { top: `${position}px`, left: '50%', transform: 'translate(-50%, -50%)' }
}
function moveActive(event: PointerEvent) { if (activeHandle) followPointer(event, activeHandle) }
function stopFollowing() {
  activeHandle = null
  window.removeEventListener('pointermove', moveActive)
  window.removeEventListener('pointerup', stopFollowing)
  window.removeEventListener('pointercancel', stopFollowing)
}
function startFollowing(event: PointerEvent) {
  if (event.button !== 0) return
  activeHandle = event.currentTarget as HTMLElement
  followPointer(event, activeHandle)
  window.addEventListener('pointermove', moveActive)
  window.addEventListener('pointerup', stopFollowing)
  window.addEventListener('pointercancel', stopFollowing)
}
onBeforeUnmount(stopFollowing)
</script>

<template>
  <SplitterResizeHandle v-bind="forwarded" @pointerenter="followPointer($event)" @pointermove="followPointer($event)" @pointerdown="startFollowing" :class="cn('group relative z-40 flex w-px items-center justify-center bg-border after:absolute after:inset-y-0 after:left-1/2 after:w-3 after:-translate-x-1/2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1 [&[data-orientation=vertical]]:h-px [&[data-orientation=vertical]]:w-full [&[data-orientation=vertical]]:after:left-0 [&[data-orientation=vertical]]:after:h-1 [&[data-orientation=vertical]]:after:w-full [&[data-orientation=vertical]]:after:-translate-y-1/2 [&[data-orientation=vertical]]:after:translate-x-0 [&[data-orientation=vertical]>div]:rotate-90', props.class)">
    <template v-if="props.withHandle">
      <div :style="handlePosition" class="pointer-events-none absolute flex h-10 w-7 shrink-0 items-center justify-center rounded-lg border border-primary/30 bg-primary text-primary-foreground shadow-md opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 group-data-[state=drag]:opacity-100">
        <svg viewBox="0 0 24 24" class="size-5" aria-hidden="true" fill="currentColor"><path d="M9 6 3 12l6 6V6Zm6 0v12l6-6-6-6Z" /></svg>
      </div>
    </template>
  </SplitterResizeHandle>
</template>
