<script lang="ts">
// ThumbGrid — virtual-scrolling grid of thumbnail cards.
// Ported from oldcode/ui/widgets/thumbnail_grid.py. Only visible items
// (plus a 2-row buffer) are rendered in the DOM; a tall inner div drives
// the scrollbar. The `load` prop is a placeholder for task 4.4 IPC fetch.
import type { TypesetStatus, WorkMode } from '@shared/types'

export interface ThumbItem {
  id: string
  filename: string
  thumbUrl: string | null
  mtimeText: string
  status: TypesetStatus
}

export type ThumbSize = '大' | '中' | '小'
</script>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { WORK_MODE_LABELS } from '@shared/modes'
const props = withDefaults(
  defineProps<{
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
  (e: 'dblclick', id: string): void
  (e: 'action', id: string): void
  (e: 'mark', id: string): void
  (e: 'selectionChange', ids: string[]): void
}>()

// --- Constants (mirror oldcode thumbnail_grid.py) ---------------------------
// 间距从 4px 放到 10px：4px 时卡片几乎粘在一起，图与图之间没有任何停顿。
const GAP = 10
const MAX_WORKERS = 4
const BUFFER_ROWS = 2
const SCROLL_DEBOUNCE_MS = 80
const FLUSH_DEBOUNCE_MS = 16

const SIZE_MAP: Record<ThumbSize, { frameW: number; frameH: number; imgW: number; imgH: number }> =
  {
    // 图片区仍是上一轮的 1.5 倍预设（宽高比不变），但**外框必须容纳得下内容**：
    //
    //   frameW = imgW + 18   （2px 边框 + 两侧各 8px 内边距）
    //   frameH = imgH + 72   （2px 边框 + 16px 内边距 + 信息区约 54px）
    //
    // 旧值是 frameW = imgW + 8、frameH = imgH + 34 —— 信息区实际需要约 54px，
    // 于是 flex 只能压缩图片：中号声明 208px、实际只渲染到约 170px（少 18%），
    // 页面按 0.7 宽高比 contain 之后左右各露出约 21px 的底色。这就是"卡片挤"的
    // 真正原因，不是间距问题。改这三个数字前请先量一遍渲染结果。
    小: { frameW: 143, frameH: 230, imgW: 125, imgH: 158 },
    中: { frameW: 180, frameH: 280, imgW: 162, imgH: 208 },
    大: { frameW: 229, frameH: 346, imgW: 211, imgH: 274 }
  }

// --- Reactive state ---------------------------------------------------------
const scrollContainer = ref<HTMLElement | null>(null)
const scrollTop = ref(0)
const clientWidth = ref(0)
const clientHeight = ref(0)
const loadedIndices = ref<Set<number>>(new Set())
const selectedIds = ref<Set<string>>(new Set())
const selectionAnchorIndex = ref<number | null>(null)

// AbortController per index — abort when item leaves the buffered range.
const abortControllers = new Map<number, AbortController>()

let scrollTimer: ReturnType<typeof setTimeout> | null = null
let flushTimer: ReturnType<typeof setTimeout> | null = null
let resizeObserver: ResizeObserver | null = null

// --- Computed dimensions ---------------------------------------------------
const dims = computed(() => SIZE_MAP[props.thumbSize])
const rowHeight = computed(() => dims.value.frameH + GAP)

const cols = computed(() => {
  if (clientWidth.value <= 0) return 1
  return Math.max(1, Math.floor((clientWidth.value + GAP) / (dims.value.frameW + GAP)))
})

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

  const count = props.items.length
  if (count === 0) return

  // Abort out-of-range items.
  const { first: vFirst, last: vLast } = visibleRange.value
  const c = Math.max(1, cols.value)
  const firstRow = Math.floor(vFirst / c)
  const lastRow = vLast >= 0 ? Math.floor(vLast / c) : 0
  const keepLo = Math.max(0, firstRow - BUFFER_ROWS) * c
  const keepHi = Math.min(count - 1, (lastRow + BUFFER_ROWS + 1) * c - 1)

  for (const [idx, controller] of abortControllers) {
    if (idx < keepLo || idx > keepHi) {
      controller.abort()
      abortControllers.delete(idx)
    }
  }

  // Load newly-visible items up to MAX_WORKERS at a time.
  if (!props.load) return
  let loadCount = 0
  for (let i = vFirst; i <= vLast && loadCount < MAX_WORKERS; i++) {
    if (i < 0 || i >= count) continue
    if (loadedIndices.value.has(i)) continue
    if (abortControllers.has(i)) continue

    const controller = new AbortController()
    abortControllers.set(i, controller)
    const next = new Set(loadedIndices.value)
    next.add(i)
    loadedIndices.value = next
    props.load(i, props.items[i])
    loadCount++
  }

  // Schedule a flush (placeholder for batching UI updates).
  if (flushTimer) clearTimeout(flushTimer)
  flushTimer = setTimeout(() => {
    // In Vue, reactivity handles UI updates automatically.
    // This timer exists to mirror the oldcode 16ms flush debounce.
  }, FLUSH_DEBOUNCE_MS)
}

function clearLoadState(): void {
  loadedIndices.value = new Set()
  abortControllers.forEach((c) => c.abort())
  abortControllers.clear()
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
  return status === 'done' ? '已嵌字，点击标记为未嵌字' : '待嵌字，点击标记为已嵌字'
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
  if (flushTimer) clearTimeout(flushTimer)
  resizeObserver?.disconnect()
  resizeObserver = null
  abortControllers.forEach((c) => c.abort())
  abortControllers.clear()
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
  () => props.items.map((item) => item.id).join('\n'),
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
    class="h-full overflow-auto bg-app-bg"
    tabindex="0"
    @scroll="onScroll"
    @keydown="handleKeydown"
  >
    <div :style="{ height: totalHeight + 'px', position: 'relative' }">
      <div
        v-for="vi in visibleItems"
        :key="vi.item.id"
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
          class="relative flex items-center justify-center overflow-hidden rounded-md bg-media-bg"
          :style="{ width: dims.imgW + 'px', height: dims.imgH + 'px' }"
        >
          <img
            v-if="vi.item.thumbUrl"
            :src="vi.item.thumbUrl"
            class="max-w-full max-h-full object-contain"
            :alt="vi.item.filename"
          />
          <div
            v-else
            class="flex h-full w-full items-center justify-center text-text-tertiary text-xs"
          >
            ...
          </div>

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

        <!-- Info area: 名称 + 日期一行，状态点 + 动作一行（三行改两行，省下的高度还给图片）。 -->
        <div class="mt-2 flex w-full min-w-0 items-center justify-between gap-1.5">
          <span class="min-w-0 flex-1 truncate text-[12px] leading-4 text-text-primary">
            {{ vi.item.filename }}
          </span>
          <span class="shrink-0 text-[11px] leading-4 tabular-nums text-text-tertiary">
            {{ vi.item.mtimeText }}
          </span>
        </div>
        <div class="mt-1.5 flex w-full items-center justify-between">
          <button
            v-if="vi.item.status !== 'none'"
            class="thumb-status flex h-5 w-5 items-center justify-center rounded-full transition-colors hover:bg-surface-pressed"
            :aria-label="statusLabel(vi.item.status)"
            @click.stop="handleMark(vi.item.id)"
          >
            <!-- 已完成用 --done（樱花粉）：它和"可点击"的主色在色相上分开，
                 一眼就能扫出一话里哪些做完了。 -->
            <span
              class="inline-block h-3 w-3 rounded-full"
              :class="
                vi.item.status === 'done'
                  ? 'bg-done'
                  : 'border-[1.5px] border-border-strong bg-transparent'
              "
            />
          </button>
          <span v-else class="h-5 w-5" aria-hidden="true" />

          <button
            class="thumb-action flex h-5 shrink-0 items-center rounded-full border border-border bg-card-bg px-2 text-[11px] font-medium leading-none text-accent transition-colors hover:border-accent hover:bg-primary-soft"
            @click.stop="handleAction(vi.item.id)"
          >
            {{ actionLabel }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
