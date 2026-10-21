import { readRememberedRoots } from '@shared/source-roots'
import type { ParentProject } from '@shared/types'
import { PAIRED_MODE_STATS_VERSION, PAIRED_PSD_STATS_VERSION } from '@shared/status'
import { normalizeChapterNumber } from '@shared/chapter'
import { normalizeDuties } from '@shared/duties'

/** Reject broken records rather than silently dropping chapters before a later save. */
export function assertProjectTreeShape(raw: unknown): asserts raw is ParentProject[] {
  const record = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === 'object' && !Array.isArray(value)
  if (
    !Array.isArray(raw) ||
    raw.some(
      (parent) =>
        !record(parent) ||
        typeof parent.id !== 'string' ||
        typeof parent.title !== 'string' ||
        !Array.isArray(parent.children) ||
        parent.children.some(
          (child: unknown) =>
            !record(child) || typeof child.id !== 'string' || typeof child.folderPath !== 'string'
        )
    )
  )
    throw new Error('项目清单格式损坏，请检查项目数据或从备份恢复')
}

/** Hydrate raw registry payload into ParentProject[] with safe defaults. */
export function hydrateProjectTree(
  raw: unknown,
  policy: 'versioned' | 'stored' = 'versioned'
): ParentProject[] {
  assertProjectTreeShape(raw)
  return (raw as ParentProject[]).map((p) => {
    // Shared field conversion; callers select their cache validity policy.
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
          policy === 'stored' ||
          (c.statsVersion === PAIRED_PSD_STATS_VERSION && Array.isArray(c.psdStats))
            ? policy === 'stored'
              ? Array.isArray(c.psdStats)
                ? c.psdStats
                : []
              : c.psdStats
            : undefined,
        statsVersion: c.statsVersion,
        psdModeStats:
          policy === 'stored' ||
          (c.modeStatsVersion === PAIRED_MODE_STATS_VERSION && c.psdModeStats)
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
