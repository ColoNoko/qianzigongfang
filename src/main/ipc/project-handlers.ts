import { ipcMain } from 'electron'
import type { SelfCheckImportRequest } from '@shared/ipc-api'
import type { ChildProgressUpdate, ChildProjectScan, ParentProject, WorkMode } from '@shared/types'
import { projectScanService, projectScanWatch } from '../services/project-scan-service'
import { watchProject } from '../services/project-refresh'
import {
  detectRenamedCandidates,
  importParentSelfCheck,
  previewParentSelfCheck,
  setParentSourceRoot
} from '../services/project-self-check'
import {
  deleteChildren,
  getProjectTree,
  reclaimChildPath,
  renameParent,
  reorderParents,
  saveChildProgress,
  saveProjectChanges,
  saveProjectTree,
  setParentDuties,
  setParentSourceRoots
} from '../services/project-repository'

export function registerProjectHandlers(): void {
  ipcMain.handle(
    'comicType:scanChildProject',
    async (_, absFolder: string, options?: { cached?: boolean }): Promise<ChildProjectScan> => {
      // 唯一扫描入口（2026-10-05）：去重 / 2 秒缓存 / 双次校验 / 内容指纹。
      // 顺带把"最近扫过的话"挂进目录监听 —— 文件一变，主进程侧缓存自动刷。
      projectScanWatch.add(absFolder)
      return projectScanService.request(absFolder, options?.cached ?? true)
    }
  )
  ipcMain.handle('comicType:watchProject', (event, folderPath: string | null, visible = true) => {
    watchProject(event.sender, folderPath, visible)
  })
  ipcMain.handle('comicType:selfCheckPreview', async (_, parentId: string, sourceRoot?: string) =>
    previewParentSelfCheck(parentId, sourceRoot)
  )
  ipcMain.handle('comicType:selfCheckImport', async (_, request: SelfCheckImportRequest) =>
    importParentSelfCheck(request)
  )
  ipcMain.handle(
    'comicType:selfCheckDetectRenames',
    async (_, parentId: string, candidatePaths: string[]) =>
      detectRenamedCandidates(parentId, candidatePaths)
  )
  ipcMain.handle(
    'comicType:projectSetSourceRoot',
    async (_, parentId: string, sourceRoot: string) => setParentSourceRoot(parentId, sourceRoot)
  )
  ipcMain.handle(
    'comicType:projectReclaimChildPath',
    async (_, parentId: string, childId: string, folderPath: string) =>
      reclaimChildPath(parentId, childId, folderPath)
  )
  ipcMain.handle(
    'comicType:projectSetParentSourceRoots',
    async (_, parentId: string, roots: string[] | null) => setParentSourceRoots(parentId, roots)
  )
  ipcMain.handle('comicType:projectGetTree', async () => getProjectTree())
  ipcMain.handle('comicType:projectSaveTree', async (_, tree: ParentProject[]) =>
    saveProjectTree(tree)
  )
  ipcMain.handle(
    'comicType:projectSaveChanges',
    async (_, before: ParentProject[], after: ParentProject[]) => saveProjectChanges(before, after)
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
