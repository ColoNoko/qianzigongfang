// @vitest-environment node
/**
 * `projectScanService`（2026-10-05）—— 主进程唯一扫描入口的胶水锁。
 * 调度器 / 指纹 / 扫描器各自都有单测，这里只锁"它们被正确地串在了一起"：
 * 经过服务扫描出来的结果必须带 `status` 与 `sourceRevision`（指纹）。
 *
 * ⚠️ 这里用**真实计时器**：真实 fs 扫描的完成时点不落在 fake timers 的一次 advance 里
 * （settle 计时器会在 advance 之后才被排上，测试就挂死）—— 双次校验 ~1 秒，可接受。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

vi.mock('../logger', () => ({ writeLog: vi.fn().mockResolvedValue(undefined) }))

const repo = vi.hoisted(() => ({
  recordChildContentFingerprint: vi.fn().mockResolvedValue(undefined)
}))
vi.mock('../project-repository', () => ({
  recordChildContentFingerprint: repo.recordChildContentFingerprint
}))

import { projectScanService } from '../project-scan-service'

let work: string

beforeEach(async () => {
  work = await mkdtemp(join(tmpdir(), 'qianzi-service-'))
})

afterEach(async () => {
  await rm(work, { recursive: true, force: true })
})

describe('projectScanService — 扫描器的唯一入口', () => {
  it('读全的目录 ⇒ status=complete 且带 64 位内容指纹', async () => {
    const dir = join(work, '第1話')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, '01.jpg'), 'img')
    await writeFile(join(dir, '01.psd'), 'psd')

    const result = await projectScanService.request(dir, false)

    expect(result.status).toBe('complete')
    expect(result.sourceRevision).toMatch(/^[0-9a-f]{64}$/)
    expect(result.contentFingerprint).toMatch(/^[0-9a-f]{64}$/)
  })

  /**
   * 稳定扫描之后要把**全文件指纹**记到那一话上（R1）：改名认领的比对基准。
   * 只在稳定（双次校验通过）之后记 —— 半写状态的指纹是垃圾。
   */
  it('稳定扫描后把内容指纹记到那一话上', async () => {
    const dir = join(work, '第3話')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, '01.psd'), 'psd')

    const result = await projectScanService.request(dir, false)

    expect(repo.recordChildContentFingerprint).toHaveBeenCalledWith(dir, result.contentFingerprint)
  })

  it('同一目录在 2 秒内走缓存（cached=true 不再扫）', async () => {
    const dir = join(work, '第2話')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, '01.jpg'), 'img')

    const firstResult = await projectScanService.request(dir, false)
    const cached = await projectScanService.request(dir, true)

    expect(cached.revision).toBe(firstResult.revision)
    expect(cached.sourceRevision).toBe(firstResult.sourceRevision)
  })
})
