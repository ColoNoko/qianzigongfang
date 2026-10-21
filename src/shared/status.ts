/**
 * Pure status + progress helpers for the 汉化工坊 (qianzi-gongfang) app.
 *
 * No fs, no dom, no side effects. Imported by main (when computing
 * ChapterProgress for the IPC payload) and by the renderer (when
 * re-deriving progress from a list of PsdEntry stats).
 *
 * Status rule (from .omo/plans/psd-manager-app.md):
 *   A PSD is "done" when (mtimeMs - createdTimeMs) > 5 minutes.
 *   The field is still named ctimeMs in payloads for compatibility, but the
 *   scanner fills it from fs.Stats.birthtimeMs where available.
 *   Strict greater-than — exactly 5 minutes is still "pending".
 *
 * Progress:
 *   n/m where m = effective work items selected by the scanner and n is done.
 *   Pct = (n/m)*100 rounded to 2 decimals, or null when m === 0.
 */

import type { ChapterProgress, ChildProject, JpgPsdPair, PsdStat, WorkMode } from './types'

const FIVE_MINUTES_MS = 5 * 60 * 1000

/**
 * Offset baked into a "done" PsdStat's ctime so `isTypesetDone` reports true.
 * Completion is encoded in the timestamp pair rather than in a separate flag,
 * so every consumer (progress bars, dashboard, achievements) keeps working off
 * the same `{ mtimeMs, ctimeMs }` shape.
 */
export const DONE_OFFSET_MS = FIVE_MINUTES_MS + 1

export const PAIRED_PSD_STATS_VERSION = 5
export const PAIRED_MODE_STATS_VERSION = 1

export function isCountablePair(pair: JpgPsdPair): boolean {
  return pair.countsTowardProgress ?? (typeof pair.jpgPath === 'string' && pair.jpgPath.length > 0)
}

/**
 * 把一批**选中**的 pair 重新对应到重扫后的新对象上。**这是全项目唯一一处该逻辑。**
 *
 * 为什么需要它（2026-09-23 真机 bug）：
 * 重扫会造出一批全新的 pair 对象（同一路径、新引用）。这时只有两种做法都是错的 ——
 *   ① 原地清空：`scanActiveChild()` 挂在 window 的 focus 上（从 Photoshop 切回来就会跑），
 *      一刀切会让工具栏的「标记X」在每次回到窗口后无辜变灰；
 *   ② 把旧对象原样留着：下游读到的还是重扫前的旧状态（标记完了又变回未标记）。
 * 所以必须"按路径重新映射"：路径还在的留下**并换成新对象**，真的消失的才丢掉。
 */
export function resyncPairSelection(
  selected: JpgPsdPair[],
  available: JpgPsdPair[]
): JpgPsdPair[] {
  if (selected.length === 0) return []
  const byPath = new Map(available.map((pair) => [pair.psd.absPath, pair]))
  return selected
    .map((pair) => byPath.get(pair.psd.absPath))
    .filter((pair): pair is JpgPsdPair => pair !== undefined)
}

/**
 * 只认手动标记：嵌字完成与否由 `modes.typeset`（写进 `status`）决定，
 * 不再看文件时间。未完成的条目把 ctime 对齐 mtime，因此 `isTypesetDone`
 * 不会因为"PSD 被编辑过"而误判为已完成。
 */
export function countablePsdStats(pairs: JpgPsdPair[]): PsdStat[] {
  return pairs
    .filter(isCountablePair)
    .map((pair) => ({
      mtimeMs: pair.psd.mtimeMs,
      ctimeMs:
        pair.psd.status === 'done' ? pair.psd.mtimeMs - DONE_OFFSET_MS : pair.psd.mtimeMs
    }))
}

export function isTypesetDone(stat: { mtimeMs: number; ctimeMs: number }): boolean {
  return stat.mtimeMs - stat.ctimeMs > FIVE_MINUTES_MS
}

export function computeModeCounts(pairs: JpgPsdPair[]): Record<WorkMode, ChapterProgress> {
  const countable = pairs.filter(isCountablePair)
  const total = countable.length

  const build = (mode: WorkMode): ChapterProgress => {
    if (total === 0) return { done: 0, total: 0, pct: null }
    const done = countable.filter((pair) => pair.psd.modes?.[mode] === true).length
    const pct = Math.round((done / total) * 100 * 100) / 100
    return { done, total, pct }
  }

  return {
    typeset: build('typeset'),
    translated: build('translated'),
    proofread: build('proofread'),
    supervised: build('supervised')
  }
}

export function modeStatsFromPairs(pairs: JpgPsdPair[]): Record<WorkMode, PsdStat[]> {
  const result: Record<WorkMode, PsdStat[]> = {
    typeset: [],
    translated: [],
    proofread: [],
    supervised: []
  }

  for (const pair of pairs.filter(isCountablePair)) {
    for (const mode of ['typeset', 'translated', 'proofread', 'supervised'] as const) {
      const timestamp = pair.psd.modeTimestamps?.[mode]
      if (typeof timestamp === 'number' && timestamp > 0) {
        result[mode].push({ mtimeMs: timestamp, ctimeMs: timestamp })
      } else if (mode === 'typeset' && pair.psd.status === 'done') {
        // 旧数据没有时间戳时，沿用嵌字统计的 mtime 作为回退。
        result.typeset.push({ mtimeMs: pair.psd.mtimeMs, ctimeMs: pair.psd.mtimeMs })
      } else if (pair.psd.modes?.[mode] === true) {
        // Older image marks can have a completion flag without a per-mode timestamp.
        // A metadata-only TXT save triggers a rescan; retain those completed counts.
        result[mode].push({ mtimeMs: pair.psd.mtimeMs, ctimeMs: pair.psd.mtimeMs })
      }
    }
  }

  return result
}

export function computeProgress(psdStats: { mtimeMs: number; ctimeMs: number }[]): ChapterProgress {
  const total = psdStats.length
  if (total === 0) {
    return { done: 0, total: 0, pct: null }
  }
  const done = psdStats.filter(isTypesetDone).length
  const pct = Math.round((done / total) * 100 * 100) / 100
  return { done, total, pct }
}

/**
 * 某个子项目在指定模式下的完成情况 —— 侧栏每行的取数口。
 *
 * 两种字段的维护保证不同，所以按模式分流：
 *   - 嵌字：`psdStats`。它带缓存版本校验，且被注册表刷新路径**全量重算**，
 *     同时已经是"只认手动标记"的口径。
 *   - 翻译/校对/监修：`psdModeStats[mode]`。这些标记只可能在该话被打开时产生，
 *     写入的那一刻就已经算好并持久化，因此缓存是可靠的。
 *     反过来说，注册表刷新路径不重算它，所以不能简单地把两种模式混用同一来源。
 */
export function childModeProgress(
  child: Pick<ChildProject, 'psdStats' | 'psdModeStats'>,
  mode: WorkMode
): ChapterProgress {
  const stats = child.psdStats ?? []
  const total = stats.length
  if (total === 0) {
    return { done: 0, total: 0, pct: null }
  }

  const done =
    mode === 'typeset' ? stats.filter(isTypesetDone).length : (child.psdModeStats?.[mode]?.length ?? 0)
  const pct = Math.round((done / total) * 100 * 100) / 100
  return { done, total, pct }
}
