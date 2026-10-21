/**
 * 校对记录导出 —— 「另存为」对话框 + 写文件（译文栏改版第 2 批）。
 *
 * 照 `achievement-io.ts` 的 `exportAchievementFile()` 那条现成先例：
 * **只写用户自己选的那个位置**（`dialog.showSaveDialog`），
 * **绝不写话目录**（这一批不新增写用户漫画库的路径 —— 那是第 3/4 批才碰的边界）。
 *
 * 文本由渲染层拼好（那里才有作品名 / 话名 / 当前 txt 的值），
 * 主进程这一层不解析、不组装、不做决定：拿到一段字符串就往外写。
 */
import { BrowserWindow, dialog } from 'electron'
import { writeFile } from 'fs/promises'
import type {
  TranslationReviewExportRequest,
  TranslationReviewExportResult
} from '@shared/translation-review'

export async function exportTranslationReviewFile(
  request: TranslationReviewExportRequest
): Promise<TranslationReviewExportResult> {
  const win = BrowserWindow.getFocusedWindow()
  const options: Electron.SaveDialogOptions = {
    title: '导出校对记录',
    defaultPath: String(request?.defaultFileName ?? '').trim() || '校对记录.txt',
    filters: [
      { name: '文本文件', extensions: ['txt'] },
      { name: '所有文件', extensions: ['*'] }
    ]
  }
  const result = win
    ? await dialog.showSaveDialog(win, options)
    : await dialog.showSaveDialog(options)
  // 取消**不是失败**：界面不该为它弹一句错。
  if (result.canceled || !result.filePath) return { saved: false }

  try {
    await writeFile(result.filePath, String(request?.text ?? ''), 'utf8')
    return { saved: true, path: result.filePath }
  } catch (error) {
    return { saved: false, error: error instanceof Error ? error.message : String(error) }
  }
}
