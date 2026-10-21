import { BrowserWindow, ipcMain, dialog, net, shell, app } from 'electron'
import { spawn } from 'child_process'
import { existsSync } from 'fs'
import { readdir, stat } from 'fs/promises'
import { join } from 'path'
import type {
  DirEntry,
  StatSnap,
  OpenPathResult,
  PsFallbackDecision,
  ToolFileKind,
  LogEntry,
  UpdateCheckResult
} from '@shared/ipc-api'
import { normalizeExternalUrl } from '@shared/external-url'
import { checkForUpdate } from '../services/update-check'
import { getLogPath, readLogTail, writeLog } from '../services/logger'
import { collectDiagnostics } from '../services/diagnostics'
import { describeOpenPathResult } from '../services/open-path-failure'
import { IPCError } from './support'

export function registerSystemHandlers(): void {
  ipcMain.handle('comicType:setWindowTitleBarTheme', (event, theme: 'light'|'dark') => {
    if (process.platform !== 'win32') return
    const window = BrowserWindow.fromWebContents(event.sender)
    if (window && !window.isDestroyed()) window.setTitleBarOverlay({color:'#00000000',symbolColor:theme === 'dark' ? '#f1f3f5' : '#202124',height:36})
  })
  ipcMain.handle('comicType:pickDirectory', async (): Promise<string | null> => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) {
      return null
    }
    return result.filePaths[0]
  })
  ipcMain.handle('comicType:listDir', async (_, absPath: string): Promise<DirEntry[]> => {
    try {
      const entries = await readdir(absPath, { withFileTypes: true })
      return entries.map((dirent) => ({
        name: dirent.name,
        isDirectory: dirent.isDirectory(),
        absPath: join(absPath, dirent.name)
      }))
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      throw new IPCError('E_UNREADABLE', message)
    }
  })
  ipcMain.handle('comicType:stat', async (_, absPath: string): Promise<StatSnap> => {
    try {
      const s = await stat(absPath)
      return {
        mtimeMs: s.mtimeMs,
        ctimeMs: s.ctimeMs,
        size: s.size,
        isFile: s.isFile(),
        isDirectory: s.isDirectory()
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      throw new IPCError('E_UNREADABLE', message)
    }
  })
  ipcMain.handle('comicType:closeCurrentWindow', async (event): Promise<void> => {
    BrowserWindow.fromWebContents(event.sender)?.close()
  })
  ipcMain.handle('comicType:openPath', async (_, absPath: string): Promise<OpenPathResult> => {
    // 分类逻辑在 services/open-path-failure.ts（纯函数、有单测）—— 这里只负责调系统与补事实。
    // 2026-10-01 A4（真机实测后重做）：系统只回一句 "Failed to open path"，
    // 分不出原因，所以这里补一个**能拿到的事实**：文件在不在。
    // 顺带修掉一条死分支 —— 老代码判的 `includes('does not exist')` 实测永远不会命中。
    try {
      const raw = await shell.openPath(absPath)
      return describeOpenPathResult(raw, existsSync(absPath))
    } catch (error) {
      return {
        ok: false,
        code: 'E_OPEN_FAILED',
        message: error instanceof Error ? error.message : String(error)
      }
    }
  })
  ipcMain.handle('comicType:checkForUpdate', async (): Promise<UpdateCheckResult> => {
    return checkForUpdate({
      currentVersion: app.getVersion(),
      fetchImpl: net.fetch as unknown as typeof fetch
    })
  })
  ipcMain.handle('comicType:openExternal', async (_, rawUrl: string): Promise<OpenPathResult> => {
    // 白名单在主进程侧执行（渲染进程可能被注入任何字符串）。
    const url = normalizeExternalUrl(rawUrl)
    if (url === null) {
      return { ok: false, code: 'E_INVALID_URL', message: String(rawUrl) }
    }
    try {
      await shell.openExternal(url)
      return { ok: true }
    } catch (error) {
      return {
        ok: false,
        code: 'E_OPEN_FAILED',
        message: error instanceof Error ? error.message : String(error)
      }
    }
  })
  ipcMain.handle(
    'comicType:pickToolFile',
    async (_, kind: ToolFileKind = 'executable'): Promise<string | null> => {
      const result =
        kind === 'script'
          ? await dialog.showOpenDialog({
              title: '选择 Photoshop 脚本（.jsx）',
              properties: ['openFile'],
              filters: [
                { name: 'Photoshop 脚本', extensions: ['jsx', 'js'] },
                { name: '所有文件', extensions: ['*'] }
              ]
            })
          : await dialog.showOpenDialog({
              title: '选择可执行文件',
              properties: ['openFile'],
              filters: [
                { name: '可执行文件', extensions: ['exe'] },
                { name: '所有文件', extensions: ['*'] }
              ]
            })
      if (result.canceled || result.filePaths.length === 0) {
        return null
      }
      return result.filePaths[0]
    }
  )
  ipcMain.handle(
    'comicType:launchTool',
    async (_, exePath: string, args: string[] = []): Promise<OpenPathResult> => {
      // The tool path comes from user settings, so a missing target is a
      // configuration error that must be reported — not an OS association miss.
      try {
        const info = await stat(exePath)
        if (!info.isFile()) {
          return { ok: false, code: 'E_NOT_FOUND', message: `${exePath} 不是一个文件` }
        }
      } catch {
        return { ok: false, code: 'E_NOT_FOUND', message: `找不到 ${exePath}` }
      }

      // shell.openPath cannot pass arguments, and the 译文导入 flow needs
      // `Photoshop.exe "<script>.jsx"`. spawn is given an argument array, so no
      // shell ever parses the user's paths.
      return await new Promise<OpenPathResult>((resolve) => {
        let settled = false
        const child = spawn(exePath, args, { detached: true, stdio: 'ignore' })
        child.once('error', (error) => {
          if (settled) return
          settled = true
          resolve({ ok: false, code: 'E_OPEN_FAILED', message: error.message })
        })
        child.once('spawn', () => {
          if (settled) return
          settled = true
          child.unref()
          resolve({ ok: true })
        })
      })
    }
  )
  ipcMain.handle('comicType:confirmPsFallback', async (): Promise<PsFallbackDecision> => {
    const options: Electron.MessageBoxOptions = {
      type: 'question',
      buttons: ['依然打开ps', '取消'],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
      message: '尚未配置「译文导入 / PSD 生成工具」',
      detail:
        '该话还没有 PSD。你可以在「设置 → 外部工具」里指定译文导入用的 .jsx 脚本，之后这个按钮会直接在 Photoshop 里运行它。',
      checkboxLabel: '下次不再提醒',
      checkboxChecked: false
    }
    const owner = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const result = owner
      ? await dialog.showMessageBox(owner, options)
      : await dialog.showMessageBox(options)
    return { confirmed: result.response === 0, skipNextTime: result.checkboxChecked }
  })
  ipcMain.handle('comicType:writeLog', async (_, entry: LogEntry): Promise<void> => {
    await writeLog(entry)
  })
  ipcMain.handle('comicType:getLogPath', async (): Promise<string> => {
    return getLogPath()
  })
  ipcMain.handle('comicType:diagnosticsSnapshot', async () => collectDiagnostics())
  ipcMain.handle('comicType:readLogTail', async (_, maxBytes?: number) =>
    readLogTail(typeof maxBytes === 'number' ? maxBytes : undefined)
  )
}
