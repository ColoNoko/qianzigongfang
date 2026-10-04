<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = withDefaults(
  defineProps<{
    /**
     * Width of the primary (list) pane as a percentage.
     *
     * Doubles as the initial value and as the live value: when the owner loads a
     * persisted width after mount this pane follows it — unless the user has
     * already moved the divider themselves, which always wins.
     */
    primaryPercent?: number
    minPrimaryWindowRatio?: number
    minSecondaryPx?: number
  }>(),
  {
    primaryPercent: 33.333,
    minPrimaryWindowRatio: 0.2,
    minSecondaryPx: 320
  }
)

const emit = defineEmits<{
  (e: 'update:primaryPercent', value: number): void
}>()

/** Collapses arrow-key repeats into one persisted value. */
const KEYBOARD_SAVE_DEBOUNCE_MS = 300

const container = ref<HTMLElement | null>(null)
const primaryWidth = ref(`${props.primaryPercent}%`)
const dragging = ref(false)
let resizeObserver: ResizeObserver | undefined
let saveTimer: ReturnType<typeof setTimeout> | null = null
// Set once the user moves the divider; a persisted width arriving later (an
// async settings load) must not undo their adjustment.
let userAdjusted = false

function bounds(): { left: number; width: number; min: number; max: number } | null {
  const rect = container.value?.getBoundingClientRect()
  if (!rect || rect.width <= 0) return null
  const min = Math.min(rect.width, window.innerWidth * props.minPrimaryWindowRatio)
  const max = Math.max(min, rect.width - props.minSecondaryPx)
  return { left: rect.left, width: rect.width, min, max }
}

function setPrimaryPixels(value: number): void {
  const limit = bounds()
  if (!limit) return
  const next = Math.min(limit.max, Math.max(limit.min, value))
  primaryWidth.value = `${(next / limit.width) * 100}%`
}

function currentPixels(): number {
  const limit = bounds()
  if (!limit) return 0
  return (Number.parseFloat(primaryWidth.value) / 100) * limit.width
}

function currentPercent(): number {
  const parsed = Number.parseFloat(primaryWidth.value)
  if (!Number.isFinite(parsed)) return props.primaryPercent
  // Trim float noise so the stored value stays readable.
  return Math.round(parsed * 1000) / 1000
}

function notifyPercent(): void {
  emit('update:primaryPercent', currentPercent())
}

function scheduleNotify(): void {
  cancelScheduledNotify()
  saveTimer = setTimeout(() => {
    saveTimer = null
    notifyPercent()
  }, KEYBOARD_SAVE_DEBOUNCE_MS)
}

function cancelScheduledNotify(): void {
  if (!saveTimer) return
  clearTimeout(saveTimer)
  saveTimer = null
}

function onPointerMove(event: PointerEvent): void {
  if (!dragging.value) return
  const limit = bounds()
  if (limit) setPrimaryPixels(event.clientX - limit.left)
}

function detachDragListeners(): void {
  document.body.style.removeProperty('user-select')
  document.body.style.removeProperty('cursor')
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', onPointerUp)
  window.removeEventListener('pointercancel', onPointerUp)
}

/** `notify` is false when the component is being torn down mid-drag. */
function finishDrag(notify: boolean): void {
  if (!dragging.value) return
  dragging.value = false
  detachDragListeners()
  // Persist on release only — a drag fires pointermove continuously and every
  // intermediate width would be a database write.
  if (notify) notifyPercent()
}

function onPointerUp(): void {
  finishDrag(true)
}

function startDrag(event: PointerEvent): void {
  event.preventDefault()
  userAdjusted = true
  dragging.value = true
  document.body.style.userSelect = 'none'
  document.body.style.cursor = 'col-resize'
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp)
  window.addEventListener('pointercancel', onPointerUp)
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
  event.preventDefault()
  userAdjusted = true
  setPrimaryPixels(currentPixels() + (event.key === 'ArrowLeft' ? -24 : 24))
  scheduleNotify()
}

const primaryStyle = computed(() => ({ width: primaryWidth.value }))

// Follow a width that arrives after mount (persisted settings load).
watch(
  () => props.primaryPercent,
  (value) => {
    if (userAdjusted || dragging.value) return
    if (typeof value !== 'number' || !Number.isFinite(value)) return
    primaryWidth.value = `${value}%`
    setPrimaryPixels(currentPixels())
  }
)

onMounted(() => {
  setPrimaryPixels(currentPixels())
  if (typeof ResizeObserver !== 'undefined') {
    // Re-clamps on window resize. Deliberately silent: shrinking the window
    // must not permanently shrink the stored list width.
    resizeObserver = new ResizeObserver(() => setPrimaryPixels(currentPixels()))
    if (container.value) resizeObserver.observe(container.value)
  }
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  cancelScheduledNotify()
  finishDrag(false)
})
</script>

<template>
  <div ref="container" class="flex h-full min-h-0 min-w-0">
    <div class="min-w-0 shrink-0 overflow-hidden" :style="primaryStyle">
      <slot name="primary" />
    </div>
    <div
      class="group relative z-10 flex w-2 shrink-0 cursor-col-resize items-center justify-center focus:outline-none"
      role="separator"
      aria-orientation="vertical"
      aria-label="调整项目列表宽度"
      tabindex="0"
      data-testid="split-pane-divider"
      @pointerdown="startDrag"
      @keydown="onKeydown"
    >
      <div
        class="h-1/4 min-h-12 max-h-32 w-1 rounded-badge bg-text-tertiary/40 transition-colors group-hover:bg-accent group-focus:bg-accent"
      />
    </div>
    <div class="min-w-0 flex-1 overflow-hidden">
      <slot name="secondary" />
    </div>
  </div>
</template>
