import { lastPathSegment } from '@shared/paths'
import type {
  ChildProject,
  ParentProject,
  JpgPsdPair,
  PsdStat,
  TypesetStatus,
  WorkMode,
  WorkModeStatus
} from '@shared/types'
import type { DirEntry } from '@shared/ipc-api'
import {
  countablePsdStats,
  PAIRED_MODE_STATS_VERSION,
  PAIRED_PSD_STATS_VERSION
} from '@shared/status'
import { useProjectStore } from '../project'
import { normalizeChapterNumber } from '@shared/chapter'

export { hydrateProjectTree as hydrateParents } from '@shared/project-tree'

/**
 * Project workspace store — holds the registry tree and the active child.
 *
 * Task 4.2 created the minimal surface: `parents` state + `findChild` getter
 * so Project.vue can resolve a route childId to a ChildProject (or null for
 * the "项目不存在" fallback).
 *
 * Task 4.5 extended this with `activeChild` + `psdStats` state, a `progress`
 * getter that derives `ChapterProgress` via `computeProgress`, and the
 * `setActiveChild` / `clearActiveChild` actions.
 *
 * Task 7.1 adds hot-path optimizations:
 *   - `debouncedScan` — 200ms debounce wrapper around `scanChild` so rapid
 *     `activeChild` switches (e.g. arrow-key navigation) coalesce into one
 *     scan. The pending timer is module-scoped (like `_systemUnwatch` in
 *     theme.ts) to keep it out of reactive state.
 *   - `thumbUrlCache` — LRU cache (max 200 entries) of `readFileDataURL`
 *     results so re-rendering a thumbnail grid does not re-read the file.
 *
 * `PsdStat` is reused from `./project` (task 2.5) rather than redefined — it
 * is the same `{ mtimeMs, ctimeMs }` shape `computeProgress` consumes.
 */

/**
 * Convert Vue reactive structures to plain JSON before sending over IPC.
 * Electron structured clone cannot clone Vue reactive Proxy objects.
 */
export function toPlain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

/**
 * 章节根目录**不在**（被删掉 / 被改名）。
 *
 * 为什么单独一个类型：用户经常整理本地文件，把某一话整个文件夹删掉或改名是
 * **预期操作**，不是故障。调用方据此把提示从"红色告警"降级为"安静的状态条"，
 * 而后者的触发条件（权限不足、网络盘没挂载）照旧报警。
 *
 * ⚠️ 它仍然是**抛错**：`scanChild()` 里"绝不写任何缓存"那条守卫
 * （2026-09-30 审查 high）因此一个字都不用改，也就不会把这一话记成 0 页。
 */
export class ChildRootMissingError extends Error {
  readonly rootMissing = true

  constructor(readonly folderPath: string) {
    super(`章节目录不在：${folderPath}`)
    this.name = 'ChildRootMissingError'
  }
}

/** Max entries in the thumbnail URL LRU cache. */
export const THUMB_CACHE_MAX = 200

/** Debounce window (ms) for `debouncedScan`. */
export const SCAN_DEBOUNCE_MS = 200

export const PSD_STATUS_OVERRIDES_KEY = 'psdStatusOverrides'

export const DONE_OFFSET_MS = 5 * 60 * 1000 + 1

export const IMAGE_EXTS = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.gif',
  '.bmp',
  '.avif',
  '.jfif'
])

export const PSD_EXT = '.psd'

export type PsdStatusOverride = 'done' | 'pending'

export type SaveChildPayload = {
  parentTitle: string
  chapterNumber: string
  projectTitle: string
  folderPath: string
}

export interface ImportResult {
  added: number
  skipped: number
  updated: number
}

export type ScannedChildProject = {
  lastMtimeMs: number
  psdStats: PsdStat[]
  psdModeStats: Record<WorkMode, PsdStat[]>
  pairs: JpgPsdPair[]
}

export function latestPairMtime(pairs: JpgPsdPair[]): number {
  return pairs.reduce((latest, pair) => Math.max(latest, pair.psd.mtimeMs), 0)
}

export function psdStatsFromPairs(pairs: JpgPsdPair[]): PsdStat[] {
  return countablePsdStats(pairs)
}

export function basename(absPath: string): string {
  return lastPathSegment(absPath, absPath)
}

export function extname(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot >= 0 ? name.slice(dot).toLowerCase() : ''
}

export function hasRootProjectFiles(entries: DirEntry[]): boolean {
  return entries.some((entry) => {
    if (entry.isDirectory) return false
    const ext = extname(entry.name)
    return ext === PSD_EXT || IMAGE_EXTS.has(ext)
  })
}

export function makeParentId(): string {
  return `parent-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

export function makeChildId(): string {
  return `child-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

export function normalizePathForLookup(absPath: string): string {
  return absPath.replace(/\\/g, '/').normalize('NFC').toLocaleLowerCase()
}

export function parentFolderPath(absPath: string): string {
  const normalized = normalizePathForLookup(absPath).replace(/\/+$/, '')
  const separator = normalized.lastIndexOf('/')
  return separator > 0 ? normalized.slice(0, separator) : normalized
}

export function statsEqual(a: PsdStat[] | undefined, b: PsdStat[]): boolean {
  if (!a || a.length !== b.length) return false
  return a.every(
    (stat, index) => stat.mtimeMs === b[index].mtimeMs && stat.ctimeMs === b[index].ctimeMs
  )
}

export function ensureParent(parents: ParentProject[], title: string): ParentProject {
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

export function syncDashboardStore(parents: ParentProject[]): void {
  const projectStore = useProjectStore()
  projectStore.projects = parents.map((parent) => ({
    ...parent,
    children: parent.children.map((child) => ({
      ...child,
      psdStats: child.psdStats ?? []
    }))
  }))
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

export function hydrateOverrides(raw: unknown): Record<string, PsdStatusOverride> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {}
  const result: Record<string, PsdStatusOverride> = {}
  for (const [path, value] of Object.entries(raw)) {
    if (value === 'done' || value === 'pending') {
      result[path] = value
    }
  }
  return result
}

export function applyOverrideToPair(
  pair: JpgPsdPair,
  override: PsdStatusOverride | undefined,
  modes?: WorkModeStatus,
  modeTimestamps?: Partial<Record<WorkMode, number>>
): JpgPsdPair {
  if (!override && !modes && !modeTimestamps) return pair

  let status: TypesetStatus = pair.psd.status
  let ctimeMs = pair.psd.ctimeMs

  if (modes) {
    status = modes.typeset ? 'done' : 'pending'
    ctimeMs = modes.typeset ? pair.psd.mtimeMs - DONE_OFFSET_MS : pair.psd.mtimeMs
  } else if (override) {
    status = override
    ctimeMs = override === 'done' ? pair.psd.mtimeMs - DONE_OFFSET_MS : pair.psd.mtimeMs
  }

  return {
    ...pair,
    psd: {
      ...pair.psd,
      ctimeMs,
      status,
      ...(modes ? { modes } : {}),
      ...(modeTimestamps ? { modeTimestamps } : {})
    }
  }
}

export function writeWorkspaceLog(
  level: 'info' | 'warn' | 'error',
  message: string,
  data: unknown
): void {
  if (typeof window.comicType?.writeLog !== 'function') return
  void window.comicType
    .writeLog({
      level,
      scope: 'project-workspace',
      message,
      data
    })
    .catch(() => {
      // Diagnostic logging must never block project scanning.
    })
}

export function recomputeParentMtimes(parents: ParentProject[]): ParentProject[] {
  for (const parent of parents) {
    parent.lastMtimeMs = parent.children.reduce(
      (latest, child) => Math.max(latest, child.lastMtimeMs),
      0
    )
  }
  return parents
}

export function snapshotParents(parents: ParentProject[]): ParentProject[] {
  return parents.map((parent) => ({
    ...parent,
    children: parent.children.map((child) => ({
      ...child,
      psdStats: child.psdStats?.map((stat) => ({ ...stat }))
    }))
  }))
}
