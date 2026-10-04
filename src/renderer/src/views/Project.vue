<script setup lang="ts">
// Project workbench — 1/3 sidebar + 2/3 main + 24px footer dock.
// Wires ProjectSidebar, ProjectThumbList, ProjectFooter, CompareViewer,
// and ProjectFormModal into the layout shell.
import { basenameOf } from '@shared/paths'
import { computed, onBeforeUnmount, onMounted, watch, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useProjectWorkspace } from '@renderer/stores/projectWorkspace'
import { useProjectStore } from '@renderer/stores/project'
import { useAchievementsStore } from '@renderer/stores/achievements'
import { useToastStore } from '@renderer/stores/toast'
import { useSettingsStore } from '@renderer/stores/settings'
import { useProjectSelfCheck } from '@renderer/features/project/useProjectSelfCheck'
import type { ChapterProgress, JpgPsdPair, WorkMode } from '@shared/types'
import LoadingSkeleton from '@renderer/components/LoadingSkeleton.vue'
import NetworkRetry from '@renderer/components/NetworkRetry.vue'
import EmptyState from '@renderer/components/EmptyState.vue'
import ProjectSidebar from '@renderer/components/ProjectSidebar.vue'
import ProjectThumbList from '@renderer/components/ProjectThumbList.vue'
import ProjectFooter from '@renderer/components/ProjectFooter.vue'
import CompareViewer from '@renderer/components/CompareViewer.vue'
import PreviewThumbStrip, { type StripItem } from '@renderer/components/PreviewThumbStrip.vue'
import MarkHistoryDialog from '@renderer/features/project/MarkHistoryDialog.vue'
import { summarizeMarkOperation, type MarkAuditOperation } from '@shared/mark-audit'
import ProjectFormModal from '@renderer/components/ProjectFormModal.vue'
import SplitPane from '@renderer/components/SplitPane.vue'
import AppSelect from '@renderer/components/AppSelect.vue'
import SelfCheckDialog from '@renderer/features/project/SelfCheckDialog.vue'
import { useProjectMarking } from '@renderer/features/project/useProjectMarking'
import { useProjectScan } from '@renderer/features/project/useProjectScan'
import { useParentDuties } from '@renderer/features/project/useParentDuties'
import { pickDutyMode } from '@shared/duties'
import { performCardAction } from '@renderer/features/project/external-tool'
import { childWorkbenchPath } from '@renderer/features/project/project-route'
import { formatChapterNumber } from '@shared/chapter'
import { computeModeCounts } from '@shared/status'
import { WORK_MODE_LABELS, WORK_MODE_OPTIONS } from '@shared/modes'
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

// Scan result for the active child — fed to ProjectThumbList.
const pairs = ref<JpgPsdPair[]>([])

const {
  selectedPairs,
  activeMode,
  activeModeDoneLabel,
  activeModePendingLabel,
  onMark,
  markTargetsForActiveMode,
  onSelectionChange,
  setActiveMode,
  markSelectedDone,
  markSelectedPending
} = useProjectMarking({
  pairs,
  currentParent
})

const modeProgress = computed(() => computeModeCounts(pairs.value))

const activeModeProgress = computed<ChapterProgress>(() => modeProgress.value[activeMode.value])

/**
 * The header used to render four independent numbers (explicit flags only),
 * which disagreed with the footer's auto-derived typeset figure. It now shows
 * the single active-mode figure — the same computed the footer reads, so the
 * two can no longer drift apart.
 */
const activeModeStat = computed(() => ({
  label: WORK_MODE_LABELS[activeMode.value],
  progress: activeModeProgress.value
}))

const {
  scanning,
  txtSummary,
  thumbListKey,
  chapterMissing,
  scanActiveChild,
  refreshActiveChild,
  refreshCurrentProject,
  cancelScan
} = useProjectScan({
  pairs,
  selectedPairs,
  childId,
  currentParent
})

// --- 职责 → 落脚时对齐一次模式（2026-10-03）----------------------------------
const { dutyMap, dutiesOf } = useParentDuties()
/** 上一次"按职责对齐过"的父级：只在**换到另一本漫画**时对齐，同一本里换话不打扰。 */
let alignedDutyParentId: string | null = null

/**
 * 进这一本时把模式切到职责对应的工序。
 *
 * 三条边界（都是"别让它变成打扰"）：
 * - 只在**换本**时对齐一次；同一本里换话、或你自己手动切走，都不会被拉回来；
 * - 等这一话**扫完**再对齐（`scanning === false`）—— 否则两个职责时拿到的是
 *   "0/0 还没开始"，完成度比不出来，只能靠规范顺序瞎猜；
 * - 没有职责（或本来就是这个模式）就什么都不做，也不弹提示。
 */
watch(
  [() => currentParent.value?.id ?? null, scanning],
  ([parentId, isScanning]) => {
    if (!parentId || isScanning || parentId === alignedDutyParentId) return
    alignedDutyParentId = parentId
    const target = pickDutyMode(dutiesOf(parentId), modeProgress.value)
    if (!target || target === activeMode.value) return
    setActiveMode(target)
    toast.addToast({
      type: 'success',
      message: `已按职责切到「${WORK_MODE_LABELS[target]}」`
    })
  }
)

/**
 * One figure for the active mode, read straight from the live scan result.
 * 嵌字 no longer has a separate auto-derived path — completion is manual-only
 * for every mode — so head and footer share a single source by construction.
 */


// CompareViewer state
const compareVisible = ref(false)
const comparePair = ref<JpgPsdPair | null>(null)

// --- 标记台账：撤销 / 记录（第十四轮）-----------------------------------------
const undoableMark = ref<MarkAuditOperation | null>(null)
const undoingMark = ref(false)
const markHistoryVisible = ref(false)

/** 最近一次可撤销的标记（没有就 null）→ 决定「撤销标记」亮不亮、tooltip 说什么。 */
async function refreshUndoableMark(): Promise<void> {
  undoableMark.value = await workspace.findUndoableMark()
}

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
          ? `已撤销：还原 ${result.revertedFiles} 个文件的标记`
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
  const target = event.target as HTMLElement | null
  const tag = target?.tagName?.toLowerCase()
  if (tag === 'input' || tag === 'textarea' || target?.isContentEditable) return
  if (!undoableMark.value) return
  event.preventDefault()
  void onUndoMark()
}

// --- 看图三件套（缩略图条 / 自动播放；缩放在 CompareViewer 里）-----------------
/** 底部那条"胶片"是否展开。退出预览会自动收起（免得下次进来先看到一条挡图的条）。 */
const stripOpen = ref(false)
/** 页脚那个 ▶ 是否在走。 */
const playing = ref(false)
/**
 * 缩略图网格已经渲染好的那份内存缩略图（`psd.absPath` → data URL）。
 *
 * 缩略图条**只认这一份**：零 IPC、零重新解析 PSD —— 这就是"复用已有缓存、不重新生成"。
 * 网格还没轮到的那一页会在条上显示页码占位，几秒内自己补齐。
 */
const viewerThumbs = ref<Record<string, string>>({})
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
      thumbUrl: viewerThumbs.value[pair.psd.absPath] ?? null
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

function onThumbnails(urls: Record<string, string>): void {
  viewerThumbs.value = urls
}

function onPlayIntervalLabel(): string {
  return `${settings.playIntervalMsValid / 1000} 秒`
}

const playIntervalLabel = computed(onPlayIntervalLabel)

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
  confirmSelfCheckImport
} = useProjectSelfCheck({
  refreshAfterSelfCheck: async () => {
    await refreshAfterSelfCheck()
  }
})

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

function closeCompare(): void {
  compareVisible.value = false
  comparePair.value = null
  // 退出预览 = 播放停、胶片收起：下次进来是干净的一屏。
  stopPlayback()
  stripOpen.value = false
  viewerReady = false
}

async function rememberRecentProject(id: string): Promise<void> {
  try {
    const raw = await window.comicType.storeGet('recentProjectIds')
    const previous = Array.isArray(raw)
      ? raw.filter((value): value is string => typeof value === 'string')
      : []
    await window.comicType.storeSet(
      'recentProjectIds',
      [id, ...previous.filter((value) => value !== id)].slice(0, 3)
    )
  } catch {
    // Recent-project history is a convenience and must not block the workbench.
  }
}

onMounted(async () => {
  if (workspace.parents.length === 0) {
    treeLoading.value = true
    try {
      await workspace.loadParents()
    } finally {
      treeLoading.value = false
    }
  }
  syncActiveChild()
  await scanActiveChild()
  await refreshUndoableMark()
  window.addEventListener('focus', refreshActiveChild)
  document.addEventListener('visibilitychange', refreshActiveChild)
  window.addEventListener('keydown', onUndoHotkey)
})

onBeforeUnmount(() => {
  cancelScan()
  stopPlayback()
  window.removeEventListener('keydown', onUndoHotkey)
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

async function onBatchMark(childIds: string[], status: 'done' | 'pending'): Promise<void> {
  // The batch buttons mark the mode currently selected in the toolbar — not
  // always typeset. Passing the mode through keeps the button label honest.
  const mode = activeMode.value
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

// --- ThumbList handlers ----------------------------------------------------
async function onCompare(pair: JpgPsdPair): Promise<void> {
  stopPlayback()
  viewerReady = false
  comparePair.value = pair
  compareVisible.value = true
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
  const current = pairs.value.find((pair) => pair.psd.absPath === shown.psd.absPath) ?? shown
  await markTargetsForActiveMode([current], status, 'viewer')
  await refreshUndoableMark()
  // C3：开了「标记后下一张」就顺手翻页 —— 到头**停下**（不回卷），跟自动播放一个语义。
  if (settings.advanceAfterMark) advanceToNextPair()
}

/** 标完翻下一张：到最后一页就停在原地（静默回卷最容易让人标错张）。 */
function advanceToNextPair(): void {
  const index = currentCompareIndex()
  if (index === -1 || index >= pairs.value.length - 1) return
  viewerReady = false
  comparePair.value = pairs.value[index + 1]
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

async function openCurrentFolder(): Promise<void> {
  if (!child.value) return
  const result = await window.comicType.openPath(child.value.folderPath)
  if (!result.ok) {
    toast.addToast({ type: 'error', message: result.message || '打开文件夹失败' })
  }
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

function onToast(payload: { type: 'success' | 'warning' | 'error'; message: string }): void {
  toast.addToast(payload)
}

// --- Modal handlers --------------------------------------------------------
async function onModalSave(payload: {
  parentTitle: string
  chapterNumber: string
  projectTitle: string
  folderPath: string
}): Promise<void> {
  const result = await workspace.saveChild(payload, managedChildId.value ?? undefined)
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
        <aside class="h-full overflow-auto border-r border-border bg-card-bg">
          <ProjectSidebar
            :parents="workspace.parents"
            :loading="treeLoading"
            :reveal-active-child="true"
            :active-child-id="childId"
            :child-sort-order="settings.childSortOrder"
            :mode="activeMode"
            :parent-duties="dutyMap"
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
          />
        </aside>
      </template>

      <template #secondary>
        <section class="flex h-full min-w-0 flex-col overflow-hidden bg-app-bg">
          <!-- Header bar -->
          <header
            class="flex min-h-[96px] flex-col justify-center gap-0.5 border-b border-border px-4 py-2"
          >
            <div class="flex min-w-0 items-center justify-between gap-3">
              <h2 class="min-w-0 truncate text-[17px] font-semibold tracking-tight text-text-primary">
                {{ formatChapterNumber(child.chapterNumber) }} · {{ child.projectTitle }}
              </h2>
              <!-- One figure, matching the footer exactly: same computed, so the
                   two can never disagree. 放在标题行右侧，页头因此从四行收到三行。
                   注意 `mode-stat-*` 元素里只能有 "done/total"，Project.spec 用它
                   和页脚的数字做逐字比对。 -->
              <span
                class="flex shrink-0 items-center gap-1.5 rounded-full bg-primary-soft px-2.5 py-1 text-[12px] leading-none"
              >
                <span class="text-accent">{{ activeModeStat.label }}</span>
                <span
                  class="font-semibold tabular-nums text-accent"
                  :data-testid="`mode-stat-${activeMode}`"
                >
                  {{ activeModeStat.progress.done }}/{{ activeModeStat.progress.total }}
                </span>
              </span>
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
            <div class="mt-1.5 flex flex-wrap items-center gap-2">
              <button
                class="h-8 rounded-badge border border-border bg-card-bg px-3 text-[13px] text-text-secondary transition-colors hover:bg-card-bg-hover hover:text-text-primary active:bg-card-bg-pressed"
                @click="openCurrentFolder"
              >
                打开当前文件夹
              </button>
              <button
                class="h-8 rounded-badge border border-border bg-card-bg px-3 text-[13px] text-text-secondary transition-colors hover:bg-card-bg-hover hover:text-text-primary active:bg-card-bg-pressed"
                @click="refreshCurrentProject"
              >
                刷新
              </button>
              <span class="mx-0.5 h-4 w-px shrink-0 bg-border" aria-hidden="true" />
              <!--
                模式下拉**留着**：对照视图的按钮文案跟着它走（标记嵌字 ↔ 标记监修），
                所以它在对照状态下仍然有用，不是多余的控件。
              -->
              <AppSelect
                v-model="activeMode"
                :options="WORK_MODE_OPTIONS"
                size="small"
                test-id="mark-mode-select"
              />
              <!--
                对照视图自己有「标记X」，作用于**当前显示的那一张**；
                这两只是作用于缩略图的选中项。同一个动作在一屏里出现两次，
                用户不知道该点哪个 —— 所以进对照视图时这两只让位。
                （对照视图里也看不见缩略图，本来就没法确认选中了哪几张。）
              -->
              <template v-if="!compareVisible">
                <button
                  class="h-8 rounded-badge bg-accent px-3 text-[13px] font-medium text-text-on-accent transition-colors hover:bg-primary-hover active:bg-primary-active disabled:cursor-not-allowed disabled:opacity-40"
                  :disabled="selectedPairs.length === 0"
                  @click="onToolbarMark('done')"
                >
                  标记{{ activeModeDoneLabel }}
                </button>
                <button
                  class="h-8 rounded-badge border border-primary-border bg-primary-soft px-3 text-[13px] text-accent transition-colors hover:bg-primary-soft-hover active:bg-primary-soft-hover disabled:cursor-not-allowed disabled:opacity-40"
                  :disabled="selectedPairs.length === 0"
                  @click="onToolbarMark('pending')"
                >
                  标记{{ activeModePendingLabel }}
                </button>
              </template>
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
              <button
                class="flex h-8 w-8 shrink-0 items-center justify-center rounded-badge border border-border bg-card-bg text-text-secondary transition-colors hover:bg-card-bg-hover hover:text-text-primary active:bg-card-bg-pressed disabled:cursor-not-allowed disabled:opacity-40"
                :disabled="!undoableMark || undoingMark"
                :title="undoTooltip"
                aria-label="撤销标记"
                data-testid="mark-undo-button"
                @click="onUndoMark"
              >
                <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M9 7H5v-4" />
                  <path d="M5 7a8 8 0 1 1-1.5 5" />
                </svg>
              </button>
              <button
                class="flex h-8 w-8 shrink-0 items-center justify-center rounded-badge border border-border bg-card-bg text-text-secondary transition-colors hover:bg-card-bg-hover hover:text-text-primary active:bg-card-bg-pressed"
                title="标记记录：谁在什么时候改了什么（每条都能还原）"
                aria-label="标记记录"
                data-testid="mark-history-button"
                @click="markHistoryVisible = true"
              >
                <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="12" cy="12" r="8.5" />
                  <path d="M12 7.5V12l3 2" />
                </svg>
              </button>
            </div>
          </header>

          <!-- Content area -->
          <div class="relative flex-1 overflow-hidden" @click="stopPlayback">
            <ProjectThumbList
              v-if="pairs.length > 0 || !scanning"
              :key="thumbListKey"
              :pairs="pairs"
              :folder-path="child.folderPath"
              :mode="activeMode"
              :missing="chapterMissing"
              @compare="onCompare"
              @mark="onCardMark"
              @selection-change="onSelectionChange"
              @thumbnails="onThumbnails"
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
                :jpg-path="comparePair.jpgPath"
                :psd-path="comparePair.psd.absPath"
                :folder-path="child.folderPath"
                :visible="true"
                :mode="activeMode"
                :image-only="comparePair.previewOnly === true"
                :playing="playing"
                :thumb-strip-open="stripOpen"
                :advance-after-mark="settings.advanceAfterMark"
                @update:advance-after-mark="settings.setAdvanceAfterMark($event)"
                @open-psd="openPsd(comparePair.psd.absPath)"
                @mark="markComparePair"
                @ready="onViewerReady"
                @stop-playback="stopPlayback"
                @previous="shiftCompare(-1)"
                @next="shiftCompare(1)"
                @close="closeCompare"
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
              @close="stripOpen = false"
            />
          </div>

          <!-- Footer dock: txt summary + 24px progress bar -->
          <footer
            class="flex h-14 shrink-0 flex-col justify-end gap-1 border-t border-border bg-card-bg px-3 pb-1.5"
          >
            <div class="flex w-full items-center gap-1.5">
              <!--
                看图三件套的入口（只在预览 / 对照状态出现）。
                缩略图网格状态下本来就有一整片缩略图，再来一条是废话；
                播放更是没意义（画面都没开）。**常驻显隐**是刻意的：全站没有
                "鼠标不动就隐藏"的先例，而鼠标停住恰恰是最需要控件的时刻。
              -->
              <template v-if="compareVisible">
                <button
                  type="button"
                  class="flex h-6 w-6 shrink-0 items-center justify-center rounded-badge transition-colors hover:bg-card-bg-hover"
                  :class="stripOpen ? 'bg-primary-soft text-accent' : 'text-text-secondary hover:text-text-primary'"
                  aria-label="缩略图"
                  title="缩略图：展开一条胶片，点哪张跳哪张"
                  data-testid="viewer-thumb-strip-toggle"
                  @click="toggleStrip"
                >
                  <!-- 胶片格：上半是画面、下半是胶片孔（与看图软件那一枚同款图案） -->
                  <svg class="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
                    <rect x="3" y="4.5" width="18" height="15" rx="2.5" />
                    <line x1="3" y1="14.5" x2="21" y2="14.5" />
                    <line x1="8" y1="14.5" x2="8" y2="19.5" />
                    <line x1="12" y1="14.5" x2="12" y2="19.5" />
                    <line x1="16" y1="14.5" x2="16" y2="19.5" />
                  </svg>
                </button>
                <button
                  type="button"
                  class="flex h-6 w-6 shrink-0 items-center justify-center rounded-badge transition-colors hover:bg-card-bg-hover disabled:cursor-not-allowed disabled:opacity-40"
                  :class="playing ? 'bg-primary-soft text-accent' : 'text-text-secondary hover:text-text-primary'"
                  :disabled="pairs.length <= 1"
                  :aria-label="playing ? '停止播放' : '自动播放'"
                  :title="playing ? '停止播放' : `自动播放：每 ${playIntervalLabel} 一张`"
                  data-testid="viewer-play-toggle"
                  @click="togglePlay"
                >
                  <!-- 圆角方框 + 三角 / 双竖条：与看图软件那一枚同款图案（暂停也在同一个框里） -->
                  <svg v-if="!playing" class="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round">
                    <rect x="3.5" y="5" width="17" height="14" rx="3" />
                    <path d="M10.5 9.2 15 12l-4.5 2.8z" fill="currentColor" />
                  </svg>
                  <svg v-else class="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
                    <rect x="3.5" y="5" width="17" height="14" rx="3" />
                    <line x1="10.5" y1="9" x2="10.5" y2="15" />
                    <line x1="13.5" y1="9" x2="13.5" y2="15" />
                  </svg>
                </button>
                <span class="mx-0.5 h-3.5 w-px shrink-0 bg-border" aria-hidden="true" />
              </template>
              <div
                class="min-w-0 flex-1 truncate text-left text-[12px] leading-4 text-text-secondary"
                data-testid="project-txt-summary"
              >
                {{ txtSummary || ' ' }}
              </div>
            </div>
            <div class="h-6 w-full">
              <ProjectFooter :progress="activeModeProgress" :mode="activeMode" />
            </div>
          </footer>
        </section>
      </template>
    </SplitPane>
  </div>

  <!-- Modal -->
  <ProjectFormModal
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
    @close="closeSelfCheck"
    @pick-directory="pickSelfCheckDirectory"
    @run-with-source="runSelfCheckWithSource"
    @set-conflict-action="setSelfCheckConflictAction"
    @update:never-ask="selfCheckNeverAsk = $event"
    @confirm="confirmSelfCheckImport"
  />
</template>
