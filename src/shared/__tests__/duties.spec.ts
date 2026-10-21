// @vitest-environment node

/**
 * 「职责」的纯规则（2026-10-03）。
 *
 * 职责 = 这一本漫画归我干哪道工序，可挂 1~2 个模式。所有判断都收在这个纯模块里，
 * 组件只负责画与发事件 —— 这样"最多两个 / 规范顺序 / 推断只给一个"这几条规则
 * 可以脱离 DOM 单测。（本仓库一贯做法，见 features/project/card-action.ts）
 */

import { describe, expect, it } from 'vitest'
import {
  MAX_PARENT_DUTIES,
  inferParentDuties,
  normalizeDuties,
  pickDutyMode,
  toggleDuty
} from '../duties'

describe('normalizeDuties：存进库的东西必须是干净的', () => {
  it('只留合法模式、去重，并按规范顺序排列（嵌 → 翻 → 校 → 监）', () => {
    expect(normalizeDuties(['supervised', 'typeset', 'supervised'])).toEqual([
      'typeset',
      'supervised'
    ])
    expect(normalizeDuties(['proofread', 'translated'])).toEqual(['translated', 'proofread'])
  })

  it('最多两个：多的丢掉（不报错、不静默换成别的）', () => {
    expect(MAX_PARENT_DUTIES).toBe(2)
    expect(normalizeDuties(['typeset', 'translated', 'proofread'])).toEqual([
      'typeset',
      'translated'
    ])
  })

  it('非数组 / 垃圾值 / 空数组 → 空职责（不是崩，也不是"保留上次"）', () => {
    for (const junk of [null, undefined, 'typeset', 42, {}, [], ['不存在的模式'], [null, 1]]) {
      expect(normalizeDuties(junk)).toEqual([])
    }
  })
})

describe('toggleDuty：点一下标签里的某个模式', () => {
  it('没选过就加上；已选就取消', () => {
    expect(toggleDuty([], 'proofread')).toEqual(['proofread'])
    expect(toggleDuty(['proofread'], 'proofread')).toEqual([])
  })

  it('已经两个时再加第三个 → 保持不变（界面也会禁用，这里是兜底）', () => {
    expect(toggleDuty(['typeset', 'translated'], 'proofread')).toEqual(['typeset', 'translated'])
  })
})

describe('pickDutyMode：进这本漫画时该切到哪个模式', () => {
  const none = { done: 0, total: 0 }

  it('只有一个职责 → 就是它', () => {
    expect(pickDutyMode(['supervised'], { supervised: { done: 3, total: 9 } })).toBe('supervised')
  })

  it('两个职责 → 切到**完成度更低**的那道（手上还有活的那个）', () => {
    expect(
      pickDutyMode(['proofread', 'supervised'], {
        proofread: { done: 9, total: 10 },
        supervised: { done: 1, total: 10 }
      })
    ).toBe('supervised')
  })

  it('两个都还没开始（0/0）→ 按规范顺序取第一个，结果稳定', () => {
    expect(pickDutyMode(['supervised', 'typeset'], { typeset: none, supervised: none })).toBe(
      'typeset'
    )
  })

  it('没有职责 → null（调用方保持现状，不许自己猜一个）', () => {
    expect(pickDutyMode([], {})).toBeNull()
  })
})

describe('inferParentDuties：没声明过职责时，按已有标记猜一个（过渡用）', () => {
  it('取标记文件数最多的那个模式（≥3 个文件才算数）', () => {
    // 真实语料：快住手 = 校对 683 / 监修 10 → 校对（也正是用户给它起的名字）
    expect(inferParentDuties([{ proofread: 683, supervised: 10 }])).toEqual(['proofread'])
    // 鹅妈妈 = 嵌字 805
    expect(inferParentDuties([{ typeset: 805 }])).toEqual(['typeset'])
  })

  it('**只给一个**：第二名哪怕很大也不给（"先嵌字后监修"是同一道流水线，不是两个岗位）', () => {
    // 真实语料：零魔力的大贤者 = 嵌字 209 + 监修 373 → 只认监修
    expect(inferParentDuties([{ typeset: 209, supervised: 373 }])).toEqual(['supervised'])
  })

  it('低于门槛的杂音不算职责（真实语料：青梅亭亭里翻译只有 1 个文件）', () => {
    expect(
      inferParentDuties([{ proofread: 162, supervised: 152, typeset: 28, translated: 1 }])
    ).toEqual(['proofread'])
  })

  it('一点标记都没有 → 空（新建的漫画不许凭空猜）', () => {
    expect(inferParentDuties([{}, { typeset: 2 }])).toEqual([])
  })

  it('把一话一话的计数先汇总，再取最大', () => {
    expect(inferParentDuties([{ typeset: 2 }, { typeset: 2 }, { supervised: 1 }])).toEqual([
      'typeset'
    ])
  })
})

it('selects slower or faster duties without changing stable tie order', () => {
  const progress = {typeset:{done:8,total:10},proofread:{done:2,total:10}}
  expect(pickDutyMode(['typeset','proofread'],progress,'slower')).toBe('proofread')
  expect(pickDutyMode(['typeset','proofread'],progress,'faster')).toBe('typeset')
})
