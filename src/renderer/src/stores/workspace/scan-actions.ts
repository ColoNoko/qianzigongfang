import { requireCompleteScan } from '@shared/project-scan'
import type { ChildProject, JpgPsdPair, PsdStat } from '@shared/types'
import {
  modeStatsFromPairs,
  PAIRED_MODE_STATS_VERSION,
  PAIRED_PSD_STATS_VERSION
} from '@shared/status'
import {
  toPlain,
  ChildRootMissingError,
  SCAN_DEBOUNCE_MS,
  latestPairMtime,
  psdStatsFromPairs,
  statsEqual,
  syncDashboardStore,
  writeWorkspaceLog,
  recomputeParentMtimes,
  snapshotParents
} from './helpers'
import type { WorkspaceContext } from './context'

let _scanTimer: ReturnType<typeof setTimeout> | null = null
const scanVersions = new WeakMap<object, Map<string, number>>()
export const scanActions = {
  async persistParentsProgress(
    this: WorkspaceContext,
    current: () => boolean = () => true
  ): Promise<void> {
    if (!current()) return
    recomputeParentMtimes(this.parents)

    const updates = this.parents.flatMap((parent) =>
      parent.children.map((child) => ({
        childId: child.id,
        lastMtimeMs: child.lastMtimeMs,
        psdStats: child.psdStats,
        statsVersion: child.statsVersion,
        psdModeStats: child.psdModeStats,
        modeStatsVersion: child.modeStatsVersion
      }))
    )
    await window.comicType.projectSaveProgress(toPlain(updates))
    if (!current()) return

    const persistedParents = snapshotParents(this.parents)
    const activeChildId = this.activeChild?.id
    this.parents = persistedParents
    if (activeChildId) {
      const updated = this.findChild(activeChildId)
      if (updated) this.setActiveChild(updated, updated.psdStats ?? [])
    }
    syncDashboardStore(persistedParents)
  },
  setActiveChild(this: WorkspaceContext, child: ChildProject | null, stats: PsdStat[]): void {
    this.activeChild = child
    this.psdStats = stats
  },
  clearActiveChild(this: WorkspaceContext): void {
    this.activeChild = null
    this.psdStats = []
    this.txtFiles = []
    this.scannedImages = { childId: '', files: [] }
  },
  async scanChild(
    this: WorkspaceContext,
    child: ChildProject,
    callerCurrent: () => boolean = () => true,
    cached = false
  ): Promise<JpgPsdPair[]> {
    let versions = scanVersions.get(this)
    if (!versions) {
      versions = new Map()
      scanVersions.set(this, versions)
    }
    const version = (versions.get(child.id) ?? 0) + 1
    versions.set(child.id, version)
    const registered = Boolean(this.findChild(child.id))
    const originalPath = child.folderPath
    const current = () =>
      callerCurrent() &&
      versions!.get(child.id) === version &&
      (!registered || this.findChild(child.id)?.folderPath === originalPath)
    const result = cached
      ? await window.comicType.scanChildProject(originalPath, { cached: true })
      : await window.comicType.scanChildProject(originalPath)
    if (!current()) return []
    // ⚠️ 「0 页 + 有错误」≠「这一话有 0 个文件」（2026-09-30 审查 high）：
    // scanner 读不到目录时**不抛错**，只把错误塞进 `errors[]` 然后返回空列表
    // （scanner.ts 的 walk()）。照旧往下走会把 psdStats=[]、statsVersion=PAIRED、
    // lastMtimeMs=0 写进库 → 侧栏/首页永久显示 0/0；而 childHasStoredStats() 之后
    // 判定"已统计"，enrichMissingStats 不再补算（重启也不自修），界面还报"已标记成功"。
    // 这里直接把这次取数判为**失败**：不写任何缓存，由调用方决定怎么提示。
    // 触发很日常：U 盘/网络盘没挂载、OneDrive 占位符、文件夹被改名而注册表还是旧路径。
    if (result.jpgPairs.length === 0 && result.errors.length > 0) {
      const first = result.errors[0]
      // 目录**不在**（被删/改名）与"读不到"（权限、网络盘）要分开提示：前者是
      // 用户整理文件后的预期状态，每次切回窗口都弹一次红字纯属骚扰。两者都仍然
      // 抛错 —— 守住上面那条"不写任何缓存"的底线，区别只在错误类型。
      if (result.rootMissing) {
        writeWorkspaceLog('info', 'Child project folder missing', {
          childId: child.id,
          folderPath: child.folderPath,
          errorCount: result.errors.length
        })
        throw new ChildRootMissingError(child.folderPath)
      }
      writeWorkspaceLog('warn', 'Child project scan failed (unreadable)', {
        childId: child.id,
        folderPath: child.folderPath,
        errorCount: result.errors.length,
        firstError: first ? `${first.path}：${first.msg}` : ''
      })
      throw new Error(
        `读不到这一话的目录（${result.errors.length} 个路径报错${first ? `，例如 ${first.msg}` : ''}）`
      )
    }
    requireCompleteScan(result)
    await this.loadRememberedStatuses(child, result.jpgPairs, current)
    if (!current()) return []
    child = this.findChild(child.id) ?? child
    const pairs = this.applyPsdStatusOverrides(result.jpgPairs)
    // 统计补漏（2026-10-05 从并行分支 T6 移植）：模式统计（校对/翻译/监修）
    // 的变化也必须触发落库 —— 否则"重扫后发现校对数变了、但 PSD 张数与时间没变"
    // 的场景会跳过保存，侧栏与成就页的重扫结果一重启就回退。
    const nextModeStats = modeStatsFromPairs(pairs)
    const modeStatsChanged =
      child.modeStatsVersion !== PAIRED_MODE_STATS_VERSION ||
      JSON.stringify(child.psdModeStats) !== JSON.stringify(nextModeStats)
    child.psdModeStats = nextModeStats
    child.modeStatsVersion = PAIRED_MODE_STATS_VERSION
    if (!this.activeChild || this.activeChild.id === child.id) {
      this.txtFiles = result.txtFiles
      this.scannedImages = { childId: child.id, files: result.imageFiles ?? result.jpgPairs.flatMap(pair => pair.jpgPath ? [pair.jpgPath] : []) }
    }
    writeWorkspaceLog('info', 'Child project scan completed', {
      childId: child.id,
      title: child.projectTitle,
      folderPath: child.folderPath,
      pairCount: pairs.length,
      txtCount: result.txtFiles.length,
      errorCount: result.errors.length,
      firstPsdPaths: pairs.slice(0, 20).map((pair) => pair.psd.absPath),
      errors: result.errors.slice(0, 10)
    })
    const lastMtimeMs = latestPairMtime(pairs)
    const psdStats = psdStatsFromPairs(pairs)
    const progressChanged =
      modeStatsChanged ||
      child.statsVersion !== PAIRED_PSD_STATS_VERSION ||
      child.lastMtimeMs !== lastMtimeMs ||
      !statsEqual(child.psdStats, psdStats)
    child.lastMtimeMs = lastMtimeMs
    child.psdStats = psdStats
    child.statsVersion = PAIRED_PSD_STATS_VERSION
    const parent = this.parents.find((p) => p.children.some((c) => c.id === child.id))
    if (parent) {
      parent.lastMtimeMs = parent.children.reduce((latest, c) => Math.max(latest, c.lastMtimeMs), 0)
    }
    if (progressChanged) await this.persistParentsProgress(current)
    return pairs
  },
  debouncedScan(this: WorkspaceContext, child: ChildProject | null): void {
    if (_scanTimer !== null) {
      clearTimeout(_scanTimer)
      _scanTimer = null
    }
    if (child === null) return
    _scanTimer = setTimeout(() => {
      _scanTimer = null
      // scanChild 对"目录读不到"会抛错（见 2026-09-30 审查 high），这里是空跑的
      // 后台刷新，不该把未处理拒绝抛到 window。
      void this.scanChild(child).catch((error) => {
        writeWorkspaceLog('warn', 'Debounced child scan skipped', {
          childId: child.id,
          error: error instanceof Error ? error.message : String(error)
        })
      })
    }, SCAN_DEBOUNCE_MS)
  },
  cancelDebouncedScan(this: WorkspaceContext): void {
    if (_scanTimer !== null) {
      clearTimeout(_scanTimer)
      _scanTimer = null
    }
  }
}
