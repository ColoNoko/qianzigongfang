// @vitest-environment node
/**
 * 目录不在时，用台账还原"最后已知的一话"（2026-10-01）。
 *
 * 现场：用户把某一话整个文件夹删掉/改名是**日常操作**，而工作台只会一片空白
 * （旧版还额外弹一行红字）。同一话的进度明明还在侧栏显示 24/24 —— 它取自
 * `project_memory_files`，不受文件系统影响。这里锁的就是"把那一话照原样摆出来"。
 *
 * 最要紧的一条是**进度不能被算成 0/0**：`isCountablePair()` 在未显式指定
 * `countsTowardProgress` 时要求 `jpgPath` 非空，而台账里只有 PSD 路径 ——
 * 一旦漏设，头部/底部立刻显示 0/0，恰好是这次要修的误导。
 */
import { describe, expect, it } from 'vitest'
import { computeModeCounts, isCountablePair } from '@shared/status'
import type { ProjectMemory } from '@shared/ipc-api'
import { ghostPairsFromMemory } from '../ghost-pairs'

const FOLDER = 'D:\\comic\\ch2'

function memory(): ProjectMemory {
  return {
    childId: 'c2',
    folderPath: FOLDER,
    updatedAt: 1,
    files: {
      'b-key': {
        path: `${FOLDER}\\002.psd`,
        status: 'pending',
        mtimeMs: 222,
        updatedAt: 1,
        modes: { typeset: false, translated: false, proofread: false, supervised: false }
      },
      'a-key': {
        path: `${FOLDER}\\001.psd`,
        status: 'done',
        mtimeMs: 111,
        updatedAt: 1,
        modes: { typeset: true, translated: true, proofread: false, supervised: false },
        modeTimestamps: { typeset: 999 }
      }
    }
  }
}

describe('ghostPairsFromMemory', () => {
  it('把台账里的每一页还原成只读的一话，并按路径排序', () => {
    const pairs = ghostPairsFromMemory(memory())

    expect(pairs.map((p) => p.psd.absPath)).toEqual([
      `${FOLDER}\\001.psd`,
      `${FOLDER}\\002.psd`
    ])
  })

  it('逐页保留状态、各模式标记与时间戳', () => {
    const pairs = ghostPairsFromMemory(memory())
    const first = pairs[0]

    expect(first.psd.status).toBe('done')
    expect(first.psd.modes).toEqual({
      typeset: true,
      translated: true,
      proofread: false,
      supervised: false
    })
    expect(first.psd.modeTimestamps).toEqual({ typeset: 999 })
    expect(first.psd.mtimeMs).toBe(111)
  })

  it('★ 必须计入进度：否则头部/底部会显示成 0/0', () => {
    const pairs = ghostPairsFromMemory(memory())

    expect(pairs.every((pair) => pair.countsTowardProgress === true)).toBe(true)
    expect(pairs.every(isCountablePair)).toBe(true)
  })

  it('★ 还原出的进度与台账一致（与侧栏同口径）', () => {
    const counts = computeModeCounts(ghostPairsFromMemory(memory()))

    expect(counts.typeset).toEqual({ done: 1, total: 2, pct: 50 })
    expect(counts.translated).toEqual({ done: 1, total: 2, pct: 50 })
    expect(counts.proofread).toEqual({ done: 0, total: 2, pct: 0 })
  })

  it('台账里没有这一话（或读不到）时给空列表，不抛错', () => {
    expect(ghostPairsFromMemory(null)).toEqual([])
    expect(ghostPairsFromMemory(undefined)).toEqual([])
    expect(ghostPairsFromMemory({ childId: 'c2', folderPath: FOLDER, updatedAt: 1, files: {} })).toEqual(
      []
    )
  })
})
