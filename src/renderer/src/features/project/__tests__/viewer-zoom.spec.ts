import { describe, expect, it } from 'vitest'
import {
  MAX_ZOOM_RATIO,
  MIN_ZOOM_RATIO,
  ZOOM_STEP,
  clampZoomRatio,
  parseZoomPercentInput,
  zoomIn,
  zoomOut,
  zoomPercentLabel
} from '../viewer-zoom'

describe('viewer-zoom 纯函数', () => {
  it('夹取到 [1, 20]：低于适应窗口回到 1，超过 20 倍封顶，乱七八糟的值回落成 1', () => {
    expect(clampZoomRatio(1)).toBe(1)
    expect(clampZoomRatio(1.25)).toBe(1.25)
    expect(clampZoomRatio(0.4)).toBe(MIN_ZOOM_RATIO)
    expect(clampZoomRatio(0)).toBe(MIN_ZOOM_RATIO)
    expect(clampZoomRatio(-3)).toBe(MIN_ZOOM_RATIO)
    expect(clampZoomRatio(999)).toBe(MAX_ZOOM_RATIO)
    expect(clampZoomRatio(Number.NaN)).toBe(MIN_ZOOM_RATIO)
    expect(clampZoomRatio(Number.POSITIVE_INFINITY)).toBe(MIN_ZOOM_RATIO)
  })

  it('步进按 1.25 倍走，且不会越过上下限', () => {
    expect(zoomIn(1)).toBe(ZOOM_STEP)
    expect(zoomOut(ZOOM_STEP)).toBe(1)
    expect(zoomIn(MAX_ZOOM_RATIO)).toBe(MAX_ZOOM_RATIO)
    expect(zoomOut(MIN_ZOOM_RATIO)).toBe(MIN_ZOOM_RATIO)
    // 连续步进不留浮点尾巴（1.25^3 = 1.953125）
    expect(zoomIn(zoomIn(zoomIn(1)))).toBe(1.9531)
  })

  it('步进先夹取再计算：脏值不会把倍数带到范围外', () => {
    expect(zoomIn(0.2)).toBe(ZOOM_STEP)
    expect(zoomOut(120)).toBe(MAX_ZOOM_RATIO / ZOOM_STEP)
  })

  it('百分比文案四舍五入到整数', () => {
    expect(zoomPercentLabel(1)).toBe('100%')
    expect(zoomPercentLabel(1.25)).toBe('125%')
    expect(zoomPercentLabel(1.9531)).toBe('195%')
    expect(zoomPercentLabel(0.5)).toBe('100%')
  })

  it('输入解析：认数字与百分号，认得出但超范围的夹取', () => {
    expect(parseZoomPercentInput('250')).toBe(2.5)
    expect(parseZoomPercentInput('250%')).toBe(2.5)
    expect(parseZoomPercentInput(' 250 ％ ')).toBe(2.5)
    // 12.5% 低于下限 → 被夹回 100%（下限就是"适应窗口"）
    expect(parseZoomPercentInput('12.5')).toBe(MIN_ZOOM_RATIO)
    expect(parseZoomPercentInput('100')).toBe(1)
    expect(parseZoomPercentInput('9999')).toBe(MAX_ZOOM_RATIO)
    expect(parseZoomPercentInput('10')).toBe(MIN_ZOOM_RATIO)
  })

  it('输入解析：看不懂的一律返回 null（界面保持原值，不静默改数）', () => {
    for (const raw of ['', '   ', 'abc', '1e2', '-50', '+50', '50%50', '1,5', '１２５', '%']) {
      expect(parseZoomPercentInput(raw), `raw=${JSON.stringify(raw)}`).toBeNull()
    }
    expect(parseZoomPercentInput(undefined as unknown as string)).toBeNull()
  })
})
