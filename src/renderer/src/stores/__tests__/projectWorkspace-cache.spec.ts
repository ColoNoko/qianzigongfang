// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { psdStatsFromPairs, useProjectWorkspace } from '../projectWorkspace'
import type { ChildProject, ChildProjectScan, ParentProject } from '@shared/types'
import type { DirEntry } from '@shared/ipc-api'
import { computeProgress } from '@shared/status'

/** Build a ChildProject with sensible defaults. */
function makeChild(overrides: Partial<ChildProject> = {}): ChildProject {
  return {
    id: 'c1',
    parentTitle: 'parent',
    folderPath: '/fake/chapter1',
    chapterNumber: '第1話',
    projectTitle: 'p',
    lastMtimeMs: 1000,
    ...overrides
  }
}

/** Build a recursive scan result: one .psd + one .jpg sharing a stem. */
function makeScan(folder: string, stems: string[]): ChildProjectScan {
  return {
    jpgPairs: stems.map((stem, index) => ({
      jpgPath: `${folder}/${stem}.jpg`,
      psd: {
        absPath: `${folder}/${stem}.psd`,
        mtimeMs: 2000 + index,
        ctimeMs: 1000,
        status: 'pending'
      }
    })),
    txtFiles: [],
    errors: []
  }
}

/** Install a comicType bridge mock with the given scan + thumb impls. */
function mockComicType(opts: {
  scanChildProject?: ReturnType<typeof vi.fn>
  readFileDataURL?: ReturnType<typeof vi.fn>
  listDir?: ReturnType<typeof vi.fn>
  storeGet?: ReturnType<typeof vi.fn>
  storeSet?: ReturnType<typeof vi.fn>
  memoryGetProject?: ReturnType<typeof vi.fn>
  memorySetStatuses?: ReturnType<typeof vi.fn>
  projectDeleteChildren?: ReturnType<typeof vi.fn>
  projectRenameParent?: ReturnType<typeof vi.fn>
  projectReorderParents?: ReturnType<typeof vi.fn>
  projectGetTree?: ReturnType<typeof vi.fn>
  projectSaveTree?: ReturnType<typeof vi.fn>
  projectSaveProgress?: ReturnType<typeof vi.fn>
}): void {
  window.comicType = {
    scanChildProject:
      opts.scanChildProject ?? vi.fn().mockResolvedValue(makeScan('/fake/chapter1', [])),
    listDir: opts.listDir ?? vi.fn().mockResolvedValue([]),
    stat: vi.fn(),
    readFileDataURL:
      opts.readFileDataURL ?? vi.fn().mockResolvedValue('data:image/jpeg;base64,AAA'),
    pickDirectory: vi.fn(),
    readFileBuffer: vi.fn(),
    openPath: vi.fn(),
    storeGet: opts.storeGet ?? vi.fn(),
    storeSet: opts.storeSet ?? vi.fn(),
    projectGetTree: opts.projectGetTree ?? vi.fn().mockResolvedValue([]),
    projectSaveTree: opts.projectSaveTree ?? vi.fn().mockResolvedValue(undefined),
    projectSaveProgress: opts.projectSaveProgress ?? vi.fn().mockResolvedValue(undefined),
    projectDeleteChildren: opts.projectDeleteChildren ?? vi.fn().mockResolvedValue(undefined),
    projectRenameParent: opts.projectRenameParent ?? vi.fn().mockResolvedValue(undefined),
    projectReorderParents: opts.projectReorderParents ?? vi.fn().mockResolvedValue(undefined),
    ...(opts.memoryGetProject ? { memoryGetProject: opts.memoryGetProject } : {}),
    ...(opts.memorySetStatuses ? { memorySetStatuses: opts.memorySetStatuses } : {})
  } as unknown as typeof window.comicType
}

beforeEach(() => {
  setActivePinia(createPinia())
})

afterEach(() => {
  vi.useRealTimers()
  delete (window as unknown as { comicType?: unknown }).comicType
})

describe('useProjectWorkspace — scan cache', () => {
  it('scanChild uses recursive scan IPC and returns pairs', async () => {
    const scanChildProject = vi.fn().mockResolvedValue(makeScan('/fake/chapter1', ['page_001']))
    mockComicType({ scanChildProject })

    const store = useProjectWorkspace()
    const child = makeChild()

    const pairs = await store.scanChild(child)
    expect(scanChildProject).toHaveBeenCalledTimes(1)
    expect(scanChildProject).toHaveBeenCalledWith('/fake/chapter1')
    expect(pairs).toHaveLength(1)
    expect(pairs[0].psd.absPath).toBe('/fake/chapter1/page_001.psd')
    expect(pairs[0].jpgPath).toBe('/fake/chapter1/page_001.jpg')
    expect(child.lastMtimeMs).toBe(2000)
  })

  it('scanChild refreshes on repeated calls instead of serving stale cache', async () => {
    const scanChildProject = vi
      .fn()
      .mockResolvedValueOnce(makeScan('/fake/chapter1', ['page_001']))
      .mockResolvedValueOnce(makeScan('/fake/chapter1', ['page_001', 'page_002']))
    mockComicType({ scanChildProject })

    const store = useProjectWorkspace()
    const child = makeChild({ lastMtimeMs: 1000 })

    await store.scanChild(child)
    expect(scanChildProject).toHaveBeenCalledTimes(1)

    const second = await store.scanChild(child)
    expect(scanChildProject).toHaveBeenCalledTimes(2)
    expect(second).toHaveLength(2)
  })

  it('excludes a PSD without a matching image from progress stats', () => {
    const paired = makeScan('/fake/chapter1', ['paired']).jpgPairs[0]
    const orphan = {
      psd: {
        absPath: '/fake/chapter1/orphan.psd',
        mtimeMs: 600_001,
        ctimeMs: 0,
        status: 'done' as const
      }
    }

    expect(psdStatsFromPairs([paired, orphan])).toHaveLength(1)
  })
})

describe('useProjectWorkspace — debounced scan', () => {
  it('debouncedScan called twice within 100ms fires only one scan after 200ms', async () => {
    vi.useFakeTimers()
    const scanChildProject = vi.fn().mockResolvedValue(makeScan('/fake/chapter1', ['page_001']))
    mockComicType({ scanChildProject })

    const store = useProjectWorkspace()
    const child = makeChild()

    // First trigger — schedules a scan for t+200ms.
    store.debouncedScan(child)
    // Second trigger 100ms later — cancels the first, restarts the clock.
    vi.advanceTimersByTime(100)
    store.debouncedScan(child)

    // At t=100ms no scan should have fired yet.
    expect(scanChildProject).not.toHaveBeenCalled()

    // Advance past the 200ms debounce window from the second call.
    await vi.advanceTimersByTimeAsync(200)

    // Exactly one scan call — the first timer was cancelled.
    expect(scanChildProject).toHaveBeenCalledTimes(1)
  })
})

describe('useProjectWorkspace — thumbUrlCache LRU', () => {
  it('evicts the least-recently-used entry once the cache exceeds 200', async () => {
    const dataUrl = (i: number): string => `data:image/jpeg;base64,${i}`
    const readFileDataURL = vi.fn((p: string) =>
      Promise.resolve(dataUrl(Number(p.split('_').pop()?.replace('.jpg', ''))))
    )
    mockComicType({ readFileDataURL })

    const store = useProjectWorkspace()

    // Fill the cache with 200 distinct entries.
    for (let i = 0; i < 200; i++) {
      await store.readThumbUrl(`/fake/thumb_${i}.jpg`)
    }
    expect(store.thumbUrlCache.size).toBe(200)
    expect(readFileDataURL).toHaveBeenCalledTimes(200)

    // Entry 0 is the oldest (least-recently-used).
    // Inserting a 201st entry should evict entry 0.
    await store.readThumbUrl('/fake/thumb_200.jpg')
    expect(store.thumbUrlCache.size).toBe(200)
    expect(store.thumbUrlCache.has('/fake/thumb_0.jpg')).toBe(false)
    expect(store.thumbUrlCache.has('/fake/thumb_200.jpg')).toBe(true)
    expect(readFileDataURL).toHaveBeenCalledTimes(201)

    // Reading an existing (recent) entry is a cache hit — no new IPC, and
    // it moves to most-recently-used so it survives a subsequent eviction.
    await store.readThumbUrl('/fake/thumb_199.jpg')
    expect(readFileDataURL).toHaveBeenCalledTimes(201)

    // Now insert another entry; the LRU (entry 1, the oldest remaining)
    // should be evicted, while thumb_199 (just promoted) survives.
    await store.readThumbUrl('/fake/thumb_201.jpg')
    expect(store.thumbUrlCache.has('/fake/thumb_1.jpg')).toBe(false)
    expect(store.thumbUrlCache.has('/fake/thumb_199.jpg')).toBe(true)
    expect(readFileDataURL).toHaveBeenCalledTimes(202)
  })
})

describe('useProjectWorkspace — deleteChild persistence', () => {
  it('removes the child from the persisted registry without touching source files', async () => {
    const parent = {
      id: 'p1',
      title: 'parent',
      lastMtimeMs: 20,
      children: [makeChild({ id: 'c1', lastMtimeMs: 10 }), makeChild({ id: 'c2', lastMtimeMs: 20 })]
    }
    const projectDeleteChildren = vi.fn().mockResolvedValue(undefined)
    window.comicType = {
      scanChildProject: vi.fn(),
      listDir: vi.fn(),
      stat: vi.fn(),
      readFileDataURL: vi.fn(),
      pickDirectory: vi.fn(),
      readFileBuffer: vi.fn(),
      openPath: vi.fn(),
      projectDeleteChildren
    } as unknown as typeof window.comicType

    const store = useProjectWorkspace()
    store.parents = [parent]
    store.setActiveChild(parent.children[0], [])

    await store.deleteChild('p1', 'c1')

    expect(projectDeleteChildren).toHaveBeenCalledWith(['c1'])
    expect(store.findChild('c1')).toBeNull()
    expect(window.comicType.openPath).not.toHaveBeenCalled()
  })

  it('deletes multiple selected children through one project domain call', async () => {
    const parent = {
      id: 'p1',
      title: 'parent',
      lastMtimeMs: 30,
      children: [
        makeChild({ id: 'c1', lastMtimeMs: 10 }),
        makeChild({ id: 'c2', lastMtimeMs: 20 }),
        makeChild({ id: 'c3', lastMtimeMs: 30 })
      ]
    }
    const projectDeleteChildren = vi.fn().mockResolvedValue(undefined)
    window.comicType = {
      projectDeleteChildren
    } as unknown as typeof window.comicType

    const store = useProjectWorkspace()
    store.parents = [parent]
    await store.deleteChildren(['c1', 'c2'])

    expect(store.parents[0].children.map((child) => child.id)).toEqual(['c3'])
    expect(projectDeleteChildren).toHaveBeenCalledTimes(1)
    expect(projectDeleteChildren).toHaveBeenCalledWith(['c1', 'c2'])
  })
})

describe('useProjectWorkspace — import and parent management', () => {
  it('batch-imports direct child folders when the selected root has no project files', async () => {
    const rootEntries: DirEntry[] = [
      { name: '第1話 开端', isDirectory: true, absPath: '/library/龙珠/第1話 开端' },
      { name: '002_继续', isDirectory: true, absPath: '/library/龙珠/002_继续' }
    ]
    const scanChildProject = vi.fn((folder: string) => {
      const stem = folder.endsWith('002_继续') ? '002' : '001'
      return Promise.resolve(makeScan(folder, [stem]))
    })
    const projectSaveTree = vi.fn().mockResolvedValue(undefined)
    mockComicType({
      scanChildProject,
      listDir: vi.fn().mockResolvedValue(rootEntries),
      projectGetTree: vi.fn().mockResolvedValue([]),
      projectSaveTree
    })

    const store = useProjectWorkspace()
    await store.saveChild({
      parentTitle: '手填标题',
      chapterNumber: '',
      projectTitle: '',
      folderPath: '/library/龙珠'
    })

    expect(scanChildProject).toHaveBeenCalledWith('/library/龙珠/第1話 开端')
    expect(scanChildProject).toHaveBeenCalledWith('/library/龙珠/002_继续')
    expect(store.parents).toHaveLength(1)
    expect(store.parents[0].title).toBe('手填标题')
    expect(store.parents[0].children).toHaveLength(2)
    expect(store.parents[0].children.map((child) => child.chapterNumber)).toEqual(['2', '1'])
    expect(store.parents[0].children.every((child) => child.parentTitle === '手填标题')).toBe(true)
    expect(projectSaveTree).toHaveBeenCalledWith(store.parents)
  })

  it('incrementally imports only new folders and preserves edited chapter metadata', async () => {
    const existingParent: ParentProject = {
      id: 'p1',
      title: '我修改过的漫画名',
      lastMtimeMs: 10,
      children: [
        makeChild({
          id: 'existing',
          parentTitle: '我修改过的漫画名',
          folderPath: '/library/龙珠/001_开端',
          chapterNumber: '特别一',
          projectTitle: '我修改过的标题'
        })
      ]
    }
    const rootEntries: DirEntry[] = [
      { name: '001_开端', isDirectory: true, absPath: '/library/龙珠/001_开端' },
      { name: '002_继续', isDirectory: true, absPath: '/library/龙珠/002_继续' }
    ]
    const scanChildProject = vi.fn().mockResolvedValue(makeScan('/library/龙珠/002_继续', ['002']))
    const projectSaveTree = vi.fn().mockResolvedValue(undefined)
    mockComicType({
      scanChildProject,
      listDir: vi.fn().mockResolvedValue(rootEntries),
      projectGetTree: vi.fn().mockResolvedValue([existingParent]),
      projectSaveTree
    })

    const store = useProjectWorkspace()
    const result = await store.saveChild({
      parentTitle: '龙珠',
      chapterNumber: '',
      projectTitle: '',
      folderPath: '/library/龙珠'
    })

    expect(result).toEqual({ added: 1, skipped: 1, updated: 0 })
    expect(scanChildProject).toHaveBeenCalledTimes(1)
    expect(scanChildProject).toHaveBeenCalledWith('/library/龙珠/002_继续')
    expect(store.parents).toHaveLength(1)
    expect(store.parents[0].title).toBe('我修改过的漫画名')
    expect(store.parents[0].children[0]).toMatchObject({
      id: 'existing',
      chapterNumber: '特别一',
      projectTitle: '我修改过的标题'
    })
    expect(store.parents[0].children[1]).toMatchObject({
      parentTitle: '我修改过的漫画名',
      chapterNumber: '2'
    })
    expect(projectSaveTree).toHaveBeenCalledTimes(1)
  })

  it('skips an already imported single folder without rescanning it', async () => {
    const existing = makeChild({
      id: 'existing',
      folderPath: 'C:\\library\\龙珠\\001',
      chapterNumber: '自定义集数',
      projectTitle: '自定义标题'
    })
    const parent: ParentProject = {
      id: 'p1',
      title: '龙珠',
      lastMtimeMs: 10,
      children: [existing]
    }
    const scanChildProject = vi.fn()
    const projectSaveTree = vi.fn().mockResolvedValue(undefined)
    mockComicType({
      scanChildProject,
      listDir: vi.fn().mockResolvedValue([]),
      projectGetTree: vi.fn().mockResolvedValue([parent]),
      projectSaveTree
    })

    const store = useProjectWorkspace()
    const result = await store.saveChild({
      parentTitle: '会覆盖的名字',
      chapterNumber: '999',
      projectTitle: '会覆盖的标题',
      folderPath: 'c:/LIBRARY/龙珠/001'
    })

    expect(result).toEqual({ added: 0, skipped: 1, updated: 0 })
    expect(scanChildProject).not.toHaveBeenCalled()
    expect(projectSaveTree).not.toHaveBeenCalled()
    expect(store.parents[0].children[0]).toMatchObject({
      chapterNumber: '自定义集数',
      projectTitle: '自定义标题'
    })
  })

  it('renames a parent and syncs the denormalized child parentTitle values', async () => {
    const parent: ParentProject = {
      id: 'p1',
      title: '旧漫画',
      lastMtimeMs: 10,
      children: [
        makeChild({ id: 'c1', parentTitle: '旧漫画' }),
        makeChild({ id: 'c2', parentTitle: '旧漫画', folderPath: '/fake/chapter2' })
      ]
    }
    const projectRenameParent = vi.fn().mockResolvedValue(undefined)
    mockComicType({ projectRenameParent })

    const store = useProjectWorkspace()
    store.parents = [parent]
    store.setActiveChild(parent.children[0], [])

    await store.renameParent('p1', '新漫画')

    expect(projectRenameParent).toHaveBeenCalledWith('p1', '新漫画')
    expect(store.parents[0].title).toBe('新漫画')
    expect(store.parents[0].children.every((child) => child.parentTitle === '新漫画')).toBe(true)
    expect(store.activeChild?.parentTitle).toBe('新漫画')
  })

  it('persists a manually reordered parent list', async () => {
    const first: ParentProject = {
      id: 'p1',
      title: '第一',
      lastMtimeMs: 20,
      children: [makeChild({ id: 'c1' })]
    }
    const second: ParentProject = {
      id: 'p2',
      title: '第二',
      lastMtimeMs: 10,
      children: [makeChild({ id: 'c2' })]
    }
    const projectReorderParents = vi.fn().mockResolvedValue(undefined)
    mockComicType({ projectReorderParents })
    const store = useProjectWorkspace()
    store.parents = [first, second]

    await store.reorderParent('p2', 'p1')

    expect(projectReorderParents).toHaveBeenCalledWith('p2', 'p1')
    expect(store.parents.map((parent) => parent.id)).toEqual(['p2', 'p1'])
  })
})

describe('useProjectWorkspace — batch project status', () => {
  it('marks every PSD under all selected child projects and persists progress', async () => {
    const parent: ParentProject = {
      id: 'p1',
      title: '漫画',
      lastMtimeMs: 0,
      children: [
        makeChild({ id: 'c1', folderPath: '/fake/c1' }),
        makeChild({ id: 'c2', folderPath: '/fake/c2' })
      ]
    }
    const storeGet = vi.fn((key: string) =>
      Promise.resolve(key === 'psdStatusOverrides' ? {} : undefined)
    )
    const storeSet = vi.fn().mockResolvedValue(undefined)
    const projectSaveProgress = vi.fn().mockResolvedValue(undefined)
    mockComicType({
      storeGet,
      storeSet,
      projectSaveProgress,
      scanChildProject: vi.fn((folder: string) =>
        Promise.resolve(makeScan(folder, ['page_001', 'page_002']))
      )
    })
    const store = useProjectWorkspace()
    store.parents = [parent]

    const count = await store.markChildProjects(['c1', 'c2'], 'done')

    // 2026-09-30：返回值从"数字"改成结果对象（多了 cancelled / skipped —— 目录读不到时
    // 要如实报出"跳过了哪几话"，见交接文档 §0 第二十一轮）。语义不变：marked = 写进去的文件数。
    expect(count.marked).toBe(4)
    expect(count.cancelled).toBe(false)
    expect(count.skipped).toEqual([])
    expect(storeSet).toHaveBeenCalledWith('psdStatusOverrides', {
      '/fake/c1/page_001.psd': 'done',
      '/fake/c1/page_002.psd': 'done',
      '/fake/c2/page_001.psd': 'done',
      '/fake/c2/page_002.psd': 'done'
    })
    expect(
      store.parents.every((item) => item.children.every((child) => child.psdStats?.length === 2))
    ).toBe(true)
    expect(computeProgress(store.parents[0].children[0].psdStats ?? [])).toEqual({
      done: 2,
      total: 2,
      pct: 100
    })
    expect(projectSaveProgress).toHaveBeenCalledWith(expect.any(Array))
  })

  it('loads remembered status and writes later changes back to project memory', async () => {
    const child = makeChild({ id: 'c1', folderPath: '/fake/c1' })
    const memorySetStatuses = vi.fn().mockResolvedValue(undefined)
    mockComicType({
      storeGet: vi.fn().mockResolvedValue({}),
      storeSet: vi.fn().mockResolvedValue(undefined),
      scanChildProject: vi.fn().mockResolvedValue(makeScan('/fake/c1', ['page_001'])),
      memoryGetProject: vi.fn().mockResolvedValue({
        childId: 'c1',
        folderPath: '/fake/c1',
        updatedAt: 1,
        files: {
          '/fake/c1/page_001.psd': {
            path: '/fake/c1/page_001.psd',
            status: 'done',
            mtimeMs: 2000,
            updatedAt: 1
          }
        }
      }),
      memorySetStatuses
    })
    const store = useProjectWorkspace()
    store.parents = [{ id: 'p1', title: '漫画', lastMtimeMs: 0, children: [child] }]

    const pairs = await store.scanChild(child)
    expect(pairs[0].psd.status).toBe('done')
    expect(computeProgress(store.findChild('c1')?.psdStats ?? []).pct).toBe(100)

    await store.rememberStatuses(child, pairs, 'pending')
    // 载荷是**补丁**：只带本次要改的那个模式（其它模式由主进程与库里的值合并）。
    // 整份 modes 发过去会让客户端内存里那份不新鲜的值覆盖库里的真值
    // —— 2026-09-26 的批量标记就是那样抹掉 15 话标记的。
    expect(memorySetStatuses).toHaveBeenCalledWith(
      'c1',
      '/fake/c1',
      [
        {
          pathKey: '/fake/c1/page_001.psd',
          path: '/fake/c1/page_001.psd',
          status: 'pending',
          mtimeMs: 2000,
          modeTimestamps: { typeset: 0 },
          modes: { typeset: false }
        }
      ],
      // 第十四轮起第 4 个参数是**台账上下文**。这条用例是直接调 store 的
      // （没有经过用户操作入口），所以它是 undefined —— 由调用方决定记不记台账，
      // 真实流程带上下文的样子见 projectWorkspace-mark-audit.spec.ts。
      undefined
    )
  })

  it('batch-marking an explicit mode never flips the typeset state', async () => {
    const parent: ParentProject = {
      id: 'p1',
      title: '漫画',
      lastMtimeMs: 0,
      children: [makeChild({ id: 'c1', folderPath: '/fake/c1' })]
    }
    const memorySetStatuses = vi.fn().mockResolvedValue(undefined)
    mockComicType({
      storeGet: vi.fn((key: string) =>
        Promise.resolve(key === 'psdStatusOverrides' ? {} : undefined)
      ),
      storeSet: vi.fn().mockResolvedValue(undefined),
      memorySetStatuses,
      projectSaveProgress: vi.fn().mockResolvedValue(undefined),
      scanChildProject: vi.fn((folder: string) => Promise.resolve(makeScan(folder, ['page_001'])))
    })
    const store = useProjectWorkspace()
    store.parents = [parent]

    const count = await store.markChildProjects(['c1'], 'done', 'translated')

    // 同上：契约改成结果对象，语义不变。
    expect(count.marked).toBe(1)
    expect(count.skipped).toEqual([])
    const updates = memorySetStatuses.mock.calls[0][2] as Array<Record<string, unknown>>
    // 载荷是**补丁**：只带本次改的那一个模式 —— "不碰 typeset" 这条不变式
    // 现在由主进程按 patch 合并来保证（见 database.spec.ts 的补丁合并用例）。
    expect(updates[0].modes).toEqual({ translated: true })
    expect((updates[0].modeTimestamps as Record<string, number>).translated).toEqual(
      expect.any(Number)
    )
    // …and the legacy status stays 'pending' because typeset itself is untouched.
    expect(updates[0].status).toBe('pending')
  })

  it('batch-marking typeset still uses the legacy status path', async () => {
    const parent: ParentProject = {
      id: 'p1',
      title: '漫画',
      lastMtimeMs: 0,
      children: [makeChild({ id: 'c1', folderPath: '/fake/c1' })]
    }
    const memorySetStatuses = vi.fn().mockResolvedValue(undefined)
    mockComicType({
      storeGet: vi.fn((key: string) =>
        Promise.resolve(key === 'psdStatusOverrides' ? {} : undefined)
      ),
      storeSet: vi.fn().mockResolvedValue(undefined),
      memorySetStatuses,
      projectSaveProgress: vi.fn().mockResolvedValue(undefined),
      scanChildProject: vi.fn((folder: string) => Promise.resolve(makeScan(folder, ['page_001'])))
    })
    const store = useProjectWorkspace()
    store.parents = [parent]

    await store.markChildProjects(['c1'], 'done', 'typeset')

    const updates = memorySetStatuses.mock.calls[0][2] as Array<Record<string, unknown>>
    expect(updates[0].status).toBe('done')
    expect((updates[0].modes as Record<string, boolean>).typeset).toBe(true)
  })
})
