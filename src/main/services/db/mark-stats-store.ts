import { getDatabase } from './connection'
import { createEmptyModeStatus, normalizeModeStatus, normalizeModeTimestamps } from '@shared/modes'
import type { WorkMode } from '@shared/types'

/**
 * 标记统计层（成就 / 首页的数据源）—— 2026-10-02 P4 第四刀从 `services/database.ts`
 * 切出来的第四块。
 *
 * 这里只回答一个问题：**按话汇总标记记录**（每话的文件数 + 每个模式的完成时间列表）。
 * 台账 / 撤销 / 快照留在 `./database`，单话标记的读写在 `./project-memory-store`。
 *
 * 为什么读的是 `project_memory_files` 而不是项目树里的 `psdStats`：后者是"当前目录里有什么"
 * 的快照，删几张图历史就缩水（第十五轮换源的原因，见下）。
 *
 * 对外的 import 路径没变：`./database` 仍然把这个名字 re-export 出去。
 */

/**
 * 成就页的数据源：按话汇总**标记记录**（第十五轮）。
 *
 * 为什么不用项目树里的 `psdStats` / `psdModeStats`：那是"当前目录里有什么"的快照，
 * 删几张图历史就缩水。这里读的是 `project_memory_files`（按文件路径保存的标记 +
 * 每个模式的完成时间戳）—— 删图、挪目录都不影响它。
 *
 * 时间戳缺失的老记录回退到该行的 `updated_at`（"这行标记最后一次写入的时间"）：
 * 宁可粗一点，也不要让历史凭空少一截。
 */
export async function collectChildMarkStatistics(): Promise<
  import('@shared/ipc-api').ChildMarkStatistics[]
> {
  const database = await getDatabase()
  const rows = database
    .prepare(
      `
      SELECT f.child_id AS child_id,
             p.folder_path AS folder_path,
             f.status AS status,
             f.updated_at AS updated_at,
             f.mode_statuses_json AS mode_statuses_json,
             f.mode_timestamps_json AS mode_timestamps_json
      FROM project_memory_files f
      JOIN project_memory p ON p.child_id = f.child_id
      ORDER BY f.child_id, f.path_key
    `
    )
    .all() as Array<{
    child_id: string
    folder_path: string
    status: string
    updated_at: number
    mode_statuses_json: string | null
    mode_timestamps_json: string | null
  }>

  const allModes: WorkMode[] = ['typeset', 'translated', 'proofread', 'supervised']
  const byChild = new Map<string, import('@shared/ipc-api').ChildMarkStatistics>()

  for (const row of rows) {
    let stat = byChild.get(row.child_id)
    if (!stat) {
      stat = {
        childId: row.child_id,
        folderPath: row.folder_path,
        fileCount: 0,
        completedTimestamps: { typeset: [], translated: [], proofread: [], supervised: [] }
      }
      byChild.set(row.child_id, stat)
    }
    stat.fileCount++

    let modes = createEmptyModeStatus()
    if (row.mode_statuses_json) {
      try {
        modes = normalizeModeStatus(JSON.parse(row.mode_statuses_json))
      } catch {
        // 损坏的 JSON 回退为空状态（按下面的 legacy 规则推 typeset）。
      }
    } else {
      modes.typeset = row.status === 'done'
    }

    let timestamps: Record<string, number> = {}
    if (row.mode_timestamps_json) {
      try {
        timestamps = normalizeModeTimestamps(JSON.parse(row.mode_timestamps_json)) as Record<
          string,
          number
        >
      } catch {
        // 同上。
      }
    }

    for (const mode of allModes) {
      if (!modes[mode]) continue
      const recorded = timestamps[mode]
      stat.completedTimestamps[mode].push(
        typeof recorded === 'number' && recorded > 0 ? recorded : row.updated_at
      )
    }
  }

  for (const stat of byChild.values()) {
    for (const mode of allModes) stat.completedTimestamps[mode].sort((a, b) => a - b)
  }
  return [...byChild.values()]
}
