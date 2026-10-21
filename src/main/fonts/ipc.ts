import { BrowserWindow, dialog, ipcMain } from 'electron'
import {
  installUserFonts,
  listSystemFonts,
  listFontsInFolder,
  uninstallUserFont,
  uninstallUserFonts,
  onCatalogChanged
} from './catalog'
import { fontPreview } from './preview'
import type {
  FontFolderListResult,
  FontInstallResult,
  FontBatchActionResult
} from '@shared/ipc-api'
export function registerFontHandlers(): void {
  ipcMain.handle('comicType:fontList', async (_, options?: { refresh?: boolean }) =>
    listSystemFonts(options)
  )

  ipcMain.handle(
    'comicType:fontListFolder',
    async (_, folderPath?: string): Promise<FontFolderListResult> => {
      if (folderPath) return listFontsInFolder(folderPath)
      const result = await dialog.showOpenDialog({
        title: '选择独立字体文件夹',
        properties: ['openDirectory']
      })
      if (result.canceled || result.filePaths.length === 0) {
        return { canceled: true, supported: true, fonts: [], scannedAt: Date.now() }
      }
      return listFontsInFolder(result.filePaths[0])
    }
  )

  ipcMain.handle('comicType:fontInstall', async (): Promise<FontInstallResult> => {
    if (process.platform !== 'win32') {
      return {
        canceled: false,
        installed: [],
        failed: [{ fileName: '', message: '字体管理仅支持 Windows' }]
      }
    }

    const result = await dialog.showOpenDialog({
      title: '安装字体',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: '字体文件', extensions: ['ttf', 'otf', 'ttc'] }]
    })
    if (result.canceled || result.filePaths.length === 0) {
      return { canceled: true, installed: [], failed: [] }
    }
    return installUserFonts(result.filePaths)
  })

  ipcMain.handle('comicType:fontUninstall', async (_, fontId: string) => uninstallUserFont(fontId))

  ipcMain.handle(
    'comicType:fontUninstallMany',
    async (_, fontIds: string[]): Promise<FontBatchActionResult> => uninstallUserFonts(fontIds)
  )

  ipcMain.handle('comicType:fontPreview', (_, path: string, index?: number, sampleOnly?: boolean) =>
    fontPreview(path, index, sampleOnly)
  )
  onCatalogChanged((result) => {
    for (const window of BrowserWindow.getAllWindows())
      if (!window.isDestroyed()) window.webContents.send('comicType:fontsChanged', result)
  })
}
