import { DatabaseSync } from 'node:sqlite'
import { createEmptyModeStatus, normalizeModeStatus, normalizeModeTimestamps } from '@shared/modes'
import type { MarkSnapshot } from '@shared/mark-audit'
import { getDatabase } from './connection'

/**
 * 标记快照 —— 2026-10-02 P4 第六刀（收官）从 `services/database.ts` 切出来的最后一块。
 *
 * 快照是"某一刻整库标记长什么样"的一份只读视图，**还原预览**靠它比差异：
 * 「现在」那一侧走 `currentMarkSnapshot()`，「备份文件」那一侧走
 * `readMarkSnapshotFromFile()`（**只读打开、读完就关**）。
 *
 * `writeDatabaseSnapshotTo()` 也在这里：`VACUUM INTO` 会把 WAL 里的内容一起写进目标文件
 * （备份文件要能独立复原，不能只有主库没有 -wal 里的那部分）。
 *
 * 对外的 import 路径没变：`./database` 仍然把这些名字 re-export 出去。
 */

/** 把一行 `project_memory_files` 解析成快照里的一份值（与读项目记忆同一套口径）。 */
function snapshotFileFromRow(row: {
  path: string
  mtime_ms: number
  status: string
  mode_statuses_json: string | null
  mode_timestamps_json: string | null
}): MarkSnapshot['children'][string]['files'][string] {
  let modes = createEmptyModeStatus()
  if (row.mode_statuses_json) {
    try {
      modes = normalizeModeStatus(JSON.parse(row.mode_statuses_json))
    } catch {
      // 损坏的 JSON 回退为空状态。
    }
  } else {
    modes.typeset = row.status === 'done'
  }
  let timestamps: MarkSnapshot['children'][string]['files'][string]['timestamps'] = {}
  if (row.mode_timestamps_json) {
    try {
      timestamps = normalizeModeTimestamps(
        JSON.parse(row.mode_timestamps_json)
      ) as MarkSnapshot['children'][string]['files'][string]['timestamps']
    } catch {
      // 同上。
    }
  }
  return { path: row.path, mtimeMs: row.mtime_ms, modes, timestamps }
}

function readMarkSnapshot(database: DatabaseSync): MarkSnapshot {
  const projects = database
    .prepare('SELECT child_id, folder_path FROM project_memory')
    .all() as Array<{ child_id: string; folder_path: string }>
  const files = database
    .prepare(
      `
      SELECT child_id, path_key, path, status, mtime_ms, mode_statuses_json, mode_timestamps_json
      FROM project_memory_files
    `
    )
    .all() as Array<{
    child_id: string
    path_key: string
    path: string
    status: string
    mtime_ms: number
    mode_statuses_json: string | null
    mode_timestamps_json: string | null
  }>

  const children: MarkSnapshot['children'] = {}
  for (const project of projects) {
    children[project.child_id] = { folderPath: project.folder_path, files: {} }
  }
  for (const row of files) {
    if (!children[row.child_id]) {
      // 理论上外键保证不会出现；真出现了也别丢数据。
      children[row.child_id] = { folderPath: '', files: {} }
    }
    children[row.child_id].files[row.path_key] = snapshotFileFromRow(row)
  }
  return { children }
}

/** 当前库的标记快照（还原预览的"现在"那一侧）。 */
export async function currentMarkSnapshot(): Promise<MarkSnapshot> {
  return readMarkSnapshot(await getDatabase())
}

/** 从**另一份数据库文件**读标记快照（备份文件那一侧）：只读打开，读完就关。 */
export function readMarkSnapshotFromFile(filePath: string): MarkSnapshot {
  const external = new DatabaseSync(filePath, { readOnly: true })
  try {
    return readMarkSnapshot(external)
  } finally {
    external.close()
  }
}

/** 备份用的一致性快照：`VACUUM INTO` 会把 WAL 里的内容一起写进目标文件。 */
export async function writeDatabaseSnapshotTo(filePath: string): Promise<void> {
  const database = await getDatabase()
  const escaped = filePath.replace(/'/g, "''")
  database.exec(`VACUUM INTO '${escaped}'`)
}
