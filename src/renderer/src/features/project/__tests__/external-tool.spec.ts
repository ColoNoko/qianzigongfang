// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { openPathFailureText } from '../external-tool'

/**
 * 「打开文件失败」这句话怎么说（2026-10-01 第一批 A4）。
 *
 * 这是 `external-tool.ts` 的第一条测试 —— 它整个模块（所有"去X"按钮的执行器）
 * 在此之前**零覆盖**：宿主侧把 CompareViewer 换成了桩，所以"点了以后到底说了什么"
 * 没人看着。这里先锁住最要紧的那一点：**系统的解释不许被吞掉**。
 */
describe('openPathFailureText', () => {
  it('文件不存在 → 既有话术不变', () => {
    expect(openPathFailureText({ code: 'E_NOT_FOUND', message: 'Failed to open path' })).toBe(
      '文件不存在'
    )
  })

  it('打不开但说不出原因 → 话术 + **系统原话**（实测原文就是这一句）', () => {
    expect(openPathFailureText({ code: 'E_OPEN_FAILED', message: 'Failed to open path' })).toBe(
      '打开文件失败：Failed to open path'
    )
  })

  it('没有默认应用 → 给明确话术（该码目前打不到，见 open-path-failure.ts 的实测表）', () => {
    expect(openPathFailureText({ code: 'E_NO_DEFAULT_APP', message: 'no association' })).toBe(
      '没有默认应用打开该文件'
    )
  })

  it('系统没什么可说的 → 只给话术，别甩一个空冒号', () => {
    expect(openPathFailureText({ code: 'E_OPEN_FAILED', message: '   ' })).toBe('打开文件失败')
    expect(openPathFailureText({ code: 'E_OPEN_FAILED' })).toBe('打开文件失败')
  })
})
