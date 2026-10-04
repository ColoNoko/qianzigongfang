/**
 * mark-audit —— 标记台账（谁在什么时候把哪个文件的哪个模式从什么改成了什么）。
 *
 * 存在理由：这个项目**真的丢过标记**（2026-09-26：一次批量标记把 15 话 / 153 个文件的
 * 「监修」静默写成了 false，其中 40 个的「校对」也没了）。当时只能靠出事前 23:32 的
 * 整库快照逐行反推 —— 因为库里只存"最后状态"，**没有历史**。
 *
 * 所以这里补三样东西：
 *   ① **流水**：每次写入都把"改之前 / 改之后"逐文件记下来（与标记写入**同一个事务**，见 database.ts）；
 *   ② **可撤销**：任何一条 `kind='mark'` 的操作都能按流水精确还原（模式 + 时间戳一起还原）；
 *   ③ **差异**：拿一份备份跟当前库比，只列出"会变的行"，用户看清楚再点确认。
 *
 * 本文件全部是纯函数 —— 规则要能被表格单测锁住，数据库那边只负责"按这些规则读写"。
 */
import type { ProjectMemoryStatusUpdate, RememberedPsdStatus } from './ipc-api'
import type { WorkMode, WorkModeStatus } from './types'
import { createEmptyModeStatus, modeStatusToLegacyStatus, normalizeModeStatus } from './modes'
import { WORK_MODE_LABELS } from './modes'

/** `migrate` 是旧数据迁移的写回（幂等、不改语义），记下来是为了台账不留空白，但它**不可撤销**。 */
export type MarkAuditKind = 'mark' | 'migrate' | 'undo' | 'restore'

export type MarkAuditSource =
  | 'card'
  | 'toolbar'
  | 'viewer'
  | 'sidebar-batch'
  | 'migrate'
  | 'undo'
  | 'restore'

/**
 * 一次**用户操作**的上下文。
 *
 * `opId` 由渲染层在一次操作开始时生成，并**贯穿该操作的所有子写入** ——
 * 侧栏批量标记会逐话调用 IPC，没有它，一次点击就会在台账里变成十几条散记录。
 */
export interface MarkAuditContext {
  opId: string
  kind: MarkAuditKind
  source: MarkAuditSource
  /** 本次操作针对的模式（批量/单条标记时有值）。 */
  mode?: WorkMode
  /** 本次操作的目标状态。 */
  targetStatus?: RememberedPsdStatus
  /** `kind='undo'` 指向被撤销的那次操作；`kind='restore'` 记备份文件名。 */
  refOpId?: string
  note?: string
}

/** 一个文件的一次改动（改前 / 改后都要，撤销才可能精确）。 */
export interface MarkAuditEntry {
  pathKey: string
  path: string
  mtimeMs: number
  beforeModes: WorkModeStatus
  afterModes: WorkModeStatus
  beforeTimestamps: Partial<Record<WorkMode, number>>
  afterTimestamps: Partial<Record<WorkMode, number>>
}

export interface MarkAuditChildGroup {
  childId: string
  folderPath: string
  entries: MarkAuditEntry[]
}

/** 台账里的一条 = 一次用户操作（可能跨多话）。 */
export interface MarkAuditOperation {
  opId: string
  at: number
  kind: MarkAuditKind
  source: MarkAuditSource
  mode?: WorkMode
  targetStatus?: RememberedPsdStatus
  refOpId?: string
  note?: string
  children: MarkAuditChildGroup[]
  /** 实际改动了的文件数。 */
  fileCount: number
  /** 本来就是目标状态、没动的文件数（让"我点了但台账里怎么没有"有答案）。 */
  skippedCount: number
}

const ALL_MODES: readonly WorkMode[] = ['typeset', 'translated', 'proofread', 'supervised']

/** 排序友好 + 可读的操作号（渲染层每次用户操作生成一个）。 */
export function createMarkOperationId(now = Date.now(), salt?: string): string {
  const tail = salt ?? Math.random().toString(36).slice(2, 8)
  return `${now}-${tail}`
}

function sameModes(a: WorkModeStatus, b: WorkModeStatus): boolean {
  return ALL_MODES.every((mode) => a[mode] === b[mode])
}

function sameTimestamps(
  a: Partial<Record<WorkMode, number>>,
  b: Partial<Record<WorkMode, number>>
): boolean {
  return ALL_MODES.every((mode) => (a[mode] ?? 0) === (b[mode] ?? 0))
}

/** 这条改动是不是真的改了东西（模式或时间戳任一变化都算）。 */
export function didEntryChange(entry: MarkAuditEntry): boolean {
  return (
    !sameModes(normalizeModeStatus(entry.beforeModes), normalizeModeStatus(entry.afterModes)) ||
    !sameTimestamps(entry.beforeTimestamps, entry.afterTimestamps)
  )
}

/** 台账条目的可读文案（界面与日志共用，别在两处各写一套）。 */
export function summarizeMarkOperation(operation: MarkAuditOperation): string {
  const modeLabel = operation.mode ? WORK_MODE_LABELS[operation.mode] : ''
  const cards = `${operation.fileCount} 个文件（${operation.children.length} 话）`
  switch (operation.kind) {
    case 'mark':
      return operation.targetStatus === 'done'
        ? `标记「${modeLabel}」${cards}`
        : `取消标记「${modeLabel}」${cards}`
    case 'undo':
      return `撤销一次标记操作：还原 ${cards}`
    case 'restore':
      return `从备份还原标记：写回 ${cards}`
    case 'migrate':
    default:
      return `旧数据迁移写回：${cards}`
  }
}

/** 只有"用户标记"能撤销；迁移写回与还原本身不可撤销（否则台账会被绕成圈）。 */
export function isUndoableOperation(operation: MarkAuditOperation): boolean {
  return operation.kind === 'mark' && operation.fileCount > 0
}

/**
 * 把一次操作还原成"写回载荷"（撤销 / 还原共用）。
 *
 * ⚠️ 这里**故意发整份 `modes`**，与 2026-09-26 那次事故的区别必须写清楚：
 *   · 事故是"**标记**时发整份" —— 那时客户端内存里那份可能是旧的，整份发过去就等于
 *     用旧值覆盖库里的其它模式，于是静默抹掉别人的标记；
 *   · 这里是"**还原**时发整份" —— 值直接来自台账里记的 `beforeModes`，
 *     而台账是主进程在写库那一刻、**从库里读出来**的，所以它才是"库里那一刻的真值"。
 *     撤销的全部意义就是精确还原四个模式，发补丁反而做不到（补丁表达不了"回到从前"）。
 * 时间戳同理：缺哪个模式就发 `0`（主进程把 0 当"删掉这个时间戳"），
 * 否则"取消标记后时间戳还留着"会让 §7.2 的按时间戳统计跟实际对不上。
 */
export function buildRestoreUpdates(
  operation: MarkAuditOperation
): Array<{ childId: string; folderPath: string; updates: ProjectMemoryStatusUpdate[] }> {
  return operation.children
    .map((child) => ({
      childId: child.childId,
      folderPath: child.folderPath,
      updates: child.entries.map((entry) => {
        const modes = normalizeModeStatus(entry.beforeModes)
        const timestamps: Partial<Record<WorkMode, number>> = {}
        for (const mode of ALL_MODES) {
          timestamps[mode] = entry.beforeTimestamps[mode] ?? 0
        }
        return {
          pathKey: entry.pathKey,
          path: entry.path,
          status: modeStatusToLegacyStatus(modes),
          mtimeMs: entry.mtimeMs,
          modes,
          modeTimestamps: timestamps
        }
      })
    }))
    .filter((group) => group.updates.length > 0)
}

/** 备份差异预览用的一行（一侧有、另一侧没有的情况单独报，**不猜**、也不删东西）。 */
export interface MarkRestoreDiffRow {
  pathKey: string
  path: string
  mtimeMs: number
  currentModes: WorkModeStatus
  backupModes: WorkModeStatus
  currentTimestamps: Partial<Record<WorkMode, number>>
  backupTimestamps: Partial<Record<WorkMode, number>>
}

export interface MarkRestoreDiffChild {
  childId: string
  folderPath: string
  /** 两边都有、且值不一样的（会被写回）。 */
  changing: MarkRestoreDiffRow[]
  /** 备份里没有这一行（备份之后新建的）→ 不动，只报数。 */
  missingInBackup: number
  /** 当前库里没有、备份里有（那一话被删过）→ 不动，只报数。 */
  missingInCurrent: number
}

export interface MarkRestoreDiff {
  children: MarkRestoreDiffChild[]
  changingFiles: number
  missingInBackup: number
  missingInCurrent: number
}

/** 台账/备份里的一份快照：childId → pathKey → 那一行的值。 */
export interface MarkSnapshotFile {
  path: string
  mtimeMs: number
  modes: WorkModeStatus
  timestamps: Partial<Record<WorkMode, number>>
}

export interface MarkSnapshot {
  children: Record<string, { folderPath: string; files: Record<string, MarkSnapshotFile> }>
}

/** 只列出"会变的行"。不认识的一律不动 —— 还原是保守操作，不做"以备份为准"的删除。 */
export function diffMarkSnapshots(current: MarkSnapshot, backup: MarkSnapshot): MarkRestoreDiff {
  const children: MarkRestoreDiffChild[] = []
  let changingFiles = 0
  let missingInBackup = 0
  let missingInCurrent = 0

  for (const childId of Object.keys(backup.children)) {
    const backupChild = backup.children[childId]
    const currentChild = current.children[childId]
    const changing: MarkRestoreDiffRow[] = []
    let childMissingInBackup = 0

    for (const pathKey of Object.keys(backupChild.files)) {
      const backupFile = backupChild.files[pathKey]
      const currentFile = currentChild?.files[pathKey]
      if (!currentFile) {
        missingInCurrent++
        continue
      }
      const before = normalizeModeStatus(currentFile.modes)
      const after = normalizeModeStatus(backupFile.modes)
      if (
        sameModes(before, after) &&
        sameTimestamps(currentFile.timestamps, backupFile.timestamps)
      ) {
        continue
      }
      changing.push({
        pathKey,
        path: currentFile.path,
        mtimeMs: currentFile.mtimeMs,
        currentModes: before,
        backupModes: after,
        currentTimestamps: currentFile.timestamps,
        backupTimestamps: backupFile.timestamps
      })
    }

    if (currentChild) {
      for (const pathKey of Object.keys(currentChild.files)) {
        if (!backupChild.files[pathKey]) {
          childMissingInBackup++
          missingInBackup++
        }
      }
    }

    changingFiles += changing.length
    if (changing.length > 0 || childMissingInBackup > 0) {
      children.push({
        childId,
        folderPath: currentChild?.folderPath ?? backupChild.folderPath,
        changing,
        missingInBackup: childMissingInBackup,
        missingInCurrent: 0
      })
    }
  }

  return { children, changingFiles, missingInBackup, missingInCurrent }
}

/** 把差异预览变成"写回载荷"（只动 changing 那些行）。 */
export function buildRestoreUpdatesFromDiff(
  diff: MarkRestoreDiff
): Array<{ childId: string; folderPath: string; updates: ProjectMemoryStatusUpdate[] }> {
  return diff.children
    .filter((child) => child.changing.length > 0)
    .map((child) => ({
      childId: child.childId,
      folderPath: child.folderPath,
      updates: child.changing.map((row) => {
        const modes = normalizeModeStatus(row.backupModes)
        const timestamps: Partial<Record<WorkMode, number>> = {}
        for (const mode of ALL_MODES) {
          timestamps[mode] = row.backupTimestamps[mode] ?? 0
        }
        return {
          pathKey: row.pathKey,
          path: row.path,
          status: modeStatusToLegacyStatus(modes),
          mtimeMs: row.mtimeMs,
          modes,
          modeTimestamps: timestamps
        }
      })
    }))
}

function basename(absPath: string): string {
  return absPath.split(/[\\/]/).pop() ?? absPath
}

/** 台账里"一条操作"的可读明细行（对话框用）：`012.psd  监修 ✗→✓`（完整路径放 title）。 */
export function describeMarkEntry(entry: MarkAuditEntry): string {
  const name = basename(entry.path)
  const changedModes = ALL_MODES.filter(
    (mode) => normalizeModeStatus(entry.beforeModes)[mode] !== normalizeModeStatus(entry.afterModes)[mode]
  )
  if (changedModes.length === 0) return `${name}（只有时间戳变化）`
  const changes = changedModes
    .map((mode) => {
      const before = normalizeModeStatus(entry.beforeModes)[mode] ? '✓' : '✗'
      const after = normalizeModeStatus(entry.afterModes)[mode] ? '✓' : '✗'
      return `${WORK_MODE_LABELS[mode]} ${before}→${after}`
    })
    .join(' · ')
  return `${name}  ${changes}`
}

/** 空模式状态（给测试与"没有旧值"的兜底用）。 */
export function emptyModeStatus(): WorkModeStatus {
  return createEmptyModeStatus()
}
