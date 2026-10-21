import { describe, expect, it } from 'vitest'
import {
  LP_GROUP_PALETTE_SIZE,
  lpGroupColorIndex,
  lpGroupColorVar,
  lpGroupVarFor
} from '../group-colors'

describe('译文分组色 · 第几组用哪一档', () => {
  it('按文本里的分组顺序取色：第 1 组红、第 2 组蓝（照 LabelPlusFX）', () => {
    const groups = ['框内', '框外']
    expect(lpGroupColorIndex(groups, '框内')).toBe(1)
    expect(lpGroupColorIndex(groups, '框外')).toBe(2)
    expect(lpGroupVarFor(groups, '框内')).toBe('--lp-group-1')
    expect(lpGroupVarFor(groups, '框外')).toBe('--lp-group-2')
  })

  it('分组超过 4 个就循环（第 5 组回到第 1 档）', () => {
    const groups = ['a', 'b', 'c', 'd', 'e']
    expect(lpGroupColorIndex(groups, 'd')).toBe(LP_GROUP_PALETTE_SIZE)
    expect(lpGroupColorIndex(groups, 'e')).toBe(1)
  })

  it('认不出分组名 ⇒ 给第 1 档，不去猜（不引入"像不像"的推断）', () => {
    expect(lpGroupColorIndex(['框内', '框外'], '没这一组')).toBe(1)
    expect(lpGroupColorIndex([], '框内')).toBe(1)
    expect(lpGroupColorIndex(null, '框内')).toBe(1)
    expect(lpGroupColorIndex(['框内'], '   ')).toBe(1)
  })

  it('两边空白不影响认组（文本里的分组名常常带空格）', () => {
    expect(lpGroupColorIndex([' 框内 ', '框外'], '框内')).toBe(1)
  })

  it('色槽编号总落在 1..4（坏数字也夹回来，不会拼出 --lp-group-99）', () => {
    const variables = [
      lpGroupColorVar(0),
      lpGroupColorVar(5),
      lpGroupColorVar(Number.NaN),
      lpGroupColorVar(99)
    ]
    expect(variables).toEqual(['--lp-group-4', '--lp-group-1', '--lp-group-1', '--lp-group-3'])
  })
})
