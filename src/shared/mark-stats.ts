/**
 * mark-stats —— 成就页的聚合规则（第十五轮）。
 *
 * 以前的成就数字来自**磁盘扫描结果**（项目树缓存里的 `psdStats` / `psdModeStats`）：
 * 为了让项目瘦身删几张图，重扫之后那些条目就没了，历史成就跟着缩水。
 * 现在改成从**标记记录**（`project_memory_files`：按文件路径保存的四模式状态 +
 * 每个模式的完成时间戳）来算 —— 你把图删了、把目录挪走了，历史都还在。
 *
 * 顺带修掉一个隐藏怪癖：嵌字以前按 **PSD 文件修改时间**分月（重新保存一次 PSD，
 * 它就跳到新的月份去了）；现在统一按**标记那一刻的时间戳**分月，
 * 这才符合"成就 = 我干了多少活"的语义。
 *
 * 本文件是纯函数：规则要能被表格单测锁住。
 */
import type { ChildMarkStatistics } from './ipc-api'
import type { WorkMode } from './types'

const ALL_MODES: readonly WorkMode[] = ['typeset', 'translated', 'proofread', 'supervised']

/** 成就按"月"分桶，键形如 `2026-09`。 */
export function markMonthKey(mtimeMs: number): string {
  const date = new Date(mtimeMs)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

export interface MarkAggregates {
  /** 月份 → 完成条目数 */
  data: Map<string, number>
  /** 月份 → 该月"整话完成"的话 id 集合 */
  projectData: Map<string, string[]>
  /** 累计完成条目数 */
  total: number
}

/**
 * 把标记统计聚合成成就页要的三样东西。
 *
 * 「整话完成」的口径也换成**记录口径**：这一话**记录里**的文件全部完成就算完成
 * （以前是"当前磁盘上所有文件都完成"）。所以删图不会再让它从成就里掉出去；
 * 但反过来——只标了一半的记录不会算完成，这一点和以前一致。
 */
export function aggregateMarkStatistics(
  statistics: ChildMarkStatistics[],
  mode: WorkMode
): MarkAggregates {
  const data = new Map<string, number>()
  const completedChildren = new Map<string, Set<string>>()
  let total = 0

  for (const child of statistics) {
    const timestamps = child.completedTimestamps?.[mode] ?? []
    if (timestamps.length === 0) continue

    for (const timestamp of timestamps) {
      const key = markMonthKey(timestamp)
      data.set(key, (data.get(key) ?? 0) + 1)
      total++
    }

    if (child.fileCount > 0 && timestamps.length >= child.fileCount) {
      const key = markMonthKey(Math.max(...timestamps))
      if (!completedChildren.has(key)) completedChildren.set(key, new Set())
      completedChildren.get(key)!.add(child.childId)
    }
  }

  return {
    data,
    projectData: new Map([...completedChildren.entries()].map(([key, ids]) => [key, [...ids]])),
    total
  }
}

export { ALL_MODES }
