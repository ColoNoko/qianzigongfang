import { BrowserWindow, ipcMain, dialog } from 'electron'
import { join } from 'path'
import {
  generateLabelPlusPsd,
  generateLabelPlusPreviewPsd,
  previewLabelPlusImport
} from '../services/labelplus-import-service'
import { prepareLabelPlusInput } from '../services/labelplus-input'
import {
  buildLabelPlusJob,
  launchLauncherInPhotoshop,
  readLabelPlusJobReport
} from '../services/labelplus-manifest-job'
import {
  getLabelPlusPreviewPage,
  getLabelPlusPreviewSession,
  openLabelPlusPreviewWindow
} from '../services/labelplus-preview'
import type {
  LabelPlusGenerateRequest,
  LabelPlusPreviewGenerateRequest,
  LabelPlusMatchRequest,
  LabelPlusPreviewOpenRequest
} from '@shared/labelplus-import'
import type {
  LabelPlusManifestJobRequest,
  LabelPlusManifestJobResult,
  LabelPlusPhotoshopRunResult
} from '@shared/labelplus-manifest'
import { labelPlusZipTempRoot } from './support'

export function registerImportHandlers(): void {
  ipcMain.handle('comicType:pickLabelPlusFile', async () => {
    const result = await dialog.showOpenDialog({
      title: '选择 LabelPlus 文本',
      properties: ['openFile'],
      filters: [{ name: 'LabelPlus 文本或压缩包', extensions: ['txt', 'json', 'labelplus', 'zip'] }]
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return prepareLabelPlusInput(result.filePaths[0], labelPlusZipTempRoot())
  })
  ipcMain.handle('comicType:prepareLabelPlusInput', async (_, inputPath: string) =>
    prepareLabelPlusInput(inputPath, labelPlusZipTempRoot())
  )
  ipcMain.handle('comicType:previewLabelPlusImport', async (_, request: LabelPlusMatchRequest) =>
    previewLabelPlusImport(request)
  )
  ipcMain.handle(
    'comicType:openLabelPlusPreview',
    async (event, request: LabelPlusPreviewOpenRequest) =>
      openLabelPlusPreviewWindow(request, BrowserWindow.fromWebContents(event.sender))
  )
  ipcMain.handle('comicType:getLabelPlusPreviewSession', async (_, sessionId: string) =>
    getLabelPlusPreviewSession(sessionId)
  )
  ipcMain.handle('comicType:getLabelPlusPreviewPage', async (_, sessionId: string, index: number) =>
    getLabelPlusPreviewPage(sessionId, index)
  )
  ipcMain.handle('comicType:generateLabelPlusPsd', async (_, request: LabelPlusGenerateRequest) =>
    generateLabelPlusPsd(request)
  )
  ipcMain.handle(
    'comicType:generateLabelPlusPreviewPsd',
    async (_, request: LabelPlusPreviewGenerateRequest) =>
      generateLabelPlusPreviewPsd(request, join(labelPlusZipTempRoot(), 'preview'))
  )
  ipcMain.handle(
    'comicType:exportLabelPlusManifest',
    async (_, request: LabelPlusManifestJobRequest): Promise<LabelPlusManifestJobResult> =>
      buildLabelPlusJob(request)
  )
  ipcMain.handle(
    'comicType:runLabelPlusInPhotoshop',
    async (
      _,
      request: LabelPlusManifestJobRequest,
      photoshopPath: string
    ): Promise<LabelPlusPhotoshopRunResult> => {
      const prepared = await buildLabelPlusJob(request)
      if (!prepared.ok || !prepared.launcherPath) {
        return { ...prepared, launched: false, launchMessage: '' }
      }
      const launched = await launchLauncherInPhotoshop(photoshopPath, prepared.launcherPath)
      return {
        ...prepared,
        launched: launched.ok,
        launchMessage: launched.message,
        message: launched.ok
          ? `${prepared.message}；已在 Photoshop 里开始执行`
          : `${prepared.message}；但启动 Photoshop 失败：${launched.message}`
      }
    }
  )
  ipcMain.handle('comicType:readLabelPlusJobReport', async (_, reportPath: string) =>
    readLabelPlusJobReport(reportPath)
  )
}
