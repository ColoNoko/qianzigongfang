<script lang="ts">
// ProjectThumbList — maps JpgPsdPair[] to ThumbItem[] and wires ThumbGrid.
// Thumbnails are loaded asynchronously via window.comicType.readFileDataURL
// in onMounted (eager) and on-demand via the ThumbGrid `load` callback.
// Thumb size defaults to the settings store value; an explicit prop
// overrides it (useful for tests or per-view customization).
import { basenameOf } from '@shared/paths'
import type { JpgPsdPair, TypesetStatus, WorkMode } from '@shared/types'
import type { ThumbItem, ThumbSize } from './ThumbGrid.vue'
</script>

<script setup lang="ts">
import { ref, computed, onBeforeUnmount, watch } from 'vue'
import ThumbGrid from './ThumbGrid.vue'
import { useSettingsStore } from '@renderer/stores/settings'
import { PsdWorkerPool } from '@renderer/workers/psd-pool'
import {
  pairHasPsd,
  performCardAction
} from '@renderer/features/project/external-tool'
import { DOWNSCALE_MIN_LENGTH, fitWithin } from '@renderer/features/project/thumb-scale'

const THUMB_RENDER_CONCURRENCY = 4

const props = withDefaults(
  defineProps<{
    pairs: JpgPsdPair[]
    folderPath: string
    thumbSize?: ThumbSize
    /**
     * Card action mode. `typeset` (the default) opens the PSD with its OS
     * association — the historical behaviour. Any other mode launches the
     * external translation editor configured in settings instead.
     */
    mode?: WorkMode
    /**
     * 这一话的**本地目录已不在**（被删 / 被改名），列表来自台账里的历史记录。
     *
     * 打开时卡片动作、标记、双击对照**全部禁用** —— 文件不在本地，打开只会报错，
     * 标记更会往台账里写下无意义的记录。缩略图**仍然加载**：那条路径走的是持久
     * 缓存（thumbnail-cache.ts），正是这个模式存在的意义。
     */
    missing?: boolean
  }>(),
  { mode: 'typeset', missing: false }
)

const settingsStore = useSettingsStore()
const psdPool = new PsdWorkerPool(THUMB_RENDER_CONCURRENCY)
const filenameCollator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' })

// Prop overrides store; fall back to the validated store value.
const effectiveThumbSize = computed<ThumbSize>(
  () => props.thumbSize ?? settingsStore.thumbSizeValid
)

const emit = defineEmits<{
  (e: 'openPsd', psdPath: string): void
  (e: 'compare', pair: JpgPsdPair): void
  (e: 'mark', pair: JpgPsdPair): void
  (e: 'selectionChange', pairs: JpgPsdPair[]): void
  (e: 'toast', payload: { type: 'success' | 'warning' | 'error'; message: string }): void
  /**
   * 缩略图清单（`psd.absPath` → 已渲染好的 data URL）。
   *
   * 给预览/对照状态底部那条缩略图条用：它是**同一批内存图**，所以缩略图条
   * 零 IPC、零重新解析、零等待 —— 用户要的"复用已有缓存"就是这一条。
   */
  (e: 'thumbnails', urls: Record<string, string>): void
}>()

// Maps psd.absPath → data URL string, populated async.
const thumbUrls = ref<Record<string, string>>({})
const thumbSources = ref<Record<string, 'psd' | 'image-fallback'>>({})
// Track in-flight loads to avoid duplicate requests.
const loading = new Set<string>()
const pendingThumbQueue: JpgPsdPair[] = []
let activeThumbLoads = 0
let thumbLoadGeneration = 0

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
    // 透明自检与日志摘要都按**原生尺寸**判断：缩过之后 alpha 会被平均掉，判断就不准了。
    summary = summarizeBitmapCanvas(ctx, canvas.width, canvas.height)
    if (summary.visibleSamples === 0) {
      throw new Error('Rendered PSD bitmap is fully transparent')
    }
  }

  // D1：网格卡片里的图片区只有 162×208，原生尺寸（实测一页 1.3–1.9 MB base64）
  // 纯占内存。这里按"最长边 ≤ 360"再画一份小画布给界面用。
  // 大画布仍然留到这一步之后再丢，所以这里的 drawImage 不会额外解码一次。
  const target = fitWithin(canvas.width, canvas.height)
  const unchanged = target.width === 0 || (target.width === canvas.width && target.height === canvas.height)
  if (unchanged) return { url: canvas.toDataURL(), summary }

  const thumbCanvas = document.createElement('canvas')
  thumbCanvas.width = target.width
  thumbCanvas.height = target.height
  const thumbCtx = thumbCanvas.getContext('2d')
  if (!thumbCtx) return { url: canvas.toDataURL(), summary }
  thumbCtx.drawImage(canvas, 0, 0, target.width, target.height)
  return { url: thumbCanvas.toDataURL(), summary }
}

/**
 * 同名图片（JPG）那条路也降采样。
 *
 * 两个安全阀都写在这里：
 *   · 负载小就直接放过（照片的真实 data URL 远大于阈值）；
 *   · jsdom 里 `new Image()` 不会真的解码 —— 靠上面那条长度门槛避开"等 load 挂住用例"。
 * 任何一步失败都返回原图：**绝不因为"想省内存"而让缩略图变没有**。
 */
async function downscaleImageDataUrl(url: string): Promise<string> {
  if (url.length < DOWNSCALE_MIN_LENGTH) return url
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image()
      element.onload = () => resolve(element)
      element.onerror = () => reject(new Error('image decode failed'))
      element.src = url
    })
    const target = fitWithin(image.naturalWidth, image.naturalHeight)
    if (target.width === 0 || target.width === image.naturalWidth) return url
    const canvas = document.createElement('canvas')
    canvas.width = target.width
    canvas.height = target.height
    const ctx = canvas.getContext('2d')
    if (!ctx) return url
    ctx.drawImage(image, 0, 0, target.width, target.height)
    // 照片用 JPEG 更划算（PNG 存照片体积翻好几倍）；这条路的产物不写缩略图缓存。
    return canvas.toDataURL('image/jpeg', 0.85)
  } catch {
    return url
  }
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
      // Logging must never break thumbnail rendering.
    })
}

async function logPsdRenderStart(scope: string, pair: JpgPsdPair): Promise<void> {
  await writePsdLog(scope, 'info', 'PSD render start', {
    psdPath: pair.psd.absPath,
    imagePath: pair.jpgPath,
    status: pair.psd.status,
    mtimeMs: pair.psd.mtimeMs,
    ctimeMs: pair.psd.ctimeMs
  })
}

async function logPsdRenderSuccess(
  scope: string,
  pair: JpgPsdPair,
  byteLength: number,
  summary: BitmapSummary | null,
  dataUrlLength: number
): Promise<void> {
  await writePsdLog(scope, 'info', 'PSD render success', {
    psdPath: pair.psd.absPath,
    imagePath: pair.jpgPath,
    byteLength,
    summary,
    dataUrlLength
  })
}

async function logPsdRenderFailure(scope: string, pair: JpgPsdPair, err: unknown): Promise<void> {
  await writePsdLog(scope, 'error', 'PSD render failed; falling back to matching image', {
    psdPath: pair.psd.absPath,
    imagePath: pair.jpgPath,
    error: formatError(err)
  })
}

async function logPsdImageFallback(scope: string, pair: JpgPsdPair): Promise<void> {
  await writePsdLog(scope, 'warn', 'Using matching image fallback for thumbnail', {
    psdPath: pair.psd.absPath,
    imagePath: pair.jpgPath
  })
}

// Build ThumbItem[] from pairs, using the loaded thumbUrls map.
/**
 * 左下角状态点该画什么（2026-10-02）。
 *
 * 它表达的是**当前模式**的完成状态：切到「监修」，点就是这一页的监修状态。
 * 数据源是 `psd.modes`（`projectWorkspace` 扫完话后用 `project_memory_files` 里的记录
 * 填回来的整份四模式状态），**不是** `psd.status` —— 那个字段只表示「嵌字」。
 * ⚠️ 用 `psd.status` 当"当前模式"看，就是这次要修的毛病：监修模式下标记完，
 * 左下角的点纹丝不动，看起来像"没记住"。
 * `modes` 缺席时（老数据 / 还没加载回来）回退到老字段，避免老话突然全变空心。
 * 只有图、没有 PSD 的条目（`status === 'none'`）**不画点** —— 先判这一条：
 * 点讲的是"这张 PSD 做到哪一步了"，拿它去问一个不存在的 PSD 没有意义。
 */
function pairStatusForMode(pair: JpgPsdPair, mode: WorkMode): TypesetStatus {
  if (pair.psd.status === 'none') return 'none'
  if (pair.psd.modes) return pair.psd.modes[mode] ? 'done' : 'pending'
  return pair.psd.status
}

const items = computed<ThumbItem[]>(() =>
  props.pairs
    .map((pair) => ({
      id: pair.psd.absPath,
      filename: basename(pair.previewOnly ? (pair.jpgPath ?? pair.psd.absPath) : pair.psd.absPath),
      thumbUrl: thumbUrls.value[pair.psd.absPath] ?? null,
      mtimeText: props.missing
        ? // 目录不在时"文件修改日期"没有意义（文件已不在本地），换成状态说明。
          '本地已删除'
        : new Date(pair.psd.mtimeMs).toLocaleDateString('zh-CN'),
      status: pairStatusForMode(pair, props.mode)
    }))
    .sort((a, b) => filenameCollator.compare(a.filename, b.filename))
)

function loadPairThumb(pair: JpgPsdPair): void {
  if (thumbUrls.value[pair.psd.absPath] && thumbSources.value[pair.psd.absPath] === 'psd') {
    return
  }
  if (loading.has(pair.psd.absPath)) return

  loading.add(pair.psd.absPath)
  pendingThumbQueue.push(pair)
  drainThumbQueue()
}

function drainThumbQueue(): void {
  while (activeThumbLoads < THUMB_RENDER_CONCURRENCY && pendingThumbQueue.length > 0) {
    const pair = pendingThumbQueue.shift()!
    const generation = thumbLoadGeneration
    activeThumbLoads++

    void runThumbLoad(pair, generation)
  }
}

async function runThumbLoad(pair: JpgPsdPair, generation: number): Promise<void> {
  loadPsdThumb(pair)
    .then(({ url, source }) => {
      if (generation !== thumbLoadGeneration) return
      thumbUrls.value = { ...thumbUrls.value, [pair.psd.absPath]: url }
      thumbSources.value = { ...thumbSources.value, [pair.psd.absPath]: source }
    })
    .catch(() => {
      // Keep the placeholder when a source image cannot be read.
    })
    .finally(() => {
      activeThumbLoads = Math.max(0, activeThumbLoads - 1)
      loading.delete(pair.psd.absPath)
      drainThumbQueue()
    })
}

async function loadPsdThumb(pair: JpgPsdPair): Promise<{
  url: string
  source: 'psd' | 'image-fallback'
}> {
  if (pair.previewOnly && pair.jpgPath) {
    return {
      url: await downscaleImageDataUrl(await window.comicType.readFileDataURL(pair.jpgPath)),
      source: 'image-fallback'
    }
  }
  if (typeof window.comicType?.readPsdThumbnailCache === 'function') {
    try {
      const cached = await window.comicType.readPsdThumbnailCache(
        pair.psd.absPath,
        pair.psd.mtimeMs
      )
      if (cached) return { url: cached, source: 'psd' }
    } catch {
      // Cache failures must never prevent a fresh PSD render.
    }
  }

  try {
    void logPsdRenderStart('psd-thumb', pair)
    const buffer = await window.comicType.readFileBuffer(pair.psd.absPath)
    const byteLength = buffer.byteLength
    const bitmap = await psdPool.parsePsd(buffer)
    const { url, summary } = bitmapToUrl(bitmap)
    if (typeof window.comicType?.writePsdThumbnailCache === 'function') {
      void window.comicType
        .writePsdThumbnailCache(pair.psd.absPath, pair.psd.mtimeMs, url)
        .catch(() => {
          // The rendered thumbnail is still valid when disk caching fails.
        })
    }
    void logPsdRenderSuccess('psd-thumb', pair, byteLength, summary, url.length)
    return { url, source: 'psd' }
  } catch (err) {
    void logPsdRenderFailure('psd-thumb', pair, err)
    if (!pair.jpgPath) throw new Error('No PSD preview or matching image')
    void logPsdImageFallback('psd-thumb', pair)
    const url = await downscaleImageDataUrl(await window.comicType.readFileDataURL(pair.jpgPath))
    return { url, source: 'image-fallback' }
  }
}

watch(
  () => props.pairs,
  (pairs) => {
    void writePsdLog('psd-thumb', 'info', 'Thumbnail list received pairs', {
      folderPath: props.folderPath,
      pairCount: pairs.length,
      psdPaths: pairs.slice(0, 20).map((pair) => pair.psd.absPath)
    })
    for (const pair of pairs) {
      loadPairThumb(pair)
    }
  },
  { immediate: true }
)

/**
 * 把"已经渲染好的缩略图"往上报一份给工作台（预览/对照底部的缩略图条要用）。
 *
 * 每次 `thumbUrls` 被替换都会发一次 —— 传的是**同一批字符串引用**，不是拷贝图片数据，
 * 所以几十张也只是几十次浅拷贝。这样缩略图条永远不用自己去读图。
 */
watch(
  thumbUrls,
  (urls) => {
    emit('thumbnails', urls)
  },
  { immediate: true }
)

watch(
  () => props.folderPath,
  () => {
    thumbLoadGeneration++
    pendingThumbQueue.length = 0
    thumbUrls.value = {}
    thumbSources.value = {}
    loading.clear()
  }
)

onBeforeUnmount(() => {
  thumbLoadGeneration++
  pendingThumbQueue.length = 0
  psdPool.destroy()
})

// On-demand load callback for ThumbGrid virtual scrolling.
function handleLoad(_index: number, item: ThumbItem): void {
  if (thumbUrls.value[item.id]) return
  if (loading.has(item.id)) return
  const pair = props.pairs.find((p) => p.psd.absPath === item.id)
  if (pair) loadPairThumb(pair)
}

function handleDblclick(id: string): void {
  // 目录不在（历史记录）：对照视图要读本地文件，打不开，直接不响应。
  if (props.missing) return
  const pair = props.pairs.find((p) => p.psd.absPath === id)
  // `previewOnly` entries (a chapter whose folder holds images but no PSD) open
  // the viewer as well: CompareViewer switches to its image-only layout for
  // them, so a JPG-only chapter finally has a large-preview mode.
  if (pair) emit('compare', pair)
}

async function handleAction(id: string): Promise<void> {
  // 目录不在：卡片动作会去打开一个不存在的文件，只会弹"打开失败"。
  if (props.missing) return
  const pair = props.pairs.find((p) => p.psd.absPath === id)
  if (!pair) return

  const outcome = await performCardAction({
    mode: props.mode,
    hasPsd: pairHasPsd(pair.psd.status),
    openPath: id
  })
  if (outcome.toast) emit('toast', outcome.toast)
}

function handleMark(id: string): void {
  // 目录不在：标记会以"文件路径"为键写进台账，对已删除的文件毫无意义。
  if (props.missing) return
  const pair = props.pairs.find((p) => p.psd.absPath === id)
  if (pair) emit('mark', pair)
}

function handleSelectionChange(ids: string[]): void {
  // 目录不在：不许选中 —— 选中会让工具栏的「标记X」重新可点，而那是禁用项。
  if (props.missing) return
  const selected = ids
    .map((id) => props.pairs.find((pair) => pair.psd.absPath === id))
    .filter((pair): pair is JpgPsdPair => pair !== undefined)
  emit('selectionChange', selected)
}
</script>

<template>
  <ThumbGrid
    :items="items"
    :thumb-size="effectiveThumbSize"
    :mode="mode"
    :load="handleLoad"
    @dblclick="handleDblclick"
    @action="handleAction"
    @mark="handleMark"
    @selection-change="handleSelectionChange"
  />
</template>
