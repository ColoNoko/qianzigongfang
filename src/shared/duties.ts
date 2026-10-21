import { childModeProgress } from './status'
import type { ChildProject, ParentProject, WorkMode } from './types'
import { WORK_MODES } from './modes'

/**
 * 「职责」的纯规则（2026-10-03）。
 *
 * 职责 = **这一本漫画归我干哪道工序**（可挂 1~2 个模式）。它与"模式"不是一回事：
 * 模式是"当前章节正在做哪道工序"，职责是"这本归我做什么"（每本一份）。
 *
 * 为什么单独一个模块：规则（最多两个、规范顺序、推断只给一个）要能脱离 DOM 单测；
 * 组件只负责画标签与发事件。`inferParentDuties` 的语料全部来自真实库（见 spec）。
 */

/** 一本最多挂两个职责（真实语料：`青梅亭亭__校对&监修` 就是两个）。 */
export const MAX_PARENT_DUTIES = 2

/** 规范顺序：嵌 → 翻 → 校 → 监。显示与存储都按它排，避免同一份数据两种排法。 */
const CANONICAL: readonly WorkMode[] = WORK_MODES

function isWorkMode(value: unknown): value is WorkMode {
  return typeof value === 'string' && (CANONICAL as readonly string[]).includes(value)
}

/**
 * 把任意输入洗成"能存的职责"：只留合法模式、去重、按规范顺序、最多两个。
 *
 * 垃圾输入（null / 字符串 / 数字 / 嵌套）一律当**空职责** ——
 * 清空是一次合法操作，所以这里不抛错、也不"保留上次"。
 */
export function normalizeDuties(value: unknown): WorkMode[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<WorkMode>()
  for (const item of value) {
    if (isWorkMode(item)) seen.add(item)
  }
  return CANONICAL.filter((mode) => seen.has(mode)).slice(0, MAX_PARENT_DUTIES)
}

/** 点一下某个模式：没选过就加上，已选就取消；已经满两个时再加保持不变。 */
export function toggleDuty(current: readonly WorkMode[], mode: WorkMode): WorkMode[] {
  const list = normalizeDuties(current)
  if (list.includes(mode)) return list.filter((item) => item !== mode)
  if (list.length >= MAX_PARENT_DUTIES) return list
  return normalizeDuties([...list, mode])
}

/**
 * 进这本漫画时该切到哪个模式。
 *
 * 两个职责时选**完成度更低**的那道（手上还有活的那个）；一样低（例如都还没开始）
 * 就按规范顺序取第一个 —— 结果必须稳定，否则"每次进来切到的不一样"最讨嫌。
 * 没有职责 → null：进章时由调用方使用无职责作品的全局默认。
 */
export function pickDutyMode(
  duties: readonly WorkMode[],
  progress: Partial<Record<WorkMode, { done: number; total: number }>>,
  priority: 'slower' | 'faster' = 'slower'
): WorkMode | null {
  const list = normalizeDuties(duties)
  if (list.length === 0) return null
  if (list.length === 1) return list[0]

  const ratio = (mode: WorkMode): number => {
    const item = progress[mode]
    if (!item || item.total <= 0) return 0
    return item.done / item.total
  }
  let best = list[0]
  for (const mode of list) {
    if (priority === 'faster' ? ratio(mode) > ratio(best) : ratio(mode) < ratio(best)) best = mode
  }
  return best
}

/** 少于这个文件数就不算"这道工序是我的活"（真实语料里出现过翻译只有 1 个文件）。 */
const INFER_MIN_FILES = 3

/**
 * 没声明过职责时，按**已有标记**猜一个（过渡用，0 输入）。
 *
 * ⚠️ **只给一个**：真实语料显示"嵌字 209 + 监修 373"这类多半是**同一个人先嵌后监**的
 * 流水线，不是两个岗位 —— 猜两个会把「零魔力的大贤者」这种误标成双职责。
 * 想挂两个职责的场合（`校对&监修`）由用户自己点一下，不靠猜。
 */
export function inferParentDuties(
  perChildModeCounts: ReadonlyArray<Partial<Record<WorkMode, number>>>
): WorkMode[] {
  const total: Record<WorkMode, number> = {
    typeset: 0,
    translated: 0,
    proofread: 0,
    supervised: 0
  }
  for (const counts of perChildModeCounts) {
    for (const mode of CANONICAL) {
      const value = counts[mode]
      if (typeof value === 'number' && value > 0) total[mode] += value
    }
  }

  let best: WorkMode | null = null
  for (const mode of CANONICAL) {
    if (total[mode] < INFER_MIN_FILES) continue
    if (best === null || total[mode] > total[best]) best = mode
  }
  return best ? [best] : []
}

/** 只给渲染用的类型别名，避免调用方各写一份。 */
export type ParentDutyMap = Record<string, WorkMode[] | undefined>

/** Aggregate chapter completion before choosing a manga's entry mode. */
export function pickParentDutyMode(parent: ParentProject, duties: readonly WorkMode[], priority: 'slower' | 'faster' = 'slower'): WorkMode | null {
  const progress = Object.fromEntries(WORK_MODES.map(mode => [mode, parent.children.reduce((sum, child) => {
    const value = childModeProgress(child, mode)
    return { done: sum.done + value.done, total: sum.total + value.total }
  }, { done: 0, total: 0 })]))
  return pickDutyMode(duties, progress, priority)
}

/** Chapter entry uses this chapter's progress, not another chapter's aggregate. */
export function pickChapterDutyMode(
  child: ChildProject,
  duties: readonly WorkMode[],
  priority: 'slower' | 'faster' = 'slower'
): WorkMode | null {
  const progress = Object.fromEntries(WORK_MODES.map(mode => [mode, childModeProgress(child, mode)]))
  return pickDutyMode(duties, progress, priority)
}
