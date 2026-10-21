<script lang="ts">
// ThumbGrid — virtual-scrolling grid of thumbnail cards.
// Ported from oldcode/ui/widgets/thumbnail_grid.py. Only visible items
// (plus a 2-row buffer) are rendered in the DOM; a tall inner div drives
// the scrollbar. The `load` prop is a placeholder for task 4.4 IPC fetch.
import type { TypesetStatus, WorkMode } from '@shared/types'

export interface ThumbItem {
  id: string
  revision?: string
  error?: string
  fallback?: boolean
  filename: string
  thumbUrl: string | null
  mtimeText: string
  status: TypesetStatus
}

export type ThumbSize = '大' | '中' | '小'
</script>

<script setup lang="ts">
import { Button as UiButton } from '@renderer/components/ui/button'
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue'
import StatisticsTimeMenu from '@renderer/features/project/StatisticsTimeMenu.vue'
import { ContextMenu, ContextMenuTrigger, ContextMenuContent } from './ui/context-menu'
import { WORK_MODE_LABELS } from '@shared/modes'
const props = withDefaults(
  defineProps<{
    childId?: string
    items: ThumbItem[]
    thumbSize?: ThumbSize
    load?: (index: number, item: ThumbItem) => void
    /**
     * Selects the card action label — 去嵌字 for typeset (the default), 去翻译
     * for translated, and so on. Defaulting to typeset keeps the historical
     * label for every caller that does not know about modes.
     */
    mode?: WorkMode
  }>(),
  { thumbSize: '中', load: undefined, mode: 'typeset' }
)

const actionLabel = computed(() => `去${WORK_MODE_LABELS[props.mode]}`)

const emit = defineEmits<{
  (e: 'visible', ids: string[], nearby: string[]): void
  (e: 'retry', id: string): void
  (e: 'imageError', id: string, url: string): void
  (e: 'dblclick', id: string): void
  (e: 'action', id: string): void
  (e: 'mark', id: string): void
  (e: 'selectionChange', ids: string[]): void
}>()

// --- Constants (mirror oldcode thumbnail_grid.py) ---------------------------
// 间距从 4px 放到 10px：4px 时卡片几乎粘在一起，图与图之间没有任何停顿。
const GAP = 10
const BUFFER_ROWS = 2
const SCROLL_DEBOUNCE_MS = 80

// Minimum widths; distribute remaining row space, as in Comic Manager's auto-fill grid.
const SIZE_MAP: Record<ThumbSize, number> = { 小: 190, 中: 240, 大: 300 }

// --- Reactive state ---------------------------------------------------------
const scrollContainer = ref<HTMLElement | null>(null)
const scrollTop = ref(0)
const clientWidth = ref(0)
const clientHeight = ref(0)
const loadedIndices = ref<Set<number>>(new Set())
const selectedIds = ref<Set<string>>(new Set())
const selectionAnchorIndex = ref<number | null>(null)

let scrollTimer: ReturnType<typeof setTimeout> | null = null
let resizeObserver: ResizeObserver | null = null

// --- Computed dimensions ---------------------------------------------------
const cols = computed(() => Math.max(1, Math.floor((clientWidth.value + GAP) / (SIZE_MAP[props.thumbSize] + GAP))))
const dims = computed(() => {
  // Round down to prevent the last absolute card crossing the viewport by a subpixel.
  const frameW = Math.max(1, Math.floor(((clientWidth.value || SIZE_MAP[props.thumbSize]) - (cols.value - 1) * GAP) / cols.value))
  const imgW = Math.max(1, frameW - 18)
  const imgH = Math.round(imgW * 1.3)
  return { frameW, frameH: imgH + 62, imgW, imgH }
})
const rowHeight = computed(() => dims.value.frameH + GAP)

const totalRows = computed(() => Math.ceil(props.items.length / Math.max(1, cols.value)))
const totalHeight = computed(() => totalRows.value * rowHeight.value)

// Visible range (no buffer) — used for load decisions.
const visibleRange = computed(() => {
  const c = Math.max(1, cols.value)
  const rh = rowHeight.value
  const st = scrollTop.value
  const ch = clientHeight.value
  const count = props.items.length
  if (count === 0) return { first: 0, last: -1 }

  const first = Math.max(0, Math.floor(st / rh) * c)
  // ceil so that a viewport exactly N rows tall shows N rows, not N+1.
  const last = Math.min(count - 1, Math.ceil((st + ch) / rh) * c - 1)
  return { first, last }
})

// Render range (visible + buffer) — controls what's in the DOM.
const renderRange = computed(() => {
  const c = Math.max(1, cols.value)
  const { first, last } = visibleRange.value
  if (last < 0) return { first: 0, last: -1 }

  const firstRow = Math.floor(first / c)
  const lastRow = Math.floor(last / c)
  const bFirstRow = Math.max(0, firstRow - BUFFER_ROWS)
  const bLastRow = lastRow + BUFFER_ROWS

  const bFirst = bFirstRow * c
  const bLast = Math.min(props.items.length - 1, (bLastRow + 1) * c - 1)
  return { first: bFirst, last: bLast }
})

// Items to render in the DOM (positioned absolutely).
const visibleItems = computed(() => {
  const { first, last } = renderRange.value
  if (last < 0) return []
  const c = Math.max(1, cols.value)
  const fw = dims.value.frameW
  const rh = rowHeight.value
  const result: { index: number; item: ThumbItem; x: number; y: number }[] = []
  for (let i = first; i <= last; i++) {
    const row = Math.floor(i / c)
    const col = i % c
    result.push({
      index: i,
      item: props.items[i],
      x: col * (fw + GAP),
      y: row * rh
    })
  }
  return result
})

// --- Scroll + load logic ---------------------------------------------------
function onScroll(): void {
  if (scrollContainer.value) {
    scrollTop.value = scrollContainer.value.scrollTop
  }
  if (scrollTimer) clearTimeout(scrollTimer)
  scrollTimer = setTimeout(() => {
    measureAndLoad()
  }, SCROLL_DEBOUNCE_MS)
}

function measureAndLoad(): void {
  if (!scrollContainer.value) return

  // Read current dimensions from the DOM.
  clientWidth.value = scrollContainer.value.clientWidth
  clientHeight.value = scrollContainer.value.clientHeight
  scrollTop.value = scrollContainer.value.scrollTop

  const { first, last } = visibleRange.value
  const render = renderRange.value
  const visible = props.items.slice(first, last + 1)
  const nearby = props.items.slice(render.first, render.last + 1)
  emit(
    'visible',
    visible.map((item) => item.id),
    nearby.map((item) => item.id)
  )
  // Compatibility callback has no concurrency gate; scheduling belongs to the shared service.
  for (let i = first; i <= last; i++) {
    if (loadedIndices.value.has(i)) continue
    loadedIndices.value.add(i)
    props.load?.(i, props.items[i])
  }
}
function clearLoadState(): void {
  loadedIndices.value = new Set()
}

// --- Event handlers --------------------------------------------------------
function emitSelectionChange(): void {
  emit('selectionChange', [...selectedIds.value])
}

function setSelection(ids: string[], anchorIndex: number | null): void {
  selectedIds.value = new Set(ids)
  selectionAnchorIndex.value = anchorIndex
  emitSelectionChange()
}

function selectRange(fromIndex: number, toIndex: number): void {
  const start = Math.max(0, Math.min(fromIndex, toIndex))
  const end = Math.min(props.items.length - 1, Math.max(fromIndex, toIndex))
  const next = new Set(selectedIds.value)
  for (let index = start; index <= end; index++) {
    next.add(props.items[index].id)
  }
  selectedIds.value = next
  emitSelectionChange()
}

function handleCardClick(event: MouseEvent, index: number, id: string): void {
  const multiKey = event.ctrlKey || event.metaKey
  if (event.shiftKey) {
    const anchor = selectionAnchorIndex.value ?? index
    selectRange(anchor, index)
    return
  }

  if (multiKey) {
    const next = new Set(selectedIds.value)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    selectedIds.value = next
    selectionAnchorIndex.value = index
    emitSelectionChange()
    return
  }

  setSelection([id], index)
}

function handleKeydown(event: KeyboardEvent): void {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
    event.preventDefault()
    setSelection(
      props.items.map((item) => item.id),
      props.items.length > 0 ? 0 : null
    )
  }
}

function handleDblclick(id: string): void {
  emit('dblclick', id)
}

function handleAction(id: string): void {
  emit('action', id)
}

function handleMark(id: string): void {
  emit('mark', id)
}

function statusLabel(status: TypesetStatus): string {
  const label = WORK_MODE_LABELS[props.mode]
  return status === 'done' ? `已${label}，点击标记为未${label}` : `未${label}，点击标记为已${label}`
}

function isSelected(id: string): boolean {
  return selectedIds.value.has(id)
}

// --- Lifecycle -------------------------------------------------------------
onMounted(() => {
  if (scrollContainer.value) {
    clientWidth.value = scrollContainer.value.clientWidth
    clientHeight.value = scrollContainer.value.clientHeight
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => {
        nextTick(() => measureAndLoad())
      })
      resizeObserver.observe(scrollContainer.value)
    }
  }
  measureAndLoad()
})

onUnmounted(() => {
  if (scrollTimer) clearTimeout(scrollTimer)
  resizeObserver?.disconnect()
  resizeObserver = null
  emit('visible', [], [])
})

// When thumbSize changes, clear loaded state and re-measure.
watch(
  () => props.thumbSize,
  () => {
    clearLoadState()
    nextTick(() => measureAndLoad())
  }
)

watch(
  () => props.items.map((item) => [item.id, item.revision].join(':')).join('\n'),
  () => {
    const validIds = new Set(props.items.map((item) => item.id))
    const nextSelection = [...selectedIds.value].filter((id) => validIds.has(id))
    if (nextSelection.length !== selectedIds.value.size) {
      selectedIds.value = new Set(nextSelection)
      emitSelectionChange()
    }
    clearLoadState()
    nextTick(() => measureAndLoad())
  }
)

defineExpose({ measureAndLoad, scrollContainer, loadedIndices, selectedIds })
</script>

<template>
  <div
    ref="scrollContainer"
    class="h-full min-w-0 overflow-x-hidden overflow-y-auto bg-app-bg"
    style="scrollbar-gutter: stable"
    data-testid="thumb-grid"
    tabindex="0"
    @scroll="onScroll"
    @keydown="handleKeydown"
  >
    <div :style="{ height: totalHeight + 'px', position: 'relative' }">
      <ContextMenu v-for="vi in visibleItems" :key="vi.item.id"><ContextMenuTrigger as-child>
      <div
        class="thumb-card group absolute flex select-none flex-col items-center rounded-[var(--radius-card)] border border-border bg-card-bg p-2 shadow-[var(--shadow-card)] transition-[transform,box-shadow,border-color,background-color] duration-200 ease-out hover:-translate-y-0.5 hover:border-border-strong hover:shadow-[var(--shadow-card-hover)]"
        :class="
          isSelected(vi.item.id)
            ? 'border-accent bg-select-surface shadow-[var(--shadow-card-hover)]'
            : ''
        "
        :title="vi.item.filename"
        :style="{
          left: vi.x + 'px',
          top: vi.y + 'px',
          width: dims.frameW + 'px',
          height: dims.frameH + 'px'
        }"
        @click="handleCardClick($event, vi.index, vi.item.id)"
        @dblclick="handleDblclick(vi.item.id)"
      >
        <!-- Image area. 中性底：旧版这里用的是 --card-bg-hover（当时 = 强调色淡底），
             每张卡片因此都是一个蓝色块；强调色应该留给"可交互"，不该当背景。
             这必须是卡片里的第一个 div —— ThumbGrid.spec 靠它读内联宽高。 -->
        <div
          class="relative flex shrink-0 items-center justify-center overflow-hidden rounded-md bg-media-bg"
          :style="{ width: dims.imgW + 'px', height: dims.imgH + 'px' }"
        >
          <img
            v-if="vi.item.thumbUrl"
            :src="vi.item.thumbUrl"
            class="max-w-full max-h-full object-contain"
            :alt="vi.item.filename"
            @error="emit('imageError', vi.item.id, vi.item.thumbUrl!)"
          />
          <div
            v-else
            class="flex h-full w-full items-center justify-center text-text-tertiary text-xs"
          >
            {{ vi.item.error ? '预览不可用' : '加载中…' }}
          </div>

          <UiButton variant="ghost" size="sm"
            v-if="vi.item.error || vi.item.fallback"
            type="button"
            class="absolute inset-x-1 bottom-1"
            :title="vi.item.error"
            @click.stop="emit('retry', vi.item.id)"
            @dblclick.stop
          >
            {{ vi.item.fallback ? '原图代替 · 重试 PSD' : '重新加载' }}
          </UiButton>

          <!-- 选中角标。纯 SVG，不带文字节点：ThumbGrid.spec 会读整棵树的 text()。 -->
          <span
            v-if="isSelected(vi.item.id)"
            class="absolute right-1.5 top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-accent text-text-on-accent"
            aria-hidden="true"
          >
            <svg
              class="h-2.5 w-2.5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="3.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </span>
        </div>

        <div class="mt-2 flex w-full min-w-0 shrink-0 items-center gap-1.5">
          <div class="min-w-0 flex-1">
            <div class="truncate text-xs leading-5 text-foreground" :title="vi.item.filename">{{ vi.item.filename }}</div>
            <div class="truncate text-[11px] leading-4 tabular-nums text-muted-foreground" :title="vi.item.mtimeText">{{ vi.item.mtimeText }}</div>
          </div>
          <UiButton v-if="vi.item.status !== 'none'" variant="ghost" size="icon-sm"
            class="thumb-status size-8 shrink-0 rounded-md" :aria-label="statusLabel(vi.item.status)"
            :aria-pressed="vi.item.status === 'done'" :title="statusLabel(vi.item.status)"
            @click.stop="handleMark(vi.item.id)" @dblclick.stop>
            <svg class="!size-[10px]" viewBox="0 0 10 10" aria-hidden="true" :class="vi.item.status === 'done' ? 'text-primary' : 'text-muted-foreground'"><circle cx="5" cy="5" r="4" :fill="vi.item.status === 'done' ? 'currentColor' : 'none'" stroke="currentColor" stroke-width="1" :stroke-dasharray="vi.item.status === 'done' ? undefined : '1 1'" /></svg>
          </UiButton>
          <UiButton variant="outline" size="sm" class="thumb-action shrink-0 px-2"
            @click.stop="handleAction(vi.item.id)" @dblclick.stop>{{ actionLabel }}</UiButton>
        </div>
      </div>
      </ContextMenuTrigger><ContextMenuContent v-if="childId"><StatisticsTimeMenu :target="{ childId, paths: isSelected(vi.item.id) ? [...selectedIds] : [vi.item.id] }" :mode="mode" /></ContextMenuContent></ContextMenu>
    </div>
  </div>
</template>
