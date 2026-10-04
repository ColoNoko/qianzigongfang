// @vitest-environment node

/**
 * 「进度」页的计算口径（2026-10-03）。全部是纯函数，脱离 DOM 单测。
 *
 * 这一页回答的是：**按这本漫画的职责，我还欠几话、多久没烤肉了。**
 * 口径来自用户逐条拍板（见交接文档「进度页」一节），这里逐条锁住：
 *
 *   ① `烤肉` / `熟` = **该话在"当前职责"这个模式下，所有文件都已完成**；
 *   ② **多职责分开展示**（不合并成"都完成才算熟"）—— 界面点哪个职责，数据就切到哪个；
 *   ③ `最新话` 优先按**标记完成时间**取（最近烤的那一话），保底才用**最大集数**；
 *      理由：存在【短篇】【番外】与相同集数；
 *   ④ `距上次` 用**标记完成时间戳**（不是文件修改时间 —— 后者有历史脏值）；
 *      且**不做"未知"兜底**：久就是久，如实显示天数；
 *   ⑤ 默认排序 = **项目页那一套**（最近改动在前）。
 */

import { describe, expect, it } from 'vitest'
import {
  buildChapterDutyFacts,
  buildTimelineEvents,
  localDayStart,
  timelineDayLabel,
  computeParentDutyProgress,
  daysBetween,
  DEFAULT_PROGRESS_SORT,
  isProgressSortValue,
  latestCookedChapterOf,
  parseProgressSort,
  PROGRESS_SORT_OPTIONS,
  isChapterCooked,
  lastMarkAtOf,
  latestActiveChildId,
  sortProgressRows,
  type ChapterDutyFact,
  type ParentDutyProgress
} from '../progress'
import type { WorkMode } from '../types'

/** 造一话的事实：默认"没标记过"（两个 Record 都允许只给关心的那个模式）。 */
function fact(
  chapterNumber: string,
  partial: {
    totalFiles?: number
    doneByMode?: Partial<Record<WorkMode, number>>
    lastMarkAtByMode?: Partial<Record<WorkMode, number>>
  } = {}
): ChapterDutyFact {
  return {
    childId: `c-${chapterNumber}`,
    chapterNumber,
    totalFiles: partial.totalFiles ?? 10,
    doneByMode: { typeset: 0, translated: 0, proofread: 0, supervised: 0, ...partial.doneByMode },
    lastMarkAtByMode: partial.lastMarkAtByMode ?? {}
  }
}

const DAY = 86_400_000

describe('isChapterCooked：一话在某个职责下算不算"熟"', () => {
  it('该模式的文件**全部**完成才算熟', () => {
    expect(isChapterCooked(fact('1', { totalFiles: 10, doneByMode: { proofread: 10 } }), 'proofread')).toBe(true)
    expect(isChapterCooked(fact('1', { totalFiles: 10, doneByMode: { proofread: 9 } }), 'proofread')).toBe(false)
  })

  it('**只看当前职责那个模式**（别的模式完成到 100% 也不算熟）', () => {
    const f = fact('1', { totalFiles: 10, doneByMode: { typeset: 10, proofread: 0 } })
    expect(isChapterCooked(f, 'typeset')).toBe(true)
    expect(isChapterCooked(f, 'proofread')).toBe(false)
  })

  it('总文件数为 0（还没扫到 / 目录不在）→ 不算熟，也不许算成"完成"', () => {
    expect(isChapterCooked(fact('1', { totalFiles: 0 }), 'proofread')).toBe(false)
  })

  it('完成数超过总数（分母过期）→ 仍算熟（宁可算熟，也别把做完的说成没做）', () => {
    expect(isChapterCooked(fact('1', { totalFiles: 8, doneByMode: { proofread: 10 } }), 'proofread')).toBe(true)
  })
})

describe('latestCookedChapterOf：进展 = 最近「收工」的那一话', () => {
  it('取**最近收工**的那一话 —— 不是"最近标记"的那一话', () => {
    const facts = [
      // 12 话已收工（较早），13 话还在做（最近标记）⇒ 进展应显示 12
      fact('12', {
        totalFiles: 10,
        doneByMode: { proofread: 10 },
        lastMarkAtByMode: { proofread: 400 * DAY }
      }),
      fact('13', {
        totalFiles: 10,
        doneByMode: { proofread: 4 },
        lastMarkAtByMode: { proofread: 500 * DAY }
      })
    ]
    expect(latestCookedChapterOf(facts, 'proofread')).toBe('第12集')
  })

  it('一话都没收工 → 破折号（**不再**保底报一个最大集数 —— 那正是"容易误导"的来源）', () => {
    expect(latestCookedChapterOf([fact('82', { totalFiles: 10, doneByMode: { proofread: 3 } })], 'proofread')).toBe('—')
  })

  it('只看当前职责：别的模式收工不算', () => {
    const facts = [
      fact('5', { totalFiles: 2, doneByMode: { typeset: 2 }, lastMarkAtByMode: { typeset: 100 * DAY } })
    ]
    expect(latestCookedChapterOf(facts, 'typeset')).toBe('第5集')
    expect(latestCookedChapterOf(facts, 'proofread')).toBe('—')
  })

  it('没设职责 → 破折号（"哪一话收工了"没有答案）', () => {
    const facts = [
      fact('5', { totalFiles: 2, doneByMode: { typeset: 2 }, lastMarkAtByMode: { typeset: 100 * DAY } })
    ]
    expect(latestCookedChapterOf(facts, null)).toBe('—')
  })

  it('小数集数与自定义集数原样显示；一话都没有 → 破折号', () => {
    expect(
      latestCookedChapterOf(
        [fact('25.5', { totalFiles: 1, doneByMode: { translated: 1 }, lastMarkAtByMode: { translated: 100 } })],
        'translated'
      )
    ).toBe('第25.5集')
    expect(
      latestCookedChapterOf(
        [fact('归档', { totalFiles: 1, doneByMode: { typeset: 1 }, lastMarkAtByMode: { typeset: 100 } })],
        'typeset'
      )
    ).toBe('归档')
    expect(latestCookedChapterOf([], 'proofread')).toBe('—')
  })
})

/**
 * 排序档位的**唯一出处**：界面下拉与设置存储都从这儿取，别各抄一份
 * （抄两份就会出现"界面有这个档、库里校验不认"）。
 */
describe('PROGRESS_SORT_OPTIONS：排序档位的唯一出处', () => {
  it('六档，值与方向一一对应，标签就是界面上那几个字', () => {
    expect(PROGRESS_SORT_OPTIONS.map((option) => option.value)).toEqual([
      'default:desc',
      'completion:desc',
      'completion:asc',
      'update:desc',
      'update:asc',
      'title:asc'
    ])
    expect(PROGRESS_SORT_OPTIONS.find((o) => o.value === 'completion:desc')?.label).toBe('完成度↓')
    // 2026-10-04 改名：原来叫「间隔」—— 有两列天数后它指代不明，改成列名「上次更新」
    expect(PROGRESS_SORT_OPTIONS.find((o) => o.value === 'update:asc')?.label).toBe('上次更新↑')
  })

  it('校验只认这六档；解析把垃圾值回落到默认', () => {
    expect(isProgressSortValue('update:desc')).toBe(true)
    expect(isProgressSortValue('update')).toBe(false)
    expect(isProgressSortValue(42)).toBe(false)
    expect(parseProgressSort('completion:asc')).toEqual({ key: 'completion', direction: 'asc' })
    expect(parseProgressSort('nonsense')).toEqual({ key: 'default', direction: 'desc' })
    expect(DEFAULT_PROGRESS_SORT).toBe('default:desc')
  })
})

describe('lastMarkAtOf / daysBetween：距上次烤肉多久', () => {
  it('取该职责下**最近一次**完成标记的时间', () => {
    const facts = [
      fact('1', { lastMarkAtByMode: { proofread: 100 * DAY } }),
      fact('2', { lastMarkAtByMode: { proofread: 300 * DAY } }),
      fact('3', { lastMarkAtByMode: { typeset: 900 * DAY } })
    ]
    expect(lastMarkAtOf(facts, 'proofread')).toBe(300 * DAY)
  })

  it('该职责从没标记过 → null（界面显示"从未"）', () => {
    expect(lastMarkAtOf([fact('1')], 'proofread')).toBeNull()
  })

  it('天数按整天向下取整', () => {
    expect(daysBetween(0, 10 * DAY + 3600_000)).toBe(10)
    expect(daysBetween(0, 0)).toBe(0)
  })

  it('久就是久：不做"太久就显示未知"的兜底（937 天也如实算）', () => {
    expect(daysBetween(0, 937 * DAY)).toBe(937)
  })
})

describe('computeParentDutyProgress：一本漫画的一行', () => {
  const facts = [
    fact('1', { totalFiles: 10, doneByMode: { proofread: 10 }, lastMarkAtByMode: { proofread: 100 * DAY } }),
    fact('2', { totalFiles: 10, doneByMode: { proofread: 4 } }),
    fact('3', { totalFiles: 10 })
  ]

  it('按当前职责算熟/未熟话数与完成度', () => {
    const row = computeParentDutyProgress({
      parentId: 'p1',
      title: '快住手',
      duties: ['proofread'],
      duty: 'proofread',
      lastMtimeMs: 5,
      facts,
      now: 110 * DAY
    })

    expect(row.cookedChapters).toBe(1)
    expect(row.uncookedChapters).toBe(2)
    expect(row.totalChapters).toBe(3)
    expect(row.daysSinceLastMark).toBe(10)
    expect(row.latestCookedChapter).toBe('第1集')
  })

  it('**双职责分开算**：切到哪个职责，数字与「进展」就跟着换（不合并成"都完成"）', () => {
    const mixed = [
      // 话1：校对烤完了；话2：监修烤完了 —— 两边各自"最近动手"的话不是同一话
      fact('1', {
        totalFiles: 10,
        doneByMode: { proofread: 10 },
        lastMarkAtByMode: { proofread: 100 * DAY }
      }),
      fact('2', {
        totalFiles: 10,
        doneByMode: { supervised: 10 },
        lastMarkAtByMode: { supervised: 200 * DAY }
      })
    ]
    const asProofread = computeParentDutyProgress({
      parentId: 'p1', title: '青梅亭亭', duties: ['proofread', 'supervised'],
      duty: 'proofread', lastMtimeMs: 1, facts: mixed, now: 300 * DAY
    })
    const asSupervised = computeParentDutyProgress({
      parentId: 'p1', title: '青梅亭亭', duties: ['proofread', 'supervised'],
      duty: 'supervised', lastMtimeMs: 1, facts: mixed, now: 300 * DAY
    })

    // 两个口径各自"熟 1 话 / 未熟 1 话"，但熟的和最近动的**不是同一话**
    expect([asProofread.cookedChapters, asProofread.uncookedChapters]).toEqual([1, 1])
    expect([asSupervised.cookedChapters, asSupervised.uncookedChapters]).toEqual([1, 1])
    expect(asProofread.latestCookedChapter).toBe('第1集')
    expect(asSupervised.latestCookedChapter).toBe('第2集')
    expect(asProofread.daysSinceLastMark).toBe(200)
    expect(asSupervised.daysSinceLastMark).toBe(100)
  })

  it('没设职责（duty = null）→ 不算熟/未熟，且「进展」是破折号（"哪一话收工了"没有答案）', () => {
    const row = computeParentDutyProgress({
      parentId: 'p1', title: '零魔力的大贤者', duties: [], duty: null,
      lastMtimeMs: 1, facts, now: 0
    })

    expect(row.duty).toBeNull()
    expect(row.cookedChapters).toBe(0)
    expect(row.uncookedChapters).toBe(0)
    expect(row.daysSinceLastMark).toBeNull()
    expect(row.latestCookedChapter).toBe('—')
  })

  it('全熟的话：未熟 0、完成度满', () => {
    const all = [fact('1', { totalFiles: 3, doneByMode: { typeset: 3 } })]
    const row = computeParentDutyProgress({
      parentId: 'p1', title: '鹅妈妈', duties: ['typeset'], duty: 'typeset',
      lastMtimeMs: 1, facts: all, now: 0
    })
    expect(row.uncookedChapters).toBe(0)
    expect(row.cookedChapters).toBe(1)
  })
})

describe('sortProgressRows：默认按项目页那一套；完成度 / 上次更新按字面方向', () => {
  const rows: ParentDutyProgress[] = [
    { parentId: 'a', title: '鹅妈妈', duties: ['typeset'], duty: 'typeset', latestCookedChapter: '第139集', daysSinceLastMark: 9, daysSinceLastCooked: 12, cookedChapters: 40, uncookedChapters: 0, totalChapters: 40, lastMtimeMs: 100 },
    { parentId: 'b', title: '快住手', duties: ['proofread'], duty: 'proofread', latestCookedChapter: '第67集', daysSinceLastMark: 0, daysSinceLastCooked: 1, cookedChapters: 73, uncookedChapters: 2, totalChapters: 75, lastMtimeMs: 300 },
    { parentId: 'c', title: '伯爵的6岁萝莉', duties: ['supervised'], duty: 'supervised', latestCookedChapter: '第12集', daysSinceLastMark: null, daysSinceLastCooked: null, cookedChapters: 0, uncookedChapters: 14, totalChapters: 14, lastMtimeMs: 200 }
  ]

  it('默认（项目页口径）：最近改动在前', () => {
    expect(sortProgressRows(rows, 'default', 'desc').map((r) => r.parentId)).toEqual(['b', 'c', 'a'])
  })

  it('完成度↓ = 完成度**高的在前**（按比例，不是按已熟话数）', () => {
    // 鹅妈妈 40/40 = 100% 必须排在快住手 73/75 = 97% 之前 —— 比"已熟话数"会排反
    expect(sortProgressRows(rows, 'completion', 'desc').map((r) => r.parentId)).toEqual(['a', 'b', 'c'])
  })

  it('完成度↑ = 欠账多的在前', () => {
    expect(sortProgressRows(rows, 'completion', 'asc').map((r) => r.parentId)).toEqual(['c', 'b', 'a'])
  })

  it('没设职责的本（0/0）在完成度排序里排最后（它"说不出来"）', () => {
    const withNone: ParentDutyProgress[] = [
      { parentId: 'n', title: '还没设职责', duties: [], duty: null, latestCookedChapter: '第5集', daysSinceLastMark: null, daysSinceLastCooked: null, cookedChapters: 0, uncookedChapters: 0, totalChapters: 0, lastMtimeMs: 50 },
      ...rows
    ]
    expect(sortProgressRows(withNone, 'completion', 'desc').map((r) => r.parentId)).toEqual(['a', 'b', 'c', 'n'])
  })

  it('上次更新↓ = 完整收工间隔长的在前（"从未"算最长）；↑ = 短的在前', () => {
    // 注意：这里排的是 daysSinceLastCooked（完整收工），不是 daysSinceLastMark（出勤）
    expect(sortProgressRows(rows, 'update', 'desc').map((r) => r.parentId)).toEqual(['c', 'a', 'b'])
    expect(sortProgressRows(rows, 'update', 'asc').map((r) => r.parentId)).toEqual(['b', 'a', 'c'])
  })

  it('排的是「上次更新」不是「最近出勤」：两列故意反向时，顺序跟着收工走', () => {
    // x：刚完整做完一话（1 天），但自己很久没来（出勤 100 天）
    // y：今天来标过一张（出勤 0），但 50 天没完整做完一话了
    const opposite = [
      { parentId: 'x', daysSinceLastCooked: 1, daysSinceLastMark: 100 },
      { parentId: 'y', daysSinceLastCooked: 50, daysSinceLastMark: 0 }
    ] as unknown as ParentDutyProgress[]
    // 按「上次更新」升序 ⇒ x 在前；若错排成「最近出勤」，y 会在前 —— 两种结果不可能同时成立
    expect(sortProgressRows(opposite, 'update', 'asc').map((r) => r.parentId)).toEqual(['x', 'y'])
    expect(sortProgressRows(opposite, 'update', 'desc').map((r) => r.parentId)).toEqual(['y', 'x'])
  })

  it('按名字：中文自然序，且不改动入参', () => {
    const before = rows.map((r) => r.parentId)
    expect(sortProgressRows(rows, 'title', 'asc').map((r) => r.parentId)).toEqual(['c', 'a', 'b'])
    expect(rows.map((r) => r.parentId)).toEqual(before)
  })

  it('排序稳定：同键值保持原顺序（不许出现"刷新一次顺序就变"）', () => {
    const same: ParentDutyProgress[] = rows.map((r) => ({ ...r, uncookedChapters: 5, lastMtimeMs: 1 }))
    expect(sortProgressRows(same, 'completion', 'desc').map((r) => r.parentId)).toEqual(['a', 'b', 'c'])
  })
})

/**
 * 事实合成（项目树 + 标记记录）——**分母的取法是全页最容易算错的一处**：
 * 拿"只标过的文件数"当分母，会把"只做了 1/4"误判成**全熟**。
 */
describe('buildChapterDutyFacts：分母优先项目树，缺了才退回标记记录', () => {
  const stats = new Map([
    [
      'c1',
      {
        fileCount: 5,
        completedTimestamps: { typeset: [100, 200], translated: [], proofread: [300], supervised: [] }
      }
    ]
  ])

  it('有项目树统计 → 用它当分母（20 个文件只完成 2 个 ⇒ 没熟）', () => {
    const facts = buildChapterDutyFacts(
      [{ id: 'c1', chapterNumber: '1', psdStats: new Array(20) }],
      stats
    )
    expect(facts[0].totalFiles).toBe(20)
    expect(isChapterCooked(facts[0], 'typeset')).toBe(false)
  })

  it('统计缺失（长度为 0）→ 退回标记记录里的文件数，不至于全本都算"没做"', () => {
    const facts = buildChapterDutyFacts([{ id: 'c1', chapterNumber: '1', psdStats: [] }], stats)
    expect(facts[0].totalFiles).toBe(5)
    expect(isChapterCooked(facts[0], 'typeset')).toBe(false)
  })

  it('每模式的完成数与"最近完成时间"都来自标记记录；没标记的模式是 0 且没有时间', () => {
    const facts = buildChapterDutyFacts([{ id: 'c1', chapterNumber: '1', psdStats: [] }], stats)
    expect(facts[0].doneByMode).toEqual({ typeset: 2, translated: 0, proofread: 1, supervised: 0 })
    expect(facts[0].lastMarkAtByMode).toEqual({ typeset: 200, proofread: 300 })
  })

  it('从没标记过的话仍然在列表里（要算进"待烤"），只是全 0', () => {
    const facts = buildChapterDutyFacts(
      [{ id: 'cX', chapterNumber: '9', psdStats: new Array(3) }],
      stats
    )
    expect(facts).toHaveLength(1)
    expect(facts[0].totalFiles).toBe(3)
    expect(facts[0].doneByMode.typeset).toBe(0)
    expect(facts[0].lastMarkAtByMode).toEqual({})
    expect(isChapterCooked(facts[0], 'typeset')).toBe(false)
  })
})

describe('latestActiveChildId：点漫画名该跳到哪一话', () => {
  it('跳到该职责下最近标记完成的那一话（与"最新话"同一条规则）', () => {
    const facts = [
      fact('20', { lastMarkAtByMode: { proofread: 100 * DAY } }),
      fact('13', { lastMarkAtByMode: { proofread: 300 * DAY } })
    ]
    expect(latestActiveChildId(facts, 'proofread')).toBe('c-13')
  })

  it('一话都没标记过 → 跳到集数最大的那一话（点一下总能落到某一话）', () => {
    const facts = [fact('2'), fact('10')]
    expect(latestActiveChildId(facts, 'proofread')).toBe('c-10')
  })

  it('一话都没有 → null（界面把标题渲染成不可点）', () => {
    expect(latestActiveChildId([], 'proofread')).toBeNull()
  })
})

/**
 * 「上次更新」= 距上次**完整做完一话**多少天（2026-10-04 用户新增的一列）。
 *
 * 与「最近出勤」（= 距上次动手标记，原名「距上次」）的区别：
 *   出勤 = 你今天标了一张也算；更新 = 你今天**把一整话做完**了才算。
 * 两者天然满足 **上次更新 ≥ 最近出勤**（收工那话的标记时间，必然不晚于全部标记里
 * 最晚的那个）—— 这条不变量单锁一条：它是最容易在重构里被写反的地方。
 */
describe('「上次更新」：距上次完整收工多少天', () => {
  const NOW = 100 * DAY

  function rowOf(facts: readonly ChapterDutyFact[], duty: WorkMode | null = 'proofread') {
    return computeParentDutyProgress({
      parentId: 'p',
      title: '测试本',
      duties: duty ? [duty] : [],
      duty,
      lastMtimeMs: 0,
      facts,
      now: NOW
    })
  }

  it('只认**已收工**的话：没做完那话的标记时间不算数', () => {
    const facts = [
      fact('1', {
        totalFiles: 10,
        doneByMode: { proofread: 10 },
        lastMarkAtByMode: { proofread: NOW - 30 * DAY }
      }),
      fact('2', {
        totalFiles: 10,
        doneByMode: { proofread: 4 },
        lastMarkAtByMode: { proofread: NOW - DAY }
      })
    ]
    const row = rowOf(facts)
    expect(row.daysSinceLastCooked).toBe(30)
    // 出勤仍是"昨天" —— 两列各说各的，正是这一列存在的意义
    expect(row.daysSinceLastMark).toBe(1)
  })

  it('多话收工 → 取**最晚**那次（离现在最近的收工）', () => {
    const facts = [
      fact('1', { doneByMode: { proofread: 10 }, lastMarkAtByMode: { proofread: NOW - 50 * DAY } }),
      fact('2', { doneByMode: { proofread: 10 }, lastMarkAtByMode: { proofread: NOW - 3 * DAY } }),
      fact('3', { doneByMode: { proofread: 10 }, lastMarkAtByMode: { proofread: NOW - 20 * DAY } })
    ]
    expect(rowOf(facts).daysSinceLastCooked).toBe(3)
  })

  it('一话都没收工 → null（界面显示"从未"，不硬编一个天数）', () => {
    const facts = [
      fact('1', { doneByMode: { proofread: 3 }, lastMarkAtByMode: { proofread: NOW - DAY } })
    ]
    expect(rowOf(facts).daysSinceLastCooked).toBeNull()
  })

  it('没设职责 → null（"多久没更新"没有答案）', () => {
    const facts = [
      fact('1', { doneByMode: { proofread: 10 }, lastMarkAtByMode: { proofread: NOW - DAY } })
    ]
    expect(rowOf(facts, null).daysSinceLastCooked).toBeNull()
  })

  it('**不变量**：上次更新 ≥ 最近出勤（多组数据都成立）', () => {
    const cases: ChapterDutyFact[][] = [
      [
        fact('1', {
          totalFiles: 5,
          doneByMode: { proofread: 5 },
          lastMarkAtByMode: { proofread: NOW - 7 * DAY }
        })
      ],
      [
        fact('1', { totalFiles: 5, doneByMode: { proofread: 5 }, lastMarkAtByMode: { proofread: NOW - 40 * DAY } }),
        fact('2', { totalFiles: 5, doneByMode: { proofread: 1 }, lastMarkAtByMode: { proofread: NOW } })
      ],
      [
        fact('1', { totalFiles: 3, doneByMode: { proofread: 3 }, lastMarkAtByMode: { proofread: NOW - 2 * DAY } }),
        fact('2', { totalFiles: 3, doneByMode: { proofread: 3 }, lastMarkAtByMode: { proofread: NOW - 9 * DAY } })
      ],
      // 从没收工：null 不参与比大小，只要求"两边都有值"时关系成立
      [
        fact('1', {
          totalFiles: 3,
          doneByMode: { proofread: 1 },
          lastMarkAtByMode: { proofread: NOW - 5 * DAY }
        })
      ]
    ]
    for (const facts of cases) {
      const row = rowOf(facts)
      if (row.daysSinceLastCooked === null || row.daysSinceLastMark === null) continue
      expect(row.daysSinceLastCooked, '上次更新必须 ≥ 最近出勤').toBeGreaterThanOrEqual(
        row.daysSinceLastMark
      )
    }
  })

  it('切职责：两列都跟着换（多职责分开算的既有规矩不被破坏）', () => {
    const facts = [
      fact('1', {
        totalFiles: 4,
        doneByMode: { proofread: 4, supervised: 0 },
        lastMarkAtByMode: { proofread: NOW - 6 * DAY }
      })
    ]
    expect(rowOf(facts, 'proofread').daysSinceLastCooked).toBe(6)
    expect(rowOf(facts, 'supervised').daysSinceLastCooked).toBeNull()
  })
})

/**
 * 排序档位（2026-10-04 改名）：原来那档叫「间隔」，只有一列天数时够用；
 * 现在有两列天数（上次更新 / 最近出勤），按仓库既有规矩**档位名 = 列名**，
 * 于是改名成「上次更新」，排的也是「上次更新」那一列。
 * ⚠️ 键随之从 `gap` 换成 `update` ⇒ 老用户存的 `gap:*` 会**回落默认档**（不抛错）。
 * 这是用户拍板接受的副作用，单独锁住"不抛 + 回落"，免得以后有人改成崩。
 */
describe('排序档位：改名成「上次更新」', () => {
  it('下拉里不再有「间隔」，改为「上次更新↓ / 上次更新↑」', () => {
    const labels = PROGRESS_SORT_OPTIONS.map((option) => option.label)
    expect(labels).toContain('上次更新↓')
    expect(labels).toContain('上次更新↑')
    expect(labels.some((label) => label.includes('间隔'))).toBe(false)
    // 档数不变（6 档）—— 只改名，不增不减别档
    expect(PROGRESS_SORT_OPTIONS).toHaveLength(6)
  })

  it('「上次更新↓」= 完整收工间隔长的在前；**从没收工算最长、排最前**', () => {
    const rows = [
      { parentId: 'a', daysSinceLastCooked: 3 },
      { parentId: 'b', daysSinceLastCooked: null },
      { parentId: 'c', daysSinceLastCooked: 40 }
    ] as unknown as ParentDutyProgress[]
    expect(sortProgressRows(rows, 'update', 'desc').map((row) => row.parentId)).toEqual(['b', 'c', 'a'])
  })

  it('「上次更新↑」= 间隔短的在前（"从未"排最后）', () => {
    const rows = [
      { parentId: 'a', daysSinceLastCooked: 3 },
      { parentId: 'b', daysSinceLastCooked: null },
      { parentId: 'c', daysSinceLastCooked: 40 }
    ] as unknown as ParentDutyProgress[]
    expect(sortProgressRows(rows, 'update', 'asc').map((row) => row.parentId)).toEqual(['a', 'c', 'b'])
  })

  it('老值 `gap:*` 不再被认：回落默认档、**不抛错**', () => {
    expect(isProgressSortValue('gap:desc')).toBe(false)
    expect(parseProgressSort('gap:desc')).toEqual({ key: 'default', direction: 'desc' })
    expect(DEFAULT_PROGRESS_SORT).toBe('default:desc')
  })
})

/**
 * 时间线（2026-10-04 用户拍板改成**按天切分**）。
 *
 * 旧口径：一条 = 一话 × 一职责（跨多少天都合并）⇒ 一行写着「今天 · 完成 7 张」，
 *   而那 7 张可能是三个月里陆续做的 —— 日期与张数来源不同，看着像在说同一件事。
 * 新口径：一条 = **某一天** × 一话 × 一职责，`fileCount` = **那天**完成的张数。
 */
describe('buildTimelineEvents：一条 = 某天 × 某话 × 某职责', () => {
  const at = (day: number, hour = 12, minute = 0): number =>
    new Date(2026, 9, day, hour, minute, 0).getTime()

  const where = new Map([
    ['c1', { parentTitle: '鹅妈妈', chapterNumber: '第1集' }],
    ['c2', { parentTitle: '快住手', chapterNumber: '第2集' }]
  ])

  const statOf = (childId: string, stamps: Partial<Record<WorkMode, readonly number[]>>) => ({
    childId,
    completedTimestamps: {
      typeset: [],
      translated: [],
      proofread: [],
      supervised: [],
      ...stamps
    }
  })

  it('同一话同一职责**跨天**标过 → 拆成多条，张数是各自那天做的量', () => {
    const stats = [
      statOf('c1', {
        typeset: [at(1, 9), at(1, 10), at(1, 11), at(3, 15), at(3, 16)]
      })
    ]
    const events = buildTimelineEvents(stats, where)
    expect(events).toHaveLength(2)
    // 倒序：10-03 那条在前
    expect(events[0].fileCount).toBe(2)
    expect(events[1].fileCount).toBe(3)
    // 两条都是同一话同一职责 —— 差别只在"天"
    expect(events[0].chapterNumber).toBe('第1集')
    expect(events[1].chapterNumber).toBe('第1集')
  })

  it('同一天内标了多次 → **合成一条**，张数 = 那天完成的总数', () => {
    const stats = [statOf('c1', { typeset: [at(3, 9), at(3, 12), at(3, 23, 59)] })]
    const events = buildTimelineEvents(stats, where)
    expect(events).toHaveLength(1)
    expect(events[0].fileCount).toBe(3)
    // 这一条的时间 = 那天**最后一笔**
    expect(events[0].at).toBe(at(3, 23, 59))
  })

  it('**跨零点**算两天：23:59 与次日 00:01 不合并（自然日，不是滚动 24 小时）', () => {
    const stats = [statOf('c1', { typeset: [at(3, 23, 59), at(4, 0, 1)] })]
    const events = buildTimelineEvents(stats, where)
    expect(events).toHaveLength(2)
    expect(events.map((event) => event.fileCount).sort()).toEqual([1, 1])
  })

  it('不同话 / 不同职责各占一条（同一天也分开）', () => {
    const stats = [
      statOf('c1', { typeset: [at(3, 9)], proofread: [at(3, 10)] }),
      statOf('c2', { typeset: [at(3, 11)] })
    ]
    expect(buildTimelineEvents(stats, where)).toHaveLength(3)
  })

  it('排序：按天倒序；同一天内按"最后一笔"倒序', () => {
    const stats = [
      statOf('c1', { typeset: [at(2, 20)] }),
      statOf('c2', { typeset: [at(3, 8)] }),
      statOf('c1', { typeset: [at(3, 22)] })
    ]
    const events = buildTimelineEvents(stats, where)
    expect(events.map((event) => event.at)).toEqual([at(3, 22), at(3, 8), at(2, 20)])
  })

  it('只留最近 80 条（按天切分后条数会变多，上限仍然守着）', () => {
    const stamps = Array.from({ length: 90 }, (_, index) => at(1, 0) + index * 60_000)
    const stats = [statOf('c1', { typeset: stamps })]
    expect(buildTimelineEvents(stats, where).length).toBeLessThanOrEqual(80)
  })

  it('树里找不到归属的话 → 跳过（时间线要显示"哪本哪话"，没归属就没法显示）', () => {
    const stats = [statOf('已删除的话', { typeset: [at(3, 9)] })]
    expect(buildTimelineEvents(stats, where)).toEqual([])
  })

  it('没有任何标记 → 空数组（抽屉显示空态，不显示假行）', () => {
    expect(buildTimelineEvents([], where)).toEqual([])
  })
})

describe('timelineDayLabel / localDayStart：一天从本地零点开始', () => {
  const at = (day: number, hour: number, minute = 0): number =>
    new Date(2026, 9, day, hour, minute, 0).getTime()

  it('localDayStart 抹掉时分秒（本地时区）', () => {
    expect(localDayStart(at(4, 23, 59))).toBe(at(4, 0, 0))
    expect(localDayStart(at(4, 0, 0))).toBe(at(4, 0, 0))
  })

  it('按自然日算"今天 / 昨天"：凌晨 00:30 看昨夜 23:30，仍是「昨天」', () => {
    const justAfterMidnight = at(4, 0, 30)
    // 只差 1 小时，但属于不同的自然日 —— 滚动 24 小时口径会错说成"今天"
    expect(timelineDayLabel(at(3, 23, 30), justAfterMidnight)).toBe('昨天')
    expect(timelineDayLabel(at(4, 0, 10), justAfterMidnight)).toBe('今天')
  })

  it('30 天内说相对天数，更久给具体日期（不给"937 天前"这种读不出感觉的数）', () => {
    // 10-30 12:00 视角：10-27 是 3 天前；9-20 已经 40 天 ⇒ 给日期
    const now = at(30, 12)
    expect(timelineDayLabel(at(27, 12), now)).toBe('3 天前')
    expect(timelineDayLabel(new Date(2026, 8, 20, 12, 0, 0).getTime(), now)).not.toContain('天前')
  })
})
