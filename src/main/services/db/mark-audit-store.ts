import { DatabaseSync } from 'node:sqlite'
import { getDatabase } from './connection'
import { setStoredProjectMemoryStatuses } from './project-memory-store'
import {
  buildRestoreUpdates,
  createMarkOperationId,
  type MarkAuditContext,
  type MarkAuditEntry,
  type MarkAuditOperation
} from '@shared/mark-audit'
import type { MarkWriteBackResult, ProjectMemoryStatusUpdate } from '@shared/ipc-api'
import type { WorkMode } from '@shared/types'

/**
 * 标记台账 / 撤销 / 还原 —— 2026-10-02 P4 第五刀从 `services/database.ts` 切出来的第五块。
 *
 * 台账（`mark_audit` 表）是 2026-09-26 那次数据损坏事故之后立的规矩：
 * **每一笔写入都要留痕**（改之前 / 改之后 + 时间戳），**撤销按台账精确写回**，
 * 撤销 / 还原本身也留痕。这一块只做这件事；快照留在 `./database`。
 *
 * 它要写回标记 ⇒ 单向依赖 ./project-memory-store（那边只依赖连接层，不成环）。
 * 对外的 import 路径没变：`./database` 仍然把这些名字 re-export 出去。
 */

/**
 * 读一次操作的全部行（按话分组）。
 *
 * `fileCount` = 台账里"真的改了"的条目数；`skippedCount` = 本来就是目标状态的条目数
 * —— 后者是给"我点了批量标记，台账里怎么只有 3 个文件"准备的答案。
 */
function readMarkAuditOperation(database: DatabaseSync, opId: string): MarkAuditOperation | null {
  const rows = database
    .prepare(
      `
      SELECT at, kind, source, mode, target_status, ref_op_id, note,
             child_id, folder_path, entries_json, skipped
      FROM mark_audit
      WHERE op_id = ?
      ORDER BY id ASC
    `
    )
    .all(opId) as Array<{
    at: number
    kind: MarkAuditOperation['kind']
    source: MarkAuditOperation['source']
    mode: string | null
    target_status: string | null
    ref_op_id: string | null
    note: string | null
    child_id: string
    folder_path: string
    entries_json: string
    skipped: number
  }>
  if (rows.length === 0) return null

  const children: MarkAuditOperation['children'] = []
  let fileCount = 0
  let skippedCount = 0
  for (const row of rows) {
    let entries: MarkAuditEntry[] = []
    try {
      const parsed = JSON.parse(row.entries_json)
      if (Array.isArray(parsed)) entries = parsed as MarkAuditEntry[]
    } catch {
      // 台账里的 JSON 坏了也不能把界面打挂：当空处理，条数照旧统计。
    }
    fileCount += entries.length
    skippedCount += row.skipped
    children.push({ childId: row.child_id, folderPath: row.folder_path, entries })
  }

  const head = rows[0]
  return {
    opId,
    at: head.at,
    kind: head.kind,
    source: head.source,
    mode: (head.mode ?? undefined) as WorkMode | undefined,
    targetStatus: (head.target_status ?? undefined) as MarkAuditOperation['targetStatus'],
    refOpId: head.ref_op_id ?? undefined,
    note: head.note ?? undefined,
    children,
    fileCount,
    skippedCount
  }
}

/** 台账：最近若干次操作（新的在前）。 */
export async function listMarkAuditOperations(limit = 100): Promise<MarkAuditOperation[]> {
  const database = await getDatabase()
  const safeLimit = Math.max(1, Math.min(500, Math.floor(limit)))
  const ids = database
    .prepare(
      `
      SELECT op_id FROM mark_audit
      GROUP BY op_id
      ORDER BY MAX(at) DESC, MAX(id) DESC
      LIMIT ?
    `
    )
    .all(safeLimit) as Array<{ op_id: string }>
  const operations: MarkAuditOperation[] = []
  for (const row of ids) {
    const operation = readMarkAuditOperation(database, row.op_id)
    if (operation) operations.push(operation)
  }
  return operations
}

/**
 * 按 opId 取一条标记台账记录。
 *
 * ⚠️ 目前**只有测试在调**（生产侧走 `findUndoableMarkOperation` / `undoMarkOperation`）。
 * 保留而不删的理由：测试要按 opId **精确**取一条来断言"这一行写成什么样"，
 * 而 `listMarkAuditOperations()` 是**有上限**的列表 —— 拿它做断言会让用例随上限变脆。
 * 也就是说这是一条**有理由的测试缝**，不是忘了删的死码（2026-10-01 第一批 A3 判定）。
 */
export async function getMarkAuditOperation(opId: string): Promise<MarkAuditOperation | null> {
  const database = await getDatabase()
  return readMarkAuditOperation(database, opId)
}

/**
 * 最近一次**可撤销**的操作。
 *
 * 可撤销 = `kind='mark'`（用户标记，含批量）**且**还没有任何 `kind='undo'` 指向它。
 * 迁移写回、还原、撤销本身都不在候选里 —— 否则撤销可以被绕成圈。
 */
export async function findUndoableMarkOperation(): Promise<MarkAuditOperation | null> {
  const database = await getDatabase()
  const row = database
    .prepare(
      `
      SELECT r.op_id AS op_id
      FROM mark_audit r
      WHERE r.kind = 'mark'
        AND NOT EXISTS (
          SELECT 1 FROM mark_audit u WHERE u.kind = 'undo' AND u.ref_op_id = r.op_id
        )
      GROUP BY r.op_id
      ORDER BY MAX(r.at) DESC, MAX(r.id) DESC
      LIMIT 1
    `
    )
    .get() as { op_id: string } | undefined
  return row ? readMarkAuditOperation(database, row.op_id) : null
}

/** 按"写回载荷"逐话写库，并记一条台账（撤销 / 还原共用）。 */
async function applyMarkWriteBack(
  groups: Array<{ childId: string; folderPath: string; updates: ProjectMemoryStatusUpdate[] }>,
  context: Omit<MarkAuditContext, 'opId'>,
  refOpId: string
): Promise<MarkWriteBackResult> {
  const opId = createMarkOperationId()
  const childIds: string[] = []
  for (const group of groups) {
    await setStoredProjectMemoryStatuses(group.childId, group.folderPath, group.updates, {
      ...context,
      opId,
      refOpId
    })
    childIds.push(group.childId)
  }
  const database = await getDatabase()
  const operation = readMarkAuditOperation(database, opId)
  return {
    // 回执报"真的改回来几个"，而不是"尝试写几个"——台账里那条 undo 的 fileCount 就是它。
    revertedFiles: operation?.fileCount ?? 0,
    childIds,
    operation
  }
}

/** 撤销一次标记操作：按台账把「改之前」的模式与时间戳精确写回。 */
export async function undoMarkOperation(opId: string): Promise<MarkWriteBackResult> {
  const database = await getDatabase()
  const operation = readMarkAuditOperation(database, opId)
  if (!operation) throw new Error(`台账里没有这次操作：${opId}`)
  if (operation.kind !== 'mark') throw new Error('只有「标记」类操作可以撤销')
  return applyMarkWriteBack(buildRestoreUpdates(operation), { kind: 'undo', source: 'undo' }, opId)
}

/** 按备份差异写回标记（写回载荷已由纯函数从差异算好）。 */
export async function applyMarkRestore(
  groups: Array<{ childId: string; folderPath: string; updates: ProjectMemoryStatusUpdate[] }>,
  backupFile: string
): Promise<MarkWriteBackResult> {
  return applyMarkWriteBack(
    groups,
    { kind: 'restore', source: 'restore', note: backupFile },
    backupFile
  )
}
