import { confirmAction } from '@renderer/services/confirm'
import { computed, ref, watch, type ComputedRef, type Ref } from 'vue'
import { useSettingsStore } from '@renderer/stores/settings'
import type { JpgPsdPair, ParentProject, WorkMode } from '@shared/types'
import { WORK_MODE_LABELS } from '@shared/modes'
import { psdStatsFromPairs, useProjectWorkspace } from '@renderer/stores/projectWorkspace'
import {
  createMarkOperationId,
  type MarkAuditContext,
  type MarkAuditSource
} from '@shared/mark-audit'
import { useAchievementsStore } from '@renderer/stores/achievements'
import {
  modeStatsFromPairs,
  PAIRED_MODE_STATS_VERSION,
  PAIRED_PSD_STATS_VERSION,
  resyncPairSelection
} from '@shared/status'

export interface UseProjectMarkingOptions {
  pairs: Ref<JpgPsdPair[]>
  currentParent: ComputedRef<ParentProject | null>
  currentMode?: ComputedRef<WorkMode>
}

export function useProjectMarking(options: UseProjectMarkingOptions) {
  const workspace = useProjectWorkspace()
  const achievements = useAchievementsStore()

  const selectedPairs = ref<JpgPsdPair[]>([])
  const settings = useSettingsStore()
  const activeMode = computed({
    get: () => options.currentMode?.value ?? (options.currentParent.value ? settings.modeForProject(options.currentParent.value) : settings.activeWorkMode),
    set: (mode: WorkMode) => { const parent = options.currentParent.value; if (parent) void settings.setProjectWorkMode(parent.id, mode); else void settings.setActiveWorkMode(mode) }
  })
  watch(activeMode, () => { selectedPairs.value = [] })

  const activeModeDoneLabel = computed(() => WORK_MODE_LABELS[activeMode.value])
  const activeModePendingLabel = computed(() => `未${activeModeDoneLabel.value}`)

  /** 标记之后 pairs 会被替换成新对象，选中项得跟着搬到新对象上。 */
  function syncSelectedPairs(): void {
    selectedPairs.value = resyncPairSelection(selectedPairs.value, options.pairs.value)
  }

  function currentChildHasPsdSource(): boolean {
    return options.pairs.value.some(
      (pair) => !pair.previewOnly && pair.psd.absPath.toLocaleLowerCase().endsWith('.psd')
    )
  }

  /**
   * 一次**用户点击**开一个台账上下文。
   *
   * `opId` 会跟着这次点击的所有写入走到库里 —— 撤销、台账列表都以它为"一次操作"的单位。
   * `source` 只影响台账文案（哪只手改的：卡片 / 工具栏 / 对照视图 / 侧栏批量）。
   */
  function newMarkContext(
    source: MarkAuditSource,
    status: 'done' | 'pending'
  ): MarkAuditContext {
    return {
      opId: createMarkOperationId(),
      kind: 'mark',
      source,
      mode: activeMode.value,
      targetStatus: status
    }
  }

  async function markPairs(
    targetPairs: JpgPsdPair[],
    status: 'done' | 'pending',
    audit?: MarkAuditContext
  ): Promise<void> {
    const psdPaths = [...new Set(targetPairs.map((pair) => pair.psd.absPath))]
    if (psdPaths.length === 0) return
    const activeChild = workspace.activeChild
    if (!activeChild) return

    if (status === 'done' && !currentChildHasPsdSource()) {
      const confirmed = await confirmAction(
        '该子项目无 PSD 文件，强制标记为已嵌字可能导致后续无法还原。确认继续吗？'
      )
      if (!confirmed) return
    }

    await workspace.rememberStatuses(activeChild, targetPairs, status, undefined, audit)
    options.pairs.value = workspace.applyPsdStatusOverrides(options.pairs.value)
    const nextStats = psdStatsFromPairs(options.pairs.value)
    if (workspace.activeChild) {
      workspace.activeChild.psdStats = nextStats
      workspace.activeChild.statsVersion = PAIRED_PSD_STATS_VERSION
      workspace.activeChild.psdModeStats = modeStatsFromPairs(options.pairs.value)
      workspace.activeChild.modeStatsVersion = PAIRED_MODE_STATS_VERSION
    }
    workspace.setActiveChild(workspace.activeChild, nextStats)
    await workspace.persistParentsProgress()
    syncSelectedPairs()

    const parent = options.currentParent.value
    const updatedChild = workspace.activeChild
    if (parent && updatedChild) {
      await achievements.refresh()
    }
  }

  async function onMark(pair: JpgPsdPair): Promise<void> {
    const done = pair.psd.modes?.[activeMode.value] ??
      (activeMode.value === 'typeset' && pair.psd.status === 'done')
    await markTargetsForActiveMode([pair], done ? 'pending' : 'done', 'card')
  }

  function onSelectionChange(nextSelectedPairs: JpgPsdPair[]): void {
    selectedPairs.value = nextSelectedPairs
  }

  /**
   * 按**当前模式**把一批 pair 标成 done/pending。**模式分流只在这里判一次。**
   *
   * 工具栏（作用于缩略图的选中项）和对照视图（作用于当前显示的那一张）都走这一条。
   * 否则"嵌字一条路、其余模式走另一条路"这件事会在每个调用点上各写一遍，早晚漂移。
   */
  async function markTargetsForActiveMode(
    targetPairs: JpgPsdPair[],
    status: 'done' | 'pending',
    source: MarkAuditSource = 'toolbar'
  ): Promise<void> {
    const audit = newMarkContext(source, status)
    if (activeMode.value === 'typeset') {
      await markPairs(targetPairs, status, audit)
      return
    }

    const activeChild = workspace.activeChild
    if (!activeChild || targetPairs.length === 0) return

    await workspace.rememberModeStatuses(
      activeChild,
      targetPairs,
      activeMode.value,
      status === 'done',
      audit
    )
    options.pairs.value = workspace.applyPsdStatusOverrides(options.pairs.value)
    if (workspace.activeChild) {
      workspace.activeChild.psdModeStats = modeStatsFromPairs(options.pairs.value)
      workspace.activeChild.modeStatsVersion = PAIRED_MODE_STATS_VERSION
    }
    syncSelectedPairs()
    await workspace.persistParentsProgress()
  }

  async function markSelectedDone(): Promise<void> {
    await markTargetsForActiveMode(selectedPairs.value, 'done')
  }

  async function markSelectedPending(): Promise<void> {
    await markTargetsForActiveMode(selectedPairs.value, 'pending')
  }

  function setActiveMode(mode: WorkMode): void {
    activeMode.value = mode
  }

  return {
    selectedPairs,
    activeMode,
    activeModeDoneLabel,
    activeModePendingLabel,
    syncSelectedPairs,
    markPairs,
    markTargetsForActiveMode,
    onMark,
    onSelectionChange,
    markSelectedDone,
    markSelectedPending,
    setActiveMode
  }
}
