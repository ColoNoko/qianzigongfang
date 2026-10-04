import { describe, expect, it } from 'vitest'
import { childModeProgress, countablePsdStats, computeProgress, isTypesetDone } from '../status'
import type { JpgPsdPair, TypesetStatus } from '../types'

function makePair(status: TypesetStatus, times: { mtimeMs: number; ctimeMs: number }): JpgPsdPair {
  return {
    jpgPath: '/fake/page.jpg',
    countsTowardProgress: true,
    psd: { absPath: '/fake/page.psd', ...times, status }
  }
}

describe('isTypesetDone', () => {
  it('returns false at exactly 5 minutes (strict >)', () => {
    const ctime = 1000000
    const mtime = ctime + 5 * 60 * 1000
    expect(isTypesetDone({ mtimeMs: mtime, ctimeMs: ctime })).toBe(false)
  })

  it('returns true at 5 minutes + 1ms', () => {
    const ctime = 1000000
    const mtime = ctime + 5 * 60 * 1000 + 1
    expect(isTypesetDone({ mtimeMs: mtime, ctimeMs: ctime })).toBe(true)
  })
})

describe('computeProgress', () => {
  it('m=4, n=3 → pct=75.00', () => {
    const ctime = 1000000
    const stats = [
      { mtimeMs: ctime + 600000, ctimeMs: ctime },
      { mtimeMs: ctime + 600000, ctimeMs: ctime },
      { mtimeMs: ctime + 600000, ctimeMs: ctime },
      { mtimeMs: ctime + 100000, ctimeMs: ctime }
    ]
    const result = computeProgress(stats)
    expect(result.done).toBe(3)
    expect(result.total).toBe(4)
    expect(result.pct).toBe(75)
  })

  it('m=4, n=0 → pct=0.00', () => {
    const ctime = 1000000
    const stats = Array(4).fill({ mtimeMs: ctime + 100000, ctimeMs: ctime })
    const result = computeProgress(stats)
    expect(result.done).toBe(0)
    expect(result.total).toBe(4)
    expect(result.pct).toBe(0)
  })

  it('m=0 → pct=null', () => {
    const result = computeProgress([])
    expect(result.done).toBe(0)
    expect(result.total).toBe(0)
    expect(result.pct).toBeNull()
  })
})

describe('countablePsdStats — 完成度只认手动标记', () => {
  // A PSD edited long after it was created: the old heuristic called this done.
  const editedLater = { mtimeMs: 2_000_000, ctimeMs: 1_000_000 }

  it('treats an unmarked pair as pending even when the file timestamps look "done"', () => {
    const stats = countablePsdStats([makePair('pending', editedLater)])
    expect(stats).toHaveLength(1)
    expect(computeProgress(stats)).toEqual({ done: 0, total: 1, pct: 0 })
  })

  it('counts a manually marked pair as done', () => {
    const stats = countablePsdStats([makePair('done', editedLater)])
    expect(computeProgress(stats)).toEqual({ done: 1, total: 1, pct: 100 })
  })

  it('never lets file timestamps leak into the completion count', () => {
    const marked = makePair('done', editedLater)
    const unmarked = makePair('pending', editedLater)
    const untouched = makePair('pending', { mtimeMs: 1_000_000, ctimeMs: 1_000_000 })
    expect(computeProgress(countablePsdStats([marked, unmarked, untouched]))).toEqual({
      done: 1,
      total: 3,
      pct: 33.33
    })
  })

  it('keeps the PSD mtime so achievements can still bucket by save date', () => {
    const [stat] = countablePsdStats([makePair('done', editedLater)])
    expect(stat.mtimeMs).toBe(editedLater.mtimeMs)
  })
})

describe('childModeProgress — 侧栏每行按模式取数', () => {
  const twoFiles = [
    { mtimeMs: 600_000, ctimeMs: 0 }, // "done" encoding = 手动标记过
    { mtimeMs: 0, ctimeMs: 0 }
  ]

  it('reads 嵌字 from psdStats', () => {
    expect(childModeProgress({ psdStats: twoFiles, psdModeStats: undefined }, 'typeset')).toEqual({
      done: 1,
      total: 2,
      pct: 50
    })
  })

  it('reads the explicit modes from psdModeStats', () => {
    const child = {
      psdStats: twoFiles,
      psdModeStats: {
        typeset: [],
        translated: [{ mtimeMs: 1, ctimeMs: 1 }],
        proofread: [],
        supervised: [{ mtimeMs: 1, ctimeMs: 1 }, { mtimeMs: 2, ctimeMs: 2 }]
      }
    }
    expect(childModeProgress(child, 'translated').done).toBe(1)
    expect(childModeProgress(child, 'supervised').done).toBe(2)
    expect(childModeProgress(child, 'proofread').done).toBe(0)
  })

  it('never mixes the two sources: 嵌字 ignores psdModeStats, explicit modes ignore psdStats', () => {
    const child = {
      psdStats: twoFiles,
      psdModeStats: { typeset: [{ mtimeMs: 1, ctimeMs: 1 }] } as never
    }
    // typeset 用 psdStats（1/2），不会被 psdModeStats.typeset 影响。
    expect(childModeProgress(child, 'typeset').done).toBe(1)
    // translated 用 psdModeStats（缺失 → 0），不会被 psdStats 影响。
    expect(childModeProgress(child, 'translated').done).toBe(0)
  })

  it('returns the 无文件 shape when the chapter has no files', () => {
    expect(childModeProgress({ psdStats: [], psdModeStats: undefined }, 'typeset')).toEqual({
      done: 0,
      total: 0,
      pct: null
    })
  })
})
