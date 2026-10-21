// @vitest-environment node
/**
 * `scanImportCandidate` —— 自检导入路径上的"入库前过闸"锁（2026-10-05 移植）。
 *
 * 把这条锁放在这里（只 mock `scanner`）而不是起真实目录，是因为主测试套件跑在
 * **Windows** 上：NTFS 上 chmod 000 无效，造不出"部分读不到"（见 `scanner-partial.spec`
 * 头注释）。mock 掉扫描器返回一个 `partial`，就能确定性地证明：
 * 半截统计**到不了**导入队列。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ChildProjectScan } from '@shared/types'

vi.mock('../scanner', () => ({ scanChildProject: vi.fn() }))
vi.mock('../project-repository', () => ({
  getProjectTree: vi.fn(),
  updateProjectTree: vi.fn(),
  setProjectSourceRoot: vi.fn(),
  applyParentSourceRoots: vi.fn()
}))
vi.mock('../logger', () => ({ writeLog: vi.fn().mockResolvedValue(undefined) }))

import { scanChildProject } from '../scanner'
import { scanImportCandidate } from '../project-self-check'

const scannerMock = vi.mocked(scanChildProject)

let work: string

beforeEach(async () => {
  work = await mkdtemp(join(tmpdir(), 'qianzi-selfcheck-guard-'))
  scannerMock.mockReset()
})

describe('scanImportCandidate — 入库前过"读全"闸', () => {
  it('partial ⇒ 抛"部分文件读取失败"，导入记 failed', async () => {
    const dir = join(work, '第1話')
    await mkdir(dir, { recursive: true })
    const partial: ChildProjectScan = {
      jpgPairs: [],
      txtFiles: [],
      errors: [{ path: join(dir, 'x.psd'), msg: 'EACCES' }],
      status: 'partial'
    }
    scannerMock.mockResolvedValue(partial)

    await expect(scanImportCandidate(dir)).rejects.toThrow(/部分文件读取失败（1 项）/)
  })

  it('complete ⇒ 放行并返回统计', async () => {
    const dir = join(work, '第1話')
    await mkdir(dir, { recursive: true })
    const complete: ChildProjectScan = {
      jpgPairs: [
        {
          jpgPath: join(dir, '01.jpg'),
          countsTowardProgress: true,
          psd: { absPath: join(dir, '01.psd'), mtimeMs: 7, ctimeMs: 3, status: 'pending' }
        }
      ],
      txtFiles: [],
      errors: [],
      status: 'complete'
    }
    scannerMock.mockResolvedValue(complete)

    const result = await scanImportCandidate(dir)
    expect(result.lastMtimeMs).toBe(7)
    expect(result.psdStats).toEqual([{ mtimeMs: 7, ctimeMs: 3 }])
  })
})
