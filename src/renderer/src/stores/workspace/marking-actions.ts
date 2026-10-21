import { confirmAction } from '@renderer/services/confirm'
import type { ChildProject, JpgPsdPair, WorkMode } from '@shared/types'
import type { MarkWriteBackResult, ProjectMemoryStatusUpdate } from '@shared/ipc-api'
import {
  createMarkOperationId,
  type MarkAuditContext,
  type MarkAuditOperation
} from '@shared/mark-audit'
import {
  modeStatsFromPairs,
  PAIRED_MODE_STATS_VERSION,
  PAIRED_PSD_STATS_VERSION
} from '@shared/status'
import { useAchievementsStore } from '../achievements'
import { createEmptyModeStatus, modeStatusToLegacyStatus, normalizeModeStatus } from '@shared/modes'
import {
  toPlain,
  PSD_STATUS_OVERRIDES_KEY,
  type PsdStatusOverride,
  latestPairMtime,
  psdStatsFromPairs,
  normalizePathForLookup,
  hydrateOverrides,
  applyOverrideToPair,
  writeWorkspaceLog
} from './helpers'
import type { WorkspaceContext } from './context'

export const markingActions = {
  async loadRememberedStatuses(
    this: WorkspaceContext,
    child: ChildProject,
    pairs: JpgPsdPair[],
    current: () => boolean = () => true
  ): Promise<void> {
    const modesBeforeRead = this.psdModeStatuses
    await this.ensurePsdStatusOverridesLoaded()
    const remembered =
      typeof window.comicType?.memoryGetProject === 'function'
        ? await window.comicType.memoryGetProject(child.id)
        : null
    if (!current()) return
    const next = { ...this.psdStatusOverrides }
    const nextModes = { ...this.psdModeStatuses }
    const nextTimestamps = { ...this.psdModeTimestamps }
    // 用 IPC 契约类型，而不是手抄一份形状 —— 手抄的那份把 `modes` 写成了**整份**
    // `WorkModeStatus`，于是"发整份 modes"看起来是类型允许的（就是它掩盖了那个 bug）。
    const migrationUpdates: ProjectMemoryStatusUpdate[] = []

    for (const pair of pairs) {
      const pathKey = normalizePathForLookup(pair.psd.absPath)
      // A mark saved while this read was in flight wins over the older snapshot.
      if (this.psdModeStatuses[pair.psd.absPath] !== modesBeforeRead[pair.psd.absPath]) continue
      const exact = remembered?.files[pathKey]
      const image = pair.jpgPath ? remembered?.files[normalizePathForLookup(pair.jpgPath)] : undefined
      // Historical translation/review marks used the original image identity.
      // Only use that fallback if there is no current PSD record; explicit unmarks win.
      const memoryFile = exact ?? (image ? {
        ...image, status: 'pending' as const,
        modes: { ...createEmptyModeStatus(), translated: !!image.modes?.translated, proofread: !!image.modes?.proofread },
        modeTimestamps: { translated: image.modeTimestamps?.translated, proofread: image.modeTimestamps?.proofread }
      } : undefined)
      const memoryStatus = memoryFile?.status
      const legacyStatus =
        this.psdStatusOverrides[pair.psd.absPath] ?? this.psdStatusOverrides[pathKey]
      const status = memoryStatus ?? legacyStatus
      if (!status) continue

      let modes = memoryFile?.modes
      if (!modes) {
        modes = createEmptyModeStatus()
        modes.typeset = status === 'done'
      } else {
        modes = normalizeModeStatus(modes)
      }

      const modeTimestamps = memoryFile?.modeTimestamps ?? {}
      next[pair.psd.absPath] = status
      nextModes[pair.psd.absPath] = modes
      nextTimestamps[pair.psd.absPath] = modeTimestamps
      if (!memoryStatus && legacyStatus) {
        // 迁移写回：把旧式 done/pending 落到新库的**只有 typeset 这一位**。
        //
        // 这里**不能**发上面那个整份 `modes`：主进程是按"补丁"合并的
        // （setStoredProjectMemoryStatuses），发整份就等于"覆盖四个模式" ——
        // 万一该路径在库里已经有其它模式的标记，就被这次迁移悄悄抹掉了。
        // 时间戳同理：本分支的 `modeTimestamps` 恒为空对象，干脆不传（= 保留库里的值）。
        migrationUpdates.push({
          pathKey,
          path: pair.psd.absPath,
          status: legacyStatus,
          mtimeMs: pair.psd.mtimeMs,
          modes: { typeset: status === 'done' }
        })
      }
    }
    this.psdStatusOverrides = next
    this.psdModeStatuses = nextModes
    this.psdModeTimestamps = nextTimestamps
    if (migrationUpdates.length > 0 && typeof window.comicType?.memorySetStatuses === 'function') {
      await window.comicType.memorySetStatuses(
        child.id,
        child.folderPath,
        toPlain(migrationUpdates),
        // 迁移写回也留痕（kind='migrate'）：它本身幂等，但"库变了却没有记录"最难查。
        { opId: createMarkOperationId(), kind: 'migrate', source: 'migrate' }
      )
    }
  },
  async rememberStatuses(
    this: WorkspaceContext,
    child: ChildProject,
    pairs: JpgPsdPair[],
    status: PsdStatusOverride,
    modes?: Partial<Record<WorkMode, boolean>>,
    audit?: MarkAuditContext
  ): Promise<void> {
    const actualPairs = pairs
    if (actualPairs.length === 0) return
    const next = { ...this.psdStatusOverrides }
    const nextModes = { ...this.psdModeStatuses }
    const nextTimestamps = { ...this.psdModeTimestamps }

    // 写库载荷在这里**同时**建好：每一步的"内存值"与"要写进库里的值"同源，
    // 不靠事后回查（回查要写一个兜底值，而兜底值的方向一旦写错 —— 比如把
    // "已完成"兜成 0 —— 主进程会把时间戳**删掉**，已完成就被算成 0）。
    const updates: ProjectMemoryStatusUpdate[] = []
    // 补丁形状：只带本次真正要改的模式。`typeset` 必须显式给 —— 主进程现在只在
    // "完全没带 modes"时才用 legacy status 推 typeset（database.ts），
    // 少了它，「标记嵌字」会静默不生效。
    const modePatch: Partial<Record<WorkMode, boolean>> = { ...(modes ?? {}) }
    if (modes?.typeset === undefined) modePatch.typeset = status === 'done'

    for (const pair of actualPairs) {
      next[pair.psd.absPath] = status
      const currentModes = this.psdModeStatuses[pair.psd.absPath] ?? createEmptyModeStatus()
      const merged = { ...currentModes, ...(modes ?? {}) }
      if (modes?.typeset === undefined) merged.typeset = status === 'done'
      nextModes[pair.psd.absPath] = normalizeModeStatus(merged)

      const doneAt = Date.now()
      const currentTimestamps = { ...(this.psdModeTimestamps[pair.psd.absPath] ?? {}) }
      if (status === 'done') currentTimestamps.typeset = doneAt
      else delete currentTimestamps.typeset
      nextTimestamps[pair.psd.absPath] = currentTimestamps

      updates.push({
        pathKey: normalizePathForLookup(pair.psd.absPath),
        path: pair.psd.absPath,
        status,
        mtimeMs: pair.psd.mtimeMs,
        modes: modePatch,
        // 与上面的内存值同一个 `doneAt`；pending 写 0（主进程把 0 当"清掉该模式的时间戳"）。
        modeTimestamps: { typeset: status === 'done' ? doneAt : 0 }
      })
    }
    this.psdStatusOverrides = next
    this.psdModeStatuses = nextModes
    this.psdModeTimestamps = nextTimestamps

    if (typeof window.comicType?.memorySetStatuses === 'function') {
      await window.comicType.memorySetStatuses(child.id, child.folderPath, toPlain(updates), audit)
    } else {
      // Compatibility fallback for tests and older preload bridges.
      await window.comicType.storeSet(PSD_STATUS_OVERRIDES_KEY, next)
    }
  },
  async rememberModeStatuses(
    this: WorkspaceContext,
    child: ChildProject,
    pairs: JpgPsdPair[],
    mode: WorkMode,
    value: boolean,
    audit?: MarkAuditContext
  ): Promise<void> {
    const actualPairs = pairs
    if (actualPairs.length === 0) return

    const nextModes = { ...this.psdModeStatuses }
    const nextLegacy = { ...this.psdStatusOverrides }
    const nextTimestamps = { ...this.psdModeTimestamps }

    const updates = actualPairs.map((pair) => {
      const pathKey = normalizePathForLookup(pair.psd.absPath)
      const currentModes =
        this.psdModeStatuses[pair.psd.absPath] ?? pair.psd.modes ?? createEmptyModeStatus()
      const modes = normalizeModeStatus({ ...currentModes, [mode]: value })
      const legacyStatus = modeStatusToLegacyStatus(modes)

      const at = Date.now()
      const currentTimestamps = { ...(this.psdModeTimestamps[pair.psd.absPath] ?? {}) }
      if (value) currentTimestamps[mode] = at
      else delete currentTimestamps[mode]

      nextModes[pair.psd.absPath] = modes
      nextLegacy[pair.psd.absPath] = legacyStatus
      nextTimestamps[pair.psd.absPath] = currentTimestamps

      return {
        pathKey,
        path: pair.psd.absPath,
        status: legacyStatus,
        mtimeMs: pair.psd.mtimeMs,
        // 补丁：只带本次要改的那一个模式。库里其它模式由主进程按 patch 合并保留
        // —— 整份发过去就等于"把别的模式也重写一遍"，客户端内存里那份一旦不新鲜
        // 就会静默抹掉用户的标记（2026-09-26 的现场）。
        modes: { [mode]: value },
        // 与上面写进内存的时间戳是**同一个值**；取消标记写 0（主进程把 0 当"清掉"）。
        modeTimestamps: { [mode]: value ? at : 0 }
      }
    })

    this.psdModeStatuses = nextModes
    this.psdStatusOverrides = nextLegacy
    this.psdModeTimestamps = nextTimestamps

    if (typeof window.comicType?.memorySetStatuses === 'function') {
      await window.comicType.memorySetStatuses(child.id, child.folderPath, toPlain(updates), audit)
    } else {
      await window.comicType.storeSet(PSD_STATUS_OVERRIDES_KEY, nextLegacy)
    }
  },
  async ensurePsdStatusOverridesLoaded(this: WorkspaceContext): Promise<void> {
    if (this.psdStatusOverridesLoaded) return
    const raw = await window.comicType.storeGet(PSD_STATUS_OVERRIDES_KEY)
    this.psdStatusOverrides = hydrateOverrides(raw)
    this.psdStatusOverridesLoaded = true
  },
  async reloadPsdStatusOverrides(this: WorkspaceContext): Promise<void> {
    this.psdStatusOverridesLoaded = false
    this.psdStatusOverrides = {}
    this.psdModeStatuses = {}
    this.psdModeTimestamps = {}
    await this.ensurePsdStatusOverridesLoaded()
  },
  applyPsdStatusOverrides(this: WorkspaceContext, pairs: JpgPsdPair[]): JpgPsdPair[] {
    return pairs.map((pair) =>
      applyOverrideToPair(
        pair,
        this.psdStatusOverrides[pair.psd.absPath],
        this.psdModeStatuses[pair.psd.absPath],
        this.psdModeTimestamps[pair.psd.absPath]
      )
    )
  },
  async markChildProjects(
    this: WorkspaceContext,
    childIds: string[],
    status: PsdStatusOverride,
    mode: WorkMode = 'typeset'
  ): Promise<{ cancelled: boolean; marked: number; skipped: string[] }> {
    await this.ensurePsdStatusOverridesLoaded()
    const selectedIds = new Set(childIds)
    const scans: Array<{
      parentId: string
      childId: string
      pairs: JpgPsdPair[]
    }> = []

    const targets = this.parents.flatMap((parent) =>
      parent.children
        .filter((child) => selectedIds.has(child.id))
        .map((child) => ({ parentId: parent.id, child }))
    )
    // 目录读不到、这次取数失败的子项目（标题）—— 跳过它们，并如实报给调用方。
    const skippedTitles: string[] = []
    const concurrency = 4
    for (let offset = 0; offset < targets.length; offset += concurrency) {
      const chunk = targets.slice(offset, offset + concurrency)
      const results = await Promise.all(
        chunk.map(async ({ parentId, child }) => {
          try {
            const scan = await window.comicType.scanChildProject(child.folderPath)
            // ⚠️ 0 页 + 有错误 ≠ "这一话有 0 个文件"（2026-09-30 审查 high）：scanner
            // 读不到目录时不抛错、只把错误塞进 errors[] 返回空列表。照旧往下走会写
            // psdStats=[]/statsVersion=PAIRED 落库 → 侧栏永久 0/0 且不再补算。
            if (scan.errors.length > 0 || (scan.status && scan.status !== 'complete')) {
              skippedTitles.push(child.projectTitle)
              writeWorkspaceLog('warn', 'Batch project status scan skipped (unreadable)', {
                childId: child.id,
                folderPath: child.folderPath,
                errorCount: scan.errors.length
              })
              return null
            }
            return { parentId, childId: child.id, pairs: scan.jpgPairs }
          } catch (error) {
            writeWorkspaceLog('warn', 'Batch project status scan failed', {
              childId: child.id,
              folderPath: child.folderPath,
              error: error instanceof Error ? error.message : String(error)
            })
            return null
          }
        })
      )
      scans.push(
        ...results.filter((result): result is NonNullable<typeof result> => result !== null)
      )
    }

    // The "no PSD" guard protects the auto-derived typeset state only; the
    // other modes are explicit flags and can never be undone by re-scanning.
    if (status === 'done' && mode === 'typeset') {
      const hasNoPsdChild = scans.some(
        (scanned) =>
          !scanned.pairs.some(
            (pair) => !pair.previewOnly && pair.psd.absPath.toLocaleLowerCase().endsWith('.psd')
          )
      )
      if (hasNoPsdChild) {
        const confirmed = await confirmAction(
          '该子项目无 PSD 文件，强制标记为已嵌字可能导致后续无法还原。确认继续吗？'
        )
        if (!confirmed) return { cancelled: true, marked: 0, skipped: [] }
      }
    }

    // 一次批量 = **一条台账**：逐话写库，但共享同一个 opId
    // （否则一次点击会在台账里变成十几条散记录，"撤销上一次"就失去了意义）。
    const audit: MarkAuditContext = {
      opId: createMarkOperationId(),
      kind: 'mark',
      source: 'sidebar-batch',
      mode,
      targetStatus: status
    }
    let psdCount = 0
    for (const scanned of scans) {
      const actualPairs = scanned.pairs
      psdCount += actualPairs.length
      // ⚠️ 每次都按 id **重取** child：下面每个 await 期间都可能并发跑到
      // `persistParentsProgress()`，而它会把 `this.parents` 整棵树换成**新对象**。
      // 抱着旧引用写字段，成果会落在孤儿对象上，随后落盘的是新对象里那份**旧计数**
      // （标记是对的，侧栏/首页的数字却退回标记前，重启也不自修）。见 2026-09-30 审查 high。
      const child = this.findChild(scanned.childId)
      if (!child) continue
      // ★ 先把这一话「已记住的标记」读进内存，再做下面的合并。
      //   批量操作不会（也不该）先逐话打开，而那份记录只在单话的 scanChild() 里加载；
      //   不先加载的话，rememberModeStatuses 的合并底稿会落到"四个模式全 false"，
      //   写库时把**其它模式**的标记一起抹掉 —— 2026-09-26 现场：15 话 / 153 个文件的
      //   「监修」被清空。回归锁见 __tests__/projectWorkspace-batch-mark.spec.ts。
      await this.loadRememberedStatuses(child, actualPairs)
      if (mode === 'typeset') {
        await this.rememberStatuses(child, actualPairs, status, undefined, audit)
      } else {
        await this.rememberModeStatuses(child, actualPairs, mode, status === 'done', audit)
      }
      // ★ 写完之后**再从库里读一遍**，派生缓存（侧栏/成就的数字）以"库里的合并结果"为准。
      //   上面那次读取只当合并底稿；在"读底稿 → 写库"这几十毫秒里，别的实例可能刚改过
      //   同一批行（dev 与打包版共用同一份 SQLite，见交接文档 §9.5）。那种情况下
      //   "客户端内存自己合并出来的那份"会与库不一致：**库是对的，侧栏却显示 0**。
      //   多一次 memoryGetProject 换"显示口径 = 库口径"，值得 —— 批量标记是低频操作，
      //   而且它本来就已经逐话做过一次完整目录扫描。
      //   （重取放在**最后一次 await 之后、写入之前** —— 上面两条注释说的那次换身份
      //   就发生在这些 await 里，早一步重取都还会拿到旧对象。）
      await this.loadRememberedStatuses(child, actualPairs)
      const fresh = this.findChild(scanned.childId) ?? child
      const pairs = this.applyPsdStatusOverrides(actualPairs)
      fresh.psdStats = psdStatsFromPairs(pairs)
      fresh.statsVersion = PAIRED_PSD_STATS_VERSION
      fresh.psdModeStats = modeStatsFromPairs(pairs)
      fresh.modeStatsVersion = PAIRED_MODE_STATS_VERSION
      fresh.lastMtimeMs = latestPairMtime(pairs)
    }

    await this.persistParentsProgress()
    void useAchievementsStore().refresh()
    return { cancelled: false, marked: psdCount, skipped: skippedTitles }
  },
  async listMarkAudit(this: WorkspaceContext, limit = 100): Promise<MarkAuditOperation[]> {
    if (typeof window.comicType?.memoryListMarkAudit !== 'function') return []
    try {
      return await window.comicType.memoryListMarkAudit(limit)
    } catch (error) {
      writeWorkspaceLog('warn', 'Mark audit list failed', {
        message: error instanceof Error ? error.message : String(error)
      })
      return []
    }
  },
  async findUndoableMark(this: WorkspaceContext): Promise<MarkAuditOperation | null> {
    if (typeof window.comicType?.memoryFindUndoableMark !== 'function') return null
    try {
      return await window.comicType.memoryFindUndoableMark()
    } catch {
      return null
    }
  },
  async undoMarkOperation(
    this: WorkspaceContext,
    opId: string
  ): Promise<MarkWriteBackResult | null> {
    if (typeof window.comicType?.memoryUndoMark !== 'function') return null
    const result = await window.comicType.memoryUndoMark(opId)
    for (const childId of result.childIds) {
      const child = this.findChild(childId)
      // scanChild 现在对"目录读不到"会抛错（见 2026-09-30 审查 high：不能把取数失败
      // 记成 0 页）—— 撤销已经把库写对了，这里某一话重算失败不该让整次撤销报错。
      if (child) {
        try {
          await this.scanChild(child)
        } catch (error) {
          writeWorkspaceLog('warn', 'Undo rescan skipped', {
            childId,
            error: error instanceof Error ? error.message : String(error)
          })
        }
      }
    }
    await this.persistParentsProgress()
    void useAchievementsStore().refresh()
    return result
  }
}
