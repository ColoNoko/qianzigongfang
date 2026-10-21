/**
 * 把"从库里读回来的原始载荷"还原成应用对象（纯函数）：序列化、字段白名单重建、覆盖态应用。
 *
 * P6（2026-10-05）从 `stores/projectWorkspace.ts` 拆出：**纯搬家**。
 * 唯一的机械改动是**每段开头加了一个 `export `**（它们原本是那个文件的模块私有函数），
 * 函数体本身逐字节未改。
 * ⚠️ `hydrateParents` 是**固定字段重建** —— 没列到的字段会被静默丢掉（2026-10-03 现场：
 * 职责存进库了、一重启就不见）。新增父级 / 子项目字段时**必须**在这里补一行；
 */
import { normalizeChapterNumber } from '@shared/chapter'
import { normalizeDuties } from '@shared/duties'
import { PAIRED_MODE_STATS_VERSION, PAIRED_PSD_STATS_VERSION } from '@shared/status'
import { readRememberedRoots } from '@shared/source-roots'
import type {
  JpgPsdPair,
  ParentProject,
  TypesetStatus,
  WorkMode,
  WorkModeStatus
} from '@shared/types'

export /**
 * Convert Vue reactive structures to plain JSON before sending over IPC.
 * Electron structured clone cannot clone Vue reactive Proxy objects.
 */
function toPlain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

const DONE_OFFSET_MS = 5 * 60 * 1000 + 1

export type PsdStatusOverride = 'done' | 'pending'

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

export /** Hydrate raw registry payload into ParentProject[] with safe defaults. */
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
        modeStatsVersion: c.modeStatsVersion,
        // 内容指纹（R1）：**必须原样带过去** —— 整树保存会把它写回，
        // 丢了就等于抹掉"改名认领"的比对基准（hydrate 固定字段重建的老坑）。
        contentFingerprint: c.contentFingerprint
      }))
    }
  })
}
