import { describe, expect, it } from 'vitest'
import type { ChildMarkStatistics } from '../ipc-api'
import { aggregateMarkStatistics, markMonthKey } from '../mark-stats'

/**
 * 「四个模式都给了数组」这份契约的**测试侧底稿**（2026-10-01 第一批 A3）。
 *
 * 它原本是 `shared/mark-stats.ts` 里一个只被测试使用的导出 —— 生产代码一处都不用，
 * 所以搬进测试文件：**生产模块不该为了测试而导出东西**。
 */
function emptyCompletedTimestamps(): ChildMarkStatistics['completedTimestamps'] {
  return { typeset: [], translated: [], proofread: [], supervised: [] }
}

/**
 * 成就聚合（第十五轮换源后的规则）。
 *
 * 这里锁的是"删图不掉历史"这件事本身：聚合只吃**标记记录**，
 * 记录里有什么就统计什么，和当前磁盘上还剩几张图无关。
 */
function child(partial: Partial<ChildMarkStatistics> & { childId: string }): ChildMarkStatistics {
  return {
    folderPath: `/c/${partial.childId}`,
    fileCount: 0,
    completedTimestamps: emptyCompletedTimestamps(),
    ...partial
  }
}

function at(iso: string): number {
  return new Date(`${iso}T12:00:00+08:00`).getTime()
}

describe('mark-stats 聚合', () => {
  it('按**标记时间**分月计数（不是文件时间）', () => {
    const aggregates = aggregateMarkStatistics(
      [
        child({
          childId: 'c1',
          fileCount: 3,
          completedTimestamps: {
            ...emptyCompletedTimestamps(),
            typeset: [at('2026-08-10'), at('2026-09-01'), at('2026-09-20')]
          }
        })
      ],
      'typeset'
    )

    expect(markMonthKey(at('2026-09-01'))).toBe('2026-09')
    expect([...aggregates.data.entries()].sort()).toEqual([
      ['2026-08', 1],
      ['2026-09', 2]
    ])
    expect(aggregates.total).toBe(3)
  })

  it('只统计当前模式：切模式就换一套数字', () => {
    const stats = [
      child({
        childId: 'c1',
        fileCount: 2,
        completedTimestamps: {
          ...emptyCompletedTimestamps(),
          typeset: [at('2026-09-01')],
          supervised: [at('2026-07-01'), at('2026-07-02')]
        }
      })
    ]

    expect(aggregateMarkStatistics(stats, 'typeset').total).toBe(1)
    expect(aggregateMarkStatistics(stats, 'supervised').total).toBe(2)
    expect(aggregateMarkStatistics(stats, 'proofread').total).toBe(0)
  })

  it('「整话完成」按**记录口径**：记录里的文件全完成才算（与现在磁盘上剩几张无关）', () => {
    const onlyRecords = [
      child({
        childId: 'c-full',
        fileCount: 2,
        completedTimestamps: { ...emptyCompletedTimestamps(), typeset: [at('2026-09-01'), at('2026-09-05')] }
      }),
      child({
        childId: 'c-half',
        fileCount: 3,
        completedTimestamps: { ...emptyCompletedTimestamps(), typeset: [at('2026-09-02')] }
      }),
      child({ childId: 'c-empty', fileCount: 0, completedTimestamps: emptyCompletedTimestamps() })
    ]

    const aggregates = aggregateMarkStatistics(onlyRecords, 'typeset')

    // 只有 c-full 算"整话完成"，且归到它**最后一个**完成时间所在的月
    expect(aggregates.projectData.get('2026-09')).toEqual(['c-full'])
    expect(aggregates.projectData.size).toBe(1)
  })

  it('同一话里多条记录都完成时不会重复计数（同一话只算一次）', () => {
    const aggregates = aggregateMarkStatistics(
      [
        child({
          childId: 'c1',
          fileCount: 1,
          completedTimestamps: { ...emptyCompletedTimestamps(), typeset: [at('2026-09-01')] }
        }),
        // 同一话在多父级下只应出现一次（数据源按话聚合，这里再断言一次口径）
        child({
          childId: 'c1',
          fileCount: 1,
          completedTimestamps: { ...emptyCompletedTimestamps(), typeset: [at('2026-09-02')] }
        })
      ],
      'typeset'
    )

    expect(aggregates.projectData.get('2026-09')).toEqual(['c1'])
    expect(aggregates.total).toBe(2)
  })

  it('空数据 → 全空（成就页据此显示空状态）', () => {
    const aggregates = aggregateMarkStatistics([], 'typeset')

    expect(aggregates.total).toBe(0)
    expect(aggregates.data.size).toBe(0)
    expect(aggregates.projectData.size).toBe(0)
  })
})
