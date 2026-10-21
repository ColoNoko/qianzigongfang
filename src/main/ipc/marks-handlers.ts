import {
  getStatisticsTime,
  setStatisticsTime,
  statisticsTimeOperations,
  undoStatisticsTime,
  restoreStatisticsTimes
} from '../services/db/statistics-time-store'
import type { StatisticsTimeRequest, StatisticsTimeTarget } from '@shared/statistics-time'
import type { WorkMode } from '@shared/types'
import { ipcMain } from 'electron'
import type { ProjectMemoryStatusUpdate } from '@shared/ipc-api'
import type { MarkAuditContext } from '@shared/mark-audit'
import { writeLog } from '../services/logger'
import {
  getProjectMemory,
  removeProjectMemory,
  setProjectMemoryStatuses
} from '../services/project-memory'
import {
  applyMarkRestore,
  currentMarkSnapshot,
  findUndoableMarkOperation,
  listMarkAuditOperations,
  readMarkSnapshotFromFile,
  undoMarkOperation
} from '../services/database'
import {
  createDatabaseBackup,
  withPinnedDatabaseBackup,
  listDatabaseBackups,
  previewMarkRestore
} from '../services/db-backup'
import { buildRestoreUpdatesFromDiff, diffMarkSnapshots } from '@shared/mark-audit'

export function registerMarksHandlers(): void {
  ipcMain.handle('comicType:statisticsTimeGet', (_, target: StatisticsTimeTarget, mode: WorkMode) =>
    getStatisticsTime(target, mode)
  )
  ipcMain.handle('comicType:statisticsTimeSet', (_, request: StatisticsTimeRequest) =>
    setStatisticsTime(request)
  )
  ipcMain.handle('comicType:memoryGetProject', async (_, childId: string) =>
    getProjectMemory(childId)
  )
  ipcMain.handle(
    'comicType:memorySetStatuses',
    async (
      _,
      childId: string,
      folderPath: string,
      updates: ProjectMemoryStatusUpdate[],
      audit?: MarkAuditContext
    ): Promise<void> => setProjectMemoryStatuses(childId, folderPath, updates, audit)
  )
  ipcMain.handle('comicType:memoryListMarkAudit', async (_, limit?: number) =>
    Promise.all([
      listMarkAuditOperations(typeof limit === 'number' ? limit : 100),
      statisticsTimeOperations()
    ]).then((groups) =>
      groups
        .flat()
        .sort((a, b) => b.at - a.at)
        .slice(0, typeof limit === 'number' ? limit : 100)
    )
  )
  ipcMain.handle('comicType:memoryFindUndoableMark', async () => {
    const mark = await findUndoableMarkOperation()
    const dates = (await statisticsTimeOperations()).find((op) => op.kind === 'mark')
    return dates && (!mark || dates.at >= mark.at) ? dates : mark
  })
  ipcMain.handle('comicType:memoryUndoMark', async (_, opId: string) => {
    const result = opId.startsWith('statistics-time:')
      ? await undoStatisticsTime(opId)
      : await undoMarkOperation(opId)
    await writeLog({
      level: 'info',
      scope: 'mark-audit',
      message: 'Mark operation undone',
      data: { opId, revertedFiles: result.revertedFiles, childIds: result.childIds }
    }).catch(() => undefined)
    return result
  })
  ipcMain.handle('comicType:dbBackupCreate', async (_, reason: string) => {
    const info = await createDatabaseBackup(
      typeof reason === 'string' && reason ? reason : 'manual'
    )
    await writeLog({
      level: 'info',
      scope: 'db-backup',
      message: 'Database backup created',
      data: { file: info.file, bytes: info.bytes, reason: info.reason, rows: info.rows }
    }).catch(() => undefined)
    return info
  })
  ipcMain.handle('comicType:dbBackupList', async () => listDatabaseBackups())
  ipcMain.handle('comicType:dbBackupRestorePreview', async (_, file: string) =>
    previewMarkRestore(file)
  )
  ipcMain.handle('comicType:dbBackupRestoreApply', async (_, file: string) =>
    withPinnedDatabaseBackup(file, async () => {
      // 顺序很重要：先算差异 → **先给当前库留一份** → 再写回。
      // 万一选错了备份，那份 safety 就是回程票（台账里还会有一条 kind='restore'）。
      const preview = await previewMarkRestore(file)
      const safetyBackup = await createDatabaseBackup('before-restore')
      const groups = buildRestoreUpdatesFromDiff(
        diffMarkSnapshots(await currentMarkSnapshot(), readMarkSnapshotFromFile(file))
      )
      const result = await applyMarkRestore(groups, file)
      await restoreStatisticsTimes(file, true)
      await writeLog({
        level: 'info',
        scope: 'db-backup',
        message: 'Marks restored from backup',
        data: {
          file,
          changingFiles: preview.changingFiles,
          revertedFiles: result.revertedFiles,
          safetyBackup: safetyBackup.file
        }
      }).catch(() => undefined)
      return { ...result, safetyBackup }
    })
  )
  ipcMain.handle('comicType:memoryRemoveProject', async (_, childId: string): Promise<void> =>
    removeProjectMemory(childId)
  )
}
