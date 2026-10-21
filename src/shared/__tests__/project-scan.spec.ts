// @vitest-environment node
/**
 * `requireCompleteScan`（2026-10-05 从 0.4.0 移植）—— 扫描结果**入库前**的那道闸。
 *
 * 为什么要有它：扫描器返回 `partial` / `unavailable` / `unstable` 时，结果仍然"能看"
 * （该显示显示、该提示提示），但**不许落库** —— 半写状态或残缺统计一旦写进去，
 * 侧栏/首页就会永久显示错误数字（本仓库 2026-09-30 就为此修过"0 页不许入库"）。
 * 所以这条闸挂在"扫描结果 → 写库"的边界上，而不是挂在显示路径上。
 */
import { describe, expect, it } from 'vitest'
import { requireCompleteScan } from '../project-scan'
import type { ChildProjectScan } from '../types'

function scan(overrides: Partial<ChildProjectScan> = {}): ChildProjectScan {
  return { jpgPairs: [], txtFiles: [], errors: [], ...overrides }
}

describe('requireCompleteScan — 入库前只有"读全"能过', () => {
  it('complete 且没有错误 ⇒ 放行', () => {
    expect(() => requireCompleteScan(scan({ status: 'complete' }))).not.toThrow()
  })

  it('unavailable（目录不在）⇒ 报"暂不可用 / 保留上次结果"', () => {
    expect(() => requireCompleteScan(scan({ status: 'unavailable' }))).toThrow(/保留上次结果/)
  })

  it('unstable（文件仍在写）⇒ 报"仍在写入 / 稍后重试"', () => {
    expect(() => requireCompleteScan(scan({ status: 'unstable' }))).toThrow(/写入/)
  })

  it('partial（部分读不到）⇒ 报"部分文件读取失败（N 项）"', () => {
    expect(() =>
      requireCompleteScan(scan({ status: 'partial', errors: [{ path: 'a.psd', msg: 'EACCES' }] }))
    ).toThrow(/部分文件读取失败（1 项）/)
  })

  it('没有 status 但有 errors（旧扫描器或直接调用）⇒ 照样拦', () => {
    expect(() => requireCompleteScan(scan({ errors: [{ path: 'a.psd', msg: 'EIO' }] }))).toThrow(
      /部分文件读取失败（1 项）/
    )
  })
})
