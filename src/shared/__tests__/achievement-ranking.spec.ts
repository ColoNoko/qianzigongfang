import { describe, expect, it } from 'vitest'
import type { AchievementModesPayload } from '../achievement-profile'
import {
  MEDAL_BADGES,
  OVERALL_RANKING_LABEL,
  avatarInitial,
  buildKpiCards,
  buildRankingSeries,
  crownPoints,
  filterEntriesByDuty,
  rankingKindLabel,
  rankingMedals,
  sortEntriesByTotal,
  type RankingEntry
} from '../achievement-ranking'
import type { WorkMode } from '../types'

function emptyModes(): AchievementModesPayload {
  return {
    typeset: { total: 0, monthly: [] },
    translated: { total: 0, monthly: [] },
    proofread: { total: 0, monthly: [] },
    supervised: { total: 0, monthly: [] }
  }
}

function withTypeset(
  modes: AchievementModesPayload,
  points: Array<{ month: string; count: number }>
): AchievementModesPayload {
  return {
    ...modes,
    typeset: {
      total: points.reduce((sum, point) => sum + point.count, 0),
      monthly: points.map((point) => ({ ...point, projectCount: 0 }))
    }
  }
}

function entry(
  id: string,
  name: string,
  modes: AchievementModesPayload,
  duty: WorkMode | null = null,
  isSelf = false
): RankingEntry {
  return { id, name, duty, isSelf, modes }
}

describe('achievement-ranking 折线序列', () => {
  it('把不同人的月份对齐到同一条时间轴，各自首尾的空月份裁成 null', () => {
    const result = buildRankingSeries(
      [
        entry(
          'self',
          '我',
          withTypeset(emptyModes(), [{ month: '2026-08', count: 1 }]),
          null,
          true
        ),
        entry('a', '阿花', withTypeset(emptyModes(), [{ month: '2026-09', count: 2 }]))
      ],
      'typeset',
      'month'
    )

    expect(result.categories).toEqual(['2026年8月', '2026年9月'])
    // 我 从 8 月起、阿花 从 9 月起 —— 谁都不许在别人的月份上贴着 0 拉一条线
    expect(result.series.map((s) => s.data)).toEqual([
      [1, null],
      [null, 2]
    ])
    expect(result.series[0].isSelf).toBe(true)
  })

  it('**中间**的空月份不裁：那个 0 是事实（那个月真没干活）', () => {
    const result = buildRankingSeries(
      [
        entry(
          'a',
          '阿花',
          withTypeset(emptyModes(), [
            { month: '2026-07', count: 1 },
            { month: '2026-09', count: 2 }
          ])
        ),
        // 阿草 8 月有数据 → 8 月才会出现在横轴上（横轴 = 有数据的月份的并集）
        entry('b', '阿草', withTypeset(emptyModes(), [{ month: '2026-08', count: 4 }]))
      ],
      'typeset',
      'month'
    )

    expect(result.categories).toEqual(['2026年7月', '2026年8月', '2026年9月'])
    // 阿花 8 月那个 0 保留（不是 null）—— 裁的只是首尾
    expect(result.series[0].data).toEqual([1, 0, 2])
    expect(result.series[1].data).toEqual([null, 4, null])
  })

  it('横轴由 axisEntries 决定：全勾掉也留着坐标轴与图例（不然用户被困在空图上）', () => {
    const everyone = [
      entry('self', '我', withTypeset(emptyModes(), [{ month: '2026-08', count: 1 }]), null, true)
    ]
    const result = buildRankingSeries([], 'typeset', 'month', everyone)

    expect(result.categories).toEqual(['2026年8月'])
    expect(result.series).toEqual([])
  })

  it('年视图把 12 个月合并成一根柱子', () => {
    const result = buildRankingSeries(
      [
        entry(
          'self',
          '我',
          withTypeset(emptyModes(), [
            { month: '2025-12', count: 2 },
            { month: '2026-01', count: 3 },
            { month: '2026-11', count: 4 }
          ]),
          null,
          true
        )
      ],
      'typeset',
      'year'
    )

    expect(result.categories).toEqual(['2025年', '2026年'])
    expect(result.series[0].data).toEqual([2, 7])
  })

  it('综合榜把四个模式合计', () => {
    const modes: AchievementModesPayload = {
      ...emptyModes(),
      typeset: { total: 2, monthly: [{ month: '2026-09', count: 2, projectCount: 0 }] },
      translated: { total: 5, monthly: [{ month: '2026-09', count: 5, projectCount: 0 }] }
    }
    const result = buildRankingSeries([entry('self', '我', modes, null, true)], 'overall', 'month')

    expect(result.series[0].data).toEqual([7])
    expect(rankingKindLabel('overall')).toBe(OVERALL_RANKING_LABEL)
    expect(rankingKindLabel('typeset')).toBe('嵌字')
  })

  it('空参赛者 → 空坐标轴，不炸', () => {
    const result = buildRankingSeries([], 'typeset', 'month')
    expect(result.categories).toEqual([])
    expect(result.series).toEqual([])
  })
})

describe('achievement-ranking KPI 卡', () => {
  const now = new Date('2026-10-05T12:00:00+08:00').getTime()

  function makeEntry(
    name: string,
    points: Array<{ month: string; count: number }>,
    isSelf = false
  ): RankingEntry {
    return entry(`id-${name}`, name, withTypeset(emptyModes(), points), null, isSelf)
  }

  it('按模式：当月/当年/总 三张卡，标题跟模式走', () => {
    const cards = buildKpiCards(
      [
        makeEntry(
          '我',
          [
            { month: '2026-10', count: 3 },
            { month: '2025-12', count: 5 }
          ],
          true
        )
      ],
      'typeset',
      now
    )

    expect(cards.map((c) => c.title)).toEqual(['当月嵌字头牌', '当年嵌字冠军', '总嵌字之王'])
    expect(cards[0].count).toBe(3)
    expect(cards[1].count).toBe(3)
    expect(cards[2].count).toBe(8)
    expect(cards[0].winners).toEqual([{ name: '我', isSelf: true }])
    expect(cards[0].tie).toBe(false)
  })

  it('综合榜标题用统一称号「烤肉」', () => {
    const cards = buildKpiCards(
      [makeEntry('我', [{ month: '2026-10', count: 1 }], true)],
      'overall',
      now
    )
    expect(cards.map((c) => c.title)).toEqual(['当月烤肉头牌', '当年烤肉冠军', '总烤肉之王'])
  })

  it('并列第一：winners 列出所有人，tie = true', () => {
    const cards = buildKpiCards(
      [
        makeEntry('我', [{ month: '2026-10', count: 5 }], true),
        makeEntry('阿花', [{ month: '2026-10', count: 5 }]),
        makeEntry('阿草', [{ month: '2026-10', count: 2 }])
      ],
      'typeset',
      now
    )

    expect(cards[0].tie).toBe(true)
    expect(cards[0].winners.map((w) => w.name)).toEqual(['我', '阿花'])
    expect(cards[0].count).toBe(5)
  })

  it('所有人都是 0 → empty = true，不硬选出一个头牌', () => {
    const cards = buildKpiCards([makeEntry('我', []), makeEntry('阿花', [])], 'typeset', now)
    expect(cards[0].empty).toBe(true)
    expect(cards[0].winners).toEqual([])
    expect(cards[0].count).toBe(0)
  })

  it('空参赛者 → 三张空卡，不炸', () => {
    const cards = buildKpiCards([], 'typeset', now)
    expect(cards).toHaveLength(3)
    expect(cards.every((card) => card.empty)).toBe(true)
  })
})

describe('achievement-ranking 头像首字', () => {
  it('取昵称首字（按码点切，emoji / 生僻字不会切坏）', () => {
    expect(avatarInitial('对手')).toBe('对')
    expect(avatarInitial(' 阿花 ')).toBe('阿')
    expect(avatarInitial('🐟鱼')).toBe('🐟')
    expect(avatarInitial('')).toBe('?')
    expect(avatarInitial('   ')).toBe('?')
  })
})

/**
 * B 方案（2026-10-05 用户拍板）：胶囊既切对比模式，又只留同职责对手。
 * 「自己永远在场」是这条规则里最容易被改坏的一半，所以单独锁。
 */
describe('achievement-ranking 按职责筛选参赛者', () => {
  function makeEntry(name: string, duty: WorkMode | null, isSelf = false): RankingEntry {
    return entry(`id-${name}`, name, emptyModes(), duty, isSelf)
  }

  it('按模式：只留同职责对手，自己永远在场，并报出被筛掉几人', () => {
    const entries = [
      makeEntry('我', null, true),
      makeEntry('翻译君', 'translated'),
      makeEntry('嵌字君', 'typeset')
    ]

    const result = filterEntriesByDuty(entries, 'typeset')

    expect(result.visible.map((e) => e.name)).toEqual(['我', '嵌字君'])
    expect(result.hidden).toBe(1)
  })

  it('没填职责的对手：按模式档下会被筛掉（切综合榜才看得到）', () => {
    const entries = [makeEntry('我', null, true), makeEntry('没填的', null)]
    const result = filterEntriesByDuty(entries, 'proofread')
    expect(result.visible.map((e) => e.name)).toEqual(['我'])
    expect(result.hidden).toBe(1)
  })

  it('综合榜：跨职责，一个都不筛', () => {
    const entries = [makeEntry('我', null, true), makeEntry('翻译君', 'translated')]
    const result = filterEntriesByDuty(entries, 'overall')
    expect(result.visible).toHaveLength(2)
    expect(result.hidden).toBe(0)
  })
})

/**
 * 王冠（2026-10-05 用户定）：**每个月**的最高者头上戴一顶 ——
 * 七月洛高就洛戴，八月逗比高就逗比戴；并列都戴；那个月没人干活就不戴。
 */
describe('achievement-ranking 每月王冠', () => {
  it('逐月取最高者，并列都戴，全是 0 的月份不戴', () => {
    const categories = ['7月', '8月', '9月', '10月']
    const series = [
      { name: '洛', data: [500, 100, 300, 0] },
      { name: '逗比', data: [200, 900, 300, 0] }
    ]

    expect(crownPoints(categories, series)).toEqual([
      { name: '洛', point: ['7月', 500] },
      { name: '逗比', point: ['8月', 900] },
      // 9 月并列第一 → 两个人都戴
      { name: '洛', point: ['9月', 300] },
      { name: '逗比', point: ['9月', 300] }
      // 10 月全是 0 → 不戴
    ])
  })

  it('null（首尾裁掉的空月份）不参与评王冠', () => {
    const series = [
      { name: '洛', data: [null, 100] },
      { name: '逗比', data: [null, null] }
    ]
    expect(crownPoints(['7月', '8月'], series)).toEqual([{ name: '洛', point: ['8月', 100] }])
  })

  it('没有任何数据 → 一顶王冠都不发', () => {
    expect(crownPoints(['7月'], [{ name: '洛', data: [null] }])).toEqual([])
  })
})

/** 参与者胶囊 / 图例上的奖牌角标：前三名统一 金 / 银 / 铜。 */
describe('achievement-ranking 金银铜角标', () => {
  function makeEntry(name: string, count: number, isSelf = false): RankingEntry {
    return entry(
      `id-${name}`,
      name,
      withTypeset(emptyModes(), [{ month: '2026-09', count }]),
      null,
      isSelf
    )
  }

  it('前三名发金/银/铜，第四名之后没有', () => {
    const entries = [
      makeEntry('我', 10, true),
      makeEntry('甲', 30),
      makeEntry('乙', 20),
      makeEntry('丙', 5)
    ]

    expect(rankingMedals(entries, 'typeset')).toEqual([
      { name: '甲', rank: 1 },
      { name: '乙', rank: 2 },
      { name: '我', rank: 3 }
    ])
    expect(MEDAL_BADGES[1]).toBe('🥇')
    expect(MEDAL_BADGES[2]).toBe('🥈')
    expect(MEDAL_BADGES[3]).toBe('🥉')
  })

  it('并列同名次：两个并列第一就都是金，且不占用银的位置', () => {
    const entries = [makeEntry('甲', 30), makeEntry('乙', 30), makeEntry('丙', 10)]
    expect(rankingMedals(entries, 'typeset')).toEqual([
      { name: '甲', rank: 1 },
      { name: '乙', rank: 1 },
      { name: '丙', rank: 2 }
    ])
  })

  it('累计为 0 的人不发奖牌（没成绩就没有名次）', () => {
    expect(rankingMedals([makeEntry('甲', 0), makeEntry('乙', 0)], 'typeset')).toEqual([])
  })
})

/** 参与者那一行的显示顺序（2026-10-05 用户要求：高到低）。 */
describe('achievement-ranking 参与者排序', () => {
  function makeEntry(name: string, count: number, isSelf = false): RankingEntry {
    return entry(
      `id-${name}`,
      name,
      withTypeset(emptyModes(), [{ month: '2026-09', count }]),
      null,
      isSelf
    )
  }

  it('按累计从高到低；并列保持原来的先后（稳定排序）', () => {
    const entries = [
      makeEntry('我', 20, true),
      makeEntry('小李', 5),
      makeEntry('大王', 50),
      makeEntry('小同', 20)
    ]

    expect(sortEntriesByTotal(entries, 'typeset').map((item) => item.name)).toEqual([
      '大王',
      '我',
      '小同',
      '小李'
    ])
  })

  it('不改动原数组（返回新数组）', () => {
    const entries = [makeEntry('甲', 1), makeEntry('乙', 9)]
    sortEntriesByTotal(entries, 'typeset')
    expect(entries.map((item) => item.name)).toEqual(['甲', '乙'])
  })
})
