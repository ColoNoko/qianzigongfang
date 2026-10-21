import { ipcMain, dialog } from 'electron'
import { exportAchievementFile, importAchievementFile } from '../services/achievement-io'
import { importAchievementsFromDatabase } from '../services/achievement-db-import'
import type { AchievementExportPayload } from '@shared/achievement-profile'
import type { AchievementDatabaseImportResult } from '@shared/ipc-api'
import { collectChildMarkStatistics } from '../services/database'

export function registerAchievementsHandlers(): void {
  ipcMain.handle('comicType:memoryMarkStatistics', async () => collectChildMarkStatistics())
  ipcMain.handle('comicType:achievementExportFile', async (_, payload: AchievementExportPayload) =>
    exportAchievementFile(payload)
  )
  ipcMain.handle('comicType:achievementImportFile', async () => importAchievementFile())
  ipcMain.handle(
    'comicType:achievementImportDatabase',
    async (): Promise<AchievementDatabaseImportResult> => {
      const selection = await dialog.showOpenDialog({
        title: '从对方的数据库文件导入成就',
        properties: ['openFile'],
        filters: [
          { name: '汉化工坊数据库', extensions: ['sqlite', 'sqlite3', 'db'] },
          { name: '所有文件', extensions: ['*'] }
        ]
      })
      if (selection.canceled || selection.filePaths.length === 0) return { canceled: true }

      const filePath = selection.filePaths[0]
      const result = importAchievementsFromDatabase(filePath)
      return result.ok
        ? { canceled: false, path: filePath, statistics: result.statistics }
        : { canceled: false, path: filePath, error: result.error }
    }
  )
}
