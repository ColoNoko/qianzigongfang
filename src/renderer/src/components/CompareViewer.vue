<script setup lang="ts">
// CompareViewer — split 50/50 panel comparing a JPG preview (left) against
// the rendered PSD bitmap (right). The PSD is parsed off the main thread via
// PsdWorkerPool so the UI stays responsive (skeleton shown while parsing).
//
// Task 5.3 of the work plan.
// Inline in the Project view (not a modal). Parent toggles `visible` and
// listens for the `close` event (button or ESC).
import { basenameOf } from '@shared/paths'
import { pairKeyOf } from '@shared/pair'
import { computed, ref, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import ImageViewer from './ImageViewer.vue'
import { STRIP_BAR_HEIGHT_PX } from './PreviewThumbStrip.vue'
import { PsdWorkerPool } from '@renderer/workers/psd-pool'
import {
  parseZoomPercentInput,
  zoomIn,
  zoomOut,
  zoomPercentLabel
} from '@renderer/features/project/viewer-zoom'
import type { WorkMode } from '@shared/types'
import { WORK_MODE_LABELS } from '@shared/modes'

const props = withDefaults(
  defineProps<{
    jpgPath: string | undefined
    psdPath: string
    folderPath?: string
    visible: boolean
    /** Mirrors the project page's active work mode — label only. */
    mode?: WorkMode
    /**
     * 只有图片的条目（扫描器的 `previewOnly` 回退项：整个目录没有 PSD）时的布局。
     * 注意此时 `psdPath` 里装的是**图片路径**，必须忽略它：不解析 PSD、不渲染右栏，
     * 整屏只显示原图。仅当 `imageOnly === true` 时才允许这样传值。
     */
    imageOnly?: boolean
    /**
     * 页脚那个 ▶ 正在播放中。
     *
     * 只为 Esc 服务：播放时 Esc **先停播放**（不关窗），再按一次才退出预览；
     * 没在播放时保持老行为（Esc = 退出预览）。默认 false，所以既有用例一条都不用改。
     */
    playing?: boolean
    /** 底部缩略图条展开中 → 右下角缩放控件往上让位，别被压住。 */
    thumbStripOpen?: boolean
    /** 「标记后自动翻下一张」（C3）。开关本身持久化在设置里，这里只是显示它的当前值。 */
    advanceAfterMark?: boolean
  }>(),
  { mode: 'typeset', imageOnly: false, playing: false, thumbStripOpen: false, advanceAfterMark: false }
)

// Same wording rule as the thumbnail cards: 去嵌字 / 去翻译 / 去校对 / 去监修.
const actionLabel = computed(() => `去${WORK_MODE_LABELS[props.mode]}`)

/** Image-only entries have no PSD side, so the header must not promise one. */
const headerLabel = computed(() => (props.imageOnly ? '图片预览' : '对照视图'))

/** 与工具栏同一套文案：标记监修 / 标记未监修。 */
const markDoneLabel = computed(() => `标记${WORK_MODE_LABELS[props.mode]}`)
const markPendingLabel = computed(() => `标记未${WORK_MODE_LABELS[props.mode]}`)

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'openPsd'): void
  (e: 'previous'): void
  (e: 'next'): void
  /** 标记**当前显示的这张**。 */
  (e: 'mark', status: 'done' | 'pending'): void
  /**
   * 这一张**显示好了**（两栏都落定：要么有图、要么明确不可用/解析失败）。
   * 页脚的自动播放用它做节拍起点 —— 慢的 PSD 才不会变成"一路看骨架屏"。
   */
  (e: 'ready'): void
  /** 播放中按了 Esc：只停播放，不关窗（页脚负责把 ▶ 变回去）。 */
  (e: 'stopPlayback'): void
  /** 用户点了页头那枚「标记后下一张」开关（由宿主写进设置）。 */
  (e: 'update:advanceAfterMark', value: boolean): void
}>()

// --- State -----------------------------------------------------------------
const jpgUrl = ref<string | null>(null)
const jpgUnavailable = ref(false)
const psdUrl = ref<string | null>(null)
const psdUrlPath = ref<string | null>(null)
const psdLoading = ref(false)
const psdError = ref(false)
let sourceSeq = 0

// --- Zoom（右下角那组控件）---------------------------------------------------
// 倍数**只有这一份**：按钮、输入框、两栏的 Ctrl+滚轮改的都是它。
// 语义 = 相对各自"适应窗口"的倍数（适应窗口 = 100%）—— 于是对照状态一个数字就能描述两栏
// （两栏像素尺寸常常不同，绝对像素比是没法共用一个数字的）。
const zoomRatio = ref(1)
const zoomPercent = computed(() => zoomPercentLabel(zoomRatio.value))
const zoomInputOpen = ref(false)
const zoomDraft = ref('')
const zoomInputRef = ref<HTMLInputElement | null>(null)

function onZoomIn(): void {
  zoomRatio.value = zoomIn(zoomRatio.value)
}

function onZoomOut(): void {
  zoomRatio.value = zoomOut(zoomRatio.value)
}

/** 「一键回默认」= 适应窗口 = 100%（和双击画面同一件事）。 */
function onZoomFit(): void {
  zoomRatio.value = 1
}

function openZoomInput(): void {
  zoomDraft.value = String(Math.round(zoomRatio.value * 100))
  zoomInputOpen.value = true
  void nextTick(() => {
    zoomInputRef.value?.focus()
    zoomInputRef.value?.select()
  })
}

/** 看不懂的输入（空、abc、负数）就当没发生 —— 界面保持原值，不静默改成别的数。 */
function commitZoomInput(): void {
  const parsed = parseZoomPercentInput(zoomDraft.value)
  if (parsed !== null) zoomRatio.value = parsed
  zoomInputOpen.value = false
}

function cancelZoomInput(): void {
  zoomDraft.value = ''
  zoomInputOpen.value = false
}

/**
 * 「这一张显示好了」——自动播放的节拍起点。
 *
 * 判据是两栏都**落定**：有图 / 明确没有同名图 / PSD 解析失败，三者都算落定
 * （失败的页面也必须让播放往下走，否则一张坏 PSD 就把播放钉死了）。
 */
const jpgSettled = computed(() => jpgUrl.value !== null || jpgUnavailable.value)
const psdSettled = computed(() => props.imageOnly || psdUrl.value !== null || psdError.value)
watch(
  () => props.visible && jpgSettled.value && psdSettled.value,
  (ready) => {
    if (ready) emit('ready')
  }
)

// One pool per CompareViewer instance; destroyed on unmount to free workers.
const pool = new PsdWorkerPool()

const psdFilename = computed(() => basename(props.psdPath))

interface BitmapSummary {
  width: number
  height: number
  sampledPixels: number
  visibleSamples: number
  alphaMin: number
  alphaMax: number
  rgbMin: number
  rgbMax: number
}

function basename(absPath: string): string {
  return basenameOf(absPath)
}

function dirname(absPath: string): string {
  const normalized = absPath.replace(/\\/g, '/')
  const slash = normalized.lastIndexOf('/')
  return slash >= 0 ? normalized.slice(0, slash) : ''
}

function extname(absPath: string): string {
  const name = basename(absPath)
  const dot = name.lastIndexOf('.')
  return dot >= 0 ? name.slice(dot).toLowerCase() : ''
}

function stemKey(absPath: string): string {
  // 规则本身在 `@shared/pair`（2026-10-01 P2 收编）—— 扫描器那边走的是同一个函数。
  // ⚠️ 别再往这里写规则：两侧的配对键必须永远同源，否则"侧栏配好的对"与
  //    这里挑出来的图会不是同一张（标记按"当前显示的那张"落库，会落到错的页上）。
  return pairKeyOf(absPath)
}

function normalizePath(absPath: string): string {
  return absPath.replace(/\\/g, '/').normalize('NFC').toLocaleLowerCase()
}

function relativeDepth(rootFolder: string, absPath: string): number {
  const root = normalizePath(rootFolder).replace(/\/+$/, '')
  const target = normalizePath(absPath)
  const rel = target.startsWith(root + '/') ? target.slice(root.length + 1) : target
  return rel.split('/').filter(Boolean).length
}

function imageExtRank(absPath: string): number {
  switch (extname(absPath)) {
    case '.jpg':
      return 0
    case '.jpeg':
      return 1
    case '.png':
      return 2
    case '.webp':
      return 3
    case '.gif':
      return 4
    case '.bmp':
      return 5
    case '.avif':
      return 6
    case '.jfif':
      return 7
    default:
      return 9
  }
}

function imageRank(rootFolder: string, psdPath: string, imagePath: string): number {
  const extRank = imageExtRank(imagePath)
  const imageDir = normalizePath(dirname(imagePath))
  const rootDir = normalizePath(rootFolder)
  const psdDir = normalizePath(dirname(psdPath))
  if (imageDir === rootDir) return extRank
  if (imageDir === psdDir) return 100 + extRank
  return 200 + relativeDepth(rootFolder, imagePath) * 10 + extRank
}

function pickMatchingImage(
  rootFolder: string,
  psdPath: string,
  imageFiles: string[]
): string | undefined {
  const psdStem = stemKey(psdPath)
  const candidates = imageFiles.filter((imagePath) => stemKey(imagePath) === psdStem)
  if (candidates.length === 0) return undefined
  return [...candidates].sort(
    (a, b) => imageRank(rootFolder, psdPath, a) - imageRank(rootFolder, psdPath, b)
  )[0]
}

// --- ImageBitmap → string URL ---------------------------------------------
// ImageViewer accepts a string src, so we rasterise the ImageBitmap onto a
// canvas and produce a data URL. This keeps ImageViewer unchanged (task 3.5).
function summarizeBitmapCanvas(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number
): BitmapSummary {
  const { data } = ctx.getImageData(0, 0, width, height)
  const maxSamples = 4000
  const pixelCount = width * height
  const step = Math.max(1, Math.floor(pixelCount / maxSamples))
  let sampledPixels = 0
  let visibleSamples = 0
  let alphaMin = 255
  let alphaMax = 0
  let rgbMin = 255
  let rgbMax = 0

  for (let pixel = 0; pixel < pixelCount; pixel += step) {
    const i = pixel * 4
    const r = data[i]
    const g = data[i + 1]
    const b = data[i + 2]
    const a = data[i + 3]
    sampledPixels++
    if (a !== 0) visibleSamples++
    alphaMin = Math.min(alphaMin, a)
    alphaMax = Math.max(alphaMax, a)
    rgbMin = Math.min(rgbMin, r, g, b)
    rgbMax = Math.max(rgbMax, r, g, b)
  }

  return { width, height, sampledPixels, visibleSamples, alphaMin, alphaMax, rgbMin, rgbMax }
}

function bitmapToUrl(bitmap: ImageBitmap): { url: string; summary: BitmapSummary | null } {
  if (bitmap.width <= 0 || bitmap.height <= 0) {
    bitmap.close?.()
    throw new Error('Rendered PSD bitmap has invalid dimensions')
  }

  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D context unavailable')
  ctx.drawImage(bitmap, 0, 0)
  bitmap.close?.()

  let summary: BitmapSummary | null = null
  if (typeof ctx.getImageData === 'function') {
    summary = summarizeBitmapCanvas(ctx, canvas.width, canvas.height)
    if (summary.visibleSamples === 0) {
      throw new Error('Rendered PSD bitmap is fully transparent')
    }
  }

  return { url: canvas.toDataURL(), summary }
}

function formatError(err: unknown): { message: string; stack?: string } {
  if (err instanceof Error) {
    return { message: err.message, stack: err.stack }
  }
  return { message: String(err) }
}

async function writePsdLog(
  scope: string,
  level: 'info' | 'warn' | 'error',
  message: string,
  data: unknown
): Promise<void> {
  if (typeof window.comicType?.writeLog !== 'function') return
  await window.comicType
    .writeLog({
      level,
      scope,
      message,
      data
    })
    .catch(() => {
      // Logging must never break the viewer UI.
    })
}

// --- Loaders ---------------------------------------------------------------
async function resolveMatchingImagePath(
  psdPath: string,
  folderPath: string | undefined
): Promise<string | undefined> {
  if (!folderPath || typeof window.comicType?.scanChildProject !== 'function') return undefined
  try {
    void writePsdLog('compare-viewer', 'info', 'Matching image rescan start', {
      psdPath,
      folderPath
    })
    const scan = await window.comicType.scanChildProject(folderPath)
    const normalizedPsdPath = normalizePath(psdPath)
    const imageFiles =
      scan.imageFiles ??
      scan.jpgPairs.map((pair) => pair.jpgPath).filter((path): path is string => Boolean(path))
    const imagePath = pickMatchingImage(folderPath, psdPath, imageFiles)
    const exactPair = scan.jpgPairs.find(
      (pair) => normalizePath(pair.psd.absPath) === normalizedPsdPath
    )
    const resolvedPath = imagePath ?? exactPair?.jpgPath
    void writePsdLog(
      'compare-viewer',
      resolvedPath ? 'info' : 'warn',
      'Matching image rescan finished',
      {
        psdPath,
        folderPath,
        imagePath: resolvedPath,
        imageFileCount: imageFiles.length,
        pairCount: scan.jpgPairs.length,
        txtCount: scan.txtFiles.length,
        errorCount: scan.errors.length
      }
    )
    return resolvedPath
  } catch (err) {
    void writePsdLog('compare-viewer', 'error', 'Matching image rescan failed', {
      psdPath,
      folderPath,
      error: formatError(err)
    })
    return undefined
  }
}

async function loadJpg(
  seq = sourceSeq,
  jpgPath = props.jpgPath,
  psdPath = props.psdPath,
  folderPath = props.folderPath
): Promise<void> {
  let imagePath = jpgPath
  let resolvedByScan = false
  if (!imagePath) {
    imagePath = await resolveMatchingImagePath(psdPath, folderPath)
    resolvedByScan = Boolean(imagePath)
  }

  if (!imagePath) {
    if (seq !== sourceSeq || psdPath !== props.psdPath) return
    jpgUnavailable.value = true
    void writePsdLog('compare-viewer', 'warn', 'Matching image path is missing', {
      psdPath,
      folderPath
    })
    jpgUrl.value = null
    return
  }
  try {
    jpgUnavailable.value = false
    void writePsdLog('compare-viewer', 'info', 'Matching image load start', {
      psdPath,
      imagePath,
      resolvedByScan
    })
    const url = await window.comicType.readFileDataURL(imagePath)
    if (seq !== sourceSeq || psdPath !== props.psdPath) return
    jpgUrl.value = url
    void writePsdLog('compare-viewer', 'info', 'Matching image load success', {
      psdPath,
      imagePath,
      resolvedByScan,
      dataUrlLength: jpgUrl.value.length
    })
  } catch (err) {
    if (!resolvedByScan) {
      const rescannedPath = await resolveMatchingImagePath(psdPath, folderPath)
      if (rescannedPath && normalizePath(rescannedPath) !== normalizePath(imagePath)) {
        try {
          const url = await window.comicType.readFileDataURL(rescannedPath)
          if (seq !== sourceSeq || psdPath !== props.psdPath) return
          jpgUnavailable.value = false
          jpgUrl.value = url
          void writePsdLog('compare-viewer', 'info', 'Matching image load success after rescan', {
            psdPath,
            imagePath: rescannedPath,
            originalImagePath: imagePath,
            dataUrlLength: url.length
          })
          return
        } catch (rescanErr) {
          void writePsdLog('compare-viewer', 'error', 'Matching image load failed after rescan', {
            psdPath,
            imagePath: rescannedPath,
            originalImagePath: imagePath,
            error: formatError(rescanErr)
          })
        }
      }
    }
    if (seq !== sourceSeq || psdPath !== props.psdPath) return
    void writePsdLog('compare-viewer', 'error', 'Matching image load failed', {
      psdPath,
      imagePath,
      error: formatError(err)
    })
    jpgUnavailable.value = true
    jpgUrl.value = null
  }
}

async function loadPsd(
  seq = sourceSeq,
  psdPath = props.psdPath,
  jpgPath = props.jpgPath
): Promise<void> {
  psdLoading.value = true
  psdError.value = false
  psdUrl.value = null
  psdUrlPath.value = null
  try {
    void writePsdLog('compare-viewer', 'info', 'PSD render start', {
      psdPath,
      imagePath: jpgPath
    })
    const buffer = await window.comicType.readFileBuffer(psdPath)
    const byteLength = buffer.byteLength
    const bitmap = await pool.parsePsd(buffer)
    const { url, summary } = bitmapToUrl(bitmap)
    if (seq !== sourceSeq || psdPath !== props.psdPath) return
    psdUrl.value = url
    psdUrlPath.value = psdPath
    void writePsdLog('compare-viewer', 'info', 'PSD render success', {
      psdPath,
      imagePath: jpgPath,
      byteLength,
      summary,
      dataUrlLength: url.length
    })
  } catch (err) {
    if (seq !== sourceSeq || psdPath !== props.psdPath) return
    void writePsdLog('compare-viewer', 'error', 'PSD render failed', {
      psdPath,
      imagePath: jpgPath,
      error: formatError(err)
    })
    psdError.value = true
  } finally {
    if (seq === sourceSeq && psdPath === props.psdPath) {
      psdLoading.value = false
    }
  }
}

function resetState(): void {
  sourceSeq++
  jpgUrl.value = null
  jpgUnavailable.value = false
  psdUrl.value = null
  psdUrlPath.value = null
  psdLoading.value = false
  psdError.value = false
  // 退出预览 = 一切归零：下次进来是 100%（适应窗口）。
  zoomRatio.value = 1
  zoomInputOpen.value = false
  zoomDraft.value = ''
}

function reloadVisibleSources(): void {
  const seq = ++sourceSeq
  const jpgPath = props.jpgPath
  const psdPath = props.psdPath
  const folderPath = props.folderPath
  jpgUrl.value = null
  jpgUnavailable.value = false
  psdUrl.value = null
  psdUrlPath.value = null
  psdLoading.value = false
  psdError.value = false
  void loadJpg(seq, jpgPath, psdPath, folderPath)
  // imageOnly 条目的 psdPath 其实是图片路径：解析它只会白耗 worker、
  // 并把右栏变成“PSD解析失败”。直接跳过。
  if (!props.imageOnly) void loadPsd(seq, psdPath, jpgPath)
}

// --- Watchers --------------------------------------------------------------
// Trigger loads when the panel becomes visible or the compared files change.
watch(
  () => [props.visible, props.jpgPath, props.psdPath, props.folderPath, props.imageOnly] as const,
  (v) => {
    if (v[0]) {
      reloadVisibleSources()
    } else {
      resetState()
    }
  },
  { immediate: true }
)

// --- Keyboard (ESC to close) ----------------------------------------------
function onKeydown(e: KeyboardEvent): void {
  if (!props.visible) return
  if (e.key === 'Escape') {
    // 播放中 Esc = 先停播放（再按一次才退出预览）。
    // 不在播放时保持老行为：Esc 直接关窗 —— 既有用例锁着这一条。
    if (props.playing) emit('stopPlayback')
    else emit('close')
  } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
    e.preventDefault()
    emit('previous')
  } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
    e.preventDefault()
    emit('next')
  }
}

function onWheel(e: WheelEvent): void {
  if (e.ctrlKey || e.metaKey) return
  if (Math.abs(e.deltaY) < 8 && Math.abs(e.deltaX) < 8) return
  e.preventDefault()
  if (e.deltaY > 0 || e.deltaX > 0) {
    emit('next')
  } else {
    emit('previous')
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  pool.destroy()
})

function onClose(): void {
  emit('close')
}

function onOpenPsd(): void {
  emit('openPsd')
}

/**
 * 「标记X」作用于**当前正在看的这一张**。
 *
 * 这个视图里没有缩略图那种"选中"的概念，所以不能只靠工具栏那两个按钮 ——
 * 用方向键翻到第 5 页时，工具栏标的仍是最初双击的那一张（静默标错）。
 * 把动作放在这里，"看到哪张就标哪张"是唯一说得通的语义。
 */
function onMark(status: 'done' | 'pending'): void {
  emit('mark', status)
}
</script>

<template>
  <div
    v-if="visible"
    data-testid="compare-viewer"
    class="flex h-full w-full flex-col bg-app-bg text-text-primary"
    @wheel="onWheel"
  >
    <!-- Header bar -->
    <div class="flex items-center justify-between border-b border-border px-4 py-2">
      <div class="flex min-w-0 items-center gap-3">
        <span class="text-sm font-bold text-accent">{{ headerLabel }}</span>
        <span class="truncate text-sm font-bold text-text-primary">{{ psdFilename }}</span>
      </div>
      <div class="flex shrink-0 items-center gap-2">
        <button
          type="button"
          class="rounded-badge bg-accent px-3 py-1.5 text-sm font-medium text-text-on-accent transition-colors hover:bg-primary-hover active:bg-primary-active"
          data-testid="compare-mark-done"
          @click="onMark('done')"
        >
          {{ markDoneLabel }}
        </button>
        <button
          type="button"
          class="rounded-badge border border-primary-border bg-primary-soft px-3 py-1.5 text-sm font-medium text-accent transition-colors hover:bg-primary-soft-hover"
          data-testid="compare-mark-pending"
          @click="onMark('pending')"
        >
          {{ markPendingLabel }}
        </button>
        <!--
          「标记后下一张」（C3）：做一张张过的 QC 时省掉一次方向键。
          只用图标 —— 页头本来就有四个按钮，再加一个带字的会把它们挤变形
          （有 compare-viewer-header 那组截图盯着）。
        -->
        <button
          type="button"
          class="flex h-8 w-8 shrink-0 items-center justify-center rounded-badge border transition-colors"
          :class="
            advanceAfterMark
              ? 'border-primary-border bg-primary-soft text-accent'
              : 'border-border bg-card-bg text-text-secondary hover:bg-card-bg-hover hover:text-text-primary'
          "
          :title="advanceAfterMark ? '标记后下一张：开（点一下关掉）' : '标记后下一张：关（点一下打开）'"
          :aria-pressed="advanceAfterMark"
          data-testid="compare-advance-toggle"
          @click="emit('update:advanceAfterMark', !advanceAfterMark)"
        >
          <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
            <line x1="4" y1="12" x2="14" y2="12" />
            <polyline points="10 7 15 12 10 17" />
            <line x1="19" y1="5" x2="19" y2="19" />
          </svg>
        </button>
        <span class="mx-0.5 h-4 w-px shrink-0 bg-border" aria-hidden="true" />
        <button
          class="rounded-badge border border-border bg-card-bg px-3 py-1.5 text-sm font-medium text-text-secondary transition-colors hover:bg-card-bg-hover hover:text-text-primary active:bg-card-bg-pressed"
          @click="onOpenPsd"
        >
          {{ actionLabel }}
        </button>
        <button
          class="rounded-badge bg-accent px-3 py-1 text-sm font-bold text-text-on-accent transition-colors hover:bg-primary-hover active:bg-primary-active"
          @click="onClose"
        >
          退出预览
        </button>
      </div>
    </div>

    <!-- Split 50/50 panel — image-only entries get a single full-width pane. -->
    <div class="relative flex min-h-0 flex-1">
      <div class="flex min-h-0 flex-1">
        <!-- Left: JPG preview -->
        <div class="flex flex-1 flex-col" :class="imageOnly ? '' : 'border-r border-border'">
          <div class="border-b border-border px-3 py-1 text-xs text-text-secondary">原图</div>
          <div class="min-h-0 flex-1">
            <ImageViewer
              v-if="jpgUrl"
              :src="jpgUrl"
              :zoom-ratio="zoomRatio"
              @update:zoom-ratio="zoomRatio = $event"
            />
            <div v-else class="flex h-full items-center justify-center text-sm text-text-tertiary">
              无同名图片
            </div>
          </div>
        </div>

        <!-- Right: PSD rendering via worker (skipped entirely for image-only) -->
        <div v-if="!imageOnly" class="flex flex-1 flex-col">
          <div class="border-b border-border px-3 py-1 text-xs text-text-secondary">PSD</div>
          <div class="min-h-0 flex-1">
            <!-- Loading skeleton -->
            <div
              v-if="psdLoading"
              class="flex h-full flex-col items-center justify-center gap-3 text-sm text-text-secondary"
            >
              <div class="h-8 w-8 animate-spin rounded-full border-2 border-border border-t-accent" />
              <span>PSD解析中...</span>
            </div>
            <!-- Error placeholder -->
            <div
              v-else-if="psdError"
              class="flex h-full items-center justify-center text-sm text-danger"
            >
              PSD解析失败
            </div>
            <!-- Rendered bitmap -->
            <ImageViewer
              v-else-if="psdUrl"
              :src="psdUrl"
              :zoom-ratio="zoomRatio"
              @update:zoom-ratio="zoomRatio = $event"
            />
            <div v-else class="flex h-full items-center justify-center text-sm text-text-tertiary">
              无PSD图片
            </div>
          </div>
        </div>
      </div>

      <!--
        缩放控件组（看图软件的右下角那一组）。倍数只有一份，两栏同时跟着变；
        平移各自独立 —— 对照时"同一比例、各看各的位置"才是常用姿势。
        缩略图条展开时整组往上让位（不必等被压住才发现）。
      -->
      <div
        class="absolute right-3 z-10 flex items-center gap-0.5 rounded-badge border border-border bg-card-bg px-1 py-0.5 shadow-[var(--shadow-1)]"
        :style="{ bottom: thumbStripOpen ? `${STRIP_BAR_HEIGHT_PX + 12}px` : '12px' }"
        data-testid="compare-zoom-controls"
      >
        <button
          type="button"
          class="flex h-6 w-6 items-center justify-center rounded-badge text-text-secondary transition-colors hover:bg-card-bg-hover hover:text-text-primary"
          aria-label="缩小"
          title="缩小"
          data-testid="compare-zoom-out"
          @click="onZoomOut"
        >
          <svg class="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round">
            <circle cx="10.5" cy="10.5" r="6.5" />
            <line x1="7.5" y1="10.5" x2="13.5" y2="10.5" />
            <line x1="15.5" y1="15.5" x2="20.5" y2="20.5" />
          </svg>
        </button>

        <input
          v-if="zoomInputOpen"
          ref="zoomInputRef"
          v-model="zoomDraft"
          class="h-6 w-[52px] rounded-badge border border-primary-border bg-app-bg px-1 text-center text-[12px] tabular-nums text-text-primary focus:outline-none"
          data-testid="compare-zoom-input"
          @keydown.enter="commitZoomInput"
          @keydown.esc.stop="cancelZoomInput"
          @blur="commitZoomInput"
        />
        <button
          v-else
          type="button"
          class="h-6 min-w-[52px] rounded-badge px-1 text-[12px] tabular-nums text-text-primary transition-colors hover:bg-card-bg-hover"
          title="显示当前缩放倍数（100% = 整页刚好塞进窗口）；点一下可以直接输入"
          data-testid="compare-zoom-percent"
          @click="openZoomInput"
        >
          {{ zoomPercent }}
        </button>

        <button
          type="button"
          class="flex h-6 w-6 items-center justify-center rounded-badge text-text-secondary transition-colors hover:bg-card-bg-hover hover:text-text-primary"
          aria-label="放大"
          title="放大"
          data-testid="compare-zoom-in"
          @click="onZoomIn"
        >
          <svg class="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round">
            <circle cx="10.5" cy="10.5" r="6.5" />
            <line x1="7.5" y1="10.5" x2="13.5" y2="10.5" />
            <line x1="10.5" y1="7.5" x2="10.5" y2="13.5" />
            <line x1="15.5" y1="15.5" x2="20.5" y2="20.5" />
          </svg>
        </button>

        <span class="mx-0.5 h-4 w-px shrink-0 bg-border" aria-hidden="true" />

        <button
          type="button"
          class="flex h-6 w-6 items-center justify-center rounded-badge text-text-secondary transition-colors hover:bg-card-bg-hover hover:text-text-primary"
          aria-label="适应窗口"
          title="回到默认大小（适应窗口 = 100%）"
          data-testid="compare-zoom-fit"
          @click="onZoomFit"
        >
          <!-- 与"看图软件"同款：外框 + 四个内折角 + 中心实心圆（2026-09-27 按用户给的参照图换的） -->
          <svg class="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="4.5" width="18" height="15" rx="2.5" />
            <path d="M5.8 8.8V5.8h3" />
            <path d="M15.2 5.8h3v3" />
            <path d="M18.2 15.2v3h-3" />
            <path d="M8.8 18.2h-3v-3" />
            <circle cx="12" cy="12" r="2" fill="currentColor" stroke="none" />
          </svg>
        </button>
      </div>
    </div>
  </div>
</template>
