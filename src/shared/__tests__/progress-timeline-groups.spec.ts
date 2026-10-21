/**
 * 时间线**分组**的回归锁（2026-10-05 从并行分支 T8 移植）。
 *
 * 以前时间线是"一条 = 某天 × 某话 × 某职责"的**摊平列表**：同一本漫画一天做了 12 话，
 * 就是 12 行、每行写"第 N 集 · X 张"，看不出"这天在这本上总共烤了多少"。
 * 现在按 **某天 × 某漫画 × 某职责** 合并成一组，组里保留各话明细。
 *
 * 这里锁四件：① 12 话合并成 130 张且明细都在；② 日期/漫画/职责三者不同不混算、按最近标记倒序；
 * ③ 显示名相同但 childId 不同的两话**各算一话**；④ **先聚合后截断**——100 话的那天不会被
 * 老的 80 条上限截掉，而组数上限仍是 80。
 */
import { describe, expect, it } from 'vitest'
import { buildTimelineEvents, groupTimelineEvents, type ProgressTimelineEvent } from '../progress'

const at = new Date(2026, 9, 5, 12).getTime()
const event = (overrides: Partial<ProgressTimelineEvent> = {}): ProgressTimelineEvent => ({
  at,
  childId: 'c1',
  parentTitle: '老师的人偶',
  chapterNumber: '第1集',
  mode: 'supervised',
  fileCount: 10,
  ...overrides
})
describe('groupTimelineEvents', () => {
  it('merges 12 chapters into 130 pages while retaining chapter details', () => {
    const rows = Array.from({ length: 12 }, (_, index) =>
      event({
        childId: `c${index}`,
        chapterNumber: `第${index + 1}集`,
        fileCount: index === 0 ? 20 : 10
      })
    )
    const result = groupTimelineEvents(rows)
    expect(result).toHaveLength(1)
    expect(result[0].fileCount).toBe(130)
    expect(result[0].chapters).toHaveLength(12)
    expect(rows[0].fileCount).toBe(20)
  })
  it('keeps dates, manga and duties separate, orders by latest mark', () => {
    const result = groupTimelineEvents([
      event(),
      event({ at: at - 86400000 }),
      event({ parentTitle: '其他漫画' }),
      event({ mode: 'proofread', at: at + 1000 })
    ])
    expect(result).toHaveLength(4)
    expect(result[0].mode).toBe('proofread')
    expect(result.at(-1)?.at).toBe(at - 86400000)
  })
  it('counts distinct chapter identities even when their display names match', () => {
    const result = groupTimelineEvents([
      event(),
      event({ childId: 'c2' }),
      event({ at: at + 1000 })
    ])
    expect(result[0].chapters).toHaveLength(2)
    expect(result[0].chapters[0].fileCount).toBe(20)
  })
  it('does not truncate a large daily group at the old 80 chapter limit', () => {
    const stats = Array.from({ length: 100 }, (_, index) => ({
      childId: `c${index}`,
      completedTimestamps: { typeset: [], translated: [], proofread: [], supervised: [at] }
    }))
    const where = new Map(
      stats.map((stat) => [stat.childId, { parentTitle: '漫画', chapterNumber: stat.childId }])
    )
    const groups = groupTimelineEvents(buildTimelineEvents(stats, where, Infinity))
    expect(groups[0].fileCount).toBe(100)
    expect(groups[0].chapters).toHaveLength(100)
    expect(
      groupTimelineEvents(
        Array.from({ length: 90 }, (_, index) => event({ at: at - index * 86400000 }))
      )
    ).toHaveLength(80)
  })
})
