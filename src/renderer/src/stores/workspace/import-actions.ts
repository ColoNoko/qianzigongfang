import { useSettingsStore } from '../settings'
import { requireCompleteScan } from '@shared/project-scan'
import type { DirEntry } from '@shared/ipc-api'
import { modeStatsFromPairs } from '@shared/status'
import { useAchievementsStore } from '../achievements'
import { inferChapterAndTitle } from '@shared/chapter'
import {
  toPlain,
  type SaveChildPayload,
  type ImportResult,
  type ScannedChildProject,
  latestPairMtime,
  psdStatsFromPairs,
  basename,
  hasRootProjectFiles,
  normalizePathForLookup,
  parentFolderPath,
  findChildLocation,
  sortEntriesByName,
  syncDashboardStore,
  upsertChildProject,
  writeWorkspaceLog,
  recomputeParentMtimes,
  hydrateParents
} from './helpers'
import type { WorkspaceContext } from './context'

export const importActions = {
  async saveChild(
    this: WorkspaceContext,
    payload: SaveChildPayload,
    existingChildId?: string,
    onProgress?: (message: string) => void
  ): Promise<ImportResult> {
    onProgress?.('正在读取项目目录…')
    const raw = await window.comicType.projectGetTree()
    let parents = hydrateParents(raw)
    // 并发保存（2026-10-05 从并行分支 T6 移植）：进动作前先把"当时看到的树"拍张照。
    // 改完不再整树覆盖，而是让主进程对着**库里最新的树**只合并本次的章节改动，
    // 并返回合并后的权威树 —— 后台扫描/别的窗口的导入不会再被旧快照抹掉。
    const beforeTree = toPlain(parents)
    const result: ImportResult = { added: 0, skipped: 0, updated: 0 }
    await this.ensurePsdStatusOverridesLoaded()

    if (!existingChildId) {
      let rootEntries: DirEntry[] = []
      try {
        rootEntries = (await window.comicType.listDir(payload.folderPath)) ?? []
      } catch (err) {
        writeWorkspaceLog(
          'warn',
          'Project import root list failed; falling back to single import',
          {
            folderPath: payload.folderPath,
            error: err instanceof Error ? err.message : String(err)
          }
        )
      }
      const childFolders = sortEntriesByName(rootEntries.filter((entry) => entry.isDirectory))
      const shouldBatchImport = childFolders.length > 0 && !hasRootProjectFiles(rootEntries)

      if (shouldBatchImport) {
        const requestedParentTitle = payload.parentTitle.trim()
        const normalizedRoot = normalizePathForLookup(payload.folderPath).replace(/\/+$/, '')
        const previouslyImportedParent = parents.find((parent) =>
          parent.children.some((child) => parentFolderPath(child.folderPath) === normalizedRoot)
        )
        const parentTitle =
          (previouslyImportedParent?.title ?? requestedParentTitle) ||
          basename(payload.folderPath).trim()
        const existingPaths = new Set(
          parents.flatMap((parent) =>
            parent.children.map((child) => normalizePathForLookup(child.folderPath))
          )
        )
        writeWorkspaceLog('info', 'Batch project import detected', {
          folderPath: payload.folderPath,
          parentTitle,
          childFolderCount: childFolders.length,
          childFolders: childFolders.slice(0, 50).map((entry) => entry.name)
        })

        for (const folder of childFolders) {
          onProgress?.(`正在扫描章节 ${result.added + result.skipped + 1}/${childFolders.length}：${folder.name}`)
          const normalizedFolder = normalizePathForLookup(folder.absPath)
          if (existingPaths.has(normalizedFolder)) {
            result.skipped += 1
            continue
          }
          const inferred = inferChapterAndTitle(folder.name)
          const childPayload: SaveChildPayload = {
            parentTitle,
            chapterNumber: inferred.chapterNumber,
            projectTitle: inferred.projectTitle,
            folderPath: folder.absPath
          }
          const scanned = await this.scanForImport(childPayload)
          upsertChildProject(parents, childPayload, scanned)
          existingPaths.add(normalizedFolder)
          result.added += 1
        }
      } else {
        const existing = findChildLocation(
          parents,
          (child) =>
            normalizePathForLookup(child.folderPath) === normalizePathForLookup(payload.folderPath)
        )
        if (existing) {
          result.skipped = 1
          this.parents = parents
          syncDashboardStore(parents)
          return result
        }
        onProgress?.('正在扫描章节 1/1…')
        const scanned = await this.scanForImport(payload)
        upsertChildProject(parents, payload, scanned)
        result.added = 1
      }
    } else {
      onProgress?.('正在重新扫描项目…')
      const scanned = await this.scanForImport(payload)
      upsertChildProject(parents, payload, scanned, existingChildId)
      result.updated = 1
    }

    const existingParents = new Set(beforeTree.map(parent => parent.id))
    for (const parent of parents) {
      if (!existingParents.has(parent.id)) parent.duties = [...useSettingsStore().defaultImportDuties]
    }
    // Remove empty parents
    parents = parents.filter((p) => p.children.length > 0)
    parents = recomputeParentMtimes(parents)

    const oldIds = new Set(beforeTree.flatMap((parent) => parent.children.map((child) => child.id)))
    const addedIds = new Set(
      parents.flatMap((parent) =>
        parent.children.filter((child) => !oldIds.has(child.id)).map((child) => child.id)
      )
    )
    onProgress?.(`扫描完成，正在保存 ${result.added + result.updated} 个章节…`)
    const merged = await window.comicType.projectSaveChanges(beforeTree, toPlain(parents))
    const actualAdded = merged
      .flatMap((parent) => parent.children)
      .filter((child) => addedIds.has(child.id)).length
    result.skipped += result.added - actualAdded
    result.added = actualAdded
    this.parents = hydrateParents(merged)
    syncDashboardStore(this.parents)

    // 成就现在只吃标记记录：导入/更新完统一重算一次即可（不必逐话重算）。
    onProgress?.('项目已保存，正在更新统计…')
    await useAchievementsStore().refresh()
    return result
  },
  async scanForImport(
    this: WorkspaceContext,
    payload: SaveChildPayload
  ): Promise<ScannedChildProject> {
    const scan = await window.comicType.scanChildProject(payload.folderPath)
    // 入库前过"读全"那道闸（2026-10-05 移植 0.4.0）：目录不在 / 部分读不到 /
    // 文件仍在写 ⇒ 抛错，由调用方（保存/导入）把原因说给用户 —— 半截统计不许落库。
    requireCompleteScan(scan)
    const pairs = this.applyPsdStatusOverrides(scan.jpgPairs)
    writeWorkspaceLog('info', 'Child project import scan completed', {
      folderPath: payload.folderPath,
      parentTitle: payload.parentTitle,
      chapterNumber: payload.chapterNumber,
      projectTitle: payload.projectTitle,
      pairCount: pairs.length,
      txtCount: scan.txtFiles.length,
      errorCount: scan.errors.length,
      firstPsdPaths: pairs.slice(0, 20).map((pair) => pair.psd.absPath),
      errors: scan.errors.slice(0, 10)
    })
    return {
      lastMtimeMs: latestPairMtime(pairs),
      psdStats: psdStatsFromPairs(pairs),
      psdModeStats: modeStatsFromPairs(pairs),
      pairs
    }
  }
}
