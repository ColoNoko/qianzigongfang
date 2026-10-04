/**
 * diagnostics —— 应用内诊断快照（D2）。
 *
 * 为什么要有它：以前出问题只能让人去翻 `data/logs/psd-manager.log`（几十 MB 的纯文本），
 * 或者等我一句句问"你的库多大、标记多少行、有没有备份"。这里把**最常被问到的几个事实**
 * 一次凑齐（版本 / 数据目录 / 库大小 / 标记行数 / 备份份数 / 日志尾部），
 * 面板上还能一键复制 —— 出问题时用户自己先看一眼，或者直接把这段贴给我。
 *
 * 只读：不写文件、不动数据（除了日志尾部那一次 read）。
 */
import { app } from 'electron'
import { stat } from 'fs/promises'
import type { DiagnosticsSnapshot } from '@shared/ipc-api'
import { collectChildMarkStatistics, databasePath } from './database'
import { listDatabaseBackups } from './db-backup'
import { getLogSize, getLogPath } from './logger'

async function fileSize(path: string): Promise<number> {
  try {
    return (await stat(path)).size
  } catch {
    return 0
  }
}

export async function collectDiagnostics(): Promise<DiagnosticsSnapshot> {
  const database = databasePath()
  const statistics = await collectChildMarkStatistics().catch(() => [])
  const backups = await listDatabaseBackups().catch(() => [])

  const markCounts = { typeset: 0, translated: 0, proofread: 0, supervised: 0 }
  let records = 0
  for (const child of statistics) {
    records += child.fileCount
    for (const mode of ['typeset', 'translated', 'proofread', 'supervised'] as const) {
      markCounts[mode] += child.completedTimestamps?.[mode]?.length ?? 0
    }
  }

  return {
    appVersion: app.getVersion(),
    electronVersion: process.versions.electron ?? '',
    platform: `${process.platform} ${process.arch}`,
    dataDirectory: app.getPath('userData'),
    databasePath: database,
    databaseBytes: await fileSize(database),
    logPath: getLogPath(),
    logBytes: await getLogSize(),
    backupCount: backups.length,
    newestBackupAt: backups[0]?.at ?? null,
    childCount: statistics.length,
    recordCount: records,
    markCounts
  }
}
