/**
 * 项目树的建 / 查 / 插（纯函数）：ID 生成、父级定位、目录名推断章节号、按名排序。
 *
 * P6（2026-10-05）从 `stores/projectWorkspace.ts` 拆出：**纯搬家**。
 * 唯一的机械改动是**每段开头加了一个 `export `**（它们原本是那个文件的模块私有函数），
 * 函数体本身逐字节未改。
 */
import { extractChapterNumber, normalizeChapterNumber } from '@shared/chapter'
import { PAIRED_MODE_STATS_VERSION, PAIRED_PSD_STATS_VERSION } from '@shared/status'
import type { DirEntry } from '@shared/ipc-api'
import type { ChildProject, JpgPsdPair, ParentProject, PsdStat, WorkMode } from '@shared/types'
import { extname, normalizePathForLookup } from './workspace-paths'

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.avif', '.jfif'])
const PSD_EXT = '.psd'

export type SaveChildPayload = {
  parentTitle: string
  chapterNumber: string
  projectTitle: string
  folderPath: string
}

export type ScannedChildProject = {
  lastMtimeMs: number
  psdStats: PsdStat[]
  psdModeStats: Record<WorkMode, PsdStat[]>
  pairs: JpgPsdPair[]
}

export function hasRootProjectFiles(entries: DirEntry[]): boolean {
  return entries.some((entry) => {
    if (entry.isDirectory) return false
    const ext = extname(entry.name)
    return ext === PSD_EXT || IMAGE_EXTS.has(ext)
  })
}

export function inferChapterAndTitle(folderName: string): {
  chapterNumber: string
  projectTitle: string
} {
  const normalized = folderName.trim()
  const withUnit = normalized.match(
    /^((?:第\s*)?\d+(?:\.\d+)?\s*(?:话|話|集|回|章)?)(?:[\s._\-—–·]+(.+))?$/i
  )
  if (withUnit) {
    const chapterNumber = extractChapterNumber(withUnit[1])
    const projectTitle = withUnit[2]?.trim() || normalized
    return { chapterNumber, projectTitle }
  }

  const leadingNumber = normalized.match(/^(\d+(?:\.\d+)?)(?:[\s._\-—–·]+(.+))?$/)
  if (leadingNumber) {
    return {
      chapterNumber: extractChapterNumber(leadingNumber[1]),
      projectTitle: leadingNumber[2]?.trim() || normalized
    }
  }

  return { chapterNumber: extractChapterNumber(normalized), projectTitle: normalized }
}

function makeParentId(): string {
  return `parent-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

function makeChildId(): string {
  return `child-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

function ensureParent(parents: ParentProject[], title: string): ParentProject {
  let parent = parents.find((p) => p.title === title)
  if (!parent) {
    parent = {
      id: makeParentId(),
      title,
      children: [],
      lastMtimeMs: 0
    }
    parents.push(parent)
  }
  return parent
}

export function findChildLocation(
  parents: ParentProject[],
  predicate: (child: ChildProject) => boolean
): { parent: ParentProject; childIndex: number; child: ChildProject } | null {
  for (const parent of parents) {
    const childIndex = parent.children.findIndex(predicate)
    if (childIndex !== -1) {
      return { parent, childIndex, child: parent.children[childIndex] }
    }
  }
  return null
}

export function sortEntriesByName(entries: DirEntry[]): DirEntry[] {
  return [...entries].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN', { numeric: true }))
}

export function upsertChildProject(
  parents: ParentProject[],
  payload: SaveChildPayload,
  scanned: ScannedChildProject,
  existingChildId?: string
): ChildProject {
  const trimmedParentTitle = payload.parentTitle.trim()
  const normalizedFolderPath = normalizePathForLookup(payload.folderPath)
  const existingLocation = existingChildId
    ? findChildLocation(parents, (child) => child.id === existingChildId)
    : findChildLocation(
        parents,
        (child) => normalizePathForLookup(child.folderPath) === normalizedFolderPath
      )

  const existingChild = existingLocation?.child
  if (existingLocation) {
    existingLocation.parent.children.splice(existingLocation.childIndex, 1)
  }

  const parent = ensureParent(parents, trimmedParentTitle)
  const child: ChildProject = {
    id: existingChild?.id ?? makeChildId(),
    parentTitle: trimmedParentTitle,
    folderPath: payload.folderPath,
    chapterNumber: normalizeChapterNumber(payload.chapterNumber),
    projectTitle: payload.projectTitle.trim(),
    lastMtimeMs: scanned.lastMtimeMs,
    psdStats: scanned.psdStats,
    statsVersion: PAIRED_PSD_STATS_VERSION,
    psdModeStats: scanned.psdModeStats,
    modeStatsVersion: PAIRED_MODE_STATS_VERSION
  }
  parent.children.push(child)
  return child
}
