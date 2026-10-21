/**
 * achievement-io —— 成就数据导出/导入的文件对话框与读写（需求一）。
 *
 * 只做两件小事：
 *   · 导出：弹出"另存为"，把渲染层组装好的 JSON 写到用户选的位置；
 *   · 导入：弹出"打开"，读回文件内容（**不解析、不落库** —— 解析在共享层
 *     纯函数里做，校验失败就丢回渲染层报错，主进程不替用户做决定）。
 *
 * 安全边界：读回的内容只是一段字符串，本模块不做任何执行 / 路径访问；
 * 大小上限在共享层常量里（`MAX_IMPORT_FILE_BYTES`）。
 */
import { BrowserWindow, dialog } from 'electron'
import { open, writeFile } from 'fs/promises'
import { MAX_IMPORT_FILE_BYTES, type AchievementExportPayload } from '@shared/achievement-profile'

export interface AchievementExportResult {
  saved: boolean
  path?: string
  error?: string
}

export interface AchievementImportResult {
  canceled: boolean
  path?: string
  text?: string
  error?: string
}

function exportDefaultFileName(now: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `成就数据-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}.json`
}

export async function exportAchievementFile(
  payload: AchievementExportPayload
): Promise<AchievementExportResult> {
  const win = BrowserWindow.getFocusedWindow()
  const options: Electron.SaveDialogOptions = {
    title: '导出成就数据',
    defaultPath: exportDefaultFileName(new Date()),
    filters: [
      { name: 'JSON 数据文件', extensions: ['json'] },
      { name: '所有文件', extensions: ['*'] }
    ]
  }
  const result = win
    ? await dialog.showSaveDialog(win, options)
    : await dialog.showSaveDialog(options)
  if (result.canceled || !result.filePath) return { saved: false }

  try {
    await writeFile(result.filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
    return { saved: true, path: result.filePath }
  } catch (error) {
    return { saved: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export async function importAchievementFile(): Promise<AchievementImportResult> {
  const win = BrowserWindow.getFocusedWindow()
  const options: Electron.OpenDialogOptions = {
    title: '导入他人成就数据',
    properties: ['openFile'],
    filters: [
      { name: 'JSON 数据文件', extensions: ['json'] },
      { name: '所有文件', extensions: ['*'] }
    ]
  }
  const selection = win
    ? await dialog.showOpenDialog(win, options)
    : await dialog.showOpenDialog(options)
  if (selection.canceled || selection.filePaths.length === 0) return { canceled: true }

  const filePath = selection.filePaths[0]
  try {
    const file = await open(filePath, 'r')
    try {
      const buffer = Buffer.alloc(MAX_IMPORT_FILE_BYTES + 1)
      let length = 0
      while (length < buffer.length) {
        const { bytesRead } = await file.read(buffer, length, buffer.length - length, null)
        if (!bytesRead) break
        length += bytesRead
      }
      if (length > MAX_IMPORT_FILE_BYTES) {
        return {
          canceled: false,
          path: filePath,
          error: '文件太大（超过 2MB），不是有效的成就档案'
        }
      }
      return { canceled: false, path: filePath, text: buffer.toString('utf8', 0, length) }
    } finally {
      await file.close()
    }
  } catch (error) {
    return {
      canceled: false,
      path: filePath,
      error: error instanceof Error ? error.message : String(error)
    }
  }
}
