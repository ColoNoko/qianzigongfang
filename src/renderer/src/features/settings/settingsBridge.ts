/**
 * 「设置页 · 数据安全」那几条通道的渲染侧适配层（P7 之五，2026-10-05）。
 *
 * 只收**只有设置页在用**的三条（备份列表 / 立即备份 / 导入旧版数据）；
 * 被多个页面共用的那几条在 `features/shell/appShellBridge.ts`。
 */
import type { DbBackupInfo, LegacyJsonImportResult } from '@shared/ipc-api'

/** 列出已有备份（最新的在前）。 */
export function listDbBackups(): Promise<DbBackupInfo[]> {
  return window.comicType.dbBackupList()
}

/** 立即备份一份（`reason` 会记进备份文件名里）。 */
export function createDbBackup(reason: string): Promise<DbBackupInfo> {
  return window.comicType.dbBackupCreate(reason)
}

/** 打开"导入旧版数据"的文件选择框并导入。 */
export function importLegacyJsonData(): Promise<LegacyJsonImportResult> {
  return window.comicType.importLegacyJson()
}
