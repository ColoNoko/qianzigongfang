<script setup lang="ts">
// ImageViewer — pan/zoom/fit image viewer, ported from
// oldcode/ui/comic_image_viewer.py:56-115 (_ImageView QGraphicsView).
//
// Porting map (PySide6 → web):
//   setRenderHint(SmoothPixmapTransform)  → image-rendering default (browser smooth)
//   DragMode.ScrollHandDrag               → mousedown/move/up with cursor grab/grabbing
//   TransformationAnchor.AnchorUnderMouse → zoom-around-mouse formula (see onWheel)
//   fitInView(sceneRect, KeepAspectRatio)  → fitScale = min(cw/iw, ch/ih)
//   wheelEvent Ctrl+wheel → scale(1.1|1/1.1) → onWheel factor = 1.1 | 1/1.1
//   resizeEvent → fitInView                → ResizeObserver → fitToContainer
//
// Shared with CompareViewer (task 5.3) for the jpg side and standalone inspection.
// Does NOT parse PSD — receives a single bitmap URL/DataURL and renders it.
//
// 缩放有两种模式（2026-09-27 新增受控模式，为了右下角那组缩放控件）：
//   · 不给 `zoomRatio` → **自管**（老行为一字不改）：滚轮/双击都在组件内部改倍数。
//   · 给了 `zoomRatio` → **受控**：倍数由父组件持有，这里只负责算像素，
//     滚轮算出新倍数后通过 `update:zoomRatio` 报上去 —— 于是按钮和滚轮转的是**同一个旋钮**。
// 平移（offset）**始终在组件内部**：对照状态两栏可以各自拖到不同位置，这是有意的。
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { MIN_ZOOM_RATIO, MAX_ZOOM_RATIO, clampZoomRatio } from '@renderer/features/project/viewer-zoom'

const props = defineProps<{ src: string; zoomRatio?: number }>()

const emit = defineEmits<{ (e: 'update:zoomRatio', ratio: number): void }>()

const containerRef = ref<HTMLDivElement | null>(null)
const imgRef = ref<HTMLImageElement | null>(null)

// Intrinsic image dimensions (populated on load).
const naturalWidth = ref(0)
const naturalHeight = ref(0)

// Zoom/pan reactive state. scale = absolute CSS scale; fitScale = scale at
// which the image fits entirely within the container (KeepAspectRatio).
// ratio = 相对 fitScale 的倍数（1 = 适应窗口 = 界面上的 100%）。
const ratio = ref(1)
const fitScale = ref(1)

/** 受控时以父组件的倍数为准，否则用内部这份。 */
const activeRatio = computed(() => clampZoomRatio(props.zoomRatio ?? ratio.value))
const scale = computed(() => fitScale.value * activeRatio.value)

/**
 * 最近一次由本组件上报出去的倍数。
 *
 * 用途：区分"这次倍数变化是我自己滚轮转的（offset 已经按鼠标锚点算过了）"
 * 与"外面按钮/输入框改的（需要按画面中心补一次 offset）"，避免重复缩放。
 */
let lastEmittedRatio: number | null = null
const offsetX = ref(0)
const offsetY = ref(0)

const loading = ref(true)
const error = ref(false)
const dragging = ref(false)

// Drag tracking (non-reactive — only needed during active drag).
let dragStartX = 0
let dragStartY = 0
let startOffsetX = 0
let startOffsetY = 0

let resizeObserver: ResizeObserver | null = null

// Image is centered via margins + left/top 50%, then transform handles pan/zoom.
// transform-origin defaults to center center, so scale radiates from the
// image center — matching QGraphicsView's AnchorUnderMouse when combined with
// the zoom-around-mouse offset formula in onWheel.
const imgStyle = computed(() => ({
  width: `${naturalWidth.value}px`,
  height: `${naturalHeight.value}px`,
  marginLeft: `${-naturalWidth.value / 2}px`,
  marginTop: `${-naturalHeight.value / 2}px`,
  transform: `translate(${offsetX.value}px, ${offsetY.value}px) scale(${scale.value})`
}))

const isZoomed = computed(() => activeRatio.value > 1 + 0.001)

const containerCursor = computed(() => {
  if (dragging.value) return 'grabbing'
  if (isZoomed.value) return 'grab'
  return 'default'
})

/** 唯一改倍数的地方：受控就报上去，自管就写内部状态。 */
function setRatio(next: number): void {
  const clamped = clampZoomRatio(next)
  if (props.zoomRatio === undefined) {
    ratio.value = clamped
    return
  }
  lastEmittedRatio = clamped
  emit('update:zoomRatio', clamped)
}

function computeFitScale(): number {
  const container = containerRef.value
  if (!container || !naturalWidth.value || !naturalHeight.value) return 1
  const cw = container.clientWidth
  const ch = container.clientHeight
  if (!cw || !ch) return 1
  // KeepAspectRatio: scale so the entire image is visible.
  return Math.min(cw / naturalWidth.value, ch / naturalHeight.value)
}

function clampOffsets(): void {
  const container = containerRef.value
  if (!container || !naturalWidth.value || !naturalHeight.value) return
  const cw = container.clientWidth
  const ch = container.clientHeight
  const displayedW = naturalWidth.value * scale.value
  const displayedH = naturalHeight.value * scale.value
  // Allow panning only within the overflow margin; if image is smaller than
  // container in a dimension, offset is clamped to 0.
  const maxX = Math.max(0, (displayedW - cw) / 2)
  const maxY = Math.max(0, (displayedH - ch) / 2)
  offsetX.value = Math.max(-maxX, Math.min(maxX, offsetX.value))
  offsetY.value = Math.max(-maxY, Math.min(maxY, offsetY.value))
}

function fitToContainer(): void {
  fitScale.value = computeFitScale()
  setRatio(MIN_ZOOM_RATIO)
  offsetX.value = 0
  offsetY.value = 0
}

/**
 * 只重算"适应窗口"的比例。
 *
 * 受控模式（右上角有缩放控件）下载入新图 / 容器尺寸变化**不能**把用户调好的倍数清掉
 * —— 那正是"打开缩略图条就白缩放了"的另一种形态。自管模式沿用老行为（吸附回适应窗口）。
 */
function syncFitScale(): void {
  const keepRatio = props.zoomRatio !== undefined
  fitScale.value = computeFitScale()
  if (keepRatio) {
    clampOffsets()
    return
  }
  setRatio(MIN_ZOOM_RATIO)
  offsetX.value = 0
  offsetY.value = 0
}

function onWheel(e: WheelEvent): void {
  if (!e.ctrlKey) return
  e.preventDefault()
  // deltaY < 0 = scroll up = zoom in (matches angleDelta().y() > 0 in oldcode).
  const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1
  const newRatio = activeRatio.value * factor
  // Don't zoom below fit — reset to fit instead.
  if (newRatio < MIN_ZOOM_RATIO) {
    fitToContainer()
    return
  }
  // Cap max zoom at 20x fit to prevent runaway scaling.
  if (newRatio > MAX_ZOOM_RATIO) return
  // Zoom around mouse: keep the image point under the cursor stationary.
  // Derived: newOffset = mouse * (1 - factor) + oldOffset * factor
  const container = containerRef.value
  if (!container) return
  const rect = container.getBoundingClientRect()
  const mx = e.clientX - rect.left - rect.width / 2
  const my = e.clientY - rect.top - rect.height / 2
  const actualFactor = newRatio / activeRatio.value
  offsetX.value = mx * (1 - actualFactor) + offsetX.value * actualFactor
  offsetY.value = my * (1 - actualFactor) + offsetY.value * actualFactor
  setRatio(newRatio)
  clampOffsets()
}

function onMouseDown(e: MouseEvent): void {
  if (!isZoomed.value) return
  dragging.value = true
  dragStartX = e.clientX
  dragStartY = e.clientY
  startOffsetX = offsetX.value
  startOffsetY = offsetY.value
  e.preventDefault()
}

function onMouseMove(e: MouseEvent): void {
  if (!dragging.value) return
  offsetX.value = startOffsetX + (e.clientX - dragStartX)
  offsetY.value = startOffsetY + (e.clientY - dragStartY)
  clampOffsets()
}

function onMouseUp(): void {
  dragging.value = false
}

function onDblClick(): void {
  fitToContainer()
}

function onImgLoad(): void {
  const img = imgRef.value
  if (!img) return
  naturalWidth.value = img.naturalWidth
  naturalHeight.value = img.naturalHeight
  loading.value = false
  error.value = false
  syncFitScale()
}

function onImgError(): void {
  loading.value = false
  error.value = true
  naturalWidth.value = 0
  naturalHeight.value = 0
}

watch(
  () => props.src,
  () => {
    loading.value = true
    error.value = false
    ratio.value = 1
    fitScale.value = 1
    offsetX.value = 0
    offsetY.value = 0
    naturalWidth.value = 0
    naturalHeight.value = 0
    // 受控模式下不动父组件的倍数：翻页保持缩放级别（"再看一遍同样的倍数"是很常见的诉求）。
    lastEmittedRatio = null
  }
)

/**
 * 受控模式：外面的按钮 / 输入框改了倍数 → 以**画面中心**为锚补一次平移。
 * 滚轮那条路自己在 onWheel 里算过锚点了（并记在 lastEmittedRatio 上），这里跳过，避免缩两次。
 */
watch(
  () => props.zoomRatio,
  (next, previous) => {
    if (next === undefined || previous === undefined) return
    if (lastEmittedRatio !== null && Math.abs(next - lastEmittedRatio) < 1e-9) {
      lastEmittedRatio = null
      return
    }
    lastEmittedRatio = null
    const factor = clampZoomRatio(next) / clampZoomRatio(previous)
    if (!Number.isFinite(factor) || factor === 1) return
    if (!isZoomed.value && factor < 1) {
      offsetX.value = 0
      offsetY.value = 0
      return
    }
    offsetX.value *= factor
    offsetY.value *= factor
    clampOffsets()
  }
)

onMounted(() => {
  const container = containerRef.value
  if (container) {
    resizeObserver = new ResizeObserver(() => {
      // Re-fit on container resize (mirrors oldcode resizeEvent → fitInView).
      if (naturalWidth.value > 0) syncFitScale()
    })
    resizeObserver.observe(container)
  }
  // Listen on window so drag continues even if cursor leaves the container.
  window.addEventListener('mousemove', onMouseMove)
  window.addEventListener('mouseup', onMouseUp)
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  window.removeEventListener('mousemove', onMouseMove)
  window.removeEventListener('mouseup', onMouseUp)
})
</script>

<template>
  <div
    ref="containerRef"
    class="relative h-full w-full overflow-hidden bg-app-bg select-none"
    :style="{ cursor: containerCursor }"
    @wheel="onWheel"
    @mousedown="onMouseDown"
    @dblclick="onDblClick"
  >
    <img
      v-show="!error && naturalWidth > 0"
      ref="imgRef"
      :src="src"
      draggable="false"
      class="absolute left-1/2 top-1/2 max-w-none max-h-none"
      :style="imgStyle"
      @load="onImgLoad"
      @error="onImgError"
    />
    <!-- Loading placeholder -->
    <div
      v-if="loading && !error"
      class="absolute inset-0 flex items-center justify-center text-sm text-text-tertiary"
    >
      加载中...
    </div>
    <!-- Broken-image placeholder -->
    <div
      v-if="error"
      class="absolute inset-0 flex items-center justify-center text-sm text-text-tertiary"
    >
      图片加载失败
    </div>
  </div>
</template>
