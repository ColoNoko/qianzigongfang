// @vitest-environment node
/**
 * `ProjectScanScheduler`（2026-10-05 从 0.4.0 移植）—— 每目录**唯一权威扫描**。
 *
 * 移植时保留 0.4.0 的全部四条语义：
 *   ① 同一目录的并发请求只飞一次（去重）；
 *   ② 2 秒内的旧结果可作缓存返回（`cached`）；
 *   ③ **双次校验**：读全之后等 500ms 再扫一遍，两次一致才交给 `commit`，
 *      不一致就重试，最多 4 次，还不行给 `status='unstable'` ——
 *      专治"Photoshop 正在写盘，扫到半截文件"；
 *   ④ `invalidate` 让进行中的请求作废（generation 守卫）：脏结果**永远到不了 commit**。
 *
 * ⚠️ 适配边界：0.4.0 里 `commit` 直接写库（`recordScannedProject`），本项目没有
 * "扫描结果落库"这一层 —— 扫描结果由渲染层决定怎么用。所以这里的 `commit` 是
 * **注入的回调**（接线时给 no-op / 日志），双次校验与缓存语义不变。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProjectScanScheduler } from '../project-scan-scheduler'
import type { ChildProjectScan } from '@shared/types'

function cleanScan(marker = 0): ChildProjectScan {
  return {
    jpgPairs: [
      {
        jpgPath: `D:\\漫画\\第1話\\${marker}.jpg`,
        psd: {
          absPath: `D:\\漫画\\第1話\\${marker}.psd`,
          mtimeMs: marker,
          ctimeMs: marker,
          status: 'pending'
        }
      }
    ],
    imageFiles: [`D:\\漫画\\第1話\\${marker}.jpg`],
    txtFiles: [],
    errors: [],
    status: 'complete'
  }
}

const PATH = 'D:\\漫画\\第1話'

let scheduler: ProjectScanScheduler
let scan: ReturnType<typeof vi.fn<(path: string) => Promise<ChildProjectScan>>>
let commit: ReturnType<
  typeof vi.fn<(path: string, result: ChildProjectScan, current: () => boolean) => Promise<void>>
>

beforeEach(() => {
  vi.useFakeTimers()
  scan = vi.fn()
  commit = vi.fn(async () => undefined)
  scheduler = new ProjectScanScheduler(scan, commit, 500)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('ProjectScanScheduler — 去重与缓存', () => {
  it('同一目录并发请求只飞一次扫描，两个调用拿到同一份结果', async () => {
    scan.mockResolvedValue(cleanScan(1))

    const first = scheduler.request(PATH, false)
    const second = scheduler.request(PATH, false)
    expect(second).toBe(first)
    expect(scan).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(600)
    const result = await first
    expect(result.status).toBe('complete')
    expect(result.revision).toBe(1)
  })

  it('cached=true 且结果在 2 秒内 ⇒ 直接吃缓存，不再扫描', async () => {
    scan.mockResolvedValue(cleanScan(1))

    const first = scheduler.request(PATH, false)
    await vi.advanceTimersByTimeAsync(600)
    await first
    await scheduler.request(PATH, true)

    // 第一次是双次校验（2 次），第二次吃缓存（不再 +）
    expect(scan).toHaveBeenCalledTimes(2)
  })

  it('缓存超过 2 秒 ⇒ 重新扫', async () => {
    scan.mockResolvedValue(cleanScan(1))

    const first = scheduler.request(PATH, false)
    await vi.advanceTimersByTimeAsync(600)
    await first
    await vi.advanceTimersByTimeAsync(2500)
    const second = scheduler.request(PATH, true)
    await vi.advanceTimersByTimeAsync(600)
    await second

    // 第一次 2 次 + 第二次（缓存过期）再 2 次
    expect(scan).toHaveBeenCalledTimes(4)
  })
})

describe('ProjectScanScheduler — 双次校验', () => {
  it('读全 ⇒ 等 500ms 复扫，两次一致才 commit（且标 complete）', async () => {
    scan.mockResolvedValue(cleanScan(1))

    const promise = scheduler.request(PATH, false)
    await vi.advanceTimersByTimeAsync(600)
    const result = await promise

    expect(scan).toHaveBeenCalledTimes(2)
    expect(commit).toHaveBeenCalledTimes(1)
    const committed = commit.mock.calls[0][1] as ChildProjectScan
    expect(committed.status).toBe('complete')
    expect(result.revision).toBe(1)
  })

  it('两次不一致 ⇒ 重试；4 次都不稳 ⇒ status=unstable 且不 commit', async () => {
    let marker = 0
    scan.mockImplementation(async () => cleanScan(++marker))

    const promise = scheduler.request(PATH, false)
    // 4 次尝试 ×（扫 + 500ms 复扫）
    for (let attempt = 0; attempt < 4; attempt++) {
      await vi.advanceTimersByTimeAsync(600)
    }
    const result = await promise

    expect(scan).toHaveBeenCalledTimes(8)
    expect(commit).not.toHaveBeenCalled()
    expect(result.status).toBe('unstable')
    expect(result.revision).toBe(1)
  })

  it('扫描出错（errors 非空）⇒ 不做双次校验，标 partial，不 commit', async () => {
    scan.mockResolvedValue({
      ...cleanScan(1),
      status: 'partial',
      errors: [{ path: 'D:\\漫画\\第1話\\x.psd', msg: 'EACCES' }]
    })

    const result = await scheduler.request(PATH, false)
    await vi.advanceTimersByTimeAsync(10)
    await result

    expect(scan).toHaveBeenCalledTimes(1)
    expect(commit).not.toHaveBeenCalled()
    expect((await result).status).toBe('partial')
  })
})

describe('ProjectScanScheduler — generation 守卫', () => {
  it('settle 期间被 invalidate ⇒ 那次结果作废，重扫后才 commit', async () => {
    scan.mockResolvedValue(cleanScan(1))

    const promise = scheduler.request(PATH, false)
    await vi.advanceTimersByTimeAsync(0) // 让第一扫落地、settle 计时器挂上
    scheduler.invalidate(PATH) // 此时作废
    await vi.advanceTimersByTimeAsync(600) // settle 触发 → 复扫 → 发现 generation 变了 → 重试
    await vi.advanceTimersByTimeAsync(600) // 重试那一轮的 settle → 复扫 → 一致 → commit
    await promise

    // 第一轮 2 次作废，第二轮 2 次成功：共 4 次扫描、1 次 commit
    expect(scan).toHaveBeenCalledTimes(4)
    expect(commit).toHaveBeenCalledTimes(1)
  })
})
