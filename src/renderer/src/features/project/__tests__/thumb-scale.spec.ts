import { describe, expect, it } from 'vitest'
import { THUMB_MAX_EDGE, fitWithin } from '../thumb-scale'

describe('thumb-scale 缩略图尺寸规则', () => {
  it('等比缩到最长边不超过上限（横图/竖图都对）', () => {
    expect(fitWithin(1062, 1500)).toEqual({ width: 255, height: 360 })
    expect(fitWithin(3000, 2000)).toEqual({ width: 360, height: 240 })
    expect(fitWithin(720, 720)).toEqual({ width: 360, height: 360 })
  })

  it('本来就够小 → 原样返回（不多此一举）', () => {
    expect(fitWithin(162, 208)).toEqual({ width: 162, height: 208 })
    expect(fitWithin(THUMB_MAX_EDGE, THUMB_MAX_EDGE)).toEqual({ width: 360, height: 360 })
  })

  it('不合法输入 → 返回 0（调用方据此跳过降采样，而不是画出个坏画布）', () => {
    expect(fitWithin(0, 100)).toEqual({ width: 0, height: 0 })
    expect(fitWithin(-5, 100)).toEqual({ width: 0, height: 0 })
    expect(fitWithin(Number.NaN, 100)).toEqual({ width: 0, height: 0 })
  })

  it('尺寸取整且至少 1px（canvas 不接受 0 或小数）', () => {
    const tiny = fitWithin(1, 10000)
    expect(tiny.width).toBe(1)
    expect(tiny.height).toBe(360)
    const odd = fitWithin(999, 1001)
    expect(Number.isInteger(odd.width)).toBe(true)
    expect(Number.isInteger(odd.height)).toBe(true)
    expect(odd.height).toBe(360)
  })

})
