import { imageViewerPages } from './viewer-pages'
import { basenameOf } from '@shared/paths'
import { getThumbnailService, thumbnailKey } from '@renderer/services/thumbnails'
import { previewCache } from '@renderer/services/previews'
import { computed, onBeforeUnmount, watch, ref } from 'vue'
import { useSettingsStore } from '@renderer/stores/settings'
import type { JpgPsdPair, WorkMode } from '@shared/types'
import { type StripItem } from '@renderer/components/PreviewThumbStrip.vue'
import type { Ref } from 'vue'

export function useProjectViewer(sourcePairs: Ref<JpgPsdPair[]>, imageFiles?: Readonly<Ref<string[]>>, currentMode?: Readonly<Ref<WorkMode>>) {
  const settings = useSettingsStore()
  const activeMode = computed(() => currentMode?.value ?? settings.activeWorkMode)
  const pairs = computed(() => activeMode.value === 'translated' || activeMode.value === 'proofread'
    ? imageViewerPages(sourcePairs.value, imageFiles?.value ?? sourcePairs.value.flatMap(pair => pair.jpgPath ? [pair.jpgPath] : []))
    : sourcePairs.value)

  /**
   * One figure for the active mode, read straight from the live scan result.
   * 嵌字 no longer has a separate auto-derived path — completion is manual-only
   * for every mode — so head and footer share a single source by construction.
   */

  // CompareViewer state
  const compareVisible = ref(false)

  const comparePair = ref<JpgPsdPair | null>(null)

  // --- 看图三件套（缩略图条 / 自动播放；缩放在 CompareViewer 里）-----------------
  /** 底部那条"胶片"是否展开。退出预览会自动收起（免得下次进来先看到一条挡图的条）。 */
  const stripOpen = ref(false)

  /** 页脚那个 ▶ 是否在走。 */
  const playing = ref(false)

  /** 网格与胶片条共同订阅同一个缓存，释放或淘汰后不会残留失效的 Blob URL。 */
  const thumbnails = getThumbnailService()

  const stripOwner = {}

  let prefetch: AbortController | undefined

  function onStripVisible(ids: string[], nearby: string[]): void {
    const byId = new Map(pairs.value.map((pair) => [pair.psd.absPath, pair]))
    const select = (keys: string[]) =>
      keys.map((key) => byId.get(key)).filter((p): p is JpgPsdPair => Boolean(p))
    thumbnails.setVisible(stripOwner, select(ids), select(nearby))
  }

  function onStripImageError(id: string, url: string): void {
    const pair = pairs.value.find((pair) => pair.psd.absPath === id)
    if (pair) void thumbnails.imageFailed(pair, url)
  }

  const compareRevision = computed(() => {
    const pair = pairs.value.find((p) => p.psd.absPath === comparePair.value?.psd.absPath)
    return pair ? thumbnailKey(pair) : ''
  })

  watch(compareVisible, (visible) => {
    if (!visible) {
      prefetch?.abort()
      thumbnails.release(stripOwner)
    }
  })

  watch(stripOpen, (open) => {
    if (!open) thumbnails.release(stripOwner)
  })

  let playTimer: number | null = null

  let playReadyTimeout: number | null = null

  /** 当前这一张是否已经"显示好了"（CompareViewer 的 ready 事件）。 */
  let viewerReady = false

  /** 等不到就绪信号时的兜底：一张坏 PSD 不该把播放钉死。 */
  const PLAY_READY_TIMEOUT_MS = 8000

  function basename(absPath: string): string {
    return basenameOf(absPath)
  }

  const stripItems = computed<StripItem[]>(() =>
    pairs.value.map((pair, index) => {
      const path = pair.previewOnly ? (pair.jpgPath ?? pair.psd.absPath) : pair.psd.absPath
      return {
        id: pair.psd.absPath,
        filename: basename(path),
        pageNumber: index + 1,
        thumbUrl: thumbnails.state(pair).url
      }
    })
  )

  function currentCompareIndex(): number {
    return pairs.value.findIndex((pair) => pair.psd.absPath === comparePair.value?.psd.absPath)
  }

  function clearPlayTimers(): void {
    if (playTimer !== null) {
      window.clearTimeout(playTimer)
      playTimer = null
    }
    if (playReadyTimeout !== null) {
      window.clearTimeout(playReadyTimeout)
      playReadyTimeout = null
    }
  }

  /** 停播放：四种触发方式（点画面 / Esc / 手动翻页 / 退出预览）最后都走这里。 */
  function stopPlayback(): void {
    playing.value = false
    clearPlayTimers()
  }

  function armPlayInterval(): void {
    clearPlayTimers()
    playTimer = window.setTimeout(() => {
      playTimer = null
      advanceAuto()
    }, settings.playIntervalMsValid)
  }

  function armReadyTimeout(): void {
    clearPlayTimers()
    playReadyTimeout = window.setTimeout(() => {
      playReadyTimeout = null
      advanceAuto()
    }, PLAY_READY_TIMEOUT_MS)
  }

  /**
   * 自动播放往前挪一张。
   *
   * 到头**停下**（用户拍板，不循环）——静默回卷比多一次点击危险；
   * 想继续看在最后一页再点一次播放（= 从第一页重播）。
   */
  function advanceAuto(): void {
    if (!playing.value) return
    const index = currentCompareIndex()
    if (index === -1 || index >= pairs.value.length - 1) {
      stopPlayback()
      return
    }
    viewerReady = false
    comparePair.value = pairs.value[index + 1]
    armReadyTimeout()
  }

  /**
   * 这一张显示好了 → **从现在开始**算间隔（用户拍板：等就绪再计时）。
   * 预览状态（只有 JPG）下与固定节拍没区别；对照状态才不会变成一路看骨架屏。
   */
  function onViewerReady(): void {
    viewerReady = true
    prefetch?.abort()
    prefetch = new AbortController()
    const next = pairs.value[currentCompareIndex() + 1]
    if (next && compareVisible.value) {
      const sources: [string, boolean][] = []
      if (next.jpgPath) sources.push([next.jpgPath, true])
      if (!next.previewOnly) sources.push([next.psd.absPath, false])
      for (const [path, raster] of sources) {
        void previewCache
          .acquire(path, raster, prefetch.signal, 1)
          .then((lease) => lease.release())
          .catch(() => undefined)
      }
    }
    if (!playing.value) return
    armPlayInterval()
  }

  function startPlayback(): void {
    // 只有一张（或没有）时没什么可播的：按钮是禁用的，这里再兜一道。
    if (pairs.value.length <= 1) return
    if (currentCompareIndex() >= pairs.value.length - 1) {
      // 在最后一页点播放 = 从第一页重播
      viewerReady = false
      comparePair.value = pairs.value[0]
    }
    playing.value = true
    if (viewerReady) armPlayInterval()
    else armReadyTimeout()
  }

  function togglePlay(): void {
    if (playing.value) stopPlayback()
    else startPlayback()
  }

  function toggleStrip(): void {
    stripOpen.value = !stripOpen.value
  }

  function onStripPick(id: string): void {
    stopPlayback()
    const pair = pairs.value.find((item) => item.psd.absPath === id)
    if (pair) {
      viewerReady = false
      comparePair.value = pair
    }
  }

  function onPlayIntervalLabel(): string {
    return `${settings.playIntervalMsValid / 1000} 秒`
  }

  const playIntervalLabel = computed(onPlayIntervalLabel)

  function closeCompare(): void {
    compareVisible.value = false
    comparePair.value = null
    // 退出预览 = 播放停、胶片收起：下次进来是干净的一屏。
    stopPlayback()
    stripOpen.value = false
    viewerReady = false
  }

  // --- ThumbList handlers ----------------------------------------------------
  async function onCompare(pair: JpgPsdPair): Promise<void> {
    stopPlayback()
    viewerReady = false
    const target = pairs.value.find(item => item.psd.absPath === pair.psd.absPath || (pair.jpgPath && item.jpgPath === pair.jpgPath))
    if (!target) return
    comparePair.value = target
    compareVisible.value = true
  }

  /** 标完翻下一张：到最后一页就停在原地（静默回卷最容易让人标错张）。 */
  function advanceToNextPair(): void {
    const index = currentCompareIndex()
    if (index === -1 || index >= pairs.value.length - 1) return
    viewerReady = false
    comparePair.value = pairs.value[index + 1]
  }

  /**
   * 手动翻页（方向键 / 滚轮 / 视图里的上一张下一张）。
   *
   * **手动切换图片要停播放**（用户要求）——所以自动播放走的是另一条路（`advanceAuto`），
   * 不经过这里；这里只负责"人来操作"。
   */
  function shiftCompare(delta: number): void {
    stopPlayback()
    if (!comparePair.value || pairs.value.length === 0) return
    const currentIndex = pairs.value.findIndex(
      (pair) => pair.psd.absPath === comparePair.value?.psd.absPath
    )
    if (currentIndex === -1) return
    const nextIndex = (currentIndex + delta + pairs.value.length) % pairs.value.length
    viewerReady = false
    comparePair.value = pairs.value[nextIndex]
  }
  watch(pairs, (next) => {
    if (!compareVisible.value) return
    const shown = comparePair.value
    const target = next.find(item => item.psd.absPath === shown?.psd.absPath || (shown?.jpgPath && item.jpgPath === shown.jpgPath)) ?? next[0]
    if (target) {
      if (target.psd.absPath !== shown?.psd.absPath || target.previewOnly !== shown?.previewOnly) {
        prefetch?.abort(); stopPlayback(); viewerReady = false
      }
      comparePair.value = target
    }
    else closeCompare()
  })
  onBeforeUnmount(() => {
    prefetch?.abort()
    thumbnails.release(stripOwner)
    stopPlayback()
  })
  const currentPageNumber = computed(() => currentCompareIndex() + 1)
  const pageCount = computed(() => pairs.value.length)
  function goToPage(pageNumber: number): void {
    if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > pairs.value.length) return
    onStripPick(pairs.value[pageNumber - 1].psd.absPath)
  }
  return {
    viewerPairs: pairs,
    compareVisible,
    comparePair,
    stripOpen,
    playing,
    thumbnails,
    onStripVisible,
    onStripImageError,
    compareRevision,
    currentPageNumber,
    pageCount,
    goToPage,
    stripItems,
    stopPlayback,
    onViewerReady,
    togglePlay,
    toggleStrip,
    onStripPick,
    playIntervalLabel,
    closeCompare,
    onCompare,
    advanceToNextPair,
    shiftCompare
  }
}
