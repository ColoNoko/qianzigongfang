import { describe, expect, it } from 'vitest'
import type { WorkMode, WorkModeStatus } from '../types'
import {
  buildRestoreUpdates,
  buildRestoreUpdatesFromDiff,
  createMarkOperationId,
  describeMarkEntry,
  didEntryChange,
  diffMarkSnapshots,
  emptyModeStatus,
  isUndoableOperation,
  summarizeMarkOperation,
  type MarkAuditEntry,
  type MarkAuditOperation,
  type MarkSnapshot
} from '../mark-audit'

function modes(partial: Partial<WorkModeStatus>): WorkModeStatus {
  return { ...emptyModeStatus(), ...partial }
}

function entry(partial?: Partial<MarkAuditEntry>): MarkAuditEntry {
  return {
    pathKey: 'k:/c/001.psd',
    path: '/c/001.psd',
    mtimeMs: 111,
    beforeModes: modes({}),
    afterModes: modes({ supervised: true }),
    beforeTimestamps: {},
    afterTimestamps: { supervised: 1000 },
    ...partial
  }
}

function operation(partial?: Partial<MarkAuditOperation>): MarkAuditOperation {
  return {
    opId: 'op-1',
    at: 1700000000000,
    kind: 'mark',
    source: 'viewer',
    mode: 'supervised',
    targetStatus: 'done',
    children: [{ childId: 'c1', folderPath: '/c', entries: [entry()] }],
    fileCount: 1,
    skippedCount: 0,
    ...partial
  }
}

describe('mark-audit 纯函数', () => {
  it('操作号：给了时间与盐就是确定的，否则每次不同', () => {
    expect(createMarkOperationId(1700000000000, 'abc123')).toBe('1700000000000-abc123')
    expect(createMarkOperationId()).not.toBe(createMarkOperationId())
  })

  it('“这条改动算不算真改了”：模式变了算，只动时间戳也算，都没动不算', () => {
    expect(didEntryChange(entry())).toBe(true)
    expect(
      didEntryChange(entry({ afterModes: modes({ supervised: true }), afterTimestamps: {} }))
    ).toBe(true)
    expect(
      didEntryChange(
        entry({
          beforeModes: modes({ supervised: true }),
          afterModes: modes({ supervised: true }),
          beforeTimestamps: { supervised: 1000 },
          afterTimestamps: { supervised: 1000 }
        })
      )
    ).toBe(false)
  })

  it('文案：四种动作各自说得清楚（含"取消标记"）', () => {
    expect(summarizeMarkOperation(operation())).toBe('标记「监修」1 个文件（1 话）')
    expect(summarizeMarkOperation(operation({ targetStatus: 'pending' }))).toBe(
      '取消标记「监修」1 个文件（1 话）'
    )
    expect(summarizeMarkOperation(operation({ kind: 'undo', mode: undefined }))).toBe(
      '撤销一次标记操作：还原 1 个文件（1 话）'
    )
    expect(summarizeMarkOperation(operation({ kind: 'restore', mode: undefined }))).toBe(
      '从备份还原标记：写回 1 个文件（1 话）'
    )
    expect(summarizeMarkOperation(operation({ kind: 'migrate', mode: undefined }))).toBe(
      '旧数据迁移写回：1 个文件（1 话）'
    )
  })

  it('只有“用户标记”可撤销：迁移写回、还原、撤销本身都不行', () => {
    expect(isUndoableOperation(operation())).toBe(true)
    expect(isUndoableOperation(operation({ kind: 'undo' }))).toBe(false)
    expect(isUndoableOperation(operation({ kind: 'restore' }))).toBe(false)
    expect(isUndoableOperation(operation({ kind: 'migrate' }))).toBe(false)
    expect(isUndoableOperation(operation({ fileCount: 0 }))).toBe(false)
  })

  it('撤销载荷：回到“改之前”的**四个模式**，没有时间戳的模式发 0（= 让主进程删掉它）', () => {
    const op = operation({
      children: [
        {
          childId: 'c1',
          folderPath: '/c',
          entries: [
            entry({
              beforeModes: modes({ typeset: true }),
              afterModes: modes({ typeset: true, supervised: true }),
              beforeTimestamps: { typeset: 900 },
              afterTimestamps: { typeset: 900, supervised: 1000 }
            })
          ]
        }
      ]
    })

    const groups = buildRestoreUpdates(op)

    expect(groups).toHaveLength(1)
    expect(groups[0].childId).toBe('c1')
    expect(groups[0].updates[0]).toEqual({
      pathKey: 'k:/c/001.psd',
      path: '/c/001.psd',
      status: 'done',
      mtimeMs: 111,
      // 整份四模式 —— 撤销就是"回到从前"，补丁表达不了这件事
      modes: { typeset: true, translated: false, proofread: false, supervised: false },
      // supervised 在"改之前"没有时间戳 → 发 0，主进程会把它删掉
      modeTimestamps: { typeset: 900, translated: 0, proofread: 0, supervised: 0 }
    })
  })

  it('撤销载荷：没有条目的那一话不会产生空写入', () => {
    const groups = buildRestoreUpdates(
      operation({
        children: [
          { childId: 'c1', folderPath: '/c', entries: [] },
          { childId: 'c2', folderPath: '/d', entries: [entry()] }
        ]
      })
    )

    expect(groups.map((group) => group.childId)).toEqual(['c2'])
  })

  it('明细行：只说哪个模式翻了，格式是 监修 ✗→✓', () => {
    expect(describeMarkEntry(entry())).toBe('001.psd  监修 ✗→✓')
    expect(
      describeMarkEntry(
        entry({ beforeModes: modes({ typeset: true }), afterModes: modes({ typeset: true }) })
      )
    ).toBe('001.psd（只有时间戳变化）')
  })
})

describe('mark-audit 备份差异', () => {
  function snapshot(children: MarkSnapshot['children']): MarkSnapshot {
    return { children }
  }

  it('只列出会变的行；备份里没有的新文件、当前库里没有的旧文件都只报数', () => {
    const current = snapshot({
      c1: {
        folderPath: '/c',
        files: {
          a: { path: '/c/a.psd', mtimeMs: 1, modes: modes({}), timestamps: {} },
          b: { path: '/c/b.psd', mtimeMs: 1, modes: modes({ supervised: true }), timestamps: { supervised: 5 } },
          c: { path: '/c/c.psd', mtimeMs: 1, modes: modes({}), timestamps: {} }
        }
      }
    })
    const backup = snapshot({
      c1: {
        folderPath: '/c',
        files: {
          a: { path: '/c/a.psd', mtimeMs: 1, modes: modes({ typeset: true }), timestamps: { typeset: 9 } },
          b: { path: '/c/b.psd', mtimeMs: 1, modes: modes({ supervised: true }), timestamps: { supervised: 5 } },
          z: { path: '/c/z.psd', mtimeMs: 1, modes: modes({}), timestamps: {} }
        }
      }
    })

    const diff = diffMarkSnapshots(current, backup)

    expect(diff.changingFiles).toBe(1)
    expect(diff.children).toHaveLength(1)
    expect(diff.children[0].changing.map((row) => row.pathKey)).toEqual(['a'])
    expect(diff.children[0].missingInBackup).toBe(1)
    expect(diff.missingInCurrent).toBe(1)
  })

  it('一模一样时差异为空（界面上就是"这份备份与当前一致"）', () => {
    const same = {
      c1: {
        folderPath: '/c',
        files: { a: { path: '/c/a.psd', mtimeMs: 1, modes: modes({}), timestamps: {} } }
      }
    }
    const diff = diffMarkSnapshots(snapshot(same), snapshot(same))

    expect(diff.changingFiles).toBe(0)
    expect(diff.children).toHaveLength(0)
  })

  it('差异载荷：把差异变成写回载荷（同样是整份四模式 + 时间戳补 0）', () => {
    const diff = diffMarkSnapshots(
      {
        children: {
          c1: {
            folderPath: '/c',
            files: { a: { path: '/c/a.psd', mtimeMs: 7, modes: modes({}), timestamps: {} } }
          }
        }
      },
      {
        children: {
          c1: {
            folderPath: '/c',
            files: {
              a: {
                path: '/c/a.psd',
                mtimeMs: 7,
                modes: modes({ proofread: true }),
                timestamps: { proofread: 42 }
              }
            }
          }
        }
      }
    )

    const groups = buildRestoreUpdatesFromDiff(diff)

    expect(groups).toHaveLength(1)
    expect(groups[0].updates[0].modes).toEqual({
      typeset: false,
      translated: false,
      proofread: true,
      supervised: false
    })
    expect(groups[0].updates[0].modeTimestamps).toEqual({
      typeset: 0,
      translated: 0,
      proofread: 42,
      supervised: 0
    } satisfies Record<WorkMode, number>)
  })
})
