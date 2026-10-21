<script setup lang="ts">
import { Button as UiButton } from '@renderer/components/ui/button'
// CompareViewer — split 50/50 panel comparing a JPG preview (left) against
// the rendered PSD bitmap (right). The PSD is parsed off the main thread via
// PsdWorkerPool so the UI stays responsive (skeleton shown while parsing).
//
// Task 5.3 of the work plan.
// Inline in the Project view (not a modal). Parent toggles `visible` and
// listens for the `close` event (button or ESC).
import { basenameOf } from '@shared/paths'
import { pagePairKeyOf, exactPairPriority } from '@shared/pair'
import { computed, ref, shallowRef, watch, onMounted, onBeforeUnmount } from 'vue'
import ImageViewer from './ImageViewer.vue'
import { previewCache, type PreviewLease } from '@renderer/services/previews'
import type { WorkMode } from '@shared/types'
import { WORK_MODE_LABELS } from '@shared/modes'
import TranslationPane from '@renderer/features/translation/TranslationPane.vue'
import type { TranslationPaneModel } from '@renderer/features/translation/pane-model'
import type { TranslationPaneMode } from '@shared/translation-review'
import { isTextEntryTarget } from '@renderer/utils/keyboard-target'
import { useTranslationSelection } from '@renderer/features/translation/useTranslationSelection'
import SplitPane from './SplitPane.vue'
import CompareImagePane from './CompareImagePane.vue'
import ComparePager from './ComparePager.vue'
import ViewerImageControls from '@renderer/features/project/ViewerImageControls.vue'
import type { TranslationCredits } from '@shared/translation-credits'
import TranslationModeToggle from '@renderer/features/translation/TranslationModeToggle.vue'
import TranslationAddFrameToggle from '@renderer/features/translation/TranslationAddFrameToggle.vue'

const props = withDefaults(
  defineProps<{
    jpgPath: string | undefined
    psdPath: string
    folderPath?: string
    visible: boolean
    actionsTarget?: string
    markTarget?: string
    footerTarget?: string
    revision?: string
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
    markedDone?: boolean
    advanceAfterMark?: boolean
    /**
     * P1「译文对照」：**给了就在右栏显示这一页的译文**（翻译 / 校对模式）。
     *
     * 不给（`null` / 缺省）⇒ 右栏仍是 PSD —— 嵌字 / 监修模式与既有用例**一字不改**。
     * 注意"给了"不等于"有内容"：`not-found` / `error` / 本页无译文都照样显示译文栏
     * 并说一句事实（用户拍板：右栏身份恒定，不因为有没有 txt 来回跳）。
     */
    translation?: TranslationPaneModel | null
    /**
     * 译文态的左右分栏宽度（**原图那一栏的百分比**）。由父层从设置里取，
     * 拖完通过 `update:splitPercent` 报回去落库 —— 组件自己不碰 store。
     */
    splitPercent?: number
    /**
     * 当前第几张（**1 起**；`0` = 对不上，此时**不显示**页码）。
     * 由 `views/Project.vue` 从 `pairs` 现算 —— 组件自己不认识"这一话有几张"。
     */
    pageNumber?: number
    /** 这一话一共几张（页码下拉的选项数就是它）。 */
    pageCount?: number
    /**
     * 第 5 批 5d-2：**刚新增**的那一条的瞬时高亮（由宿主持有，这里只透传）。
     *
     * ⚠️ 它**不碰** `useTranslationSelection` 的那三态（悬停 / 固定选中 / 编辑态）——
     * 三态一个字段都没加；这是一个与它们并列的、**只读的**展示状态，
     * 2 秒后（或用户一动）由**宿主**清掉。
     */
    justAddedIndex?: number | null
  }>(),
  {
    mode: 'typeset',
    imageOnly: false,
    playing: false,
    thumbStripOpen: false,
    advanceAfterMark: false,
    translation: null,
    splitPercent: 66,
    pageNumber: 0,
    pageCount: 0,
    justAddedIndex: null
  }
)

// Same wording rule as the thumbnail cards: 去嵌字 / 去翻译 / 去校对 / 去监修.
const actionLabel = computed(() => `去${WORK_MODE_LABELS[props.mode]}`)

// ── P1 译文对照：右栏身份 + 两侧共用的高亮编号 ────────────────────────────────
/**
 * 右栏显示"译文"还是"PSD" —— **只看父层给没给译文模型**。
 * 模式判断（翻译 / 校对才给）在 `views/Project.vue`，这里不认识模式 —— 组件保持哑。
 */
const showTranslationPane = computed(() => props.translation !== null)
// 三个交互状态（悬停 / 固定选中 / 编辑态）全部收进 composable —— 这里只拿到六个动作
// 与两个只读派生值，**不再直接持有/写任何 ref**（方案 A，2026-10-07）。
// 为什么收进去：见 useTranslationSelection.ts 文件头（上一轮"退出时顺手清选中"是局部补丁，
// 没盖住"再双击同一行"那条退出路径，而且会把亲手点过的选中一起误清）。
const {
  highlightedIndex: highlightedTranslationIndex,
  editingIndex: editingTranslationIndex,
  setHover,
  pick: selectTranslation,
  enterEdit,
  exitEdit,
  resetForPage,
  resetForModeChange
} = useTranslationSelection()

/**
 * 双击某一条：进编辑**只开编辑器、不建立固定选中**；再双击同一行 = 收起，走统一的 `exitEdit`。
 *
 * ⚠️ 判断"进还是出"在这里做，但**两条路都不碰固定选中** —— 固定选中只有 `pick`（单击）能改。
 */
function pickTranslation(index: number): void {
  selectTranslation(index)
  scrollTranslationRowIntoView(index)
}

const editorAnchor = shallowRef<{ getBoundingClientRect: () => DOMRect } | null>(null)
function onAnchorEdit(index: number, anchor: HTMLElement): void {
  const bounds = anchor.getBoundingClientRect()
  editorAnchor.value = { getBoundingClientRect: () => bounds }
  enterEdit(index)
}
function onEditTranslation(index: number): void {
  editorAnchor.value = null
  if (editingTranslationIndex.value === index) {
    exitEdit()
  } else {
    enterEdit(index)
  }
}

/** 编辑器收起（失焦 / Esc / 点栏外）⇒ 只关编辑态，**不动固定选中**（方案 A）。 */
function onCloseEditor(): void {
  editorAnchor.value = null
  exitEdit()
}

/**
 * 第 5 批 5d-2：右栏译文栏的句柄 —— **只用到"把某一行滚进视野"这一件事**
 * （见 `TranslationPane` 的 `defineExpose`；它内部复用自己那一个 `scrollRowIntoView`，
 * 所以这里**没有**第二个滚动实现）。
 *
 * 为什么由这一层转发而不是宿主直接拿：宿主不认识"右栏是哪个组件实例"，
 * 而这一层本来就同时握着原图栏与译文栏。
 */
const translationPaneRef = ref<InstanceType<typeof TranslationPane> | null>(null)

function scrollTranslationRowIntoView(index: number | null): void {
  translationPaneRef.value?.scrollToIndex(index)
}

defineExpose({ scrollTranslationRowIntoView })

// 翻页就把高亮与编辑器都清掉：编号是"这一页的第几条"，跨页保留会指到另一句话上
watch(
  () => props.psdPath,
  () => resetForPage()
)

/**
 * 第 4 批修：**切档位（翻译 / 校对）也把编辑器收掉**；2026-10-07 方案 A 追加：**固定选中也一起清**
 * （两档行长得不一样，跨档保留的编号会指错）。悬停是临时的、自我修正，不用管。
 */
watch(
  () => props.translation?.mode ?? null,
  () => resetForModeChange()
)

/** Image-only entries have no PSD side, so the header must not promise one. */
const headerLabel = computed(() => (props.imageOnly ? '图片预览' : '对照视图'))

/** 与工具栏同一套文案：标记监修 / 标记未监修。 */
const markLabel = computed(() => `标记${props.markedDone ? '未' : '已'}${WORK_MODE_LABELS[props.mode]}`)

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'openPsd'): void
  (e: 'previous'): void
  (e: 'next'): void
  /** 译文态拖完分隔条：把原图栏的新宽度（百分比）交给宿主落库。 */
  (e: 'update:splitPercent', percent: number): void
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
  /**
   * 译文编辑（P2）：这一栏自己不落地 —— 它不认识"草稿 / 保存去哪"，一律交给宿主。
   * 这样"只有一处会写用户文件"这条纪律在组件层也是成立的。
   */
  (e: 'update:fullscreen', value: boolean): void
  (e: 'translationEditText', index: number, text: string, done?: (saved: boolean) => void): void
  (e: 'translationEditGroup', index: number, groupName: string): void
  (e: 'translationUndo'): void
  (e: 'translationDiscard'): void
  (e: 'translationSave'): void
  (e: 'translationCredits', credits: TranslationCredits, done: (error?: string) => void): void
  /** P2-c：拖完锚点（归一化坐标）。 */
  (e: 'translationMoveAnchor', index: number, x: number, y: number): void
  /**
   * 第 5 批：**在原图上新增一个条目**（分组名 + 归一化坐标）——
   * 落在哪一条、写进哪份 txt 全由宿主决定，这一层只报"用户在图上点了哪儿"。
   */
  (e: 'translationAddFrame', groupName: string, x: number, y: number): void
  /**
   * 第 5 批 5d-2：页头那枚「新增框」开关被点了。
   *
   * 状态在**宿主**（`views/Project.vue` 的 ref）—— 这一层只把"用户把它开到/关到了什么"报上去，
   * 与人家的 `translationMode` 同一条写法（组件不持有跨会话的状态）。
   */
  (e: 'translationAddFrameMode', value: boolean): void
  /**
   * 第 5 批 5e：**删除一条译文**（两处入口共用这一个事件：右栏行菜单第三项 / 锚点右键）。
   *
   * 这一层只报"要删第几条"，写盘 / 挪记录 / 草稿键重映射全在宿主
   *（与 `translationAddFrame` 同一条分工：组件不认识"能不能删、怎么删"）。
   */
  (e: 'translationDeleteEntry', index: number): void
  /** 第 2 批：用户改了译文栏档位（翻译 / 校对）—— 由宿主记住（本会话内不再跟随四模式）。 */
  (e: 'translationMode', mode: TranslationPaneMode): void
  /** 第 2 批：写某一条的校对理由（只进数据库，不碰 txt）。 */
  (e: 'translationEditReason', index: number, reason: string): void
  /** 第 2 批：点「导出校对记录…」（弹另存为那件事由宿主做）。 */
  (e: 'translationExportReviews'): void
  /** 第 3 批：点「另存…」—— 把当前翻译另存到用户选的位置（宿主去做）。 */
  (e: 'translationSaveAs'): void
  /** 第 4 批：点行尾 `✕` 或右键菜单第一项 —— 撤销校对（把原文写回 txt + 删记录）。 */
  (e: 'translationUnreview', index: number): void
  /** 第 4 批：右键菜单第二项 —— 只删记录（保留现在的译文）。 */
  (e: 'translationDropReview', index: number): void
  /** 从页码下拉选了第几张（1 起）；父层复用胶片条那条跳转。 */
  (e: 'pickPage', pageNumber: number): void
}>()

// --- State -----------------------------------------------------------------
/**
 * **PSD 栏那一枚「下一页」的显隐区**（2026-10-07 用户拍板）。
 *
 * 用户原话："在 PSD 栏右边新增一个显隐区"—— 所以它与原图栏那一套**各自独立**：
 * 鼠标进 PSD 画面 ⇒ 只亮它；鼠标进原图栏看图区 ⇒ 只亮原图栏那对。
 *
 * ⚠️ **已知边界（如实记，不改）**：这两枚"下一页"各自绑在自己的显隐区上 ⇒
 * 从原图往最右边挪鼠标时会**跨出一个区、进另一个区**，中间那一段它会淡出并变
 * `pointer-events-none`（0.2s 内点不中）。用户明确选了"两个独立显隐区"这个口径，
 * 所以先按他说的做；真机觉得"点不到"时再谈（备选：把这两个区合成"整个画面区"）。
 */
const psdHintVisible = ref(false)

/** PSD 栏那一枚只会是「下一页」，所以这里也照样写全（组件是通用的）。 */
function onPsdPagerGo(kind: 'previous' | 'next'): void {
  if (kind === 'previous') emit('previous')
  else emit('next')
}
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
const sharedPan = ref({ x: 0, y: 0 })
watch(zoomRatio, ratio => { if (ratio <= 1) sharedPan.value = { x: 0, y: 0 } })
watch([() => props.psdPath, () => props.jpgPath, () => props.mode, () => props.translation?.mode], () => { zoomRatio.value = 1; sharedPan.value = { x: 0, y: 0 } })
const fullscreen = ref(false)
const fullscreenError = ref('')
function syncFullscreen(): void { fullscreen.value = !!document.fullscreenElement; emit('update:fullscreen', fullscreen.value) }
async function toggleFullscreen(): Promise<void> {
  try {
    fullscreenError.value = ''
    if (document.fullscreenElement) await document.exitFullscreen()
    else await document.documentElement.requestFullscreen()
    syncFullscreen()
  } catch { fullscreenError.value = '无法切换全屏，请重试' }
}
let lastPageWheel = -Infinity
function onPageWheel(delta: number): void {
  const now = performance.now()
  if (!delta || now - lastPageWheel < 180) return
  lastPageWheel = now
  if (delta > 0) emit('next')
  else emit('previous')
}
/**
 * 「这一张显示好了」——自动播放的节拍起点。
 *
 * 判据是两栏都**落定**：有图 / 明确没有同名图 / PSD 解析失败，三者都算落定
 * （失败的页面也必须让播放往下走，否则一张坏 PSD 就把播放钉死了）。
 */
const jpgSettled = computed(() => jpgUrl.value !== null || jpgUnavailable.value)
const psdSettled = computed(
  () =>
    props.imageOnly ||
    // 右栏换成译文时根本不解析 PSD，所以"就绪"不能等 PSD（否则自动播放会一直等下去）
    showTranslationPane.value ||
    psdUrl.value !== null ||
    psdError.value
)
watch(
  () => props.visible && jpgSettled.value && psdSettled.value,
  (ready) => {
    if (ready) emit('ready')
  }
)

const psdFilename = computed(() => basename(props.psdPath))
let sourceController = new AbortController()
const leases = new Set<PreviewLease>()
function releaseSources(): void {
  sourceController.abort()
  sourceController = new AbortController()
  for (const lease of leases) lease.release()
  leases.clear()
}
async function previewUrl(path: string, raster: boolean, seq: number): Promise<string> {
  if (seq !== sourceSeq) throw new DOMException('预览已取消', 'AbortError')
  const lease = await previewCache.acquire(path, raster, sourceController.signal)
  if (seq !== sourceSeq) {
    lease.release()
    throw new DOMException('预览已取消', 'AbortError')
  }
  leases.add(lease)
  return lease.url
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
  return pagePairKeyOf(absPath)
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
    (a, b) => exactPairPriority(psdPath, a) - exactPairPriority(psdPath, b) || imageRank(rootFolder, psdPath, a) - imageRank(rootFolder, psdPath, b) || a.localeCompare(b)
  )[0]
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
    const url = await previewUrl(imagePath, true, seq)
    if (seq !== sourceSeq || psdPath !== props.psdPath) return
    jpgUrl.value = url
    void writePsdLog('compare-viewer', 'info', 'Matching image load success', {
      psdPath,
      imagePath,
      resolvedByScan,
      dataUrlLength: jpgUrl.value.length
    })
  } catch (err) {
    if (seq !== sourceSeq) return
    if (!resolvedByScan) {
      const rescannedPath = await resolveMatchingImagePath(psdPath, folderPath)
      if (rescannedPath && normalizePath(rescannedPath) !== normalizePath(imagePath)) {
        try {
          const url = await previewUrl(rescannedPath, true, seq)
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
    const url = await previewUrl(psdPath, false, seq)
    if (seq !== sourceSeq || psdPath !== props.psdPath) return
    psdUrl.value = url
    psdUrlPath.value = psdPath
    void writePsdLog('compare-viewer', 'info', 'PSD render success', {
      psdPath,
      imagePath: jpgPath,
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
  releaseSources()
  jpgUrl.value = null
  jpgUnavailable.value = false
  psdUrl.value = null
  psdUrlPath.value = null
  psdLoading.value = false
  psdError.value = false
  // 退出预览 = 一切归零：下次进来是 100%（适应窗口）。
  // （倍数输入框那点状态住在 ViewerZoomControls 里，随组件一起走，这里不用管。）
  zoomRatio.value = 1
}

function reloadVisibleSources(): void {
  const seq = ++sourceSeq
  releaseSources()
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
  // 右栏换成"译文"时同理：这一栏根本不显示 PSD，解析它纯属白烧 worker。
  if (!props.imageOnly && !showTranslationPane.value) void loadPsd(seq, psdPath, jpgPath)
}

// --- Watchers --------------------------------------------------------------
// Trigger loads when the panel becomes visible or the compared files change.
watch(
  () =>
    [
      props.visible,
      props.jpgPath,
      props.psdPath,
      props.folderPath,
      props.imageOnly,
      props.revision
    ] as const,
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
    if (fullscreen.value || document.fullscreenElement) { e.preventDefault(); e.stopImmediatePropagation(); void toggleFullscreen(); return }
    // 播放中 Esc = 先停播放（再按一次才退出预览）。
    // 不在播放时保持老行为：Esc 直接关窗 —— 既有用例锁着这一条。
    if (props.playing) emit('stopPlayback')
    else emit('close')
    return
  }
  const isArrow =
    e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'ArrowRight' || e.key === 'ArrowDown'
  if (!isArrow) return
  /**
   * ⚠️ 2026-10-06（P1.1）：**先看焦点在不在输入框里**。
   *
   * 这条监听挂在 `window` 上，原来完全不管事件目标 —— 于是在右下角那个缩放输入框里
   * 按 ←/→ 会翻页（§12 登记在册、一直没修的那个老毛病）。翻页入口这一轮正好要改，
   * 一次修掉。判据走 `utils/keyboard-target`（与视图的撤销热键同一处，不各写一份）。
   */
  if (isTextEntryTarget(e.target)) return
  e.preventDefault()
  if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') emit('previous')
  else emit('next')
}

/**
 * 2026-10-06（P1.1）：这里原先有一条"滚轮 = 翻页"，**已撤掉**。
 * 用户拍板：滚轮整体让给缩放（普通与 Ctrl 都缩放），翻页改走左右中段的悬停按钮
 * + 键盘 ←/→ + 底部胶片条。
 * ⚠️ 撤掉它顺带修了一个没人报过的毛病：那条监听挂在**整个对照视图**上并 preventDefault，
 * 于是滚轮悬在右栏译文清单上时**滚不动清单**（只会翻页）。现在滚轮落在哪就归谁。
 */

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  document.addEventListener('fullscreenchange', syncFullscreen)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  document.removeEventListener('fullscreenchange', syncFullscreen)
  emit('update:fullscreen', false)
  if (fullscreen.value && document.fullscreenElement) void document.exitFullscreen()
  sourceSeq++
  releaseSources()
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
  >
    <Teleport defer :to="markTarget || 'body'" :disabled="!markTarget">
        <UiButton :variant="markedDone ? 'outline' : 'default'" size="sm" data-testid="compare-mark-toggle" :aria-pressed="!!markedDone" :title="markedDone ? '点击标记为未完成' : '点击标记为已完成'" @click="onMark(markedDone ? 'pending' : 'done')">{{ markLabel }}</UiButton>
    </Teleport>
    <Teleport defer :to="actionsTarget || 'body'" :disabled="!actionsTarget">
      <div class="ml-auto flex flex-wrap items-center justify-end gap-2" data-testid="compare-actions">

        <UiButton variant="outline" size="sm"
          class="transition-colors"
          @click="onOpenPsd"
        >
          {{ actionLabel }}
        </UiButton>
        <!--
          「标记后下一张」（C3）：做一张张过的 QC 时省掉一次方向键。
          只用图标 —— 页头本来就有四个按钮，再加一个带字的会把它们挤变形
          （有 compare-viewer-header 那组截图盯着）。
        -->
        <UiButton variant="outline" size="sm"
          type="button"
          class="flex w-8 shrink-0 items-center justify-center transition-colors"
          :class="
            advanceAfterMark
              ? 'border-primary-border bg-primary-soft text-accent'
              : 'border-border bg-card-bg text-text-secondary hover:bg-card-bg-hover hover:text-text-primary'
          "
          :title="
            advanceAfterMark ? '标记后下一张：开（点一下关掉）' : '标记后下一张：关（点一下打开）'
          "
          :aria-pressed="advanceAfterMark"
          data-testid="compare-advance-toggle"
          @click="emit('update:advanceAfterMark', !advanceAfterMark)"
        >
          <svg
            class="h-4 w-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <line x1="4" y1="12" x2="14" y2="12" />
            <polyline points="10 7 15 12 10 17" />
            <line x1="19" y1="5" x2="19" y2="19" />
          </svg>
        </UiButton>
        <span class="mx-0.5 h-4 w-px shrink-0 bg-border" aria-hidden="true" />

        <UiButton variant="default" size="sm"
          class="transition-colors"
          @click="onClose"
        >
          退出预览
        </UiButton>
      </div>
    </Teleport>



    <!-- Split panel — image-only entries get a single full-width pane.
         译文态走 SplitPane（可拖拽调宽，默认 66/34）；PSD 态与只有一栏时保持原来的 flex 布局。 -->
    <div class="relative flex min-h-0 flex-1">
      <!-- 译文态：左原图 / 右译文，中间一条可拖拽的分隔条 -->
      <SplitPane
        v-if="showTranslationPane"
        class="min-w-0 flex-1"
        :primary-percent="splitPercent"
        :min-primary-window-ratio="0.3"
        :min-secondary-px="240"
        aria-label="调整原图与译文宽度"
        @update:primary-percent="emit('update:splitPercent', $event)"
      >
        <template #primary>
          <CompareImagePane
            class="h-full"
            :jpg-url="jpgUrl"
            :zoom-ratio="zoomRatio"
            :pan="sharedPan"
            @update:pan="sharedPan = $event"
            @page-wheel="onPageWheel"
            :translation="translation"
            :active-index="highlightedTranslationIndex"
            :page-number="pageNumber"
            :page-count="pageCount"
            :add-mode="translation?.addFrameMode ?? false"
            @update:zoom-ratio="zoomRatio = $event"
            @pick="pickTranslation"
            @edit="onAnchorEdit"
            @hover="setHover"
            @translation-move-anchor="
              (index: number, x: number, y: number) => emit('translationMoveAnchor', index, x, y)
            "
            @translation-add-frame="
              (groupName: string, x: number, y: number) =>
                emit('translationAddFrame', groupName, x, y)
            "
            @translation-mode="(mode: TranslationPaneMode) => emit('translationMode', mode)"
            @update:add-frame-mode="(value: boolean) => emit('translationAddFrameMode', value)"
            @translation-delete-entry="(index: number) => emit('translationDeleteEntry', index)"
            @pick-page="emit('pickPage', $event)"
            @previous="emit('previous')"
            @next="emit('next')"
          >
            <template #toolbar>
      <span class="shrink-0 text-sm font-semibold text-accent">{{ headerLabel }}</span>
      <span class="min-w-0 max-w-[30%] truncate text-sm font-semibold" :title="psdFilename">{{ psdFilename }}</span>
      <TranslationModeToggle v-if="translation" :mode="translation.mode" @update:mode="emit('translationMode', $event)" />
      <TranslationAddFrameToggle v-if="translation" :add-frame-mode="translation.addFrameMode ?? false" @update:add-frame-mode="emit('translationAddFrameMode', $event)" />

              <ViewerImageControls :page-number="pageNumber" :page-count="pageCount" :zoom-ratio="zoomRatio" :fullscreen="fullscreen" :fullscreen-error="fullscreenError" @pick-page="emit('pickPage', $event)" @update:zoom-ratio="zoomRatio = $event" @fullscreen="toggleFullscreen" />
            </template>
          </CompareImagePane>
        </template>
        <template #secondary>
          <TranslationPane
            ref="translationPaneRef"
            :loading="translation?.loading ?? false"
            :result="translation?.result ?? null"
            :entry="translation?.entry ?? null"
            :groups="translation?.groups ?? []"
            :active-index="highlightedTranslationIndex"
            :dirty="translation?.dirty ?? false"
            :changed-count="translation?.changedCount ?? 0"
            :saving="translation?.saving ?? false"
            :notice="translation?.notice ?? ''"
            :changed-indices="translation?.changedIndices ?? []"
            :editing-index="editingTranslationIndex"
            :editor-anchor="editorAnchor"
            :group-overrides="translation?.groupOverrides ?? {}"
            :mode="translation?.mode ?? 'translate'"
            :reviews="translation?.reviews ?? {}"
            :page-reviewed="translation?.pageReviewed ?? false"
            :review-count="translation?.reviewCount ?? 0"
            :can-undo-saved="translation?.canUndoSaved ?? false"
            :add-frame-mode="translation?.addFrameMode ?? false"
            :just-added-index="justAddedIndex"
            @pick="pickTranslation"
            @hover="setHover"
            @edit="onEditTranslation"
            @edit-text="(index: number, text: string, done?: (saved: boolean) => void) => emit('translationEditText', index, text, done)"
            @edit-group="
              (index: number, groupName: string) => emit('translationEditGroup', index, groupName)
            "
            @update:mode="(mode: TranslationPaneMode) => emit('translationMode', mode)"
            @update:add-frame-mode="(value: boolean) => emit('translationAddFrameMode', value)"
            @delete-entry="(index: number) => emit('translationDeleteEntry', index)"
            @edit-reason="
              (index: number, reason: string) => emit('translationEditReason', index, reason)
            "
            @export-reviews="emit('translationExportReviews')"
            @save-as="emit('translationSaveAs')"
            @unreview="(index: number) => emit('translationUnreview', index)"
            @drop-review="(index: number) => emit('translationDropReview', index)"
            @close-editor="onCloseEditor"
            @undo="emit('translationUndo')"
            @discard="emit('translationDiscard')"
            @save="emit('translationSave')"
          />
        </template>
      </SplitPane>

      <!-- 其余形态：PSD 对照（50/50）或只有一栏 -->
      <div v-else class="flex min-h-0 min-w-0 flex-1 flex-col">
            <div class="flex min-h-11 shrink-0 flex-wrap items-center gap-2 border-b border-border px-3 py-1" data-testid="compare-image-pane-header">
      <span class="shrink-0 text-sm font-semibold text-accent">{{ headerLabel }}</span>
      <span class="min-w-0 max-w-[30%] truncate text-sm font-semibold" :title="psdFilename">{{ psdFilename }}</span>
      <TranslationModeToggle v-if="translation" :mode="translation.mode" @update:mode="emit('translationMode', $event)" />
      <TranslationAddFrameToggle v-if="translation" :add-frame-mode="translation.addFrameMode ?? false" @update:add-frame-mode="emit('translationAddFrameMode', $event)" />

              <ViewerImageControls :page-number="pageNumber" :page-count="pageCount" :zoom-ratio="zoomRatio" :fullscreen="fullscreen" :fullscreen-error="fullscreenError" @pick-page="emit('pickPage', $event)" @update:zoom-ratio="zoomRatio = $event" @fullscreen="toggleFullscreen" />
            </div>
        <div class="flex min-h-0 min-w-0 flex-1">
        <!-- Left: JPG preview -->
        <CompareImagePane
          class="min-w-0 basis-0 flex-1"
          :class="imageOnly ? '' : 'border-r border-border'"
          :jpg-url="jpgUrl"
          :zoom-ratio="zoomRatio"
            :pan="sharedPan"
            @update:pan="sharedPan = $event"
            @page-wheel="onPageWheel"
          :translation="translation"
          :active-index="highlightedTranslationIndex"
          :page-number="pageNumber"
          :page-count="pageCount"
          :show-next-pager="imageOnly"
          @update:zoom-ratio="zoomRatio = $event"
          @pick="pickTranslation"
            @edit="onAnchorEdit"
          @hover="setHover"
          @translation-move-anchor="
            (index: number, x: number, y: number) => emit('translationMoveAnchor', index, x, y)
          "
          @pick-page="emit('pickPage', $event)"
          @previous="emit('previous')"
          @next="emit('next')"
        >

          </CompareImagePane>

        <!-- Right: PSD rendering via worker (skipped entirely for image-only) -->
        <div v-if="!imageOnly" class="flex min-w-0 basis-0 flex-1 flex-col">
          <!--
            ⚠️ `relative` 是这一枚「下一页」的定位祖先（用户拍板：贴在 **PSD 栏的画面容器右缘**）——
            少了它就会被算到更外层、离画面右缘远一大截（本轮正是为这个加的）。
          -->
          <div
            class="relative min-h-0 flex-1"
            data-testid="compare-psd-pane-body"
            @pointerenter="psdHintVisible = true"
            @pointerleave="psdHintVisible = false"
          >
            <!-- Loading skeleton -->
            <div
              v-if="psdLoading"
              class="flex h-full flex-col items-center justify-center gap-3 text-sm text-text-secondary"
            >
              <div
                class="h-8 w-8 animate-spin rounded-full border-2 border-border border-t-accent"
              />
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
            :pan="sharedPan"
            @update:pan="sharedPan = $event"
            @page-wheel="onPageWheel"
              @update:zoom-ratio="zoomRatio = $event"
            />
            <div v-else class="flex h-full items-center justify-center text-sm text-text-tertiary">
              无PSD图片
            </div>
            <!--
              嵌 / 监态的「下一页」：贴 **PSD 栏画面容器的右缘**（用户拍板）。
              只在这一支出现 ⇒ 与原图栏里那枚**永不共存**（原图栏那枚在这一支被 `showNextPager=false` 关掉）。
            -->
            <ComparePager
              kind="next"
              position-class="right-2"
              :visible="psdHintVisible"
              test-id="compare-page-next-psd"
              @go="onPsdPagerGo"
            />
          </div>
        </div>
        </div>
      </div>
    </div>

  </div>
</template>
