import { getDatabase, getDatabaseSync, writeValueToDatabase } from './connection'

/**
 * 键值设置层（2026-10-02 P4 第二刀：从 `database.ts` 里切出来的第二块）。
 *
 * 这里管**通用键值设置**（`key_value_store` 表）：主题、缩略图大小、窗口尺寸、最近项目……
 * 都是"一个 key → 一段 JSON"，没有领域语义 —— 领域查询（单话标记、统计、台账、撤销/还原、
 * 快照）留在 `./database`。
 *
 * 为什么跟着连接层走：这一层**只做一件小事**，却要在**应用退出那条不能 await 的路径**上用
 * （`setStoredValueSync`，窗口 `close` 处理器），它必须跟连接层共用**同一份连接状态**。
 *
 * 键值原语（`readValueFromDatabase` / `writeValueToDatabase`）留在 `./connection`：
 * 旧数据导入与迁移也用它们，放这边会和连接层互相 import 成环。
 *
 * 对外的 import 路径没变：`./database` 仍然把这些名字 re-export 出去。
 */

export async function getStoredValue(key: string): Promise<unknown> {
  const database = await getDatabase()
  const row = database.prepare('SELECT value_json FROM key_value_store WHERE key = ?').get(key) as
    { value_json?: string } | undefined
  if (!row?.value_json) return undefined
  try {
    return JSON.parse(row.value_json)
  } catch {
    return undefined
  }
}

export async function setStoredValue(key: string, value: unknown): Promise<void> {
  const database = await getDatabase()
  writeValueToDatabase(database, key, value)
}

/**
 * Write a key through the already-open connection, without awaiting anything.
 *
 * Used by the window's `close` handler: during quit the database may be closing
 * in parallel, and an awaited write can lose the race and land after
 * `closeDatabase()` has run. Returns false when no connection is cached (or the
 * write threw), so the caller can fall back to the async path.
 */
export function setStoredValueSync(key: string, value: unknown): boolean {
  const database = getDatabaseSync()
  if (!database) return false
  try {
    writeValueToDatabase(database, key, value)
    return true
  } catch {
    return false
  }
}
