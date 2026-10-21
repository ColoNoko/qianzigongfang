import { syncStatisticsTime } from './statistics-time-store'
import { getDatabase } from './connection'
import type {
  ProjectMemory,
  ProjectMemoryFileStatus,
  ProjectMemoryStatusUpdate
} from '@shared/ipc-api'
import {
  storedModeStatus,
  modeStatusToLegacyStatus,
  normalizeModeStatus,
  normalizeModeTimestamps
} from '@shared/modes'
import { didEntryChange, type MarkAuditContext, type MarkAuditEntry } from '@shared/mark-audit'
import type { WorkMode } from '@shared/types'

/**
 * 单话标记（项目记忆，"这一话哪几张图完成到哪个模式"）—— 2026-10-02 P4 第三刀从
 * `services/database.ts` 切出来的第三块。
 *
 * 这里只管 `project_memory` / `project_memory_files` 两张表的读写；统计、台账、快照
 * 留在 `./database`，键值设置在 `./key-value`。
 *
 * ⚠️ **写库是"补丁合并"，不是覆盖**（见下面那段契约注释）—— 这是 2026-09-26 那次
 * "批量标记把 15 话的「监修」静默清空"的成因所在，改动这里之前先看那条注释。
 *
 * 对外的 import 路径没变：`./database` 仍然把这些名字 re-export 出去。
 */

export async function getStoredProjectMemory(childId: string): Promise<ProjectMemory | null> {
  const database = await getDatabase()
  const project = database
    .prepare('SELECT folder_path, updated_at FROM project_memory WHERE child_id = ?')
    .get(childId) as { folder_path: string; updated_at: number } | undefined
  if (!project) return null

  const rows = database
    .prepare(
      `
      SELECT path_key, path, status, mtime_ms, updated_at, mode_statuses_json, mode_timestamps_json
      FROM project_memory_files
      WHERE child_id = ?
    `
    )
    .all(childId) as Array<{
    path_key: string
    path: string
    status: 'done' | 'pending'
    mtime_ms: number
    updated_at: number
    mode_statuses_json: string | null
    mode_timestamps_json: string | null
  }>
  const files: Record<string, ProjectMemoryFileStatus> = {}
  for (const row of rows) {
    const modes = storedModeStatus(row.mode_statuses_json, row.status)

    let modeTimestamps = {}
    if (row.mode_timestamps_json) {
      try {
        modeTimestamps = normalizeModeTimestamps(JSON.parse(row.mode_timestamps_json))
      } catch {
        // 损坏的 JSON 回退为空。
      }
    }

    files[row.path_key] = {
      path: row.path,
      status: row.status,
      mtimeMs: row.mtime_ms,
      updatedAt: row.updated_at,
      modes,
      modeTimestamps
    }
  }
  return {
    childId,
    folderPath: project.folder_path,
    updatedAt: project.updated_at,
    files
  }
}

export async function setStoredProjectMemoryStatuses(
  childId: string,
  folderPath: string,
  updates: ProjectMemoryStatusUpdate[],
  audit?: MarkAuditContext
): Promise<void> {
  const database = await getDatabase()
  const now = Date.now()
  // 台账条目：只记**真的改了**的（模式或时间戳任一变化），其余只计数。
  const auditEntries: MarkAuditEntry[] = []
  let auditSkipped = 0
  database.exec('BEGIN IMMEDIATE')
  try {
    database
      .prepare(
        `
        INSERT INTO project_memory (child_id, folder_path, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(child_id) DO UPDATE SET
          folder_path = excluded.folder_path,
          updated_at = excluded.updated_at
      `
      )
      .run(childId, folderPath, now)
    const statement = database.prepare(`
      INSERT INTO project_memory_files
        (child_id, path_key, path, status, mtime_ms, updated_at, mode_statuses_json, mode_timestamps_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(child_id, path_key) DO UPDATE SET
        path = excluded.path,
        status = excluded.status,
        mtime_ms = excluded.mtime_ms,
        updated_at = excluded.updated_at,
        mode_statuses_json = excluded.mode_statuses_json,
        mode_timestamps_json = excluded.mode_timestamps_json
    `)
    const existingModesStatement = database.prepare(`
      SELECT mode_statuses_json, mode_timestamps_json, mtime_ms, status, updated_at
      FROM project_memory_files
      WHERE child_id = ? AND path_key = ?
    `)
    for (const update of updates) {
      let existingTimestamps: Record<string, number> = {}
      const existing = existingModesStatement.get(childId, update.pathKey) as
        | {
            mode_statuses_json: string | null
            mode_timestamps_json: string | null
            status: string
            updated_at: number
            mtime_ms: number | null
          }
        | undefined
      const existingModes = storedModeStatus(existing?.mode_statuses_json, existing?.status)
      if (existing?.mode_timestamps_json) {
        try {
          existingTimestamps = normalizeModeTimestamps(
            JSON.parse(existing.mode_timestamps_json)
          ) as Record<string, number>
        } catch {
          // 损坏的 JSON 回退为空。
        }
      }

      // Freeze the legacy fallback before this row's updated_at changes.
      for (const mode of Object.keys(existingModes) as WorkMode[]) {
        if (existingModes[mode] && !existingTimestamps[mode] && existing?.updated_at) {
          existingTimestamps[mode] = existing.updated_at
        }
      }

      // `update.modes` 是**补丁**：只带本次真正要改的模式，其余字段留给库里已有的值
      // （契约见 ProjectMemoryStatusUpdate）。所以这里是"合并"，不是覆盖。
      //
      // 契约只区分两件事，别再往里加第三种解读：
      //   · 带了 modes（**包括空对象 `{}`**）→ 只按补丁合并，typeset 不动；
      //     `{}` 的语义是"什么都不改"，不是"用 status 推 typeset"。
      //   · 没带 modes（undefined / null 等）→ 旧式写入（例如 stores/project.ts 的
      //     旧数据迁移），用 legacy 的 `status` 字段推 typeset。
      //
      // 这条判断不能放宽成 `update.modes?.typeset === undefined` —— 那样"只改校对"的
      // 补丁会把「嵌字」一起推成 false，正是 2026-09-26 那次批量标记抹掉 15 话标记的成因。
      // 反过来收成 `update.modes === undefined` 只影响 null 这类畸形载荷：那时按旧式
      // 推断（宽松）比"静默什么都不改"安全，所以维持 `!update.modes`。
      const merged = { ...existingModes, ...(update.modes ?? {}) }
      if (!update.modes) {
        merged.typeset = update.status === 'done'
      }
      const modes = normalizeModeStatus(merged)
      const legacyStatus = modeStatusToLegacyStatus(modes)

      const modeTimestamps = normalizeModeTimestamps({
        ...existingTimestamps,
        ...(update.modeTimestamps ?? {})
      })
      // 0 表示取消，移除该模式的完成时间。
      for (const key of Object.keys(modeTimestamps)) {
        if (modeTimestamps[key as WorkMode] === 0) {
          delete modeTimestamps[key as WorkMode]
        }
      }

      statement.run(
        childId,
        update.pathKey,
        update.path,
        legacyStatus,
        update.mtimeMs,
        now,
        JSON.stringify(modes),
        JSON.stringify(modeTimestamps)
      )

      syncStatisticsTime(database, childId, update.pathKey, update.path, modes, modeTimestamps, now)

      if (audit) {
        const entry: MarkAuditEntry = {
          pathKey: update.pathKey,
          path: update.path,
          // 还原时写回这个 mtime：它是"这行标记属于哪个版本的文件"的信息，
          // 用当前时间去覆盖它会把这层信息抹掉。
          mtimeMs: existing?.mtime_ms ?? update.mtimeMs,
          beforeModes: existingModes,
          afterModes: modes,
          beforeTimestamps: existingTimestamps as MarkAuditEntry['beforeTimestamps'],
          afterTimestamps: modeTimestamps as MarkAuditEntry['afterTimestamps']
        }
        if (didEntryChange(entry)) auditEntries.push(entry)
        else auditSkipped++
      }
    }

    if (audit && auditEntries.length > 0) {
      database
        .prepare(
          `
          INSERT INTO mark_audit
            (op_id, at, kind, source, mode, target_status, ref_op_id, note,
             child_id, folder_path, entries_json, skipped)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
        )
        .run(
          audit.opId,
          now,
          audit.kind,
          audit.source,
          audit.mode ?? null,
          audit.targetStatus ?? null,
          audit.refOpId ?? null,
          audit.note ?? null,
          childId,
          folderPath,
          JSON.stringify(auditEntries),
          auditSkipped
        )
    }
    database.exec('COMMIT')
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
}

export async function removeStoredProjectMemory(childId: string): Promise<void> {
  const database = await getDatabase()
  database.prepare('DELETE FROM project_memory WHERE child_id = ?').run(childId)
}
