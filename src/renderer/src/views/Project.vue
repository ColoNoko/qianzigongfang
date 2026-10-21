<script setup lang="ts">
import { initialTranslationCredits, type TranslationCredits } from '@shared/translation-credits'
import { compareChapterNumbersByOrder } from '@shared/chapter'
import { Button as UiButton } from '@renderer/components/ui/button'
import { useProjectViewer } from '@renderer/features/project/useProjectViewer'
import { computed, onBeforeUnmount, onMounted, watch, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useProjectWorkspace } from '@renderer/stores/projectWorkspace'
import { useProjectStore } from '@renderer/stores/project'
import { useAchievementsStore } from '@renderer/stores/achievements'
import { useToastStore } from '@renderer/stores/toast'
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/components/ui/popover'
import { ToggleGroup, ToggleGroupItem } from '@renderer/components/ui/toggle-group'
import { useSettingsStore, PLAY_INTERVAL_OPTIONS } from '@renderer/stores/settings'
import { useProjectSelfCheck } from '@renderer/features/project/useProjectSelfCheck'
import type { ChapterProgress, JpgPsdPair, WorkMode } from '@shared/types'
import LoadingSkeleton from '@renderer/components/LoadingSkeleton.vue'
import NetworkRetry from '@renderer/components/NetworkRetry.vue'
import EmptyState from '@renderer/components/EmptyState.vue'
import ProjectSidebar from '@renderer/components/ProjectSidebar.vue'
import ProjectThumbList from '@renderer/components/ProjectThumbList.vue'
import ProjectFooter from '@renderer/components/ProjectFooter.vue'
import CompareViewer from '@renderer/components/CompareViewer.vue'
import PreviewThumbStrip from '@renderer/components/PreviewThumbStrip.vue'
import MarkHistoryDialog from '@renderer/features/project/MarkHistoryDialog.vue'
import { summarizeMarkOperation, type MarkAuditOperation } from '@shared/mark-audit'
import ProjectFormModal from '@renderer/components/ProjectFormModal.vue'
import SplitPane from '@renderer/components/SplitPane.vue'
import SelfCheckDialog from '@renderer/features/project/SelfCheckDialog.vue'
import SourceRootDialog from '@renderer/features/project/SourceRootDialog.vue'
import { useSourceRootEditor } from '@renderer/features/project/useSourceRootEditor'
import { useProjectMarking } from '@renderer/features/project/useProjectMarking'
import { useProjectScan } from '@renderer/features/project/useProjectScan'
import { useParentDuties } from '@renderer/features/project/useParentDuties'
import TranslationCreditsEditor from '@renderer/features/translation/TranslationCreditsEditor.vue'
import { useChapterTranslation } from '@renderer/features/translation/useChapterTranslation'
import {
  toPlainEdits,
  useChapterTranslationDraft
} from '@renderer/features/translation/useChapterTranslationDraft'
import TranslationConflictDialog from '@renderer/features/translation/TranslationConflictDialog.vue'
import {
  readChapterTranslation,
  createChapterTranslation,
  deleteTranslationReview,
  exportChapterTranslation,
  exportTranslationReview,
  insertChapterTranslation,
  listTranslationReviews,
  saveChapterTranslation,
  saveTranslationReview
} from '@renderer/features/translation/translationBridge'
import {
  chapterTranslationExportFileName,
  findTranslationEntryForPage,
  findTranslationLabelByPosition,
  snappedChapterTranslationPosition
} from '@shared/chapter-translation'
import { basenameOf, lastPathSegment } from '@shared/paths'
import type { LabelPlusImageEntry } from '@shared/labelplus-import'
import type { TranslationPaneModel } from '@renderer/features/translation/pane-model'
import {
  buildTranslationReviewExport,
  normalizeReviewFolder,
  normalizeReviewImage,
  paneModeForWorkMode,
  translationReviewExportFileName,
  type TranslationPaneMode,
  type TranslationReviewExportEntry,
  type TranslationReviewRecord
} from '@shared/translation-review'
import {
  readRecentProjectIds,
  writeRecentProjectIds
} from '@renderer/features/project/projectBridge'
import { isTextEntryTarget } from '@renderer/utils/keyboard-target'
import { performCardAction } from '@renderer/features/project/external-tool'
import { childWorkbenchPath } from '@renderer/features/project/project-route'
import { formatChapterNumber, normalizeChapterNumber } from '@shared/chapter'
import { computeModeCounts } from '@shared/status'
import { WORK_MODE_LABELS } from '@shared/modes'
import { findChildAfterDeletion } from '@renderer/utils/projectDeletionNavigation'

// Keep the imports live (no tree-shaking).
void LoadingSkeleton
void NetworkRetry

const route = useRoute()
const router = useRouter()
const workspace = useProjectWorkspace()
const projectStore = useProjectStore()
const achievements = useAchievementsStore()
const toast = useToastStore()
const settings = useSettingsStore()

const childId = computed(() => route.params.childId as string)

/**
 * 树是否仍在加载。
 *
 * 启动直达（§4.5）和"从列表点进详情"的第一帧里 `workspace.parents` 还是空的，
 * 此时 `child` 必然找不到 —— 直接渲染"项目不存在"就是整屏空状态闪一下，
 * 正是用户报的"画面一闪而过"。加载期间渲染中性的"加载中…"，加载完再判定。
 */
const treeLoading = ref(workspace.parents.length === 0)

// Look up the child in the workspace store. Null → "项目不存在" fallback.
const child = computed(() => workspace.findChild(childId.value))
const currentParent = computed(
  () =>
    workspace.parents.find((parent) => parent.children.some((item) => item.id === childId.value)) ??
    null
)

const { dutyMap, modeMap } = useParentDuties()

// Scan result for the active child — fed to ProjectThumbList.
const pairs = ref<JpgPsdPair[]>([])


const {
  selectedPairs,
  activeMode,
  activeModeDoneLabel,
  onMark,
  markTargetsForActiveMode,
  onSelectionChange,
  markSelectedDone,
  markSelectedPending
} = useProjectMarking({
  pairs,
  currentParent,
  currentMode: computed(() => currentParent.value ? modeMap.value[currentParent.value.id] : settings.activeWorkMode)
})

const {
  compareVisible,
  comparePair,
  stripOpen,
  playing,
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
} = useProjectViewer(pairs, computed(() => workspace.scannedImages.childId === childId.value ? workspace.scannedImages.files : []), activeMode)
const modeProgress = computed(() => computeModeCounts(pairs.value))

const activeModeProgress = computed<ChapterProgress>(() => modeProgress.value[activeMode.value])

// ── P1 译文对照：翻译 / 校对模式下，对照视图右栏换成"这一页的译文" ────────────────
/**
 * 翻译 / 校对右栏展示译文，嵌字 / 监修右栏展示 PSD。
 * 嵌字 / 监修在打开署名面板时单独读取 TXT，不影响译文草稿。
 */
const translationEnabled = computed(
  () => activeMode.value === 'translated' || activeMode.value === 'proofread'
)

/** 读的是**话自己的目录**：现扫、取最新那份能解析的 txt，不落库（见 features/translation/）。 */
const {
  result: chapterTranslation,
  loading: chapterTranslationLoading,
  load: reloadChapterTranslation
} = useChapterTranslation({
  folderPath: () => child.value?.folderPath ?? null,
  enabled: () => translationEnabled.value
})

/**
 * 译文改动的草稿（P2）。
 *
 * ⚠️ 保存成功后必须**重读**：文档与基指纹都要换成盘上最新那份 ——
 * 否则接着改第二条时，回传的还是旧指纹，会被当成"文件被别处改过"而白白拦一次。
 */
const translationDraft = useChapterTranslationDraft({
  document: () => chapterTranslation.value?.document ?? null,
  filePath: () => chapterTranslation.value?.file?.path ?? null,
  // 换话的判据是**话目录**（不是 txt 路径）：一次普通重读会让路径抖一下，
  // 用路径判会把"可退历史"误清 —— 那正是真机上"提示能撤、按下去没反应"的一层根因。
  chapterKey: () => child.value?.folderPath ?? null,
  base: () => {
    const file = chapterTranslation.value?.file
    return file ? { size: file.size, mtimeMs: file.mtimeMs, sha256: file.sha256 } : null
  },
  onSaved: async () => {
    const folderPath = child.value?.folderPath ?? null
    await reloadChapterTranslation()
    if (child.value?.folderPath === folderPath) await reloadTranslationReviews()
  }
})

/** 这一页的"图名"：只有图片的条目（previewOnly）把图片路径放在 psd 槽里。 */
function currentPageImageName(): string | null {
  const pair = comparePair.value
  if (!pair) return null
  return pair.jpgPath ?? pair.psd.absPath ?? null
}

/**
 * 当前这一页在 txt 里对应哪一条（本页没译文 ⇒ `null`）。
 *
 * ⚠️ **必须单独抽出来**：`compareTranslation` 与 `pageReviews` 都要用它。
 * 如果让后者去读前者的结果（`compareTranslation.value.entry`），两个 computed 就成了**环**——
 * Vue 在环里读到的是"正在计算中"的那份，表现是**那块数据静默为空**
 * （2026-10-06 现场：`reviews` 一直是 `{}`，铅笔一条都不出来，而别的一切正常）。
 */
const currentTranslationEntry = computed<LabelPlusImageEntry | null>(() =>
  findTranslationEntryForPage(chapterTranslation.value?.document ?? null, currentPageImageName())
)

// ── 第 2 批：档位（翻译 / 校对）与校对记录 ────────────────────────────────────

/**
 * 译文栏档位。
 *
 * 默认值**跟着四模式走**（`paneModeForWorkMode`：只有「校对」工序落到校对档），
 * 但用户**手动改过之后本会话内不再跟随**（`translationPaneModePinned`）——
 * 用户拍板原话是"联动 + 可手动改回，会话内有效"。
 */
const translationPaneMode = ref<TranslationPaneMode>('translate')

watch(
  activeMode,
  (mode) => {
    translationPaneMode.value = paneModeForWorkMode(mode)
  },
  { immediate: true }
)

/** 用户自己动了档位开关 ⇒ 这一会话内不再被四模式牵着走。 */
function onTranslationPaneMode(mode: TranslationPaneMode): void {
  translationPaneMode.value = mode
}

// ── 第 5 批「新增框」：开关 / 瞬时高亮（5d-2，2026-10-07）────────────────────────
/**
 * 页头那枚「新增框」开关（**默认关**，用户拍板）。
 *
 * 开着 ⇒ 原图栏**左键点一下 = 新增框内**、**右键点一下 = 新增框外**（写进这一话的 txt）；
 * 关着 ⇒ 图上一切照旧。
 *
 * ⚠️ 状态**只住在这里**：页头开关与 Tab 入口（原图栏内按 Tab）都汇到这一个 ref，
 * 组件层不持有它（否则"开关显示"与"手势实际行为"会各说各话）。
 */
const translationAddFrameMode = ref(false)

/** 切开关：开的时候清掉上一次的瞬时高亮（免得"刚新增"小标挂在新的一条上）。 */
function setTranslationAddFrameMode(value: boolean): void {
  translationAddFrameMode.value = value
  if (!value) clearJustAdded()
}

/**
 * **刚新增**的那一条（瞬时高亮，约 2 秒自动退掉）。
 *
 * ⚠️ 它**不是** `activeIndex` / `editingIndex` 里的任何一个 —— 用户拍板：
 * **不碰** `useTranslationSelection` 那个三态 composable（一个字段都不加）。
 * 它是这一层自己的只读展示状态：视觉上也刻意分开 ——
 * 固定选中 = 左缘 2px accent 竖条 + 选中底色；瞬时高亮 = 淡紫底 + accent 细描边 + 「刚新增」小标。
 */
const justAddedEntryIndex = ref<number | null>(null)
let justAddedTimer: ReturnType<typeof setTimeout> | null = null

/** 清掉瞬时高亮（开新一条之前 / 用户一动 / 切页换话切档位都会到这儿）。 */
function clearJustAdded(): void {
  if (justAddedTimer !== null) {
    clearTimeout(justAddedTimer)
    justAddedTimer = null
  }
  justAddedEntryIndex.value = null
}

/**
 * 点亮"刚新增"那一条。`null` = 有东西写了盘、但界面认不出是哪一条
 * （只出一句状态条，不点亮任何一行 —— 宁可什么都不亮，也不**蒙一个**）。
 */
function flashJustAdded(index: number | null): void {
  clearJustAdded()
  if (index === null) return
  justAddedEntryIndex.value = index
  justAddedTimer = setTimeout(() => {
    justAddedTimer = null
    justAddedEntryIndex.value = null
  }, 2000)
}

/** 离开新增模式的三条路之一：切页 / 换话 / 切档位 / 关预览都走这个（用户拍板"离开就关"）。 */
function leaveAddFrameMode(): void {
  translationAddFrameMode.value = false
  clearJustAdded()
}

/**
 * 这一话的校对记录（App 数据库里那张 `translation_review`）。
 *
 * **只在翻译 / 校对模式下读** —— 别的模式右栏根本不是译文栏，白读一次库没有意义
 * （与上面那条"读译文"同一条理由）。
 */
const translationReviews = ref<TranslationReviewRecord[]>([])
/**
 * **文件级反馈**的那一句人话（记录读写失败 / 另存失败）。
 *
 * ⚠️ 记录**读不出来不能假装"这一话没校对过"**：两者在界面上都表现为"没有铅笔图标"，
 * 而后者会让用户以为自己的记录丢了。所以失败要摆到状态条上。
 * 另存失败同理：用户挑完位置却什么都没拿到，不吭声就等于让他以为存上了。
 * （成功与"用户自己取消"都**不说话** —— 与草稿那条"成功静默、失败出声"同一口径。）
 */
const translationFileNotice = ref('')

/** Only the latest request for the still-visible chapter may publish review state. */
let translationReviewLoadSequence = 0
async function reloadTranslationReviews(): Promise<void> {
  const token = ++translationReviewLoadSequence
  const folderPath = child.value?.folderPath ?? null
  if (!translationEnabled.value || !folderPath) {
    translationReviews.value = []
    return
  }
  const result = await listTranslationReviews(folderPath)
  if (
    token !== translationReviewLoadSequence ||
    child.value?.folderPath !== folderPath ||
    !translationEnabled.value
  ) return
  translationReviews.value = result.ok ? result.records : []
  translationFileNotice.value = result.ok ? '' : result.message
}

watch(
  [translationEnabled, () => child.value?.folderPath ?? null],
  () => {
    translationReviews.value = []
    translationFileNotice.value = ''
    void reloadTranslationReviews()
  },
  { immediate: true, flush: 'sync' }
)
onBeforeUnmount(() => { translationReviewLoadSequence += 1 })

/**
 * **这一页**里校对过的那些（按条目编号索引）—— 有记录才有铅笔、才有"上原下校"。
 *
 * 只带记录里的**原文与理由**：「校」那一行显示的是**文档里的当前值**
 * （覆盖保存之后两者相等；若之后又被改过，就以 txt 现在这份为准 ——
 * 与用户的口径"被改过就以 txt 当前值为校"一致）。
 */
const pageReviews = computed<Record<number, { originalText: string; reason: string }>>(() => {
  const entry = currentTranslationEntry.value
  const folderPath = child.value?.folderPath ?? null
  if (!entry || !folderPath) return {}
  const folder = normalizeReviewFolder(folderPath)
  const imageKey = normalizeReviewImage(entry.fileName)
  const result: Record<number, { originalText: string; reason: string }> = {}
  for (const record of translationReviews.value) {
    if (normalizeReviewFolder(record.folderPath) !== folder) continue
    if (normalizeReviewImage(record.imageName) !== imageKey) continue
    result[record.labelIndex] = { originalText: record.originalText, reason: record.reason }
  }
  return result
})

/**
 * 交给 CompareViewer 的那个模型：**给了它 ⇒ 右栏是译文栏**。
 * `null`（嵌字 / 监修模式）⇒ 右栏还是 PSD，老行为一字不改。
 */
const currentCompareSource = computed(() => {
  const shown = comparePair.value
  return shown ? pairs.value.find(pair => pair.psd.absPath === shown.psd.absPath || (shown.jpgPath && pair.jpgPath === shown.jpgPath)) ?? workspace.applyPsdStatusOverrides([shown])[0] : null
})
function pairDone(pair: JpgPsdPair): boolean {
  return pair.psd.modes?.[activeMode.value] ?? (activeMode.value === 'typeset' && pair.psd.status === 'done')
}
const compareDone = computed(() => currentCompareSource.value ? pairDone(currentCompareSource.value) : false)
const selectedDone = computed(() => selectedPairs.value.length > 0 && selectedPairs.value.every(pairDone))

const compareTranslation = computed<TranslationPaneModel | null>(() => {
  if (!translationEnabled.value) return null
  const document = chapterTranslation.value?.document ?? null
  // 用**同一个** computed（别在这里再解析一次：两处各解析一次，早晚会有一处忘了跟着改）
  const entry = currentTranslationEntry.value
  // 这一页里哪几条被改过（改动集按"图名 + 序号"存，所以只筛当前这一页）
  const changedIndices = entry
    ? entry.labels
        .map((label) => label.index)
        .filter((index) => translationDraft.isChanged(entry.fileName, index))
    : []
  // P2-c：拖过坐标的那几条（有值就用它画锚点，免得拖完先弹回原处再跳过去）
  const positionOverrides = entry
    ? translationDraft.positionOverridesFor(entry.fileName, entry.labels)
    : {}
  // 改过分组的那几条（下拉显示要读它，否则一选就弹回旧值 ⇒ 看着像"切换没反应"）
  const groupOverrides = entry
    ? translationDraft.groupOverridesFor(entry.fileName, entry.labels)
    : {}
  return {
    loading: chapterTranslationLoading.value,
    result: chapterTranslation.value,
    entry,
    groups: document?.groups ?? [],
    // 界面读的是**慢一拍**的那个：自动保存成功就不闪（见 useChapterTranslationDraft）
    dirty: translationDraft.dirtyVisible.value,
    changedCount: translationDraft.changedCount.value,
    saving: translationDraft.saving.value,
    notice: translationDraft.notice.value || translationFileNotice.value,
    changedIndices,
    positionOverrides,
    groupOverrides,
    // 第 2 批：档位 + 这一页的校对记录 + 整话已校条数
    mode: translationPaneMode.value,
    reviews: pageReviews.value,
    pageReviewed: currentCompareSource.value?.psd.modes?.proofread === true,
    reviewCount: translationReviews.value.length,
    // 2026-10-07：本会话在这份 txt 上还有可退的保存（状态条据此放一枚只表示有/无的小标）
    canUndoSaved: translationDraft.canUndoSaved.value,
    // 第 5 批 5d-2：页头那枚「新增框」开关（默认关；页头开关与栏内 Tab 都汇到同一个 ref）
    addFrameMode: translationAddFrameMode.value
  }
})

/**
 * P2：右栏发上来的译文编辑，全部落进**草稿**（还没写盘）。
 *
 * 作用对象是"当前这一页"（`compareTranslation.entry.fileName`）——
 * 改的是哪一张图由这里决定，组件层不认识"这是第几页"。
 *
 * 第 2 批：**校对档下的这次改动还要留一条记录** —— 原文（覆盖之后 txt 里就不存在了）
 * 与"改成了什么"都进 App 数据库；理由由行首那枚铅笔单独写。
 */
async function onTranslationEditText(index: number, text: string, done?: (saved: boolean) => void): Promise<void> {
  let saved = false
  try {
    const entry = compareTranslation.value?.entry
    if (!entry) return
    // Capture the original chapter, file, page, mode and prior review before text IPC.
    const originalText = String(entry.labels.find((item) => item.index === index)?.text ?? '')
    const reviewing = translationPaneMode.value === 'review'
    const reviewTarget = reviewing
      ? captureTranslationReviewTarget(entry.fileName, index, originalText)
      : null
    translationDraft.setText(entry.fileName, index, text)
    const hadChanges = translationDraft.dirty.value
    const result = await translationDraft.commit(async (result) => {
      // Keep text + review in the same write queue so deletion cannot reindex between them.
      if (reviewTarget && result.ok && result.changed) await writeTranslationReview(reviewTarget, text)
    })
    saved = result?.ok ?? !hadChanges
  } finally { done?.(saved) }
}

interface TranslationReviewTarget {
  readonly folderPath: string
  readonly filePath: string
  readonly imageName: string
  readonly labelIndex: number
  readonly page: number
  readonly originalText: string
  readonly reason: string
}

/** Snapshot scalar values, never a mutable record from the next chapter's loaded list. */
function captureTranslationReviewTarget(
  imageName: string,
  labelIndex: number,
  originalText: string
): TranslationReviewTarget | null {
  const folderPath = child.value?.folderPath ?? null
  const filePath = chapterTranslation.value?.file?.path ?? null
  if (!folderPath || !filePath) return null
  const existing = translationReviews.value.find(
    (record) =>
      normalizeReviewFolder(record.folderPath) === normalizeReviewFolder(folderPath) &&
      normalizeReviewImage(record.imageName) === normalizeReviewImage(imageName) &&
      record.labelIndex === labelIndex
  )
  return {
    folderPath,
    filePath,
    imageName,
    labelIndex,
    page: currentPageNumber.value,
    originalText: existing?.originalText ?? originalText,
    reason: existing?.reason ?? ''
  }
}

function translationReviewTargetIsCurrent(target: TranslationReviewTarget): boolean {
  return child.value?.folderPath === target.folderPath &&
    chapterTranslation.value?.file?.path === target.filePath
}

/** Persist to the captured chapter even after navigation; only refresh its visible state. */
async function writeTranslationReview(
  target: TranslationReviewTarget,
  reviewedText: string,
  reasonOverride?: string
): Promise<void> {
  const result = await saveTranslationReview({
    folderPath: target.folderPath,
    imageName: target.imageName,
    labelIndex: target.labelIndex,
    page: target.page,
    originalText: target.originalText,
    reviewedText,
    reason: reasonOverride ?? target.reason,
    at: Date.now()
  })
  if (!translationReviewTargetIsCurrent(target)) return
  if (!result.ok) {
    translationFileNotice.value = result.message
    return
  }
  translationFileNotice.value = ''
  await reloadTranslationReviews()
}

/** 校对理由只进数据库，不改 txt；原文与目标沿用该条已有记录。 */
async function onTranslationEditReason(index: number, reason: string): Promise<void> {
  const record = reviewRecordFor(index)
  if (!record) return
  const target = captureTranslationReviewTarget(record.imageName, index, record.originalText)
  if (!target) return
  await writeTranslationReview(target, record.reviewedText, reason)
}

/**
 * 导出文件头里的"话"：优先集数（与界面上显示同一口径）；
 * 没设集数就用**话目录名**兜底 —— 别拿"未设置集数"当话名发给别人。
 * ⚠️ 这里**不能**过 `normalizeReviewFolder`（那一格是给键用的，会把路径转小写）。
 */
const translationExportChapterTitle = computed<string>(() => {
  const item = child.value
  if (!item) return ''
  if (normalizeChapterNumber(item.chapterNumber)) return formatChapterNumber(item.chapterNumber)
  const parts = String(item.folderPath ?? '')
    .replace(/\\/g, '/')
    .split('/')
  return parts.filter(Boolean).pop() ?? ''
})

/**
 * 第 2 批：导出**当前话**的校对记录（弹「另存为」，只写用户选的位置）。
 *
 * 「校」那一行取**现在 txt 里的值**：记录里那份是"当时写进去的"，之后可能又被改过，
 * 而这份文件是给人**照着找缺漏**的，当然要跟盘上现在一致。
 * 对不上当前文档的记录（图名被改过之类）**回落到记录里那份** ——
 * 宁可给出"当时的事实"，也不静默丢掉一条。
 */
async function onTranslationExportReviews(): Promise<void> {
  const folderPath = child.value?.folderPath ?? null
  if (!folderPath) return
  const folder = normalizeReviewFolder(folderPath)
  const document = chapterTranslation.value?.document ?? null
  const entries: TranslationReviewExportEntry[] = translationReviews.value
    .filter((record) => normalizeReviewFolder(record.folderPath) === folder)
    .map((record) => {
      const image = document?.images.find(
        (item) => normalizeReviewImage(item.fileName) === normalizeReviewImage(record.imageName)
      )
      const current = image?.labels.find((label) => label.index === record.labelIndex)
      return {
        page: record.page,
        imageName: record.imageName,
        originalText: record.originalText,
        reviewedText: current ? String(current.text ?? '').trim() : record.reviewedText,
        reason: record.reason
      }
    })
  const workTitle = currentParent.value?.title ?? ''
  const text = buildTranslationReviewExport({
    workTitle,
    chapterTitle: translationExportChapterTitle.value,
    exportedAt: Date.now(),
    entries
  })
  const result = await exportTranslationReview({
    text,
    defaultFileName: translationReviewExportFileName(workTitle, translationExportChapterTitle.value)
  })
  // 用户取消**不算失败**（`saved: false` 且没有 error）⇒ 一个字都不说。
  if (!result.saved && result.error) translationFileNotice.value = result.error
}

/**
 * 找这一页里某一条的那条校对记录（没有就是 `null`）。
 *
 * 口径与 `pageReviews` 一致：话目录 + 图名（不分大小写）+ 条目序号。
 */
function reviewRecordFor(index: number): TranslationReviewRecord | null {
  const entry = currentTranslationEntry.value
  const folderPath = child.value?.folderPath ?? null
  if (!entry || !folderPath) return null
  const folder = normalizeReviewFolder(folderPath)
  const imageKey = normalizeReviewImage(entry.fileName)
  return (
    translationReviews.value.find(
      (record) =>
        normalizeReviewFolder(record.folderPath) === folder &&
        normalizeReviewImage(record.imageName) === imageKey &&
        record.labelIndex === index
    ) ?? null
  )
}

/**
 * 第 4 批：**撤销校对** —— 把记录里的原文写回 txt，**成功之后**才删记录。
 *
 * 顺序是这条功能的**全部安全性**所在：
 * · 先写盘（走「保存」那条链路：指纹比对 / 写前备份 / 原子写 / 写后回读）；
 * · 写盘没成功 ⇒ **记录一个字节都不动**（原文还在库里，用户还能再试）；
 * · 写盘成功 ⇒ 删掉记录（含理由）⇒「已校：N」减 1，右栏显示回原文。
 *
 * 另外：这一条若在草稿里还有没落盘的改动，**先把它丢掉** ——
 * 否则下一次自动保存会把用户刚撤销掉的那句又写回去（那是"撤销了自己回来"的鬼故事）。
 */
const creditsSaving = ref(false)
let preparedCredits: { childId: string; result: Awaited<ReturnType<typeof readChapterTranslation>> } | null = null
async function prepareTranslationCredits(): Promise<TranslationCredits> {
  const currentChild = child.value
  const currentMode = activeMode.value
  if (!currentChild) throw new Error('请先打开章节')
  preparedCredits = null
  const result = translationEnabled.value ? chapterTranslation.value : await readChapterTranslation(currentChild.folderPath)
  if (child.value?.id !== currentChild.id || activeMode.value !== currentMode) throw new Error('章节已切换，请重新打开署名')
  if (!result || result.status === 'error') throw new Error(result?.message || '无法读取当前署名')
  preparedCredits = { childId: currentChild.id, result }
  const credits = result.document?.credits ?? { translator: '', proofreader: '', combined: false }
  const fromFileEachTime = currentMode === 'typeset' || currentMode === 'supervised'
  if (credits.initialized && !fromFileEachTime) return { ...credits }
  const [name, last, recentIds] = await Promise.all([window.comicType.storeGet('ui.userId'), window.comicType.storeGet('ui.lastTranslationCredits'), fromFileEachTime ? window.comicType.storeGet('recentProjectIds') : Promise.resolve(null)])
  let previous: Partial<TranslationCredits> = !fromFileEachTime && last && typeof last === 'object' ? last as TranslationCredits : {}
  const siblings = [...(currentParent.value?.children ?? [])].sort((a,b) => compareChapterNumbersByOrder(a.chapterNumber,b.chapterNumber,'ascending'))
  const index = siblings.findIndex(c => c.id === currentChild.id)
  const chapters = workspace.parents.flatMap(parent => parent.children)
  const recentChapter = fromFileEachTime && Array.isArray(recentIds)
    ? recentIds.filter(id => typeof id === 'string' && id !== currentChild.id).map(id => chapters.find(chapter => chapter.id === id)).find(Boolean)
    : undefined
  const inheritFrom = recentChapter ?? (index > 0 ? siblings[index - 1] : undefined)
  if (inheritFrom) {
    const prior = await readChapterTranslation(inheritFrom.folderPath)
    if (prior.status === 'ok' && prior.document?.credits) previous = prior.document.credits
  }
  if (child.value?.id !== currentChild.id || activeMode.value !== currentMode) throw new Error('章节已切换，请重新打开署名')
  return initialTranslationCredits(credits, previous, currentMode, typeof name === 'string' && name.trim() ? name : '朋友')
}
async function onTranslationCredits(credits: TranslationCredits, done: (error?: string) => void): Promise<void> {
  const target = child.value
  const prepared = preparedCredits && preparedCredits.childId === target?.id ? preparedCredits.result : null
  const file = prepared?.status === 'ok' ? prepared.file : null
  if (!prepared || !target || creditsSaving.value || chapterTranslationLoading.value || translationDraft.saving.value || translationDraft.dirty.value || chapterTranslation.value?.status === 'error') {
    done('请先保存译文改动，等待文件读取完成。'); return
  }
  creditsSaving.value = true
  try {
    const result = file
      ? await saveChapterTranslation({ filePath: file.path, base: { size: file.size, mtimeMs: file.mtimeMs, sha256: file.sha256 }, edits: [], credits })
      : await createChapterTranslation({ folderPath: target.folderPath, pages: pageFileNames(), credits })
    if (!result.ok) { done(result.message); return }
    if (child.value?.id === target.id) {
      if ('changed' in result && result.changed) translationDraft.noteSavedWrite()
      await reloadChapterTranslation()
    }
    await window.comicType.storeSet('ui.lastTranslationCredits', { ...credits })
    done()
  } catch (error) { done(error instanceof Error ? error.message : '署名保存失败') }
  finally { creditsSaving.value = false }
}
async function onTranslationUnreview(index: number): Promise<void> {
  const entry = currentTranslationEntry.value
  const file = chapterTranslation.value?.status === 'ok' ? chapterTranslation.value.file : null
  const record = reviewRecordFor(index)
  if (!entry || !file || !record) return

  translationDraft.discardEntry(entry.fileName, index)
  const result = await saveChapterTranslation({
    filePath: file.path,
    base: { size: file.size, mtimeMs: file.mtimeMs, sha256: file.sha256 },
    edits: [{ imageName: entry.fileName, labelIndex: index, text: record.originalText }]
  })
  if (!result.ok) {
    // 冲突**不复用草稿那个弹窗**：那个弹窗的两条路是"重读草稿 / 强推草稿"，
    // 而这里根本没有草稿 —— 复用它会把用户引到一个什么都不做的按钮上。
    translationFileNotice.value =
      result.kind === 'conflict'
        ? '这一话的 txt 在你读进来之后被改过了，所以没有撤销。重新读一遍（切一下页或档位）再试。'
        : result.message
    return
  }
  const dropped = await dropReviewRecord(record)
  if (!dropped) return
  translationFileNotice.value = ''
  await reloadChapterTranslation()
}

/**
 * 第 4 批：**只删记录**（右键菜单第二项）—— 现在 txt 里的译文原样留着。
 *
 * 与「撤销校对」的分工：那个是"我改错了，退回原样"；这个是"这条我不算校对过"。
 */
async function onTranslationDropReview(index: number): Promise<void> {
  const record = reviewRecordFor(index)
  if (!record) return
  const dropped = await dropReviewRecord(record)
  if (dropped) translationFileNotice.value = ''
}

/** 删一条记录（失败就照实说，成功返回 `true`）。 */
async function dropReviewRecord(record: TranslationReviewRecord): Promise<boolean> {
  const result = await deleteTranslationReview({
    folderPath: record.folderPath,
    imageName: record.imageName,
    labelIndex: record.labelIndex
  })
  if (!result.ok) {
    translationFileNotice.value = result.message
    return false
  }
  await reloadTranslationReviews()
  return true
}

/**
 * 从零生成那份空底稿时按页序用的图名。
 *
 * 口径与「这一页是哪个文件」（`currentPageImageName`）**同一条**：
 * 有原图用原图，只有 PSD 的那种页就用 PSD 名。
 */
function pageFileNames(): string[] {
  return pairs.value.map((pair) => basenameOf(pair.jpgPath ?? pair.psd.absPath))
}

/**
 * 第 3 批：把**当前翻译另存一份**到用户选的位置（**不动**话目录里那份）。
 *
 * 三个要点：
 * 1. **带上草稿里还没落盘的改动** —— 另存出来的应当是"界面上现在这份"；
 *    少了自己刚改的那几条，是**最难发现**的一种错（对着文件看半天才发现）。
 * 2. 这一话**没有可解析的 txt** 时传 `sourcePath: null` ⇒ 主进程**从零生成**一份空底稿。
 * 3. 失败才出声；**用户取消一个字都不说**（`message` 是空串）。
 */
async function onTranslationSaveAs(): Promise<void> {
  // ⚠️ **还在读这一话的译文时不许另存**：`null` 表示"有没有 txt、是哪一份"这个问题
  // 还没有答案，而另存的两条路（复制原件 / 从零生成空底稿）**完全由它决定**。
  // 赌错了的后果不是"报个错"，而是把一份**空底稿**当成"当前翻译"存出去，
  // 用户还以为自己拿到的是译文 —— 这类"内容错了、流程全绿"最难发现。
  if (chapterTranslation.value === null) {
    translationFileNotice.value = '还在读这一话的译文，读完再另存。'
    return
  }
  const file = chapterTranslation.value.status === 'ok' ? chapterTranslation.value.file : null
  const folderPath = child.value?.folderPath ?? ''
  // 默认名沿用那份 txt 的名字（`译文.txt` → `译文-另存-20261006-2130.txt`）；
  // 没有 txt 就用话目录名（从零生成的那份，名字得能看出是哪一话）。
  const stem = file ? basenameOf(file.name).replace(/\.[^.]+$/, '') : lastPathSegment(folderPath)
  const result = await exportChapterTranslation({
    sourcePath: file?.path ?? null,
    edits: toPlainEdits(translationDraft.edits.value.values()),
    defaultFileName: chapterTranslationExportFileName(stem, Date.now()),
    defaultDirectory: folderPath,
    pages: pageFileNames()
  })
  if (result.ok) {
    translationFileNotice.value = ''
    return
  }
  // **用户取消不算失败**（`kind: 'canceled'`，message 是空串）：
  // 不但不该报错，还要把上一次那句话说清楚的状态**收掉** —— 否则那条旧消息留在状态条上，
  // 看着就像"刚才这次取消出错了"。
  if (result.kind === 'canceled') {
    translationFileNotice.value = ''
    return
  }
  translationFileNotice.value = result.message
}

/**
 * 删除与草稿保存共用同一话的串行写队列。
 * 只有写盘成功后，原会话的草稿和撤销快照才会丢弃该条并重排后续序号。
 * 导航期间的完成通知不得改变新话的状态。
 */
async function onTranslationDeleteEntry(index: number): Promise<void> {
  if (chapterTranslation.value === null) {
    translationFileNotice.value = '还在读这一话的译文，读完再删。'
    return
  }
  const entry = compareTranslation.value?.entry ?? null
  if (!entry) {
    translationFileNotice.value = '这一页还没对上 txt 里的记录，删不了。'
    return
  }
  const file = chapterTranslation.value.status === 'ok' ? chapterTranslation.value.file : null
  if (!file) {
    translationFileNotice.value =
      chapterTranslation.value.message || '这一话没有能改的 txt，删不了。'
    return
  }
  const folderPath = child.value?.folderPath ?? null
  const result = await translationDraft.deleteEntry(entry.fileName, index)
  if (
    child.value?.folderPath !== folderPath ||
    chapterTranslation.value?.file?.path !== file.path
  ) return
  if (!result?.ok) {
    if (result) translationFileNotice.value = result.message
    return
  }
  clearJustAdded()
  translationFileNotice.value = `已删除第 ${result.deletedIndex} 条 · Ctrl+Z 可撤销`
}

/**
 * 第 5 批 5d-2：原图上**新增一个条目**（左键 = 框内 / 右键 = 框外）。
 *
 * ## 那一刀切在**这里**（用户拍板）
 *
 * **有 txt ⇒ 走插入；没有 ⇒ 从零新建** —— 组件层不判这件事（它连"有没有 txt"都不该知道）。
 * 还有一档要**拒绝并说人话**：译文还没读完（`result` 还是 `null`，既没确认有、也没确认没有）
 * ⇒ 赌错了不是"报个错"，而是**凭空新建一份 txt** 或**插进不确定的那份**，两条都在改数据。
 *
 * ## 新增之后（用户 Q4）
 *
 * **不进编辑器**（"光 A 就行"）：只在状态条说一句 + 右侧那一行**瞬时高亮** + 滚过去。
 * Ctrl+Z 能撤 —— 因为插入走的是与「保存」同一段安全网（会话栈已经压了一层）。
 */
async function onTranslationAddFrame(groupName: string, x: number, y: number): Promise<void> {
  // 目录读不了 / 还在读 ⇒ 拒绝（**什么都不写**）
  if (chapterTranslation.value === null) {
    translationFileNotice.value = '还在读这一话的译文，读完再新增。'
    return
  }
  const folderPath = child.value?.folderPath ?? ''
  // ⚠️ **"目录读不了"排在最前面**：它是更根本的那条事实 —— 这一页在 txt 里对不上，
  // 恰恰可能就是"读不出来"的后果。把根因说成表象（"这一页对不上"）会让用户白找一圈。
  if (chapterTranslation.value.status === 'error') {
    translationFileNotice.value = chapterTranslation.value.message || '读不了话目录，新增不了。'
    return
  }
  const imageName = currentPageImageName()
  if (!imageName) {
    translationFileNotice.value = '这一页还没对上 txt 里的记录，新增不了。'
    return
  }
  // ⚠️ 图名用哪一份（这一条是"从零新建"那半边的命门）：
  // · **有 txt** ⇒ 用 txt 里记的那个名字（`entry.fileName`）—— 它与文件里
  //   `>>>>>>>>[名字]<<<<<<<<` 那一行必须**字面一致**，而磁盘上的扩展名可能已经被改过
  //   （txt 写 `20.jpg`、盘上是 `20.png` 是真实存在的一种情况，见 `findTranslationEntryForPage`）；
  // · **一份 txt 都没有** ⇒ 根本不存在"记录里的名字"，只能用当前这一页的**文件名**
  //   （裸名，不带目录）—— 新建出来的那份就是拿它当图片块的标题。
  const entry = compareTranslation.value?.entry ?? null
  if (chapterTranslation.value.status === 'ok' && !entry) {
    translationFileNotice.value = '这一页还没对上 txt 里的记录，新增不了。'
    return
  }
  const insertImageName = entry?.fileName ?? basenameOf(imageName)

  const insert = { imageName: insertImageName, groupName, position: { x, y } }
  const status = chapterTranslation.value.status
  let insertedIndex: number | null = null
  /**
   * 从零新建时，**真正写出去的那个路径**（主进程返回的）。
   *
   * ⚠️ 必须在"读回来之前"就拿到：新建之前界面手上没有路径（`chapterTranslation.file` 是 `null`），
   * 而"这一次写盘算一层可退历史"要记在这一份上 —— 记在空键上的话，
   * 状态条会写着「Ctrl+Z 可撤销」而按下去没反应（真机 bug 的同一个症状）。
   */
  let createdTargetPath: string | null = null

  if (status === 'ok' && chapterTranslation.value.file) {
    // ① 有 txt ⇒ 插入（安全网与「保存」同一段 ⇒ Ctrl+Z 能撤这一步）
    const file = chapterTranslation.value.file
    const result = await insertChapterTranslation({
      filePath: file.path,
      base: { size: file.size, mtimeMs: file.mtimeMs, sha256: file.sha256 },
      insert
    })
    if (!result.ok) {
      translationFileNotice.value = result.message
      return
    }
    insertedIndex = result.insertedIndex
  } else if (status === 'not-found') {
    // ② 一份能解析的 txt 都没有 ⇒ 在话目录里从零新建（同名 `-2`…，**绝不覆盖**）
    const result = await createChapterTranslation({ folderPath, pages: pageFileNames(), insert })
    if (!result.ok) {
      translationFileNotice.value = result.message
      return
    }
    insertedIndex = result.insertedIndex
    createdTargetPath = result.path
  } else {
    // ③ `error`：上面已经拦掉了（这里只是把"不可能到"写明白，绝不新建一份盖过去）
    translationFileNotice.value = chapterTranslation.value.message || '读不了话目录，新增不了。'
    return
  }

  // ⚠️ **新增这一次写盘也要记进"可退层数"的镜像**（2026-10-07 真机 bug）：
  // 这两条写盘路（插入 / 从零新建）**绕过**了草稿的 `save()`，而镜像原来只在 `save()` 里 +1
  // ⇒ 状态条写着「Ctrl+Z 可撤销」、按下去却什么都不发生（主进程那边那一层是真的有的）。
  // 放在这里（插入/新建都成功之后、重读之前）是因为：**只有真写进盘了才算一层历史**。
  // 写盘之后把"待落地的新路径"一起交给草稿：这一趟之后 `input.filePath()` 才会变成它
  const createdPath = status === 'not-found' ? createdTargetPath : null
  translationDraft.noteSavedWrite(createdPath)

  // 新增写盘成功 ⇒ 重读：盘上内容变了，下一句保存要拿新指纹（与"回退"那条同一条理由）
  await reloadChapterTranslation()
  // 从零新建那一趟：写出文件之前界面手上没有路径，那一层历史记在空键上 ⇒ 重读之后搬过来
  if (createdPath)
    translationDraft.migrateSavedUndo(null, chapterTranslation.value?.file?.path ?? null)
  const nextEntry = findTranslationEntryForPage(
    chapterTranslation.value?.document ?? null,
    imageName
  )
  const label = findTranslationLabelByPosition(
    nextEntry,
    snappedChapterTranslationPosition({ x, y }),
    insertedIndex
  )
  // 滚过去 + 瞬时高亮（**认不出是哪一条就只出一句，不点亮错的那一行**）
  compareViewerRef.value?.scrollTranslationRowIntoView(label?.index ?? null)
  flashJustAdded(label?.index ?? null)
  translationFileNotice.value = `已新增 ${groupName}第 ${insertedIndex ?? '?'} 条 · Ctrl+Z 可撤销`
}

/**
 * 收掉"新增框"留下的那句状态提示（只收**自己写的那一句**，别把别人的消息一起抹掉）。
 *
 * 什么时候调：`Ctrl+Z` 真把这一层退掉了 —— 那一刻"Ctrl+Z 可撤销"已经不成立。
 */
function clearAddFrameNotice(): void {
  if (translationFileNotice.value.includes('可撤销')) translationFileNotice.value = ''
}

/**
 * 对照视图的句柄 —— 只用到"把右栏某一行滚进视野"。
 *
 * ⚠️ 不新写第二个滚动：`CompareViewer` 把这件事转发给 `TranslationPane` 里**那一个**
 * `scrollRowIntoView`（见它的 `defineExpose`）。
 */
const compareViewerRef = ref<InstanceType<typeof CompareViewer> | null>(null)
const viewerFullscreen = ref(false)

function onTranslationEditGroup(index: number, groupName: string): void {
  const entry = compareTranslation.value?.entry
  if (!entry) return
  translationDraft.setGroup(entry.fileName, index, groupName)
  void translationDraft.commit()
}

/**
 * P2-c：拖完锚点 → 记进草稿，**并立刻落盘**（松手也算"编辑动作结束"）。
 * 归一化坐标由组件层算好（那里才有原图尺寸与缩放），这里只负责"落到哪一条"。
 */
function onTranslationMoveAnchor(index: number, x: number, y: number): void {
  const entry = compareTranslation.value?.entry
  if (!entry) return
  translationDraft.setPosition(entry.fileName, index, x, y)
  void translationDraft.commit()
}

/** 冲突弹窗要读的状态（包成 computed，模板里才能自动解包）。 */
const translationConflict = computed(() => translationDraft.conflict.value)

/** 盘上那份"什么时候、多大" —— 给人判断"是不是刚被 PS 那边存过"。 */
const translationConflictLabel = computed<string>(() => {
  const current = translationDraft.conflict.value?.current
  if (!current) return ''
  const when = new Date(current.mtimeMs).toLocaleString()
  return `盘上那份：${current.size} 字节 · 最后修改 ${when}`
})

/** 关掉冲突弹窗 = 什么都不做（**草稿原样留着**，用户想清楚了再点保存）。 */
function dismissTranslationConflict(): void {
  translationDraft.conflict.value = null
}

/**
 * 页头那枚「校对 0/18」胶囊**已删**（2026-10-06，用户拍板；连同四模式各自那枚）。
 *
 * 为什么删得掉：它与底部进度条**读的是同一个 computed**（`activeModeProgress`），
 * 删页头**没有任何信息损失** —— 底部那条还在。空出来的位置换成了对照视图
 * 原图分屏右上角的**页码 `2/18 ▾`**（四种模式都看得见，点一下还能跳页）。
 */

const {
  scanning,
  txtSummary,
  thumbListKey,
  chapterMissing,
  scanActiveChild,
  refreshActiveChild,
  refreshCurrentProject,
  cancelScan,
  startAutoRefresh,
  stopAutoRefresh
} = useProjectScan({
  pairs,
  selectedPairs,
  childId,
  currentParent
})

watch(() => [currentParent.value?.id, route.query.workMode, settings.settingsLoaded], () => {
  const parent = currentParent.value
  const requestedMode = route.query.workMode as WorkMode
  if (parent && settings.settingsLoaded) {
    const mode = settings.enabledWorkModes.includes(requestedMode) ? requestedMode : settings.modeForProject(parent, dutyMap.value[parent.id])
    void settings.setProjectWorkMode(parent.id, mode)
  }
}, { immediate: true })

// --- 标记台账：撤销 / 记录（第十四轮）-----------------------------------------
const undoableMark = ref<MarkAuditOperation | null>(null)
const undoingMark = ref(false)
const markHistoryVisible = ref(false)

/** 最近一次可撤销的标记（没有就 null）→ 决定「撤销标记」亮不亮、tooltip 说什么。 */
async function refreshUndoableMark(): Promise<void> {
  undoableMark.value = await workspace.findUndoableMark()
}

onMounted(() => window.addEventListener('statistics-time-changed', refreshUndoableMark))
onBeforeUnmount(() => window.removeEventListener('statistics-time-changed', refreshUndoableMark))

const undoTooltip = computed(() => {
  const target = undoableMark.value
  if (!target) return '没有可撤销的标记操作'
  const when = new Date(target.at).toLocaleTimeString('zh-CN', { hour12: false })
  return `撤销：${summarizeMarkOperation(target)}（${when}）· Ctrl+Z`
})

async function onUndoMark(): Promise<void> {
  const target = undoableMark.value
  if (!target || undoingMark.value) return
  undoingMark.value = true
  try {
    const result = await workspace.undoMarkOperation(target.opId)
    if (!result) {
      toast.addToast({ type: 'error', message: '撤销失败：主进程没有响应' })
      return
    }
    if (result.childIds.includes(childId.value)) await scanActiveChild()
    toast.addToast({
      type: result.revertedFiles > 0 ? 'success' : 'warning',
      message:
        result.revertedFiles > 0
          ? `已撤销：还原 ${result.revertedFiles} 个文件的记录`
          : '这次操作没有需要还原的改动'
    })
  } catch (reason) {
    toast.addToast({
      type: 'error',
      message: `撤销失败：${reason instanceof Error ? reason.message : String(reason)}`
    })
  } finally {
    undoingMark.value = false
    await refreshUndoableMark()
  }
}

/** 台账里点了「还原到这一步之前」之后：受影响的话要重扫，撤销按钮也要重新判断。 */
async function onToolbarMark(status: 'done' | 'pending'): Promise<void> {
  if (status === 'done') await markSelectedDone()
  else await markSelectedPending()
  await refreshUndoableMark()
}

async function onCardMark(pair: JpgPsdPair): Promise<void> {
  await onMark(pair)
  await refreshUndoableMark()
}

async function onMarkHistoryChanged(childIds: string[]): Promise<void> {
  if (childIds.includes(childId.value)) await scanActiveChild()
  await refreshUndoableMark()
}

/**
 * Ctrl+Z = 撤销最近一次标记。
 *
 * 输入框里按 Ctrl+Z 归输入框自己管，所以先看焦点在哪 —— 抢走用户在输入框里的撤销最讨嫌。
 */
function onUndoHotkey(event: KeyboardEvent): void {
  if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'z') return
  // 判据抽到 utils/keyboard-target（对照视图那条方向键翻页共用同一处，别各写一份）
  if (isTextEntryTarget(event.target)) return

  // P2（用户拍板）：**有未保存的译文改动时，Ctrl+Z 归译文**（拖锚点也算一条改动）。
  // 这样这个键在两种情况下都是"撤销"，**永远不会跨到第三种东西上** ——
  // 否则"刚改完译文顺手按 Ctrl+Z"会去撤掉一个**标记**，动的是另一条数据。
  if (translationDraft.undo()) {
    event.preventDefault()
    // 撤销也是一次"编辑动作结束" ⇒ 立刻落盘；
    // 否则会留下"没人在编辑、草稿却是脏的"那种悬浮状态（与"失焦即存"的口径一致）
    void translationDraft.commit()
    return
  }

  /**
   * 2026-10-07：**没草稿、但本会话在这份 txt 上保存过 ⇒ 每按一次退一步**
   * （退到本会话开始为止；见 `useChapterTranslationDraft` 的 `canUndoSaved` / `undoSaved`）。
   *
   * 位置就在"撤草稿"那一支**后面**：有草稿时这个键照旧归草稿，不被抢。
   * 退到空（`canUndoSaved` 为 false）⇒ 落到下面的原有行为，**不是静默吞键**。
   */
  if (translationDraft.canUndoSaved.value) {
    event.preventDefault()
    // 退完之后状态条那句「…Ctrl+Z 可撤销」就过时了 ⇒ 顺手收掉（它说的是"还能撤"）
    void translationDraft.undoSaved().then(() => {
      if (!translationDraft.canUndoSaved.value) clearAddFrameNotice()
    })
    return
  }

  // ⚠️ **"撤销标记"只在缩略图视图里管用**（用户 2026-10-07 拍板）：
  // 对照视图 / 图片预览（那层覆盖窗）里，Ctrl+Z **只**跟译文有关 ——
  // 在那儿按下它的人想撤的是"我刚改的那句译文"，把一次**标记**撤掉动的是另一条数据。
  // 代价如实说：在对照视图里用「标记X」标的那些，Ctrl+Z 不再能撤（回缩略图视图撤）。
  if (compareVisible.value) return

  if (!undoableMark.value) return
  event.preventDefault()
  void onUndoMark()
}

/**
 * Ctrl+S = 把译文改动立刻写盘（用户 2026-10-06 点名要的）。
 *
 * 平时**失焦就会自动存**（口径 B），所以它主要是"手动的兜底那一下"：
 * 还没失焦（光标还在文本框里）但想立刻存 —— 按它就对了。
 * 输入框里也认这个键（与 Ctrl+Z 不同：那是"输入框自己的撤销"，抢走最讨嫌；而"保存"没有归属之争）。
 */
function onSaveHotkey(event: KeyboardEvent): void {
  if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 's') return
  if (!translationDraft.dirty.value) return
  event.preventDefault()
  void translationDraft.commit()
}

// ProjectFormModal state
const modalVisible = ref(false)
const modalMode = ref<'add' | 'manage'>('add')
const modalData = ref<
  | {
      parentTitle: string
      chapterNumber: string
      projectTitle: string
      folderPath: string
    }
  | undefined
>(undefined)
const managedChildId = ref<string | null>(null)

const {
  selfCheckVisible,
  selfCheckSourceRoot,
  selfCheckPreview,
  selfCheckBusy,
  selfCheckNeverAsk,
  selfCheckConflictActions,
  selfCheckRunning,
  closeSelfCheck,
  setSelfCheckConflictAction,
  runSelfCheckWithSource,
  pickSelfCheckDirectory,
  startSelfCheck,
  confirmSelfCheckImport,
  reclaimCandidate,
  selfCheckRenameHints,
  detectSelfCheckRenames
} = useProjectSelfCheck({
  refreshAfterSelfCheck: async () => {
    await refreshAfterSelfCheck()
  }
})

/**
 * 「修改扫描目录」（2026-10-05，需求二）。
 *
 * 传进去的是 `projects` 取函数而不是快照：弹窗开着的时候树可能被别处改（另一次导入 /
 * 删除），冲突判定必须看**当下**的树，不能拿打开那一刻的旧副本。
 */
const {
  visible: sourceRootVisible,
  busy: sourceRootBusy,
  parentTitle: sourceRootParentTitle,
  mode: sourceRootMode,
  directory: sourceRootDirectory,
  layers: sourceRootLayers,
  layerError: sourceRootLayerError,
  selectedLayerPaths: sourceRootSelectedLayerPaths,
  acknowledged: sourceRootAcknowledged,
  currentRoots: sourceRootCurrentRoots,
  currentIsRemembered: sourceRootCurrentIsRemembered,
  currentCandidateCount: sourceRootCurrentCandidateCount,
  currentMessage: sourceRootCurrentMessage,
  conflicts: sourceRootConflicts,
  canSave: sourceRootCanSave,
  plan: sourceRootPlan,
  open: openSourceRootEditor,
  close: closeSourceRootEditor,
  pickDirectory: pickSourceRootDirectory,
  setDirectory: setSourceRootDirectory,
  loadLayers: loadSourceRootLayers,
  toggleLayer: toggleSourceRootLayer,
  resetToAuto: resetSourceRootToAuto,
  save: saveSourceRoot
} = useSourceRootEditor({
  projects: () => workspace.parents,
  refreshAfterSave: refreshAfterSelfCheck
})

/**
 * "我知道"这个开关的写入走一个显式函数，而不是模板里写赋值表达式 ——
 * `<script setup>` 里的 ref 在模板中直接赋值要靠编译器的自动解包，容易看错；
 * 显式函数一眼能看出改的是哪一份状态（这个仓库对"看不清的隐式行为"一向谨慎）。
 */
function onSourceRootAcknowledged(value: boolean): void {
  sourceRootAcknowledged.value = value
}

// Sync the workspace store's active child with the route param. On mount
// and whenever the childId route param changes, resolve the child via the
// store and either setActiveChild (with empty stats — scanning fills them
// via scanActiveChild) or clearActiveChild when the child is not found.
function syncActiveChild(): void {
  const found = workspace.findChild(childId.value)
  if (found) {
    workspace.setActiveChild(found, found.psdStats ?? [])
    void rememberRecentProject(found.id)
  } else {
    workspace.clearActiveChild()
    selectedPairs.value = []
    txtSummary.value = ''
  }
}

async function rememberRecentProject(id: string): Promise<void> {
  try {
    const raw = await readRecentProjectIds()
    const previous = Array.isArray(raw)
      ? raw.filter((value): value is string => typeof value === 'string')
      : []
    await writeRecentProjectIds([id, ...previous.filter((value) => value !== id)].slice(0, 3))
  } catch {
    // Recent-project history is a convenience and must not block the workbench.
  }
}

let projectDisposed = false
/**
 * 第 5 批「新增框」：**离开就关**（用户拍板，不做"3 秒无操作自动退出"——
 * 用户盯着图研究时并不"操作"，会在"刚想加下一条"时被踢出模式）。
 *
 * 四条路：切页（当前这张图变了）、换话（目录变了）、切档位、切工序、关预览。
 * ⚠️ 写在 `onMounted` **之前**是因为这几样东西到这儿都已经定义好了；
 * 而它必须**早于**这里的水合动作，否则"刚挂载就被算成离开"。
 */
watch(currentPageImageName, () => leaveAddFrameMode())
watch(
  () => [child.value?.folderPath ?? '', translationPaneMode.value, activeMode.value].join('\u0000'),
  () => leaveAddFrameMode()
)
watch(compareVisible, (visible) => {
  if (!visible) leaveAddFrameMode()
})

onMounted(async () => {
  if (workspace.parents.length === 0) {
    treeLoading.value = true
    try {
      await workspace.loadParents()
    } finally {
      treeLoading.value = false
    }
  }
  if (projectDisposed) return
  syncActiveChild()
  await scanActiveChild()
  await refreshUndoableMark()
  if (projectDisposed) return
  window.addEventListener('focus', refreshActiveChild)
  document.addEventListener('visibilitychange', refreshActiveChild)
  window.addEventListener('keydown', onUndoHotkey)
  window.addEventListener('keydown', onSaveHotkey)
  // 工作台可见时的轻轮询（2026-10-05）：配合主进程目录监听，PS 存盘后界面自己更新。
  startAutoRefresh()
})

onBeforeUnmount(() => {
  projectDisposed = true
  cancelScan()
  stopAutoRefresh()
  stopPlayback()
  clearJustAdded()
  window.removeEventListener('keydown', onUndoHotkey)
  window.removeEventListener('keydown', onSaveHotkey)
  window.removeEventListener('focus', refreshActiveChild)
  document.removeEventListener('visibilitychange', refreshActiveChild)
})

watch(
  () => route.params.childId,
  () => {
    closeCompare()
    syncActiveChild()
    void scanActiveChild()
    void refreshUndoableMark()
  }
)

// --- Sidebar handlers ------------------------------------------------------
function onSidebarSelect(_parentId: string, selectedChildId: string): void {
  const found = workspace.findChild(selectedChildId)
  if (found) {
    closeCompare()
    router.push(childWorkbenchPath(found.parentTitle, found.id))
  }
}

async function onBatchMark(childIds: string[], status: 'done' | 'pending', selectedMode?: WorkMode): Promise<void> {
  // The batch buttons mark the mode currently selected in the toolbar — not
  // always typeset. Passing the mode through keeps the button label honest.
  const mode = selectedMode ?? activeMode.value
  const result = await workspace.markChildProjects(childIds, status, mode)
  if (result.cancelled) return
  if (childIds.includes(childId.value)) {
    syncActiveChild()
    await scanActiveChild()
  }
  await refreshUndoableMark()
  const verb = status === 'done' ? '已标记' : '已取消标记'
  // 目录读不到而被跳过的话要如实报出来（2026-09-30 审查 high）——
  // 否则"少标了几话"会被读成"全都标成功了"。
  const skippedNote =
    result.skipped.length > 0
      ? `；另 ${result.skipped.length} 话读不到目录已跳过（${result.skipped.slice(0, 3).join('、')}${
          result.skipped.length > 3 ? '…' : ''
        }）`
      : ''
  toast.addToast({
    type: result.marked > 0 ? (result.skipped.length > 0 ? 'warning' : 'success') : 'warning',
    message:
      result.marked > 0
        ? `已将 ${result.marked} 个文件的「${WORK_MODE_LABELS[mode]}」${verb}${skippedNote}`
        : result.skipped.length > 0
          ? `没有可标记的文件：${result.skipped.length} 话读不到目录（${result.skipped
              .slice(0, 3)
              .join('、')}）`
          : '所选项目中没有可标记文件'
  })
}

function onAdd(): void {
  modalMode.value = 'add'
  modalData.value = undefined
  managedChildId.value = null
  modalVisible.value = true
}

function onManage(selectedChildId: string): void {
  const found = workspace.findChild(selectedChildId)
  if (!found) return
  modalMode.value = 'manage'
  modalData.value = {
    parentTitle: found.parentTitle,
    chapterNumber: found.chapterNumber,
    projectTitle: found.projectTitle,
    folderPath: found.folderPath
  }
  managedChildId.value = found.id
  modalVisible.value = true
}

/**
 * 侧栏「管理」模式里点「扫描目录」：把**父级对象**交给弹窗（它要看"记住过没有"）。
 * 找不到就不开 —— 静默失败比开一个空弹窗好。
 */
function onEditSourceRoot(parentId: string): void {
  const parent = workspace.parents.find((item) => item.id === parentId)
  if (parent) void openSourceRootEditor(parent)
}

async function onSetDuties(parentId: string, duties: WorkMode[]): Promise<void> {
  await workspace.setParentDuties(parentId, duties)
}

async function onRenameParent(parentId: string, title: string): Promise<void> {
  const trimmed = title.trim()
  if (!trimmed) return
  await workspace.renameParent(parentId, trimmed)
  syncActiveChild()
  toast.addToast({ type: 'success', message: '漫画名称已更新' })
}

async function onReorderParent(sourceParentId: string, targetParentId: string): Promise<void> {
  await workspace.reorderParent(sourceParentId, targetParentId)
}

async function onDelete(parentId: string, selectedChildId: string): Promise<void> {
  const destination =
    selectedChildId === childId.value
      ? findChildAfterDeletion(
          workspace.parents,
          childId.value,
          [selectedChildId],
          settings.childSortOrder
        )
      : null
  await workspace.deleteChild(parentId, selectedChildId)
  toast.addToast({ type: 'success', message: '项目已删除' })
  if (selectedChildId === childId.value) {
    pairs.value = []
    compareVisible.value = false
    comparePair.value = null
    await navigateAfterDeletion(destination)
  }
}

async function onBatchDelete(childIdsToDelete: string[]): Promise<void> {
  const activeDeleted = childIdsToDelete.includes(childId.value)
  const destination = activeDeleted
    ? findChildAfterDeletion(
        workspace.parents,
        childId.value,
        childIdsToDelete,
        settings.childSortOrder
      )
    : null
  await workspace.deleteChildren(childIdsToDelete)
  toast.addToast({
    type: 'success',
    message: `已删除 ${childIdsToDelete.length} 个项目记录`
  })
  if (activeDeleted) {
    pairs.value = []
    compareVisible.value = false
    comparePair.value = null
    await navigateAfterDeletion(destination)
  }
}

async function navigateAfterDeletion(destination: ReturnType<typeof findChildAfterDeletion>) {
  if (destination) {
    await router.push(
      '/project/' + encodeURIComponent(destination.parentTitle) + '/' + destination.id
    )
    return
  }
  await router.push('/project')
}

/**
 * 对照视图里的「标记X」—— 作用于**当前显示的这一张**。
 *
 * 不能让工具栏那两个按钮代劳：那个视图里没有缩略图那种"选中"概念，
 * 用方向键翻到第 5 页时工具栏标的仍是最初双击的那一张（静默标错，比标不上更糟）。
 *
 * 另外这里要按路径**重新取一次当前对象**：重扫会造一批新 pair，
 * 而 `comparePair` 可能还指着重扫前的旧对象（那条路上不会自动更新）。
 */
async function markComparePair(status: 'done' | 'pending'): Promise<void> {
  const shown = comparePair.value
  if (!shown) return
  // Navigation uses image identities in translation modes; keep existing mark records on their original pair.
  const current = pairs.value.find((pair) => pair.psd.absPath === shown.psd.absPath ||
    (shown.jpgPath && pair.jpgPath === shown.jpgPath)) ?? shown
  await markTargetsForActiveMode([current], status, 'viewer')
  await refreshUndoableMark()
  // C3：开了「标记后下一张」就顺手翻页 —— 到头**停下**（不回卷），跟自动播放一个语义。
  if (settings.advanceAfterMark) advanceToNextPair()
}

/**
 * The compare viewer's 去X button.
 *
 * Normal (two-pane) mode only ever shows entries that have a PSD, so the click
 * opens the PSD (嵌字/监修) or launches the external translation editor
 * (翻译/校对) — the same routing the thumbnail cards use.
 *
 * `previewOnly` entries (a chapter whose folder holds images only) have no PSD
 * at all, so they must follow the *card* routing instead: 嵌字 runs the 译文导入
 * script (or asks about opening Photoshop), 翻译/校对 launch LabelPlusFX.
 */
async function openPsd(psdPath: string): Promise<void> {
  const outcome = await performCardAction({
    mode: activeMode.value,
    hasPsd: comparePair.value?.previewOnly !== true,
    openPath: psdPath
  })
  if (outcome.toast) toast.addToast(outcome.toast)
}

async function openSelectedPair(): Promise<void> {
  const pair = selectedPairs.value[0]
  if (!pair || selectedPairs.value.length !== 1) return
  const outcome = await performCardAction({ mode: activeMode.value, hasPsd: pair.previewOnly !== true, openPath: pair.psd.absPath })
  if (outcome.toast) toast.addToast(outcome.toast)
}

async function openCurrentFolder(): Promise<void> {
  if (!child.value) return
  const result = await window.comicType.openPath(child.value.folderPath)
  if (!result.ok) {
    toast.addToast({ type: 'error', message: result.message || '打开文件夹失败' })
  }
}

function onToast(payload: { type: 'success' | 'warning' | 'error'; message: string }): void {
  toast.addToast(payload)
}

// --- Modal handlers --------------------------------------------------------
const savingProject = ref(false)

async function onModalSave(payload: {
  parentTitle: string
  chapterNumber: string
  projectTitle: string
  folderPath: string
}): Promise<void> {
  if (savingProject.value) return
  savingProject.value = true
  const progressId = toast.addToast({ type: 'loading', message: '正在准备项目…', duration: 0 })
  try {
    const result = await workspace.saveChild(payload, managedChildId.value ?? undefined, (message) => toast.updateToast(progressId, message))
    toast.removeToast(progressId)
    toast.addToast({
      type: 'success',
      message:
        modalMode.value === 'manage'
          ? '项目保存成功'
          : result.skipped > 0 && result.added === 0
            ? '项目已存在，已跳过导入'
            : result.skipped > 0
              ? `新增 ${result.added} 个项目，跳过 ${result.skipped} 个已有项目`
              : `项目添加成功（${result.added} 个）`
    })
    modalVisible.value = false
    // If we updated the current child and its parent title changed, the
    // route may be stale — reload parents and re-sync.
    await workspace.loadParents()
    syncActiveChild()
    await scanActiveChild()
  } catch (error) {
    // 保存/导入前的扫描没过"读全"那道闸（2026-10-05）：目录不在 / 半写 / 读不到。
    // 必须把原因说出来 —— 一声不吭地失败是本仓库的零容忍项。
    toast.addToast({
      type: 'error',
      message: `项目保存失败：${error instanceof Error ? error.message : String(error)}`
    })
  } finally {
    savingProject.value = false
    toast.removeToast(progressId)
  }
}

async function onModalDelete(): Promise<void> {
  if (managedChildId.value) {
    const deletingActiveChild = managedChildId.value === childId.value
    const destination = deletingActiveChild
      ? findChildAfterDeletion(
          workspace.parents,
          childId.value,
          [managedChildId.value],
          settings.childSortOrder
        )
      : null
    // Find the parentId for this child
    for (const parent of workspace.parents) {
      const child = parent.children.find((c) => c.id === managedChildId.value)
      if (child) {
        await workspace.deleteChild(parent.id, managedChildId.value)
        toast.addToast({ type: 'success', message: '项目已删除' })
        modalVisible.value = false
        if (deletingActiveChild) {
          pairs.value = []
          compareVisible.value = false
          comparePair.value = null
          await navigateAfterDeletion(destination)
        }
        return
      }
    }
  }
  modalVisible.value = false
}

// --- Self-check refresh -----------------------------------------------------
async function refreshAfterSelfCheck(): Promise<void> {
  await Promise.all([workspace.loadParents(), projectStore.loadProjects()])
  void achievements.refresh()
  syncActiveChild()
  if (child.value) {
    await scanActiveChild()
  }
}
</script>

<template>
  <!-- 加载中：不要在这一帧喊"项目不存在"。 -->
  <div
    v-if="!child && treeLoading"
    class="page-in flex h-full items-center justify-center bg-app-bg text-text-secondary"
    data-testid="project-loading"
  >
    加载中…
  </div>

  <!-- Missing child fallback（真的不存在才走这里） -->
  <div v-else-if="!child" class="page-in flex h-full items-center justify-center bg-app-bg">
    <EmptyState headline="项目不存在" cta-text="返回首页" :cta-action="() => router.push('/')" />
  </div>

  <!-- Adjustable project list + thumbnail workspace -->
  <div v-else class="page-in h-full">
    <SplitPane
      :primary-percent="settings.projectListWidth"
      :min-primary-window-ratio="0.2"
      @update:primary-percent="settings.setProjectListWidth"
    >
      <template #primary>
        <aside class="flex h-full flex-col overflow-hidden border-r border-border bg-card-bg">
          <div class="project-sidebar-scroll min-h-0 flex-1 overflow-auto">
          <ProjectSidebar
            :parents="workspace.parents"
            :loading="treeLoading"
            :reveal-active-child="true"
            :active-child-id="childId"
            :child-sort-order="settings.childSortOrder"
            :mode="activeMode"
            :parent-duties="dutyMap"
          :parent-modes="modeMap"
            :duty-mode-priority="settings.dutyModePriority"
            @select="onSidebarSelect"
            @rename-parent="onRenameParent"
            @add="onAdd"
            @manage="onManage"
            @delete="onDelete"
            @batch-mark="onBatchMark"
            @batch-delete="onBatchDelete"
            @reorder-parent="onReorderParent"
            @self-check-parent="startSelfCheck"
            @set-duties="onSetDuties"
            :enabled-modes="settings.enabledWorkModes"
            @switch-mode="settings.setProjectWorkMode"
            @edit-source-root="onEditSourceRoot"
          />
          </div>
        </aside>
      </template>

      <template #secondary>
        <Teleport to="body" :disabled="!viewerFullscreen">
        <section data-viewer-workspace :class="{ 'fixed inset-0 z-40': viewerFullscreen }" class="flex h-full min-w-0 flex-col overflow-hidden bg-app-bg">
          <!-- Header bar -->
          <header
            class="flex min-h-[96px] flex-col justify-center gap-0.5 border-b border-border px-4 py-2"
          >
            <div class="flex min-w-0 items-center justify-between gap-3">
              <h2
                class="min-w-0 truncate text-[17px] font-semibold tracking-tight text-text-primary"
              >
                {{ formatChapterNumber(child.chapterNumber) }} · {{ child.projectTitle }}
              </h2>
              <!--
                这里原来有一枚「校对 0/18」胶囊（`mode-stat-*`）—— 2026-10-06 按用户要求
                **全局删掉**：它与底部进度条读同一个 computed，删了不丢任何信息；
                取而代之的是对照视图原图分屏右上角的页码 `2/18 ▾`。
              -->
            </div>
            <p class="truncate text-[11px] text-text-tertiary">{{ child.folderPath }}</p>
            <!--
              「目录不在」不是故障，是用户整理本地文件后的**预期状态**（2026-10-01）：
              用安静的状态条说明，不再每次切回窗口都弹一次红色告警 —— 红色留给真读不到
              （权限不足、网络盘没挂载）。样式沿用 Import.vue 里同期别的 info 条。
              文案必须写清"哪里的进度还是历史值"：侧栏/成就取自数据库（不受影响），
              而本页头部与底部的数字是从**实时扫描**算的，目录不在时必然是 0/0。
            -->
            <p
              v-if="chapterMissing"
              data-testid="chapter-missing"
              class="mt-1 flex w-fit items-center gap-1.5 rounded-md border border-info/30 bg-info-soft px-2.5 py-1 text-[11px] leading-none text-info"
            >
              <span
                class="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-info"
                aria-hidden="true"
              />
              本地目录已不在（被删除或改名）· 侧栏与成就的进度仍按历史记录统计
            </p>
            <!-- 工具条：四个控件四种层级，别再让"静止底色 = 悬停底色"
                 （旧版 hover 只把 opacity 降到 90%，视觉上反而变暗 —— 交接文档 §12.1.2）。 -->
            <div class="mt-1.5 flex flex-wrap items-center gap-2" data-testid="project-file-toolbar">
              <UiButton variant="outline" size="sm"
                class="transition-colors"
                @click="openCurrentFolder"
              >
                打开当前文件夹
              </UiButton>

              <UiButton variant="outline" size="sm"
                class="transition-colors"
                @click="refreshCurrentProject"
              >
                刷新
              </UiButton>
              <span class="mx-0.5 h-4 w-px shrink-0 bg-border" aria-hidden="true" />
              <!--
                撤销最近一次标记（含批量）：数据从**台账**来，所以关掉程序再打开也还在
                （不是内存里记一笔）。输入框里按 Ctrl+Z 不会被抢，见 onUndoHotkey。
              -->
              <!--
                只用图标：这一条工具条本来就快满了，加两个带字的按钮会把它挤到第二行
                （第一版就是，截图时当场发现）。功能说明放在 title 与 aria-label 里 ——
                和隔壁「记录」同一档。
              -->
              <TranslationCreditsEditor
                :key="`${child?.id}-${activeMode}`"
                :mode="activeMode"
                :prepare="prepareTranslationCredits"
                :credits="chapterTranslation?.document?.credits"
                :disabled="chapterTranslationLoading || creditsSaving || translationDraft.saving.value || translationDraft.dirty.value || chapterTranslation?.status === 'error'"
                @save="onTranslationCredits"
              />
              <UiButton variant="outline" size="sm"
                class="flex w-8 shrink-0 items-center justify-center transition-colors disabled:cursor-not-allowed disabled:opacity-40"
                :disabled="!undoableMark || undoingMark"
                :title="undoTooltip"
                aria-label="撤销标记"
                data-testid="mark-undo-button"
                @click="onUndoMark"
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
                  <path d="M9 7H5v-4" />
                  <path d="M5 7a8 8 0 1 1-1.5 5" />
                </svg>
              </UiButton>
              <UiButton variant="outline" size="sm"
                class="flex w-8 shrink-0 items-center justify-center transition-colors"
                title="标记记录：谁在什么时候改了什么（每条都能还原）"
                aria-label="标记记录"
                data-testid="mark-history-button"
                @click="markHistoryVisible = true"
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
                  <circle cx="12" cy="12" r="8.5" />
                  <path d="M12 7.5V12l3 2" />
                </svg>
              </UiButton>
              <div class="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-2">

                <div id="project-compare-actions" class="flex min-w-0 flex-wrap items-center justify-end gap-2"><div id="project-mark-actions" class="flex items-center gap-2">              <template v-if="!compareVisible">
                <UiButton :variant="selectedDone ? 'outline' : 'default'" size="sm" :disabled="selectedPairs.length === 0" :aria-pressed="selectedDone" :title="selectedDone ? '点击标记为未完成' : '点击标记为已完成'" @click="onToolbarMark(selectedDone ? 'pending' : 'done')">
                  标记{{ selectedDone ? '未' : '已' }}{{ activeModeDoneLabel }}
                </UiButton>
              </template></div>
              <UiButton v-if="!compareVisible" variant="outline" size="sm" :disabled="selectedPairs.length !== 1" data-testid="project-open-selected" @click="openSelectedPair">去{{ activeModeDoneLabel }}</UiButton>
                </div>
              </div>
            </div>
          </header>

          <!-- Content area -->
          <div class="relative flex-1 overflow-hidden" @click="stopPlayback">
            <ProjectThumbList :child-id="childId"
              v-if="pairs.length > 0 || !scanning"
              :key="thumbListKey"
              :pairs="pairs"
              :folder-path="child.folderPath"
              :mode="activeMode"
              :missing="chapterMissing"
              @compare="onCompare"
              @mark="onCardMark"
              @selection-change="onSelectionChange"
              @toast="onToast"
            />
            <div v-else class="flex h-full items-center justify-center text-text-secondary">
              扫描中…
            </div>

            <!-- CompareViewer overlay -->
            <div
              v-if="compareVisible && comparePair"
              class="absolute inset-0 z-20 border-t border-border bg-app-bg"
            >
              <CompareViewer
                ref="compareViewerRef"
                @update:fullscreen="viewerFullscreen = $event"
                actions-target="#project-compare-actions" mark-target="#project-mark-actions"
                footer-target="#project-compare-footer"
                :jpg-path="comparePair.jpgPath"
                :psd-path="comparePair.psd.absPath"
                :revision="compareRevision"
                :folder-path="child.folderPath"
                :visible="true"
                :mode="activeMode"
                :image-only="comparePair.previewOnly === true"
                :playing="playing"
                :thumb-strip-open="stripOpen"
                :advance-after-mark="settings.advanceAfterMark"
                :marked-done="compareDone"
                :translation="compareTranslation"
                :page-number="currentPageNumber"
                :page-count="pageCount"
                :split-percent="settings.viewerSplitWidth"
                :just-added-index="justAddedEntryIndex"
                @update:split-percent="settings.setViewerSplitWidth($event)"
                @update:advance-after-mark="settings.setAdvanceAfterMark($event)"
                @open-psd="openPsd(comparePair.psd.absPath)"
                @mark="markComparePair"
                @ready="onViewerReady"
                @stop-playback="stopPlayback"
                @previous="shiftCompare(-1)"
                @next="shiftCompare(1)"
                @close="closeCompare"
                @pick-page="goToPage"
                @translation-credits="onTranslationCredits"
                @translation-edit-text="onTranslationEditText"
                @translation-edit-group="onTranslationEditGroup"
                @translation-move-anchor="onTranslationMoveAnchor"
                @translation-add-frame="onTranslationAddFrame"
                @translation-add-frame-mode="setTranslationAddFrameMode"
                @translation-delete-entry="onTranslationDeleteEntry"
                @translation-undo="translationDraft.undo()"
                @translation-discard="translationDraft.discard()"
                @translation-save="translationDraft.save()"
                @translation-mode="onTranslationPaneMode"
                @translation-edit-reason="onTranslationEditReason"
                @translation-export-reviews="onTranslationExportReviews"
                @translation-save-as="onTranslationSaveAs"
                @translation-unreview="onTranslationUnreview"
                @translation-drop-review="onTranslationDropReview"
              />
            </div>

            <!--
              缩略图条：盖在画面底部（**不挤**画面区）。
              挤的话图像区会变矮 → ImageViewer 的 ResizeObserver 会重新"适应窗口" →
              用户刚调好的缩放被清掉。盖上不动，缩放和位置都保住。
            -->
            <PreviewThumbStrip
              v-if="compareVisible && stripOpen"
              :items="stripItems"
              :active-id="comparePair?.psd.absPath ?? ''"
              @pick="onStripPick"
              @visible="onStripVisible"
              @image-error="onStripImageError"
              @close="stripOpen = false"
            />
          </div>

          <!-- Footer dock: txt summary + 24px progress bar -->
          <footer
            class="flex min-h-[66px] shrink-0 flex-col justify-end gap-1 border-t border-border bg-card-bg px-3 py-1.5"
          >
            <div class="flex w-full items-center gap-1.5">
              <!--
                看图三件套的入口（只在预览 / 对照状态出现）。
                缩略图网格状态下本来就有一整片缩略图，再来一条是废话；
                播放更是没意义（画面都没开）。**常驻显隐**是刻意的：全站没有
                "鼠标不动就隐藏"的先例，而鼠标停住恰恰是最需要控件的时刻。
              -->
              <template v-if="compareVisible">
                <UiButton variant="ghost" size="sm"
                  type="button"
                  class="flex w-6 shrink-0 items-center justify-center transition-colors"
                  :class="
                    stripOpen
                      ? 'bg-primary-soft text-accent'
                      : 'text-text-secondary hover:text-text-primary'
                  "
                  aria-label="缩略图"
                  title="缩略图：展开一条胶片，点哪张跳哪张"
                  data-testid="viewer-thumb-strip-toggle"
                  @click="toggleStrip"
                >
                  <!-- 胶片格：上半是画面、下半是胶片孔（与看图软件那一枚同款图案） -->
                  <svg
                    class="h-[18px] w-[18px]"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.6"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <rect x="3" y="4.5" width="18" height="15" rx="2.5" />
                    <line x1="3" y1="14.5" x2="21" y2="14.5" />
                    <line x1="8" y1="14.5" x2="8" y2="19.5" />
                    <line x1="12" y1="14.5" x2="12" y2="19.5" />
                    <line x1="16" y1="14.5" x2="16" y2="19.5" />
                  </svg>
                </UiButton>
                <UiButton variant="ghost" size="sm"
                  type="button"
                  class="flex w-6 shrink-0 items-center justify-center transition-colors disabled:cursor-not-allowed disabled:opacity-40"
                  :class="
                    playing
                      ? 'bg-primary-soft text-accent'
                      : 'text-text-secondary hover:text-text-primary'
                  "
                  :disabled="pageCount <= 1"
                  :aria-label="playing ? '停止播放' : '自动播放'"
                  :title="playing ? '停止播放' : `自动播放：每 ${playIntervalLabel} 一张`"
                  data-testid="viewer-play-toggle"
                  @click="togglePlay"
                >
                  <!-- 圆角方框 + 三角 / 双竖条：与看图软件那一枚同款图案（暂停也在同一个框里） -->
                  <svg
                    v-if="!playing"
                    class="h-[18px] w-[18px]"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.6"
                    stroke-linejoin="round"
                  >
                    <rect x="3.5" y="5" width="17" height="14" rx="3" />
                    <path d="M10.5 9.2 15 12l-4.5 2.8z" fill="currentColor" />
                  </svg>
                  <svg
                    v-else
                    class="h-[18px] w-[18px]"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.8"
                    stroke-linecap="round"
                  >
                    <rect x="3.5" y="5" width="17" height="14" rx="3" />
                    <line x1="10.5" y1="9" x2="10.5" y2="15" />
                    <line x1="13.5" y1="9" x2="13.5" y2="15" />
                  </svg>
                </UiButton>
                <Popover>
                  <PopoverTrigger as-child><UiButton variant="ghost" size="sm" aria-label="播放间隔">{{ playIntervalLabel }}</UiButton></PopoverTrigger>
                  <PopoverContent align="end" class="w-auto"><p class="mb-2 text-sm font-medium">自动播放间隔</p><ToggleGroup type="single" size="sm" :model-value="String(settings.playIntervalMs)" aria-label="播放间隔" @update:model-value="value => { if(value) settings.setPlayIntervalMs(Number(value)) }"><ToggleGroupItem v-for="option in PLAY_INTERVAL_OPTIONS" :key="option.value" :value="String(option.value)">{{ option.label }}</ToggleGroupItem></ToggleGroup></PopoverContent>
                </Popover>
                <span class="mx-0.5 h-3.5 w-px shrink-0 bg-border" aria-hidden="true" />
              </template>
              <div
                class="min-w-0 flex-1 truncate text-left text-[12px] leading-4 text-text-secondary"
                data-testid="project-txt-summary"
              >
                {{ txtSummary || ' ' }}
              </div>
              <div id="project-compare-footer" class="ml-auto shrink-0" />
            </div>
            <div class="h-6 w-full">
              <ProjectFooter :progress="activeModeProgress" :mode="activeMode" />
            </div>
          </footer>
        </section>
        </Teleport>
      </template>
    </SplitPane>
  </div>

  <!-- Modal -->
  <ProjectFormModal
    :saving="savingProject"
    v-if="modalVisible"
    :mode="modalMode"
    :initial-data="modalData"
    :existing-parent-titles="workspace.parents.map((parent) => parent.title)"
    @save="onModalSave"
    @cancel="modalVisible = false"
    @delete="onModalDelete"
  />

  <MarkHistoryDialog
    v-if="markHistoryVisible"
    :open="true"
    :child-id="childId"
    @close="markHistoryVisible = false"
    @changed="onMarkHistoryChanged"
    @toast="onToast"
  />

  <SelfCheckDialog
    :visible="selfCheckVisible"
    :busy="selfCheckBusy"
    :running="selfCheckRunning"
    :preview="selfCheckPreview"
    :source-root="selfCheckSourceRoot"
    :conflict-actions="selfCheckConflictActions"
    :never-ask="selfCheckNeverAsk"
    :silent-self-check="settings.silentSelfCheck"
    :rename-hints="selfCheckRenameHints"
    @close="closeSelfCheck"
    @pick-directory="pickSelfCheckDirectory"
    @run-with-source="runSelfCheckWithSource"
    @set-conflict-action="setSelfCheckConflictAction"
    @update:never-ask="selfCheckNeverAsk = $event"
    @confirm="confirmSelfCheckImport"
    @reclaim="reclaimCandidate"
    @detect-renames="detectSelfCheckRenames"
  />

  <!-- 「修改扫描目录」：只改父级的"检测新章节去哪找"，不动任何话自己的路径。 -->
  <SourceRootDialog
    :visible="sourceRootVisible"
    :busy="sourceRootBusy"
    :parent-title="sourceRootParentTitle"
    :mode="sourceRootMode"
    :directory="sourceRootDirectory"
    :layers="sourceRootLayers"
    :layer-error="sourceRootLayerError"
    :selected-layer-paths="sourceRootSelectedLayerPaths"
    :acknowledged="sourceRootAcknowledged"
    :current-roots="sourceRootCurrentRoots"
    :current-is-remembered="sourceRootCurrentIsRemembered"
    :current-candidate-count="sourceRootCurrentCandidateCount"
    :current-message="sourceRootCurrentMessage"
    :conflicts="sourceRootConflicts"
    :plan="sourceRootPlan"
    :can-save="sourceRootCanSave"
    @close="closeSourceRootEditor"
    @pick-directory="pickSourceRootDirectory"
    @update:directory="setSourceRootDirectory"
    @load-layers="loadSourceRootLayers"
    @toggle-layer="toggleSourceRootLayer"
    @reset-to-auto="resetSourceRootToAuto"
    @update:acknowledged="onSourceRootAcknowledged"
    @save="saveSourceRoot"
  />

  <TranslationConflictDialog
    :visible="translationConflict !== null"
    :message="translationConflict?.message ?? ''"
    :current-label="translationConflictLabel"
    @reload="translationDraft.resolveConflict('reload')"
    @force="translationDraft.resolveConflict('force')"
    @close="dismissTranslationConflict"
  />
</template>
