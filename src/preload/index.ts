import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { ComicTypeAPI } from '../shared/ipc-api'
import { parseBootThemeArguments } from '../shared/boot-theme-args'
import {
  IPC_GUARD_FLAG,
  assertIpcPayloadCloneable,
  isIpcGuardEnabled
} from '../shared/ipc-guard'

/**
 * The theme snapshot the main process appended to this process's argv.
 *
 * Reading it here — rather than through an async `storeGet` after mount — is
 * what allows the renderer's very first paint to use the persisted theme
 * instead of flashing the light default. Malformed or missing arguments parse
 * to null and the renderer falls back to localStorage.
 */
function readBootTheme(): ComicTypeAPI['bootTheme'] {
  return parseBootThemeArguments(process.argv ?? [])
}

/**
 * 所有 IPC 转发都走这里。唯一目的是 dev 下的参数护栏：
 * 结构化克隆过不了的参数（Vue 响应式代理是最常见的一种）当场抛错并点名 channel，
 * 而不是等它在主进程侧变成一句看不出位置的 "An object could not be cloned"。
 *
 * 开关来自 argv（主进程只在 `is.dev` 时追加）：打包后 argv 里没有这个 flag，
 * 分支永不进入 —— 也就是说生产环境每次调用只多一次布尔判断，不会白跑一遍克隆。
 */
const ipcGuardEnabled = isIpcGuardEnabled(process.argv)

function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  if (ipcGuardEnabled) assertIpcPayloadCloneable(channel, args)
  return ipcRenderer.invoke(channel, ...args) as Promise<T>
}

// IPC_GUARD_FLAG 只用于文档/调试时对照，运行时判断在 isIpcGuardEnabled 里。
void IPC_GUARD_FLAG

const api: ComicTypeAPI = {
  bootTheme: readBootTheme(),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  pickDirectory: () => invoke('comicType:pickDirectory'),
  pickLabelPlusFile: () => invoke('comicType:pickLabelPlusFile'),
  prepareLabelPlusInput: (inputPath) =>
    invoke('comicType:prepareLabelPlusInput', inputPath),
  listDir: (p) => invoke('comicType:listDir', p),
  stat: (p) => invoke('comicType:stat', p),
  readFileBuffer: (p) => invoke('comicType:readFileBuffer', p),
  readFileDataURL: (p) => invoke('comicType:readFileDataURL', p),
  previewLabelPlusImport: (request) =>
    invoke('comicType:previewLabelPlusImport', request),
  generateLabelPlusPsd: (request) => invoke('comicType:generateLabelPlusPsd', request),
  generateLabelPlusPreviewPsd: (request) =>
    invoke('comicType:generateLabelPlusPreviewPsd', request),
  openLabelPlusPreview: (request) => invoke('comicType:openLabelPlusPreview', request),
  getLabelPlusPreviewSession: (sessionId) =>
    invoke('comicType:getLabelPlusPreviewSession', sessionId),
  getLabelPlusPreviewPage: (sessionId, index) =>
    invoke('comicType:getLabelPlusPreviewPage', sessionId, index),
  closeCurrentWindow: () => invoke('comicType:closeCurrentWindow'),
  readPsdThumbnailCache: (p, mtimeMs) =>
    invoke('comicType:readPsdThumbnailCache', p, mtimeMs),
  writePsdThumbnailCache: (p, mtimeMs, dataUrl) =>
    invoke('comicType:writePsdThumbnailCache', p, mtimeMs, dataUrl),
  scanChildProject: (p) => invoke('comicType:scanChildProject', p),
  runLabelPlusInPhotoshop: (request, photoshopPath) =>
    invoke('comicType:runLabelPlusInPhotoshop', request, photoshopPath),
  exportLabelPlusManifest: (request) => invoke('comicType:exportLabelPlusManifest', request),
  readLabelPlusJobReport: (reportPath) =>
    invoke('comicType:readLabelPlusJobReport', reportPath),
  openPath: (p) => invoke('comicType:openPath', p),
  openExternal: (url) => invoke('comicType:openExternal', url),
  checkForUpdate: () => invoke('comicType:checkForUpdate'),
  pickToolFile: (kind) => invoke('comicType:pickToolFile', kind),
  launchTool: (exePath, args) => invoke('comicType:launchTool', exePath, args),
  confirmPsFallback: () => invoke('comicType:confirmPsFallback'),
  writeLog: (entry) => invoke('comicType:writeLog', entry),
  getLogPath: () => invoke('comicType:getLogPath'),
  importLegacyJson: () => invoke('comicType:importLegacyJson'),
  fontList: () => invoke('comicType:fontList'),
  fontInstall: () => invoke('comicType:fontInstall'),
  fontUninstall: (fontId) => invoke('comicType:fontUninstall', fontId),
  fontUninstallMany: (fontIds) => invoke('comicType:fontUninstallMany', fontIds),
  storeGet: (k) => invoke('comicType:storeGet', k),
  storeSet: (k, v) => invoke('comicType:storeSet', k, v),
  memoryGetProject: (childId) => invoke('comicType:memoryGetProject', childId),
  memorySetStatuses: (childId, folderPath, updates, audit) =>
    invoke('comicType:memorySetStatuses', childId, folderPath, updates, audit),
  memoryRemoveProject: (childId) => invoke('comicType:memoryRemoveProject', childId),
  memoryListMarkAudit: (limit) => invoke('comicType:memoryListMarkAudit', limit),
  memoryFindUndoableMark: () => invoke('comicType:memoryFindUndoableMark'),
  memoryMarkStatistics: () => invoke('comicType:memoryMarkStatistics'),
  diagnosticsSnapshot: () => invoke('comicType:diagnosticsSnapshot'),
  readLogTail: (maxBytes) => invoke('comicType:readLogTail', maxBytes),
  memoryUndoMark: (opId) => invoke('comicType:memoryUndoMark', opId),
  dbBackupCreate: (reason) => invoke('comicType:dbBackupCreate', reason),
  dbBackupList: () => invoke('comicType:dbBackupList'),
  dbBackupRestorePreview: (file) => invoke('comicType:dbBackupRestorePreview', file),
  dbBackupRestoreApply: (file) => invoke('comicType:dbBackupRestoreApply', file),
  selfCheckPreview: (parentId, sourceRoot) =>
    invoke('comicType:selfCheckPreview', parentId, sourceRoot),
  selfCheckImport: (request) => invoke('comicType:selfCheckImport', request),
  projectSetSourceRoot: (parentId, sourceRoot) =>
    invoke('comicType:projectSetSourceRoot', parentId, sourceRoot),
  projectGetTree: () => invoke('comicType:projectGetTree'),
  projectSaveTree: (tree) => invoke('comicType:projectSaveTree', tree),
  projectSaveProgress: (updates) => invoke('comicType:projectSaveProgress', updates),
  projectDeleteChildren: (childIds) =>
    invoke('comicType:projectDeleteChildren', childIds),
  projectRenameParent: (parentId, title) =>
    invoke('comicType:projectRenameParent', parentId, title),
  projectSetParentDuties: (parentId, duties) =>
    invoke('comicType:projectSetParentDuties', parentId, duties),
  projectReorderParents: (sourceParentId, targetParentId) =>
    invoke('comicType:projectReorderParents', sourceParentId, targetParentId)
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('comicType', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-expect-error (define in dts)
  window.comicType = api
}
