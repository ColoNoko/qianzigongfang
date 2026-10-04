// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { mkdir, rm } from 'node:fs/promises'
import { resolve } from 'node:path'

/**
 * 标记台账与撤销（主进程侧）。
 *
 * 这是这一轮最关键的几条断言：**"改了就必须留痕"**、**"撤销要精确回到从前"**。
 * 2026-09-26 那次现场（一次批量把 15 话 / 153 个文件的「监修」写成 false）之所以只能靠
 * 整库快照反推，就是因为当时没有这张表 —— 所以这里逐条锁死它的行为。
 */

const ROOT = resolve(__dirname, '../../../../.omo/fixtures/mark-audit-test')

vi.mock('electron', () => ({
  app: { getPath: () => ROOT }
}))

import {
  closeDatabase,
  collectChildMarkStatistics,
  findUndoableMarkOperation,
  getMarkAuditOperation,
  getStoredProjectMemory,
  listMarkAuditOperations,
  setStoredProjectMemoryStatuses,
  undoMarkOperation
} from '../database'
import type { MarkAuditContext } from '@shared/mark-audit'

function context(partial: Partial<MarkAuditContext> & { opId: string }): MarkAuditContext {
  return { kind: 'mark', source: 'viewer', ...partial }
}

function update(partial: {
  pathKey: string
  modes?: Record<string, boolean>
  modeTimestamps?: Record<string, number>
  status?: 'done' | 'pending'
}) {
  return {
    pathKey: partial.pathKey,
    path: partial.pathKey,
    status: partial.status ?? ('done' as const),
    mtimeMs: 1000,
    modes: partial.modes,
    modeTimestamps: partial.modeTimestamps
  }
}

beforeAll(async () => {
  await rm(ROOT, { recursive: true, force: true })
  await mkdir(ROOT, { recursive: true })
})

afterAll(async () => {
  await closeDatabase()
  await rm(ROOT, { recursive: true, force: true })
})

describe('标记台账：写入即留痕', () => {
  it('标记时记下「改之前 / 改之后」，且与库里的实际状态一致', async () => {
    await setStoredProjectMemoryStatuses(
      'c1',
      '/c1',
      [update({ pathKey: 'k1', modes: { supervised: true }, modeTimestamps: { supervised: 111 } })],
      context({ opId: 'op-1', mode: 'supervised', targetStatus: 'done' })
    )

    const operations = await listMarkAuditOperations()
    expect(operations).toHaveLength(1)
    expect(operations[0].opId).toBe('op-1')
    expect(operations[0].fileCount).toBe(1)

    const entry = operations[0].children[0].entries[0]
    expect(entry.beforeModes).toEqual({
      typeset: false,
      translated: false,
      proofread: false,
      supervised: false
    })
    expect(entry.afterModes.supervised).toBe(true)
    expect(entry.afterTimestamps.supervised).toBe(111)

    const memory = await getStoredProjectMemory('c1')
    expect(memory?.files.k1.modes?.supervised).toBe(true)
  })

  it('标记时**不会**把别的模式写进 after（补丁语义仍然成立）', async () => {
    await setStoredProjectMemoryStatuses(
      'c2',
      '/c2',
      [update({ pathKey: 'k2', modes: { proofread: true }, modeTimestamps: { proofread: 222 } })],
      context({ opId: 'op-proof', mode: 'proofread', source: 'card' })
    )
    await setStoredProjectMemoryStatuses(
      'c2',
      '/c2',
      [
        update({
          pathKey: 'k2',
          modes: { supervised: true },
          modeTimestamps: { supervised: 333 }
        })
      ],
      context({ opId: 'op-sup', mode: 'supervised' })
    )

    const second = await getMarkAuditOperation('op-sup')
    const entry = second!.children[0].entries[0]
    // 改之前：校对是亮的 —— 这正是撤销时必须还原的信息
    expect(entry.beforeModes).toEqual({
      typeset: false,
      translated: false,
      proofread: true,
      supervised: false
    })
    expect(entry.afterModes).toEqual({
      typeset: false,
      translated: false,
      proofread: true,
      supervised: true
    })
  })

  it('没有真的改动就不记流水（只计 skipped），避免台账被空操作塞满', async () => {
    await setStoredProjectMemoryStatuses(
      'c3',
      '/c3',
      [update({ pathKey: 'k3', modes: { typeset: true }, modeTimestamps: { typeset: 1 } })],
      context({ opId: 'op-first' })
    )
    // 再来一次同样的标记
    await setStoredProjectMemoryStatuses(
      'c3',
      '/c3',
      [update({ pathKey: 'k3', modes: { typeset: true }, modeTimestamps: { typeset: 1 } })],
      context({ opId: 'op-repeat' })
    )

    expect(await getMarkAuditOperation('op-repeat')).toBeNull()
  })

  it('不给台账上下文就不记（旧调用点行为不变）', async () => {
    await setStoredProjectMemoryStatuses('c4', '/c4', [
      update({ pathKey: 'k4', modes: { typeset: true }, modeTimestamps: { typeset: 5 } })
    ])

    const operations = await listMarkAuditOperations(500)
    expect(operations.some((operation) => operation.children.some((c) => c.childId === 'c4'))).toBe(
      false
    )
  })
})

describe('撤销：按台账精确回到从前', () => {
  it('撤销只回到「改之前」：其它模式与旧时间戳原样保留，被撤销的模式时间戳被清掉', async () => {
    const undone = await undoMarkOperation('op-sup')

    expect(undone.revertedFiles).toBe(1)
    expect(undone.childIds).toEqual(['c2'])

    const memory = await getStoredProjectMemory('c2')
    expect(memory?.files.k2.modes).toEqual({
      typeset: false,
      translated: false,
      proofread: true,
      supervised: false
    })
    // 监修的时间戳必须被删掉（否则 §7.2 的按时间戳统计会跟实际对不上）
    expect(memory?.files.k2.modeTimestamps).toEqual({ proofread: 222 })
  })

  it('撤销本身也留痕：多一条 kind=undo 指向被撤销的那次操作', async () => {
    const undoOperation = await getMarkAuditOperation((await listMarkAuditOperations())[0].opId)
    expect(undoOperation).toBeTruthy()
    // 最新一条应该是那次 undo
    const latest = (await listMarkAuditOperations())[0]
    expect(latest.kind).toBe('undo')
    expect(latest.refOpId).toBe('op-sup')
  })

  it('已经被撤销过的操作不再出现在「可撤销」候选里', async () => {
    const undoable = await findUndoableMarkOperation()
    expect(undoable?.opId).not.toBe('op-sup')
  })

  it('迁移写回不可撤销（kind=migrate 不进候选），撤销"还原类"操作会被拒绝', async () => {
    await setStoredProjectMemoryStatuses(
      'c5',
      '/c5',
      [update({ pathKey: 'k5', modes: { typeset: true } })],
      { opId: 'op-migrate', kind: 'migrate', source: 'migrate' }
    )

    const undoable = await findUndoableMarkOperation()
    expect(undoable?.kind).toBe('mark')
    await expect(undoMarkOperation('op-migrate')).rejects.toThrow('只有「标记」类操作可以撤销')
  })

  it('撤销之后那条操作可以被再次找到吗？—— 不会（台账口径：一次操作只撤销一次）', async () => {
    const operations = await listMarkAuditOperations(500)
    const undoRefs = operations
      .filter((operation) => operation.kind === 'undo')
      .map((operation) => operation.refOpId)
    expect(undoRefs).toContain('op-sup')
    expect(undoRefs).not.toContain('op-migrate')
  })
})

describe('成就数据源：按话汇总标记记录（第十五轮）', () => {
  it('逐文件汇总完成时间；**没有时间戳的老记录回退到该行的 updated_at**（宁可粗，不可漏）', async () => {
    await setStoredProjectMemoryStatuses(
      'c-stats',
      '/c-stats',
      [
        {
          pathKey: 's1',
          path: 's1',
          status: 'done',
          mtimeMs: 1,
          modes: { typeset: true },
          modeTimestamps: { typeset: 500 }
        },
        // 这一行只有"完成"、没有时间戳（老数据）→ 应当回退，而不是被丢掉
        { pathKey: 's2', path: 's2', status: 'done', mtimeMs: 1, modes: { typeset: true } }
      ],
      { opId: 'op-stats', kind: 'mark', source: 'card', mode: 'typeset', targetStatus: 'done' }
    )

    const stats = await collectChildMarkStatistics()
    const mine = stats.find((item) => item.childId === 'c-stats')

    expect(mine).toBeTruthy()
    expect(mine!.fileCount).toBe(2)
    expect(mine!.completedTimestamps.typeset).toHaveLength(2)
    expect(mine!.completedTimestamps.typeset[0]).toBe(500)
    expect(mine!.completedTimestamps.typeset[1]).toBeGreaterThan(0)
    // 其它模式没有标记 → 空数组（成就页据此显示 0）
    expect(mine!.completedTimestamps.supervised).toEqual([])
  })

  it('只统计"已完成"的记录：未标记的文件计入 fileCount，但不产生完成时间', async () => {
    await setStoredProjectMemoryStatuses(
      'c-half',
      '/c-half',
      [
        {
          pathKey: 'h1',
          path: 'h1',
          status: 'done',
          mtimeMs: 1,
          modes: { proofread: true },
          modeTimestamps: { proofread: 900 }
        },
        { pathKey: 'h2', path: 'h2', status: 'pending', mtimeMs: 1 }
      ],
      { opId: 'op-half', kind: 'mark', source: 'card', mode: 'proofread', targetStatus: 'done' }
    )

    const stats = await collectChildMarkStatistics()
    const mine = stats.find((item) => item.childId === 'c-half')

    expect(mine!.fileCount).toBe(2)
    expect(mine!.completedTimestamps.proofread).toEqual([900])
  })

  it('数据只来自标记记录：与"磁盘上还剩几张贴图"无关（删图不掉历史）', async () => {
    // 库里有多少行，汇总里就是多少 —— 这个函数根本不看文件系统。
    const stats = await collectChildMarkStatistics()
    const mine = stats.find((item) => item.childId === 'c-stats')

    expect(mine!.fileCount).toBe(2)
    expect(mine!.completedTimestamps.typeset.length).toBe(2)
  })
})
