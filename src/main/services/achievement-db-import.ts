/**
 * achievement-db-import —— 「导入别人的数据库文件」（2026-10-05 用户拍板 A 方案）。
 *
 * 为什么需要它：对面的朋友可能还在老版本或别的分支（例如 0.4.0 的干净分享包），
 * **没有导出功能**。逼他升级是最差的选择；更省事的是他把
 * `data\database\qianzi-gongfang.sqlite` 拷一份过来，我们直接读。
 *
 * 安全边界（三条，跟"备份还原预览"同一条规矩）：
 *   · **只读打开**（`readOnly: true`），一个字节都不写回去；
 *   · 只跑**同一段**汇总查询（`collectMarkStatisticsFrom`），不读项目树 / 不读设置；
 *   · 读不出预期表结构就当"这不是汉化工坊的库"明确报错，绝不瞎算一个数字出来。
 */
import { existsSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import type { ChildMarkStatistics } from '@shared/ipc-api'
import { collectMarkStatisticsFrom } from './db/mark-stats-store'

export type DatabaseImportResult =
  { ok: true; statistics: ChildMarkStatistics[] } | { ok: false; error: string }

/** `node:sqlite` 打开非 SQLite 文件时的原文五花八门，这里统一成一句人话。 */
function describeOpenFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (/not a database|file is encrypted|malformed/i.test(message)) {
    return '这个文件不是 SQLite 数据库'
  }
  if (/unable to open|no such file|cannot open/i.test(message)) {
    return '打不开这个文件（可能正在被对方程序占用，或没有读取权限）'
  }
  return message
}

export function importAchievementsFromDatabase(filePath: string): DatabaseImportResult {
  if (!existsSync(filePath)) return { ok: false, error: '文件不存在' }

  let database: DatabaseSync | null = null
  try {
    database = new DatabaseSync(filePath, { readOnly: true })
    const table = database
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'project_memory_files'"
      )
      .get() as { name?: string } | undefined
    if (!table?.name) {
      return { ok: false, error: '这不是汉化工坊的数据库（找不到标记记录表）' }
    }
    return { ok: true, statistics: collectMarkStatisticsFrom(database) }
  } catch (error) {
    return { ok: false, error: describeOpenFailure(error) }
  } finally {
    try {
      database?.close()
    } catch {
      // 关不掉也不影响：进程退出时系统会回收。
    }
  }
}
