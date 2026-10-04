import { describe, expect, it } from 'vitest'
import { formatDateTime, formatMegabytes } from '../format'

/**
 * 时间 / 体积格式化（2026-10-01 重构 P1）。
 *
 * 这两条锁的**不是新行为**，而是"与改前那四处/两处的写法逐字一致" ——
 * 所以时间那组把旧表达式当场算一遍再对比（不手抄绝对时间串：`toLocaleString` 随本机时区变，
 * 写死就等于把测试绑在开发机的时区上）。
 */
describe('formatMegabytes', () => {
  it('与旧写法 `(bytes / 1048576).toFixed(1)` 逐字一致', () => {
    for (const bytes of [0, 1, 1024, 3_200_000, 3_379_200, 83_130_544, 10_984_263]) {
      expect(formatMegabytes(bytes)).toBe((bytes / 1048576).toFixed(1))
    }
  })

  it('具体值（照设置页/诊断面板现在显示的样子）', () => {
    expect(formatMegabytes(3_200_000)).toBe('3.1')
    expect(formatMegabytes(83_130_544)).toBe('79.3')
    expect(formatMegabytes(0)).toBe('0.0')
  })
})

describe('formatDateTime', () => {
  const SAMPLES = [
    0,
    1_790_520_000_000, // 台账/还原/设置页备份列表里出现过的量级
    1_790_746_435_000,
    Date.UTC(2026, 8, 30, 9, 24, 28)
  ]

  it('与旧写法 `new Date(at).toLocaleString("zh-CN", { hour12: false })` 逐字一致', () => {
    for (const at of SAMPLES) {
      expect(formatDateTime(at)).toBe(new Date(at).toLocaleString('zh-CN', { hour12: false }))
    }
  })

  it('24 小时制：不带"上午/下午"（这条与时区无关）', () => {
    for (const at of SAMPLES) {
      expect(formatDateTime(at)).not.toMatch(/上午|下午|AM|PM/)
    }
  })

  it('年份对得上（这条也与时区无关）', () => {
    expect(formatDateTime(Date.UTC(2026, 8, 30, 9, 24, 28))).toContain('2026')
  })
})
