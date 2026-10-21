import { DatabaseSync } from 'node:sqlite';
import { getDatabase } from './connection';
import { storedModeStatus, normalizeModeTimestamps } from '@shared/modes';
import type { WorkMode } from '@shared/types';

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
/**
 * 从**任意一份**库文件里按话汇总标记记录。
 *
 * 抽出来是为了"导入别人的数据库"那条路（2026-10-05）：对方不必升级到同一版本，
 * 把 `data\database\qianzi-gongfang.sqlite` 拷过来就能比 —— 我们只读地开他的库、
 * 跑**同一段**汇总查询，绝不碰他的项目树，也绝不写回。
 */
export function collectMarkStatisticsFrom(
  database: DatabaseSync
): import('@shared/ipc-api').ChildMarkStatistics[] {
  const hasDates = !!database
    .prepare("SELECT name FROM sqlite_master WHERE name = 'statistics_time_pages'")
    .get();
  const dateRows = hasDates
    ? (database.prepare('SELECT * FROM statistics_time_pages').all() as unknown as {
        child_id: string;
        path_key: string;
        mode: string;
        at: number;
        source: string;
        mark_at: number;
      }[])
    : [];
  const dates = new Map(
    dateRows.map((row) => [JSON.stringify([row.child_id, row.path_key, row.mode]), row])
  );
  const rows = database
    .prepare(
      `
      SELECT f.child_id AS child_id, f.path_key AS path_key,
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
    path_key: string;
    child_id: string;
    folder_path: string;
    status: string;
    updated_at: number;
    mode_statuses_json: string | null;
    mode_timestamps_json: string | null;
  }>;

  const allModes: WorkMode[] = ['typeset', 'translated', 'proofread', 'supervised'];
  const byChild = new Map<string, import('@shared/ipc-api').ChildMarkStatistics>();

  for (const row of rows) {
    let stat = byChild.get(row.child_id);
    if (!stat) {
      stat = {
        childId: row.child_id,
        folderPath: row.folder_path,
        fileCount: 0,
        completedTimestamps: { typeset: [], translated: [], proofread: [], supervised: [] },
        datedEntries: {},
        lastOperationAtByMode: {}
      };
      byChild.set(row.child_id, stat);
    }
    stat.fileCount++;

    const modes = storedModeStatus(row.mode_statuses_json, row.status);

    let timestamps: Record<string, number> = {};
    if (row.mode_timestamps_json) {
      try {
        timestamps = normalizeModeTimestamps(JSON.parse(row.mode_timestamps_json)) as Record<
          string,
          number
        >;
      } catch {
        // 同上。
      }
    }

    for (const mode of allModes) {
      if (!modes[mode]) continue;
      const assignment = dates.get(JSON.stringify([row.child_id, row.path_key, mode]));
      const original = timestamps[mode] || row.updated_at;
      stat.lastOperationAtByMode![mode] = Math.max(
        stat.lastOperationAtByMode![mode] ?? 0,
        original
      );
      const recorded =
        assignment && (!timestamps[mode] || assignment.mark_at === original)
          ? assignment.at
          : original;
      (stat.datedEntries![mode] ??= []).push({
        at: recorded,
        source:
          assignment && (!timestamps[mode] || assignment.mark_at === original)
            ? (assignment.source as import('@shared/statistics-time').StatisticsTimeSource)
            : 'mark'
      });
      stat.completedTimestamps[mode].push(
        typeof recorded === 'number' && recorded > 0 ? recorded : row.updated_at
      );
    }
  }

  if (database.prepare("SELECT name FROM sqlite_master WHERE name = 'mark_audit'").get()) {
    const operations = database
      .prepare(
        "SELECT child_id, mode, MAX(at) AS at FROM mark_audit WHERE mode IS NOT NULL AND entries_json != '[]' AND source != 'statistics-time' GROUP BY child_id, mode"
      )
      .all() as { child_id: string; mode: WorkMode; at: number }[];
    for (const operation of operations) {
      const stat = byChild.get(operation.child_id);
      if (stat && allModes.includes(operation.mode))
        stat.lastOperationAtByMode![operation.mode] = Math.max(
          stat.lastOperationAtByMode![operation.mode] ?? 0,
          operation.at
        );
    }
  }
  if (database.prepare("SELECT name FROM sqlite_master WHERE name = 'key_value_store'").get()) {
    const projectRow = database
      .prepare("SELECT value_json FROM key_value_store WHERE key = 'projects'")
      .get() as { value_json: string } | undefined;
    if (projectRow) {
      try {
        const parents = JSON.parse(
          projectRow.value_json
        ) as import('@shared/types').ParentProject[];
        for (const child of parents.flatMap((p) => p.children)) {
          const stat = byChild.get(child.id);
          if (stat) stat.fileCount = Math.max(stat.fileCount, child.psdStats?.length ?? 0);
        }
      } catch {
        /* Existing records remain available even if the tree is damaged. */
      }
    }
  }
  for (const stat of byChild.values()) {
    for (const mode of allModes) stat.completedTimestamps[mode].sort((a, b) => a - b);
  }
  return [...byChild.values()];
}

/** 成就页 / 首页的取数入口：读**当前**这个库。 */
export async function collectChildMarkStatistics(): Promise<
  import('@shared/ipc-api').ChildMarkStatistics[]
> {
  return collectMarkStatisticsFrom(await getDatabase());
}
