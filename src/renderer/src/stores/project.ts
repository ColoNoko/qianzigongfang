import { defineStore } from 'pinia'
import { readRememberedRoots } from '@shared/paths'
import type {
  ChildProject,
  ChildProgressUpdate,
  JpgPsdPair,
  ParentProject,
  PsdStat
} from '@shared/types'
import { normalizeChapterNumber } from '@shared/chapter'
import { normalizeDuties } from '@shared/duties'
import { countablePsdStats, PAIRED_PSD_STATS_VERSION } from '@shared/status'

/**
 * Project store for the Dashboard view.
 *
 * The registry (electron-store key "projects") persists
 * `ParentProjectRecord[]` — records without PSD stats or mtime. The
 * dashboard, however, needs per-child PSD stats to compute progress via
 * `computeProgress`. Rather than scan the filesystem here (that belongs to
 * a separate scan IPC), the store accepts a richer shape from `storeGet`
 * that may include `psdStats` per child. When the registry only has
 * records, `psdStats` defaults to `[]` and `lastMtimeMs` to `0`, so the
 * dashboard degrades gracefully (all children show pct=null / 待启动).
 *
 * `DashboardChild` / `DashboardParent` extend the shared domain types
 * without modifying `@shared/types` — they are structurally assignable to
 * `ChildProject` / `ParentProject`.
 */

function toPlain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

/** Child enriched with PSD stats for progress computation. */
export interface DashboardChild extends ChildProject {
  psdStats: PsdStat[]
}

/** Parent whose children carry PSD stats. */
export interface DashboardParent extends ParentProject {
  children: DashboardChild[]
}

/** Normalize arbitrary registry payload into `DashboardParent[]`. */
function hydrate(raw: unknown): DashboardParent[] {
  if (!Array.isArray(raw)) return []
  return (raw as DashboardParent[]).map((p) => {
    // 同 hydrateParents：**固定字段重建**容易丢字段（2026-10-03 的 duties 与 sourceRoots 都栽在这）。
    // 新增父级字段时，这里和 `projectWorkspace.hydrateParents` **两处都要补**（有契约锁盯着）。
    const duties = normalizeDuties(p.duties)
    const sourceRoots = readRememberedRoots(p.sourceRoots)
    return {
    id: p.id,
    title: p.title,
    sourceRoot: typeof p.sourceRoot === 'string' ? p.sourceRoot : undefined,
    ...(sourceRoots.length > 0 ? { sourceRoots } : {}),
    ...(duties.length > 0 ? { duties } : {}),
    lastMtimeMs: p.lastMtimeMs ?? 0,
    children: (p.children ?? []).map((c) => ({
      id: c.id,
      parentTitle: c.parentTitle,
      folderPath: c.folderPath,
      chapterNumber: normalizeChapterNumber(c.chapterNumber),
      projectTitle: c.projectTitle,
      lastMtimeMs: c.lastMtimeMs ?? 0,
      psdStats: c.psdStats ?? [],
      statsVersion: c.statsVersion,
      psdModeStats: c.psdModeStats,
      modeStatsVersion: c.modeStatsVersion
    }))
    }
  })
}

function childHasStoredStats(rawChild: unknown): boolean {
  return (
    typeof rawChild === 'object' &&
    rawChild !== null &&
    Array.isArray((rawChild as { psdStats?: unknown }).psdStats) &&
    (rawChild as { statsVersion?: unknown }).statsVersion === PAIRED_PSD_STATS_VERSION
  )
}

function latestPairMtime(pairs: JpgPsdPair[]): number {
  return pairs.reduce((latest, pair) => Math.max(latest, pair.psd.mtimeMs), 0)
}

function normalizePath(absPath: string): string {
  return absPath.replace(/\\/g, '/').normalize('NFC').toLocaleLowerCase()
}

function hydrateStatusOverrides(raw: unknown): Record<string, 'done' | 'pending'> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {}
  return Object.fromEntries(
    Object.entries(raw).filter(
      (entry): entry is [string, 'done' | 'pending'] =>
        entry[1] === 'done' || entry[1] === 'pending'
    )
  )
}

function statsFromPairs(
  pairs: JpgPsdPair[],
  overrides: Record<string, 'done' | 'pending'>
): PsdStat[] {
  return countablePsdStats(
    pairs.map((pair) => {
      const override = pair.previewOnly ? undefined : overrides[pair.psd.absPath]
      if (!override) return pair
      // 完成度由 status 表达；countablePsdStats 据此编码时间戳（只认手动标记）。
      return { ...pair, psd: { ...pair.psd, status: override } }
    })
  )
}

async function enrichMissingStats(
  projects: DashboardParent[],
  raw: unknown,
  overrides: Record<string, 'done' | 'pending'>
): Promise<boolean> {
  if (!Array.isArray(raw)) return false
  let changed = false
  for (let parentIndex = 0; parentIndex < projects.length; parentIndex++) {
    const parent = projects[parentIndex]
    const rawParent = raw[parentIndex] as { children?: unknown[] } | undefined
    for (let childIndex = 0; childIndex < parent.children.length; childIndex++) {
      const child = parent.children[childIndex]
      const rawChild = rawParent?.children?.[childIndex]
      if (childHasStoredStats(rawChild)) continue
      changed = true
      try {
        const scan = await window.comicType.scanChildProject(child.folderPath)
        const childOverrides = { ...overrides }
        const remembered =
          typeof window.comicType?.memoryGetProject === 'function'
            ? await window.comicType.memoryGetProject(child.id)
            : null
        const migrations: Array<{
          pathKey: string
          path: string
          status: 'done' | 'pending'
          mtimeMs: number
        }> = []
        for (const pair of scan.jpgPairs) {
          if (pair.previewOnly) continue
          const pathKey = normalizePath(pair.psd.absPath)
          const memoryStatus = remembered?.files[pathKey]?.status
          const legacyStatus = overrides[pair.psd.absPath] ?? overrides[pathKey]
          const status = memoryStatus ?? legacyStatus
          if (status) childOverrides[pair.psd.absPath] = status
          if (!memoryStatus && legacyStatus) {
            migrations.push({
              pathKey,
              path: pair.psd.absPath,
              status: legacyStatus,
              mtimeMs: pair.psd.mtimeMs
            })
          }
        }
        if (migrations.length > 0 && typeof window.comicType?.memorySetStatuses === 'function') {
          await window.comicType.memorySetStatuses(child.id, child.folderPath, toPlain(migrations))
        }
        child.psdStats = statsFromPairs(scan.jpgPairs, childOverrides)
        child.lastMtimeMs = latestPairMtime(scan.jpgPairs)
        child.statsVersion = PAIRED_PSD_STATS_VERSION
      } catch {
        // ⚠️ 读不到目录（被删/改名、网络盘没挂载）时**不许盖成"已统计"**。
        // 一旦写上 statsVersion，`childHasStoredStats()` 就判定"已统计"，
        // `enrichMissingStats` 再也不会补算 —— 那一话永久显示 0/0，重启也不自修。
        // 2026-09-30 审查修掉了 `scanChild()` 里同一类问题，漏了这里；2026-10-01 补上。
        // 留着 statsVersion 空缺 = 仍然"未统计"，下次进首页会重试，目录放回来就自愈。
        // psdStats/lastMtimeMs 保持原样赋空值：形状与旧行为一致，界面不用改。
        child.psdStats = []
        child.lastMtimeMs = 0
      }
    }
    parent.lastMtimeMs = parent.children.reduce(
      (latest, child) => Math.max(latest, child.lastMtimeMs),
      0
    )
  }
  return changed
}

function progressUpdates(projects: DashboardParent[]): ChildProgressUpdate[] {
  return projects.flatMap((parent) =>
    parent.children.map((child) => ({
      childId: child.id,
      lastMtimeMs: child.lastMtimeMs,
      psdStats: child.psdStats,
      statsVersion: child.statsVersion
    }))
  )
}

export const useProjectStore = defineStore('project', {
  state: () => ({
    projects: [] as DashboardParent[],
    recentProjectIds: [] as string[],
    loading: false,
    error: null as string | null
  }),

  getters: {
    /** Flatten all children across every parent. */
    allChildren(state): ChildProject[] {
      return state.projects.flatMap((p) => p.children)
    }
  },

  actions: {
    /** Load projects from the registry via typed IPC. */
    async loadProjects(): Promise<void> {
      this.loading = true
      this.error = null
      try {
        const [raw, rawRecentIds, rawOverrides] = await Promise.all([
          window.comicType.projectGetTree(),
          window.comicType.storeGet('recentProjectIds'),
          window.comicType.storeGet('psdStatusOverrides')
        ])
        const projects = hydrate(raw)
        const statsMigrated = await enrichMissingStats(
          projects,
          raw,
          hydrateStatusOverrides(rawOverrides)
        )
        this.projects = projects
        if (statsMigrated) {
          await window.comicType.projectSaveProgress(toPlain(progressUpdates(projects)))
        }
        this.recentProjectIds = Array.isArray(rawRecentIds)
          ? rawRecentIds.filter((id): id is string => typeof id === 'string').slice(0, 3)
          : []
      } catch (e) {
        this.error = e instanceof Error ? e.message : String(e)
      } finally {
        this.loading = false
      }
    },

    /** Re-fetch the registry. */
    async refresh(): Promise<void> {
      await this.loadProjects()
    }
  }
})
