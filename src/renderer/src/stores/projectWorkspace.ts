import { lastPathSegment, readRememberedRoots } from '@shared/paths'
import { defineStore } from 'pinia'
import type {
  ChildProject,
  ChapterProgress,
  ParentProject,
  JpgPsdPair,
  PsdStat,
  TypesetStatus,
  WorkMode,
  WorkModeStatus
} from '@shared/types'
import type {
  MarkWriteBackResult, DirEntry, ProjectMemoryStatusUpdate } from '@shared/ipc-api'
import {
  createMarkOperationId,
  type MarkAuditContext,
  type MarkAuditOperation
} from '@shared/mark-audit'
import {
  computeProgress,
  countablePsdStats,
  modeStatsFromPairs,
  PAIRED_MODE_STATS_VERSION,
  PAIRED_PSD_STATS_VERSION
} from '@shared/status'
import { useProjectStore } from './project'
import { useAchievementsStore } from './achievements'
import { useToastStore } from './toast'
import { extractChapterNumber, normalizeChapterNumber } from '@shared/chapter'
import { createEmptyModeStatus, modeStatusToLegacyStatus, normalizeModeStatus } from '@shared/modes'
import { normalizeDuties } from '@shared/duties'

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
function toPlain<T>(value: T): T {
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
const THUMB_CACHE_MAX = 200

/** Debounce window (ms) for `debouncedScan`. */
const SCAN_DEBOUNCE_MS = 200
const PSD_STATUS_OVERRIDES_KEY = 'psdStatusOverrides'
const DONE_OFFSET_MS = 5 * 60 * 1000 + 1
const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.avif', '.jfif'])
const PSD_EXT = '.psd'

type PsdStatusOverride = 'done' | 'pending'
type SaveChildPayload = {
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

type ScannedChildProject = {
  lastMtimeMs: number
  psdStats: PsdStat[]
  psdModeStats: Record<WorkMode, PsdStat[]>
  pairs: JpgPsdPair[]
}

/** Pending debounce timer for `debouncedScan`. Module-scoped to stay out of
 * reactive state — same pattern as `_systemUnwatch` in theme.ts. */
let _scanTimer: ReturnType<typeof setTimeout> | null = null

function latestPairMtime(pairs: JpgPsdPair[]): number {
  return pairs.reduce((latest, pair) => Math.max(latest, pair.psd.mtimeMs), 0)
}

function psdStatsFromPairs(pairs: JpgPsdPair[]): PsdStat[] {
  return countablePsdStats(pairs)
}

function basename(absPath: string): string {
  return lastPathSegment(absPath, absPath)
}

function extname(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot >= 0 ? name.slice(dot).toLowerCase() : ''
}

function hasRootProjectFiles(entries: DirEntry[]): boolean {
  return entries.some((entry) => {
    if (entry.isDirectory) return false
    const ext = extname(entry.name)
    return ext === PSD_EXT || IMAGE_EXTS.has(ext)
  })
}

function inferChapterAndTitle(folderName: string): {
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

function normalizePathForLookup(absPath: string): string {
  return absPath.replace(/\\/g, '/').normalize('NFC').toLocaleLowerCase()
}

function parentFolderPath(absPath: string): string {
  const normalized = normalizePathForLookup(absPath).replace(/\/+$/, '')
  const separator = normalized.lastIndexOf('/')
  return separator > 0 ? normalized.slice(0, separator) : normalized
}

function statsEqual(a: PsdStat[] | undefined, b: PsdStat[]): boolean {
  if (!a || a.length !== b.length) return false
  return a.every(
    (stat, index) => stat.mtimeMs === b[index].mtimeMs && stat.ctimeMs === b[index].ctimeMs
  )
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

function findChildLocation(
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

function sortEntriesByName(entries: DirEntry[]): DirEntry[] {
  return [...entries].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN', { numeric: true }))
}

function syncDashboardStore(parents: ParentProject[]): void {
  const projectStore = useProjectStore()
  projectStore.projects = parents.map((parent) => ({
    ...parent,
    children: parent.children.map((child) => ({
      ...child,
      psdStats: child.psdStats ?? []
    }))
  }))
}

function upsertChildProject(
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

function hydrateOverrides(raw: unknown): Record<string, PsdStatusOverride> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {}
  const result: Record<string, PsdStatusOverride> = {}
  for (const [path, value] of Object.entries(raw)) {
    if (value === 'done' || value === 'pending') {
      result[path] = value
    }
  }
  return result
}

function applyOverrideToPair(
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

function writeWorkspaceLog(level: 'info' | 'warn' | 'error', message: string, data: unknown): void {
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

function recomputeParentMtimes(parents: ParentProject[]): ParentProject[] {
  for (const parent of parents) {
    parent.lastMtimeMs = parent.children.reduce(
      (latest, child) => Math.max(latest, child.lastMtimeMs),
      0
    )
  }
  return parents
}

function snapshotParents(parents: ParentProject[]): ParentProject[] {
  return parents.map((parent) => ({
    ...parent,
    children: parent.children.map((child) => ({
      ...child,
      psdStats: child.psdStats?.map((stat) => ({ ...stat }))
    }))
  }))
}

export const useProjectWorkspace = defineStore('projectWorkspace', {
  state: () => ({
    parents: [] as ParentProject[],
    activeChild: null as ChildProject | null,
    psdStats: [] as PsdStat[],
    txtFiles: [] as string[],
    /**
     * LRU cache of thumbnail data URLs. Key = absPath, value = data URL.
     * Capped at `THUMB_CACHE_MAX` (200) entries; the least-recently-used
     * entry is evicted on overflow.
     */
    thumbUrlCache: new Map<string, string>(),
    psdStatusOverrides: {} as Record<string, PsdStatusOverride>,
    psdModeStatuses: {} as Record<string, WorkModeStatus>,
    psdModeTimestamps: {} as Record<string, Partial<Record<WorkMode, number>>>,
    psdStatusOverridesLoaded: false
  }),

  getters: {
    /**
     * Search all parents for a child with the given id. Returns the first
     * match or null. Parameterized getter (returns a function) so the
     * component can pass the route childId at call time.
     */
    findChild(state) {
      return (childId: string): ChildProject | null => {
        for (const parent of state.parents) {
          const child = parent.children.find((c) => c.id === childId)
          if (child) return child
        }
        return null
      }
    },

    /**
     * Derive `ChapterProgress` from the current `psdStats` via the pure
     * `computeProgress` helper (task 2.4). Returns `{done:0,total:0,pct:null}`
     * when there are no stats — FooterBar renders "无文件" for that case.
     */
    progress(state): ChapterProgress {
      return computeProgress(state.psdStats)
    }
  },

  actions: {
    async persistParentsProgress(): Promise<void> {
      recomputeParentMtimes(this.parents)

      const updates = this.parents.flatMap((parent) =>
        parent.children.map((child) => ({
          childId: child.id,
          lastMtimeMs: child.lastMtimeMs,
          psdStats: child.psdStats,
          statsVersion: child.statsVersion,
          psdModeStats: child.psdModeStats,
          modeStatsVersion: child.modeStatsVersion
        }))
      )
      await window.comicType.projectSaveProgress(toPlain(updates))

      const persistedParents = snapshotParents(this.parents)
      const activeChildId = this.activeChild?.id
      this.parents = persistedParents
      if (activeChildId) {
        const updated = this.findChild(activeChildId)
        if (updated) this.setActiveChild(updated, updated.psdStats ?? [])
      }
      syncDashboardStore(persistedParents)
    },

    async loadRememberedStatuses(child: ChildProject, pairs: JpgPsdPair[]): Promise<void> {
      await this.ensurePsdStatusOverridesLoaded()
      const remembered =
        typeof window.comicType?.memoryGetProject === 'function'
          ? await window.comicType.memoryGetProject(child.id)
          : null
      const next = { ...this.psdStatusOverrides }
      const nextModes = { ...this.psdModeStatuses }
      const nextTimestamps = { ...this.psdModeTimestamps }
      // 用 IPC 契约类型，而不是手抄一份形状 —— 手抄的那份把 `modes` 写成了**整份**
      // `WorkModeStatus`，于是"发整份 modes"看起来是类型允许的（就是它掩盖了那个 bug）。
      const migrationUpdates: ProjectMemoryStatusUpdate[] = []

      for (const pair of pairs) {
        const pathKey = normalizePathForLookup(pair.psd.absPath)
        const memoryFile = remembered?.files[pathKey]
        const memoryStatus = memoryFile?.status
        const legacyStatus =
          this.psdStatusOverrides[pair.psd.absPath] ?? this.psdStatusOverrides[pathKey]
        const status = memoryStatus ?? legacyStatus
        if (!status) continue

        let modes = memoryFile?.modes
        if (!modes) {
          modes = createEmptyModeStatus()
          modes.typeset = status === 'done'
        } else {
          modes = normalizeModeStatus(modes)
        }

        const modeTimestamps = memoryFile?.modeTimestamps ?? {}
        next[pair.psd.absPath] = status
        nextModes[pair.psd.absPath] = modes
        nextTimestamps[pair.psd.absPath] = modeTimestamps
        if (!memoryStatus && legacyStatus) {
          // 迁移写回：把旧式 done/pending 落到新库的**只有 typeset 这一位**。
          //
          // 这里**不能**发上面那个整份 `modes`：主进程是按"补丁"合并的
          // （setStoredProjectMemoryStatuses），发整份就等于"覆盖四个模式" ——
          // 万一该路径在库里已经有其它模式的标记，就被这次迁移悄悄抹掉了。
          // 时间戳同理：本分支的 `modeTimestamps` 恒为空对象，干脆不传（= 保留库里的值）。
          migrationUpdates.push({
            pathKey,
            path: pair.psd.absPath,
            status: legacyStatus,
            mtimeMs: pair.psd.mtimeMs,
            modes: { typeset: status === 'done' }
          })
        }
      }
      this.psdStatusOverrides = next
      this.psdModeStatuses = nextModes
      this.psdModeTimestamps = nextTimestamps
      if (
        migrationUpdates.length > 0 &&
        typeof window.comicType?.memorySetStatuses === 'function'
      ) {
        await window.comicType.memorySetStatuses(
          child.id,
          child.folderPath,
          toPlain(migrationUpdates),
          // 迁移写回也留痕（kind='migrate'）：它本身幂等，但"库变了却没有记录"最难查。
          { opId: createMarkOperationId(), kind: 'migrate', source: 'migrate' }
        )
      }
    },

    async rememberStatuses(
      child: ChildProject,
      pairs: JpgPsdPair[],
      status: PsdStatusOverride,
      modes?: Partial<Record<WorkMode, boolean>>,
      audit?: MarkAuditContext
    ): Promise<void> {
      const actualPairs = pairs
      if (actualPairs.length === 0) return
      const next = { ...this.psdStatusOverrides }
      const nextModes = { ...this.psdModeStatuses }
      const nextTimestamps = { ...this.psdModeTimestamps }

      // 写库载荷在这里**同时**建好：每一步的"内存值"与"要写进库里的值"同源，
      // 不靠事后回查（回查要写一个兜底值，而兜底值的方向一旦写错 —— 比如把
      // "已完成"兜成 0 —— 主进程会把时间戳**删掉**，已完成就被算成 0）。
      const updates: ProjectMemoryStatusUpdate[] = []
      // 补丁形状：只带本次真正要改的模式。`typeset` 必须显式给 —— 主进程现在只在
      // "完全没带 modes"时才用 legacy status 推 typeset（database.ts），
      // 少了它，「标记嵌字」会静默不生效。
      const modePatch: Partial<Record<WorkMode, boolean>> = { ...(modes ?? {}) }
      if (modes?.typeset === undefined) modePatch.typeset = status === 'done'

      for (const pair of actualPairs) {
        next[pair.psd.absPath] = status
        const currentModes = this.psdModeStatuses[pair.psd.absPath] ?? createEmptyModeStatus()
        const merged = { ...currentModes, ...(modes ?? {}) }
        if (modes?.typeset === undefined) merged.typeset = status === 'done'
        nextModes[pair.psd.absPath] = normalizeModeStatus(merged)

        const doneAt = Date.now()
        const currentTimestamps = { ...(this.psdModeTimestamps[pair.psd.absPath] ?? {}) }
        if (status === 'done') currentTimestamps.typeset = doneAt
        else delete currentTimestamps.typeset
        nextTimestamps[pair.psd.absPath] = currentTimestamps

        updates.push({
          pathKey: normalizePathForLookup(pair.psd.absPath),
          path: pair.psd.absPath,
          status,
          mtimeMs: pair.psd.mtimeMs,
          modes: modePatch,
          // 与上面的内存值同一个 `doneAt`；pending 写 0（主进程把 0 当"清掉该模式的时间戳"）。
          modeTimestamps: { typeset: status === 'done' ? doneAt : 0 }
        })
      }
      this.psdStatusOverrides = next
      this.psdModeStatuses = nextModes
      this.psdModeTimestamps = nextTimestamps

      if (typeof window.comicType?.memorySetStatuses === 'function') {
        await window.comicType.memorySetStatuses(
          child.id,
          child.folderPath,
          toPlain(updates),
          audit
        )
      } else {
        // Compatibility fallback for tests and older preload bridges.
        await window.comicType.storeSet(PSD_STATUS_OVERRIDES_KEY, next)
      }
    },

    async rememberModeStatuses(
      child: ChildProject,
      pairs: JpgPsdPair[],
      mode: WorkMode,
      value: boolean,
      audit?: MarkAuditContext
    ): Promise<void> {
      const actualPairs = pairs
      if (actualPairs.length === 0) return

      const nextModes = { ...this.psdModeStatuses }
      const nextLegacy = { ...this.psdStatusOverrides }
      const nextTimestamps = { ...this.psdModeTimestamps }

      const updates = actualPairs.map((pair) => {
        const pathKey = normalizePathForLookup(pair.psd.absPath)
        const currentModes =
          this.psdModeStatuses[pair.psd.absPath] ?? pair.psd.modes ?? createEmptyModeStatus()
        const modes = normalizeModeStatus({ ...currentModes, [mode]: value })
        const legacyStatus = modeStatusToLegacyStatus(modes)

        const at = Date.now()
        const currentTimestamps = { ...(this.psdModeTimestamps[pair.psd.absPath] ?? {}) }
        if (value) currentTimestamps[mode] = at
        else delete currentTimestamps[mode]

        nextModes[pair.psd.absPath] = modes
        nextLegacy[pair.psd.absPath] = legacyStatus
        nextTimestamps[pair.psd.absPath] = currentTimestamps

        return {
          pathKey,
          path: pair.psd.absPath,
          status: legacyStatus,
          mtimeMs: pair.psd.mtimeMs,
          // 补丁：只带本次要改的那一个模式。库里其它模式由主进程按 patch 合并保留
          // —— 整份发过去就等于"把别的模式也重写一遍"，客户端内存里那份一旦不新鲜
          // 就会静默抹掉用户的标记（2026-09-26 的现场）。
          modes: { [mode]: value },
          // 与上面写进内存的时间戳是**同一个值**；取消标记写 0（主进程把 0 当"清掉"）。
          modeTimestamps: { [mode]: value ? at : 0 }
        }
      })

      this.psdModeStatuses = nextModes
      this.psdStatusOverrides = nextLegacy
      this.psdModeTimestamps = nextTimestamps

      if (typeof window.comicType?.memorySetStatuses === 'function') {
        await window.comicType.memorySetStatuses(
          child.id,
          child.folderPath,
          toPlain(updates),
          audit
        )
      } else {
        await window.comicType.storeSet(PSD_STATUS_OVERRIDES_KEY, nextLegacy)
      }
    },

    /** Set the active child and its PSD stats together. Both must be supplied
     * atomically so `progress` never reads a stale `psdStats` for a different
     * child. Pass `null` + `[]` to represent "no active child".
     */
    setActiveChild(child: ChildProject | null, stats: PsdStat[]): void {
      this.activeChild = child
      this.psdStats = stats
    },

    /**
     * Clear the active child and its stats. Resets `progress` to the
     * `{done:0,total:0,pct:null}` "无文件" state.
     */
    clearActiveChild(): void {
      this.activeChild = null
      this.psdStats = []
      this.txtFiles = []
    },

    /**
     * Scan a child project's folder recursively in the main process and return
     * its `JpgPsdPair[]`. We intentionally avoid a long-lived scan-result
     * cache here: PSDs may be edited by external apps without changing the
     * saved registry row, so re-scanning is the reliable source of truth.
     */
    async scanChild(child: ChildProject): Promise<JpgPsdPair[]> {
      const result = await window.comicType.scanChildProject(child.folderPath)
      // ⚠️ 「0 页 + 有错误」≠「这一话有 0 个文件」（2026-09-30 审查 high）：
      // scanner 读不到目录时**不抛错**，只把错误塞进 `errors[]` 然后返回空列表
      // （scanner.ts 的 walk()）。照旧往下走会把 psdStats=[]、statsVersion=PAIRED、
      // lastMtimeMs=0 写进库 → 侧栏/首页永久显示 0/0；而 childHasStoredStats() 之后
      // 判定"已统计"，enrichMissingStats 不再补算（重启也不自修），界面还报"已标记成功"。
      // 这里直接把这次取数判为**失败**：不写任何缓存，由调用方决定怎么提示。
      // 触发很日常：U 盘/网络盘没挂载、OneDrive 占位符、文件夹被改名而注册表还是旧路径。
      if (result.jpgPairs.length === 0 && result.errors.length > 0) {
        const first = result.errors[0]
        // 目录**不在**（被删/改名）与"读不到"（权限、网络盘）要分开提示：前者是
        // 用户整理文件后的预期状态，每次切回窗口都弹一次红字纯属骚扰。两者都仍然
        // 抛错 —— 守住上面那条"不写任何缓存"的底线，区别只在错误类型。
        if (result.rootMissing) {
          writeWorkspaceLog('info', 'Child project folder missing', {
            childId: child.id,
            folderPath: child.folderPath,
            errorCount: result.errors.length
          })
          throw new ChildRootMissingError(child.folderPath)
        }
        writeWorkspaceLog('warn', 'Child project scan failed (unreadable)', {
          childId: child.id,
          folderPath: child.folderPath,
          errorCount: result.errors.length,
          firstError: first ? `${first.path}：${first.msg}` : ''
        })
        throw new Error(
          `读不到这一话的目录（${result.errors.length} 个路径报错${first ? `，例如 ${first.msg}` : ''}）`
        )
      }
      await this.loadRememberedStatuses(child, result.jpgPairs)
      const pairs = this.applyPsdStatusOverrides(result.jpgPairs)
      child.psdModeStats = modeStatsFromPairs(pairs)
      child.modeStatsVersion = PAIRED_MODE_STATS_VERSION
      this.txtFiles = result.txtFiles
      writeWorkspaceLog('info', 'Child project scan completed', {
        childId: child.id,
        title: child.projectTitle,
        folderPath: child.folderPath,
        pairCount: pairs.length,
        txtCount: result.txtFiles.length,
        errorCount: result.errors.length,
        firstPsdPaths: pairs.slice(0, 20).map((pair) => pair.psd.absPath),
        errors: result.errors.slice(0, 10)
      })
      const lastMtimeMs = latestPairMtime(pairs)
      const psdStats = psdStatsFromPairs(pairs)
      const progressChanged =
        child.statsVersion !== PAIRED_PSD_STATS_VERSION ||
        child.lastMtimeMs !== lastMtimeMs ||
        !statsEqual(child.psdStats, psdStats)
      child.lastMtimeMs = lastMtimeMs
      child.psdStats = psdStats
      child.statsVersion = PAIRED_PSD_STATS_VERSION
      const parent = this.parents.find((p) => p.children.some((c) => c.id === child.id))
      if (parent) {
        parent.lastMtimeMs = parent.children.reduce(
          (latest, c) => Math.max(latest, c.lastMtimeMs),
          0
        )
      }
      if (progressChanged) await this.persistParentsProgress()
      return pairs
    },

    async ensurePsdStatusOverridesLoaded(): Promise<void> {
      if (this.psdStatusOverridesLoaded) return
      const raw = await window.comicType.storeGet(PSD_STATUS_OVERRIDES_KEY)
      this.psdStatusOverrides = hydrateOverrides(raw)
      this.psdStatusOverridesLoaded = true
    },

    async reloadPsdStatusOverrides(): Promise<void> {
      this.psdStatusOverridesLoaded = false
      this.psdStatusOverrides = {}
      this.psdModeStatuses = {}
      this.psdModeTimestamps = {}
      await this.ensurePsdStatusOverridesLoaded()
    },

    applyPsdStatusOverrides(pairs: JpgPsdPair[]): JpgPsdPair[] {
      return pairs.map((pair) =>
        applyOverrideToPair(
          pair,
          this.psdStatusOverrides[pair.psd.absPath],
          this.psdModeStatuses[pair.psd.absPath],
          this.psdModeTimestamps[pair.psd.absPath]
        )
      )
    },

    /**
     * Mark every PSD below the selected child projects in one operation.
     *
     * `mode` defaults to `typeset` so existing callers keep the legacy path
     * (auto-derived stats + the "no PSD" safety prompt). Any other mode is
     * written explicitly through `rememberModeStatuses` and leaves the
     * typeset state untouched.
     *
     * 返回值：`cancelled`（用户在"无 PSD"确认框里点了取消）、`marked`（真正写进去的文件数）、
     * `skipped`（目录读不到、被跳过的话标题）—— 让"少标了几话"看得见，而不是只报成功。
     * 见 2026-09-30 审查 high。
     */
    async markChildProjects(
      childIds: string[],
      status: PsdStatusOverride,
      mode: WorkMode = 'typeset'
    ): Promise<{ cancelled: boolean; marked: number; skipped: string[] }> {
      await this.ensurePsdStatusOverridesLoaded()
      const selectedIds = new Set(childIds)
      const scans: Array<{
        parentId: string
        childId: string
        pairs: JpgPsdPair[]
      }> = []

      const targets = this.parents.flatMap((parent) =>
        parent.children
          .filter((child) => selectedIds.has(child.id))
          .map((child) => ({ parentId: parent.id, child }))
      )
      // 目录读不到、这次取数失败的子项目（标题）—— 跳过它们，并如实报给调用方。
      const skippedTitles: string[] = []
      const concurrency = 4
      for (let offset = 0; offset < targets.length; offset += concurrency) {
        const chunk = targets.slice(offset, offset + concurrency)
        const results = await Promise.all(
          chunk.map(async ({ parentId, child }) => {
            try {
              const scan = await window.comicType.scanChildProject(child.folderPath)
              // ⚠️ 0 页 + 有错误 ≠ "这一话有 0 个文件"（2026-09-30 审查 high）：scanner
              // 读不到目录时不抛错、只把错误塞进 errors[] 返回空列表。照旧往下走会写
              // psdStats=[]/statsVersion=PAIRED 落库 → 侧栏永久 0/0 且不再补算。
              if (scan.jpgPairs.length === 0 && scan.errors.length > 0) {
                skippedTitles.push(child.projectTitle)
                writeWorkspaceLog('warn', 'Batch project status scan skipped (unreadable)', {
                  childId: child.id,
                  folderPath: child.folderPath,
                  errorCount: scan.errors.length
                })
                return null
              }
              return { parentId, childId: child.id, pairs: scan.jpgPairs }
            } catch (error) {
              writeWorkspaceLog('warn', 'Batch project status scan failed', {
                childId: child.id,
                folderPath: child.folderPath,
                error: error instanceof Error ? error.message : String(error)
              })
              return null
            }
          })
        )
        scans.push(
          ...results.filter((result): result is NonNullable<typeof result> => result !== null)
        )
      }

      // The "no PSD" guard protects the auto-derived typeset state only; the
      // other modes are explicit flags and can never be undone by re-scanning.
      if (status === 'done' && mode === 'typeset') {
        const hasNoPsdChild = scans.some(
          (scanned) =>
            !scanned.pairs.some(
              (pair) => !pair.previewOnly && pair.psd.absPath.toLocaleLowerCase().endsWith('.psd')
            )
        )
        if (hasNoPsdChild) {
          const confirmed = window.confirm(
            '该子项目无 PSD 文件，强制标记为已嵌字可能导致后续无法还原。确认继续吗？'
          )
          if (!confirmed) return { cancelled: true, marked: 0, skipped: [] }
        }
      }

      // 一次批量 = **一条台账**：逐话写库，但共享同一个 opId
      // （否则一次点击会在台账里变成十几条散记录，"撤销上一次"就失去了意义）。
      const audit: MarkAuditContext = {
        opId: createMarkOperationId(),
        kind: 'mark',
        source: 'sidebar-batch',
        mode,
        targetStatus: status
      }
      let psdCount = 0
      for (const scanned of scans) {
        const actualPairs = scanned.pairs
        psdCount += actualPairs.length
        // ⚠️ 每次都按 id **重取** child：下面每个 await 期间都可能并发跑到
        // `persistParentsProgress()`，而它会把 `this.parents` 整棵树换成**新对象**。
        // 抱着旧引用写字段，成果会落在孤儿对象上，随后落盘的是新对象里那份**旧计数**
        // （标记是对的，侧栏/首页的数字却退回标记前，重启也不自修）。见 2026-09-30 审查 high。
        const child = this.findChild(scanned.childId)
        if (!child) continue
        // ★ 先把这一话「已记住的标记」读进内存，再做下面的合并。
        //   批量操作不会（也不该）先逐话打开，而那份记录只在单话的 scanChild() 里加载；
        //   不先加载的话，rememberModeStatuses 的合并底稿会落到"四个模式全 false"，
        //   写库时把**其它模式**的标记一起抹掉 —— 2026-09-26 现场：15 话 / 153 个文件的
        //   「监修」被清空。回归锁见 __tests__/projectWorkspace-batch-mark.spec.ts。
        await this.loadRememberedStatuses(child, actualPairs)
        if (mode === 'typeset') {
          await this.rememberStatuses(child, actualPairs, status, undefined, audit)
        } else {
          await this.rememberModeStatuses(child, actualPairs, mode, status === 'done', audit)
        }
        // ★ 写完之后**再从库里读一遍**，派生缓存（侧栏/成就的数字）以"库里的合并结果"为准。
        //   上面那次读取只当合并底稿；在"读底稿 → 写库"这几十毫秒里，别的实例可能刚改过
        //   同一批行（dev 与打包版共用同一份 SQLite，见交接文档 §9.5）。那种情况下
        //   "客户端内存自己合并出来的那份"会与库不一致：**库是对的，侧栏却显示 0**。
        //   多一次 memoryGetProject 换"显示口径 = 库口径"，值得 —— 批量标记是低频操作，
        //   而且它本来就已经逐话做过一次完整目录扫描。
        //   （重取放在**最后一次 await 之后、写入之前** —— 上面两条注释说的那次换身份
        //   就发生在这些 await 里，早一步重取都还会拿到旧对象。）
        await this.loadRememberedStatuses(child, actualPairs)
        const fresh = this.findChild(scanned.childId) ?? child
        const pairs = this.applyPsdStatusOverrides(actualPairs)
        fresh.psdStats = psdStatsFromPairs(pairs)
        fresh.statsVersion = PAIRED_PSD_STATS_VERSION
        fresh.psdModeStats = modeStatsFromPairs(pairs)
        fresh.modeStatsVersion = PAIRED_MODE_STATS_VERSION
        fresh.lastMtimeMs = latestPairMtime(pairs)
      }

      await this.persistParentsProgress()
      void useAchievementsStore().refresh()
      return { cancelled: false, marked: psdCount, skipped: skippedTitles }
    },

    /**
     * 标记台账：最近若干次操作（新的在前）。对话框与"撤销"按钮都读它。
     */
    async listMarkAudit(limit = 100): Promise<MarkAuditOperation[]> {
      if (typeof window.comicType?.memoryListMarkAudit !== 'function') return []
      try {
        return await window.comicType.memoryListMarkAudit(limit)
      } catch (error) {
        writeWorkspaceLog('warn', 'Mark audit list failed', {
          message: error instanceof Error ? error.message : String(error)
        })
        return []
      }
    },

    /** 最近一次可撤销的标记操作（没有就 null）—— 决定工具栏那个按钮亮不亮。 */
    async findUndoableMark(): Promise<MarkAuditOperation | null> {
      if (typeof window.comicType?.memoryFindUndoableMark !== 'function') return null
      try {
        return await window.comicType.memoryFindUndoableMark()
      } catch {
        return null
      }
    },

    /**
     * 撤销一次标记操作。
     *
     * 写库由主进程按台账完成（模式与时间戳一起还原）；这里负责**把受影响的那些话的统计重算**：
     * 走的是与批量标记完全相同的那条路（重扫目录 → 从库里读回 → 重算 psdStats / psdModeStats），
     * 所以侧栏、成就页与工作台的数字都会跟着回到正确值，而不是"库对了、界面还是旧的"。
     */
    async undoMarkOperation(opId: string): Promise<MarkWriteBackResult | null> {
      if (typeof window.comicType?.memoryUndoMark !== 'function') return null
      const result = await window.comicType.memoryUndoMark(opId)
      for (const childId of result.childIds) {
        const child = this.findChild(childId)
        // scanChild 现在对"目录读不到"会抛错（见 2026-09-30 审查 high：不能把取数失败
        // 记成 0 页）—— 撤销已经把库写对了，这里某一话重算失败不该让整次撤销报错。
        if (child) {
          try {
            await this.scanChild(child)
          } catch (error) {
            writeWorkspaceLog('warn', 'Undo rescan skipped', {
              childId,
              error: error instanceof Error ? error.message : String(error)
            })
          }
        }
      }
      await this.persistParentsProgress()
      void useAchievementsStore().refresh()
      return result
    },

    /**
     * Debounce wrapper around `scanChild`. When `activeChild` changes, the
     * caller invokes this with the new child; the actual scan is deferred
     * by `SCAN_DEBOUNCE_MS` (200ms). A second call within that window
     * cancels the first timer and starts a new one, so rapid switches
     * coalesce into a single scan. Pass `null` to cancel a pending scan
     * without firing (e.g. when clearing the active child).
     */
    debouncedScan(child: ChildProject | null): void {
      if (_scanTimer !== null) {
        clearTimeout(_scanTimer)
        _scanTimer = null
      }
      if (child === null) return
      _scanTimer = setTimeout(() => {
        _scanTimer = null
        // scanChild 对"目录读不到"会抛错（见 2026-09-30 审查 high），这里是空跑的
        // 后台刷新，不该把未处理拒绝抛到 window。
        void this.scanChild(child).catch((error) => {
          writeWorkspaceLog('warn', 'Debounced child scan skipped', {
            childId: child.id,
            error: error instanceof Error ? error.message : String(error)
          })
        })
      }, SCAN_DEBOUNCE_MS)
    },

    /**
     * Cancel any pending debounced scan. Called on teardown to avoid a
     * scan firing after the component unmounts.
     */
    cancelDebouncedScan(): void {
      if (_scanTimer !== null) {
        clearTimeout(_scanTimer)
        _scanTimer = null
      }
    },

    /**
     * Read a file as a data URL for thumbnail display, using `thumbUrlCache`
     * as an LRU cache (max `THUMB_CACHE_MAX` entries). On a cache hit the
     * entry is moved to the most-recently-used position. On a miss the IPC
     * `readFileDataURL` is called and the result cached, evicting the
     * least-recently-used entry if the cache is full.
     */
    async readThumbUrl(absPath: string): Promise<string> {
      const cached = this.thumbUrlCache.get(absPath)
      if (cached !== undefined) {
        // LRU: move to end (most-recently-used).
        this.thumbUrlCache.delete(absPath)
        this.thumbUrlCache.set(absPath, cached)
        return cached
      }
      const url = await window.comicType.readFileDataURL(absPath)
      if (this.thumbUrlCache.size >= THUMB_CACHE_MAX) {
        // Evict the oldest (first) entry — Map preserves insertion order.
        const oldest = this.thumbUrlCache.keys().next().value
        if (oldest !== undefined) {
          this.thumbUrlCache.delete(oldest)
        }
      }
      this.thumbUrlCache.set(absPath, url)
      return url
    },

    /** Clear thumbnail cache. Useful for tests/refresh. */
    clearCaches(): void {
      this.thumbUrlCache.clear()
    },

    /**
     * Load parents through the main-process project domain API.
     * The domain module owns storage; the store only hydrates for display.
     */
    async loadParents(): Promise<void> {
      const tree = await window.comicType.projectGetTree()
      this.parents = hydrateParents(tree)
    },

    /**
     * Delete a child from its parent. If the parent becomes empty, remove
     * the parent too. Persists the updated tree back to the registry.
     */
    async deleteChild(_parentId: string, childId: string): Promise<void> {
      await this.deleteChildren([childId])
    },

    /** Delete multiple child records through the main-process project domain. */
    async deleteChildren(childIds: string[]): Promise<void> {
      const ids = new Set(childIds)
      if (ids.size === 0) return

      await window.comicType.projectDeleteChildren([...ids])

      let parents = this.parents
        .map((parent) => ({
          ...parent,
          children: parent.children.filter((child) => !ids.has(child.id))
        }))
        .filter((parent) => parent.children.length > 0)
      parents = recomputeParentMtimes(parents)

      this.parents = parents

      if (this.activeChild && ids.has(this.activeChild.id)) {
        this.clearActiveChild()
      }

      syncDashboardStore(parents)
      // 记录随话一起删掉了 → 重算一次成就（数字自然跟着掉）
      await useAchievementsStore().refresh()
    },

    /**
     * Rename a parent comic without touching any source files. The parent
     * title is denormalized onto every child as `parentTitle`, so update all
     * children in the same transaction and persist the registry once.
     */
    /**
     * 设置父级（漫画）的职责：1~2 个模式，空数组 = 清空。
     *
     * 先洗一遍再发（与主进程共用 `shared/duties.ts` 的同一份规则），**写库成功之后**才更新本地 ——
     * 侧栏那枚标签不等人，但也不能"库里没写成、界面却说设好了"。
     * ⚠️ 主进程在父级不存在时会抛错（2026-10-03 审查修复）：这里必须捕获并**让人看见**，
     * 且一个字都不许改本地（静默吞掉就等于"点了没反应"）。
     */
    async setParentDuties(parentId: string, duties: WorkMode[]): Promise<void> {
      const clean = normalizeDuties(duties)
      try {
        await window.comicType.projectSetParentDuties(parentId, clean)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        useToastStore().addToast({ type: 'error', message: `设置职责失败：${message}` })
        return
      }
      this.parents = this.parents.map((parent) => {
        if (parent.id !== parentId) return parent
        if (clean.length === 0) {
          // 显式 delete（不是解构丢弃）：解构会留一个未使用的变量，eslint 会多一条 warning
          const next = { ...parent }
          delete next.duties
          return next
        }
        return { ...parent, duties: clean }
      })
      syncDashboardStore(this.parents)
    },

    async renameParent(parentId: string, nextTitle: string): Promise<void> {
      const title = nextTitle.trim()
      if (!title) return

      await window.comicType.projectRenameParent(parentId, title)

      let parents = this.parents.map((parent) => {
        if (parent.id !== parentId) return parent
        return {
          ...parent,
          title,
          children: parent.children.map((child) => ({
            ...child,
            parentTitle: title
          }))
        }
      })
      parents = recomputeParentMtimes(parents)

      this.parents = parents

      if (
        this.activeChild &&
        parents.some((parent) => parent.children.some((child) => child.id === this.activeChild?.id))
      ) {
        const updated = this.findChild(this.activeChild.id)
        if (updated) {
          this.activeChild = updated
        }
      }

      syncDashboardStore(parents)
    },

    /** Persist a user-defined parent order from the management drag list. */
    async reorderParent(sourceParentId: string, targetParentId: string): Promise<void> {
      const sourceIndex = this.parents.findIndex((parent) => parent.id === sourceParentId)
      const targetIndex = this.parents.findIndex((parent) => parent.id === targetParentId)
      if (sourceIndex === -1 || targetIndex === -1 || sourceIndex === targetIndex) return

      await window.comicType.projectReorderParents(sourceParentId, targetParentId)

      const parents = snapshotParents(this.parents)
      const [moved] = parents.splice(sourceIndex, 1)
      parents.splice(targetIndex, 0, moved)
      this.parents = parents
      syncDashboardStore(parents)
    },

    /**
     * Add or update a child project. When `existingChildId` is provided the
     * matching child is updated (and moved to a new parent if `parentTitle`
     * changed). When omitted a new child is created under the matching parent
     * (or a new parent is created). Persists to the registry and reloads
     * `parents` so the UI stays in sync.
     */
    async saveChild(payload: SaveChildPayload, existingChildId?: string): Promise<ImportResult> {
      const raw = await window.comicType.projectGetTree()
      let parents = hydrateParents(raw)
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
              normalizePathForLookup(child.folderPath) ===
              normalizePathForLookup(payload.folderPath)
          )
          if (existing) {
            result.skipped = 1
            this.parents = parents
            syncDashboardStore(parents)
            return result
          }
          const scanned = await this.scanForImport(payload)
          upsertChildProject(parents, payload, scanned)
          result.added = 1
        }
      } else {
        const scanned = await this.scanForImport(payload)
        upsertChildProject(parents, payload, scanned, existingChildId)
        result.updated = 1
      }

      // Remove empty parents
      parents = parents.filter((p) => p.children.length > 0)
      parents = recomputeParentMtimes(parents)

      await window.comicType.projectSaveTree(toPlain(parents))
      this.parents = parents
      syncDashboardStore(parents)

      // 成就现在只吃标记记录：导入/更新完统一重算一次即可（不必逐话重算）。
      await useAchievementsStore().refresh()
      return result
    },

    async scanForImport(payload: SaveChildPayload): Promise<ScannedChildProject> {
      const scan = await window.comicType.scanChildProject(payload.folderPath)
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
})

/** Hydrate raw registry payload into ParentProject[] with safe defaults. */
function hydrateParents(raw: unknown): ParentProject[] {
  if (!Array.isArray(raw)) return []
  return (raw as ParentProject[]).map((p) => {
    // ⚠️ 这里是**固定字段重建**：没列到的字段会被静默丢掉（2026-10-03 现场：
    // 职责存进库了，一重启就不见 —— 界面退回"按标记推断"，用户手点的看起来白点了，
    // 而且之后任何一次整树保存都会把丢过字段的树写回去）。新增父级字段时**必须**在这里补一行。
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
      psdStats:
        c.statsVersion === PAIRED_PSD_STATS_VERSION && Array.isArray(c.psdStats)
          ? c.psdStats
          : undefined,
      statsVersion: c.statsVersion,
      psdModeStats:
        c.modeStatsVersion === PAIRED_MODE_STATS_VERSION && c.psdModeStats
          ? c.psdModeStats
          : undefined,
      modeStatsVersion: c.modeStatsVersion
    }))
    }
  })
}

export { latestPairMtime, psdStatsFromPairs }
