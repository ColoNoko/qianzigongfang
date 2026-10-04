import { BrowserWindow, ipcMain, dialog, net, shell, app } from 'electron'
import { spawn } from 'child_process'
import { existsSync } from 'fs'
import { readdir, stat, readFile } from 'fs/promises'
import { dirname, join, extname } from 'path'
import type {
  DirEntry,
  StatSnap,
  OpenPathResult,
  PsFallbackDecision,
  ToolFileKind,
  LogEntry,
  FontBatchActionResult,
  FontInstallResult,
  LegacyJsonImportResult,
  ProjectMemoryStatusUpdate,
  SelfCheckImportRequest,
  UpdateCheckResult
} from '@shared/ipc-api'
import type { MarkAuditContext } from '@shared/mark-audit'
import { normalizeExternalUrl } from '@shared/external-url'
import { checkForUpdate } from '../services/update-check'
import type { ChildProgressUpdate, ChildProjectScan, ParentProject, WorkMode } from '@shared/types'
import { scanChildProject } from '../services/scanner'
import { getLogPath, readLogTail, writeLog } from '../services/logger'
import { collectDiagnostics } from '../services/diagnostics'
import { describeOpenPathResult } from '../services/open-path-failure'
import { readPsdThumbnailCache, writePsdThumbnailCache } from '../services/thumbnail-cache'
import {
  getProjectMemory,
  removeProjectMemory,
  setProjectMemoryStatuses
} from '../services/project-memory'
import {
  applyMarkRestore,
  collectChildMarkStatistics,
  currentMarkSnapshot,
  findUndoableMarkOperation,
  listMarkAuditOperations,
  readMarkSnapshotFromFile,
  undoMarkOperation
} from '../services/database'
import {
  createDatabaseBackup,
  listDatabaseBackups,
  previewMarkRestore
} from '../services/db-backup'
import { buildRestoreUpdatesFromDiff, diffMarkSnapshots } from '@shared/mark-audit'
import {
  installUserFonts,
  listSystemFonts,
  resetFontManagerMemory,
  uninstallUserFont,
  uninstallUserFonts
} from '../services/font-manager'
import { getStoredValue, importLegacyJsonFiles, setStoredValue } from '../services/database'
import {
  importParentSelfCheck,
  previewParentSelfCheck,
  setParentSourceRoot
} from '../services/project-self-check'
import {
  deleteChildren,
  getProjectTree,
  renameParent,
  reorderParents,
  saveChildProgress,
  saveProjectTree,
  setParentDuties
} from '../services/project-repository'
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

class IPCError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
    this.name = 'IPCError'
  }
}

function labelPlusZipTempRoot(): string {
  const executableDirectory = process.env.PORTABLE_EXECUTABLE_DIR || dirname(process.execPath)
  return join(executableDirectory, 'temp')
}

function mimeFromExt(ext: string): string {
  switch (ext.toLowerCase()) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.png':
      return 'image/png'
    case '.gif':
      return 'image/gif'
    case '.webp':
      return 'image/webp'
    case '.bmp':
      return 'image/bmp'
    case '.avif':
      return 'image/avif'
    case '.jfif':
      return 'image/jpeg'
    case '.psd':
      return 'image/vnd.adobe.photoshop'
    default:
      return 'application/octet-stream'
  }
}

export function registerHandlers(): void {
  ipcMain.handle('comicType:pickDirectory', async (): Promise<string | null> => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) {
      return null
    }
    return result.filePaths[0]
  })

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

  ipcMain.handle('comicType:readFileBuffer', async (_, absPath: string): Promise<ArrayBuffer> => {
    try {
      const buffer = await readFile(absPath)
      return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      throw new IPCError('E_UNREADABLE', message)
    }
  })

  ipcMain.handle('comicType:readFileDataURL', async (_, absPath: string): Promise<string> => {
    try {
      const buffer = await readFile(absPath)
      const b64 = buffer.toString('base64')
      const mime = mimeFromExt(extname(absPath))
      return `data:${mime};base64,${b64}`
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      throw new IPCError('E_UNREADABLE', message)
    }
  })

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

  ipcMain.handle('comicType:closeCurrentWindow', async (event): Promise<void> => {
    BrowserWindow.fromWebContents(event.sender)?.close()
  })

  ipcMain.handle('comicType:generateLabelPlusPsd', async (_, request: LabelPlusGenerateRequest) =>
    generateLabelPlusPsd(request)
  )

  ipcMain.handle(
    'comicType:generateLabelPlusPreviewPsd',
    async (_, request: LabelPlusPreviewGenerateRequest) =>
      generateLabelPlusPreviewPsd(request, join(labelPlusZipTempRoot(), 'preview'))
  )

  // 「工坊编排 / PS 执行」那条路。写清单与启动 PS 分成两个通道，是因为
  // 出问题时唯一能把两边分开的手段就是"只写清单、我自己在 PS 里跑一遍"。
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

  ipcMain.handle(
    'comicType:readPsdThumbnailCache',
    async (_, psdPath: string, mtimeMs: number): Promise<string | null> =>
      readPsdThumbnailCache(psdPath, mtimeMs)
  )

  ipcMain.handle(
    'comicType:writePsdThumbnailCache',
    async (_, psdPath: string, mtimeMs: number, dataUrl: string): Promise<void> =>
      writePsdThumbnailCache(psdPath, mtimeMs, dataUrl)
  )

  ipcMain.handle(
    'comicType:scanChildProject',
    async (_, absFolder: string): Promise<ChildProjectScan> => {
      return scanChildProject(absFolder)
    }
  )

  ipcMain.handle('comicType:openPath', async (_, absPath: string): Promise<OpenPathResult> => {
    // 分类逻辑在 services/open-path-failure.ts（纯函数、有单测）—— 这里只负责调系统与补事实。
    // 2026-10-01 A4（真机实测后重做）：系统只回一句 "Failed to open path"，
    // 分不出原因，所以这里补一个**能拿到的事实**：文件在不在。
    // 顺带修掉一条死分支 —— 老代码判的 `includes('does not exist')` 实测永远不会命中。
    const raw = await shell.openPath(absPath)
    return describeOpenPathResult(raw, existsSync(absPath))
  })

  /**
   * 检查更新（2026-10-04）：**只读网络**。
   *
   * 用 Electron 自带的 `net.fetch`（走 Chromium 网络栈，自动带系统代理，
   * 不用为这点事引第三方 http 库）。当前版本取 `app.getVersion()` ——
   * 与界面显示的 `__APP_VERSION__` 同源（都是 package.json）。
   * 失败一律变成 `failed` 状态，不抛（见 services/update-check.ts 的注释）。
   */
  ipcMain.handle('comicType:checkForUpdate', async (): Promise<UpdateCheckResult> => {
    return checkForUpdate({
      currentVersion: app.getVersion(),
      fetchImpl: net.fetch as unknown as typeof fetch
    })
  })

  ipcMain.handle(
    'comicType:openExternal',
    async (_, rawUrl: string): Promise<OpenPathResult> => {
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
    }
  )

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

  ipcMain.handle('comicType:fontList', async () => listSystemFonts())

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

  ipcMain.handle('comicType:storeGet', async (_, key: string): Promise<unknown> => {
    return getStoredValue(key)
  })

  ipcMain.handle('comicType:storeSet', async (_, key: string, val: unknown): Promise<void> => {
    await setStoredValue(key, val)
  })

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

  // ── 标记台账 / 备份 / 还原（第十四轮）──────────────────────────────────────
  ipcMain.handle('comicType:memoryListMarkAudit', async (_, limit?: number) =>
    listMarkAuditOperations(typeof limit === 'number' ? limit : 100)
  )

  ipcMain.handle('comicType:memoryFindUndoableMark', async () => findUndoableMarkOperation())

  // 成就页的数据源：标记记录（删图不影响历史）
  ipcMain.handle('comicType:memoryMarkStatistics', async () => collectChildMarkStatistics())

  // 诊断（D2）：一次凑齐最常被问到的几个事实 + 日志尾部
  ipcMain.handle('comicType:diagnosticsSnapshot', async () => collectDiagnostics())
  ipcMain.handle('comicType:readLogTail', async (_, maxBytes?: number) =>
    readLogTail(typeof maxBytes === 'number' ? maxBytes : undefined)
  )

  ipcMain.handle('comicType:memoryUndoMark', async (_, opId: string) => {
    const result = await undoMarkOperation(opId)
    await writeLog({
      level: 'info',
      scope: 'mark-audit',
      message: 'Mark operation undone',
      data: { opId, revertedFiles: result.revertedFiles, childIds: result.childIds }
    })
    return result
  })

  ipcMain.handle('comicType:dbBackupCreate', async (_, reason: string) => {
    const info = await createDatabaseBackup(typeof reason === 'string' && reason ? reason : 'manual')
    await writeLog({
      level: 'info',
      scope: 'db-backup',
      message: 'Database backup created',
      data: { file: info.file, bytes: info.bytes, reason: info.reason, rows: info.rows }
    })
    return info
  })

  ipcMain.handle('comicType:dbBackupList', async () => listDatabaseBackups())

  ipcMain.handle('comicType:dbBackupRestorePreview', async (_, file: string) =>
    previewMarkRestore(file)
  )

  ipcMain.handle('comicType:dbBackupRestoreApply', async (_, file: string) => {
    // 顺序很重要：先算差异 → **先给当前库留一份** → 再写回。
    // 万一选错了备份，那份 safety 就是回程票（台账里还会有一条 kind='restore'）。
    const preview = await previewMarkRestore(file)
    const safetyBackup = await createDatabaseBackup('before-restore')
    const groups = buildRestoreUpdatesFromDiff(
      diffMarkSnapshots(await currentMarkSnapshot(), readMarkSnapshotFromFile(file))
    )
    const result = await applyMarkRestore(groups, file)
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
    })
    return { ...result, safetyBackup }
  })

  ipcMain.handle('comicType:memoryRemoveProject', async (_, childId: string): Promise<void> =>
    removeProjectMemory(childId)
  )

  ipcMain.handle('comicType:selfCheckPreview', async (_, parentId: string, sourceRoot?: string) =>
    previewParentSelfCheck(parentId, sourceRoot)
  )

  ipcMain.handle('comicType:selfCheckImport', async (_, request: SelfCheckImportRequest) =>
    importParentSelfCheck(request)
  )

  ipcMain.handle(
    'comicType:projectSetSourceRoot',
    async (_, parentId: string, sourceRoot: string) => setParentSourceRoot(parentId, sourceRoot)
  )

  ipcMain.handle('comicType:projectGetTree', async () => getProjectTree())

  ipcMain.handle('comicType:projectSaveTree', async (_, tree: ParentProject[]) =>
    saveProjectTree(tree)
  )

  ipcMain.handle('comicType:projectSaveProgress', async (_, updates: ChildProgressUpdate[]) =>
    saveChildProgress(updates)
  )

  ipcMain.handle('comicType:projectDeleteChildren', async (_, childIds: string[]) =>
    deleteChildren(childIds)
  )

  ipcMain.handle('comicType:projectRenameParent', async (_, parentId: string, title: string) =>
    renameParent(parentId, title)
  )

  ipcMain.handle(
    'comicType:projectSetParentDuties',
    async (_, parentId: string, duties: WorkMode[]) => setParentDuties(parentId, duties)
  )

  ipcMain.handle(
    'comicType:projectReorderParents',
    async (_, sourceParentId: string, targetParentId: string) =>
      reorderParents(sourceParentId, targetParentId)
  )
}
