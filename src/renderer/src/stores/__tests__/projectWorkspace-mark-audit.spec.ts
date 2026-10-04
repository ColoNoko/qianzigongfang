// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useProjectWorkspace } from '../projectWorkspace'
import type { ChildProject, JpgPsdPair, ParentProject, WorkModeStatus } from '@shared/types'

/**
 * 标记台账的**上游契约**（第十四轮）。
 *
 * 主进程负责"把 before/after 逐文件记下来"，但"哪几次写入属于同一次用户操作"只有渲染层知道：
 * 侧栏批量标记会**逐话**调用 IPC —— 若每话各带一个 opId，一次点击就会在台账里变成十几条散记录，
 * 「撤销上一次」也就撤销不了整批。这个文件只锁这一件事：**一次用户操作 = 一个 opId**。
 *
 * 桥接是**有状态**的小假货（写进去的能被读回来）：否则"标记后回读"会被看成
 * "内存里有记录、库里没有" → 触发旧数据迁移写回，多出一条噪声调用（第一版就踩了这个）。
 */

interface FakeRow {
  path: string
  status: 'done' | 'pending'
  mtimeMs: number
  modes: Partial<WorkModeStatus>
  modeTimestamps: Record<string, number>
}

function makePair(childId: string, name: string): JpgPsdPair {
  return {
    jpgPath: `/fake/${childId}/${name}.jpg`,
    psd: {
      absPath: `/fake/${childId}/${name}.psd`,
      mtimeMs: 1000,
      ctimeMs: 1000,
      status: 'pending'
    }
  }
}

function makeChild(id: string): ChildProject {
  return {
    id,
    parentTitle: '漫画',
    folderPath: `/fake/${id}`,
    chapterNumber: '第1話',
    projectTitle: 'vol1',
    lastMtimeMs: 1000
  }
}

function installStatefulBridge(options?: {
  legacyOverrides?: Record<string, string>
  pairsPerChild?: number
}): { memorySetStatuses: ReturnType<typeof vi.fn> } {
  const rows = new Map<string, FakeRow>()
  const pairsPerChild = options?.pairsPerChild ?? 2

  const memorySetStatuses = vi.fn(
    async (
      _childId: string,
      _folderPath: string,
      updates: Array<{
        pathKey: string
        path: string
        status: 'done' | 'pending'
        mtimeMs: number
        modes?: Partial<WorkModeStatus>
        modeTimestamps?: Record<string, number>
      }>
    ) => {
      for (const update of updates) {
        const previous = rows.get(update.pathKey)
        const modeTimestamps = { ...(previous?.modeTimestamps ?? {}) }
        for (const [mode, at] of Object.entries(update.modeTimestamps ?? {})) {
          if (at === 0) delete modeTimestamps[mode]
          else modeTimestamps[mode] = at
        }
        rows.set(update.pathKey, {
          path: update.path,
          status: update.status,
          mtimeMs: update.mtimeMs,
          modes: { ...(previous?.modes ?? {}), ...(update.modes ?? {}) },
          modeTimestamps
        })
      }
    }
  )

  window.comicType = {
    scanChildProject: vi.fn((folderPath: string) =>
      Promise.resolve({
        jpgPairs: Array.from({ length: pairsPerChild }, (_, index) =>
          makePair(folderPath.split('/').pop() ?? 'c1', `page_00${index + 1}`)
        ),
        txtFiles: [],
        errors: []
      })
    ),
    memoryGetProject: vi.fn((childId: string) =>
      Promise.resolve({
        childId,
        folderPath: `/fake/${childId}`,
        updatedAt: 1,
        files: Object.fromEntries(
          [...rows.entries()].map(([pathKey, row]) => [
            pathKey,
            {
              path: row.path,
              status: row.status,
              mtimeMs: row.mtimeMs,
              updatedAt: 1,
              modes: row.modes,
              modeTimestamps: row.modeTimestamps
            }
          ])
        )
      })
    ),
    memorySetStatuses,
    storeGet: vi.fn((key: string) =>
      Promise.resolve(key === 'psdStatusOverrides' ? (options?.legacyOverrides ?? {}) : undefined)
    ),
    storeSet: vi.fn().mockResolvedValue(undefined),
    projectGetTree: vi.fn().mockResolvedValue([]),
    projectSaveTree: vi.fn().mockResolvedValue(undefined),
    projectSaveProgress: vi.fn().mockResolvedValue(undefined),
    projectDeleteChildren: vi.fn().mockResolvedValue(undefined),
    projectRenameParent: vi.fn().mockResolvedValue(undefined),
    projectReorderParents: vi.fn().mockResolvedValue(undefined)
  } as unknown as typeof window.comicType

  return { memorySetStatuses }
}

function twoChildren(): ParentProject[] {
  return [
    { id: 'p1', title: '漫画', lastMtimeMs: 0, children: [makeChild('c1'), makeChild('c2')] }
  ]
}

function auditOf(call: unknown[]): Record<string, unknown> | undefined {
  return call[3] as Record<string, unknown> | undefined
}

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('标记台账的上游契约', () => {
  it('侧栏批量标记跨两话：两话的写入共享**同一个 opId**（一次点击 = 一条台账）', async () => {
    const { memorySetStatuses } = installStatefulBridge()
    const store = useProjectWorkspace()
    store.parents = twoChildren()

    await store.markChildProjects(['c1', 'c2'], 'done', 'supervised')

    const markCalls = memorySetStatuses.mock.calls.filter((call) => auditOf(call)?.kind === 'mark')
    expect(markCalls.map((call) => call[0]).sort()).toEqual(['c1', 'c2'])
    expect(new Set(markCalls.map((call) => auditOf(call)?.opId)).size).toBe(1)
    expect(auditOf(markCalls[0])).toMatchObject({
      kind: 'mark',
      source: 'sidebar-batch',
      mode: 'supervised',
      targetStatus: 'done'
    })
  })

  it('单话标记（工具栏 / 卡片 / 对照视图那条路）：写入带上调用方给的上下文', async () => {
    const { memorySetStatuses } = installStatefulBridge()
    const store = useProjectWorkspace()
    store.parents = twoChildren()
    const child = store.findChild('c1')!
    const pairs = await store.scanChild(child)

    await store.rememberStatuses(child, [pairs[0]], 'done', undefined, {
      opId: 'op-x',
      kind: 'mark',
      source: 'viewer',
      mode: 'typeset',
      targetStatus: 'done'
    })

    const markCall = memorySetStatuses.mock.calls.find((call) => auditOf(call)?.opId === 'op-x')
    expect(markCall).toBeTruthy()
    expect(auditOf(markCall!)).toMatchObject({ kind: 'mark', source: 'viewer' })
  })

  it('旧数据迁移写回也留痕：kind=migrate（不可撤销，但"库变了却没有记录"最难查）', async () => {
    const { memorySetStatuses } = installStatefulBridge({
      legacyOverrides: { '/fake/c1/page_001.psd': 'done' },
      pairsPerChild: 1
    })
    const store = useProjectWorkspace()
    store.parents = twoChildren()

    await store.scanChild(store.findChild('c1')!)

    const migrateCall = memorySetStatuses.mock.calls.find(
      (call) => auditOf(call)?.kind === 'migrate'
    )
    expect(migrateCall).toBeTruthy()
    expect(auditOf(migrateCall!)).toMatchObject({ kind: 'migrate', source: 'migrate' })
  })
})
