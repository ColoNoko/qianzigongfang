import { ipcMain, dialog } from 'electron'
import type { LegacyJsonImportResult } from '@shared/ipc-api'
import { resetFontManagerMemory } from '../services/font-manager'
import { getStoredValue, importLegacyJsonFiles, setStoredValue } from '../services/database'

export function registerStorageHandlers(): void {
  ipcMain.handle('comicType:importLegacyJson', async (): Promise<LegacyJsonImportResult> => {
    const selection = await dialog.showOpenDialog({
      title: '导入旧版数据',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: '汉化工坊数据', extensions: ['sqlite', 'sqlite3', 'db', 'json'] },
        { name: 'SQLite 数据库', extensions: ['sqlite', 'sqlite3', 'db'] },
        { name: 'JSON 数据文件', extensions: ['json'] }
      ]
    })
    if (selection.canceled || selection.filePaths.length === 0) {
      return {
        canceled: true,
        importedFiles: 0,
        skippedFiles: 0,
        projectsAdded: 0,
        memoryProjectsImported: 0,
        fontRecordsImported: 0,
        importedSettings: 0,
        warnings: []
      }
    }
    const result = await importLegacyJsonFiles(selection.filePaths)
    if (result.fontRecordsImported > 0) resetFontManagerMemory()
    return result
  })
  ipcMain.handle('comicType:storeGet', async (_, key: string): Promise<unknown> => {
    return getStoredValue(key)
  })
  ipcMain.handle('comicType:storeSet', async (_, key: string, val: unknown): Promise<void> => {
    await setStoredValue(key, val)
  })
}
