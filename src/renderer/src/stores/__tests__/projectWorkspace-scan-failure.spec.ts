// @vitest-environment jsdom
/**
 * 目录读不到时，**不许把它当成"这一话有 0 个文件"**（2026-09-30 审查 high）。
 *
 * 现场逻辑：`scanner.walk()` 遇到 `readdir`/`realpath` 失败不抛错，只把错误塞进
 * `errors[]` 然后返回空列表；于是这一话**通过**了调用方的 try/catch，被当成
 * "扫到了 0 个文件"：
 *   · `scanChild()` / 批量标记循环照旧写 `psdStats=[]`、`statsVersion=PAIRED`、
 *     `lastMtimeMs=0` 并落库 → 侧栏/首页永久显示 0/0；
 *   · 因为 `statsVersion` 已是最新，`childHasStoredStats()` 之后判定"已统计"，
 *     `enrichMissingStats` 再也不会补算（重启也不自修）；
 *   · 而界面上还弹"已将 N 个文件的「X」已标记"。
 *
 * 触发很日常：U 盘/网络盘没挂载、OneDrive 占位符、在资源管理器里改了文件夹名
 * （注册表里还留着旧路径）。
 *
 * 这里锁两件事：
 *   ① 单话 `scanChild()` 对"0 页 + 有错误"抛错（而不是写 0），且**不动**已有的旧缓存；
 *   ② 批量标记把这一话**跳过**，落库载荷里那话的数字仍是旧值（不是 0/0），
 *      并且把跳过了哪几话报给调用方（`skipped`）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { ChildRootMissingError, useProjectWorkspace } from '../projectWorkspace'
import { PAIRED_PSD_STATS_VERSION } from '@shared/status'
import type { ChildProject, ParentProject, PsdStat } from '@shared/types'

const FOLDER = 'D:\\comic\\ch2'

function makeChild(): ChildProject {
  return {
    id: 'c2',
    parentTitle: '父级',
    folderPath: FOLDER,
    chapterNumber: '2',
    projectTitle: '第2集',
    lastMtimeMs: 111,
    statsVersion: PAIRED_PSD_STATS_VERSION,
    // 库里原先的缓存：3 页（PsdStat 只有这两个字段 —— absPath/status 属于 pair，不属于 stat）
    psdStats: [
      { mtimeMs: 1, ctimeMs: 1 },
      { mtimeMs: 1, ctimeMs: 1 },
      { mtimeMs: 1, ctimeMs: 1 }
    ] satisfies PsdStat[]
  }
}

function makeParent(child: ChildProject): ParentProject {
  return { id: 'p1', title: '父级', lastMtimeMs: 111, children: [child] }
}

let projectSaveProgress: ReturnType<typeof vi.fn>

/** 取出桥接对象上那个 mock 的引用（用例里要临时换返回值的那些）。 */
function bridgeMock(name: 'scanChildProject' | 'memoryGetProject'): ReturnType<typeof vi.fn> {
  return window.comicType[name] as unknown as ReturnType<typeof vi.fn>
}

beforeEach(() => {
  setActivePinia(createPinia())
  projectSaveProgress = vi.fn().mockResolvedValue(undefined)
  window.comicType = {
    // ★ 关键：0 页 + 有错误（= 目录读不到），而不是"真的空目录"
    scanChildProject: vi.fn().mockResolvedValue({
      jpgPairs: [],
      txtFiles: [],
      errors: [{ path: FOLDER, msg: 'ENOENT: no such file or directory' }]
    }),
    listDir: vi.fn().mockResolvedValue([]),
    stat: vi.fn(),
    readFileDataURL: vi.fn(),
    pickDirectory: vi.fn(),
    pickToolFile: vi.fn(),
    readFileBuffer: vi.fn(),
    openPath: vi.fn(),
    storeGet: vi.fn().mockResolvedValue(undefined),
    storeSet: vi.fn().mockResolvedValue(undefined),
    memoryGetProject: vi.fn().mockResolvedValue(null),
    memorySetStatuses: vi.fn().mockResolvedValue(undefined),
    projectGetTree: vi.fn(),
    projectSaveTree: vi.fn().mockResolvedValue(undefined),
    projectSaveProgress
  } as unknown as typeof window.comicType
})

describe('目录读不到时不许记成 0 页', () => {
  it('单话 scanChild：抛错，且不动已有的旧缓存', async () => {
    const child = makeChild()
    const workspace = useProjectWorkspace()
    workspace.parents = [makeParent(child)]

    await expect(workspace.scanChild(child)).rejects.toThrow()

    expect(child.psdStats ?? []).toHaveLength(3)
    expect(child.lastMtimeMs).toBe(111)
    expect(projectSaveProgress).not.toHaveBeenCalled()
  })

  it('批量标记：这一话被跳过，落库载荷里仍是旧数字，并把跳过的话报出来', async () => {
    const child = makeChild()
    const workspace = useProjectWorkspace()
    workspace.parents = [makeParent(child)]
    workspace.activeChild = null
    workspace.psdStatusOverridesLoaded = true

    const result = await workspace.markChildProjects(['c2'], 'done', 'typeset')

    expect(result.cancelled).toBe(false)
    expect(result.marked).toBe(0)
    expect(result.skipped).toEqual(['第2集'])

    const payload = projectSaveProgress.mock.calls.at(-1)?.[0] as
      | Array<{ childId: string; psdStats?: PsdStat[]; lastMtimeMs?: number }>
      | undefined
    const persisted = payload?.find((update) => update.childId === 'c2')
    expect(persisted?.psdStats ?? []).toHaveLength(3)
    expect(persisted?.lastMtimeMs).toBe(111)
  })

  it('真的空目录（errors 为空）仍然照旧记成 0 页', async () => {
    bridgeMock('scanChildProject').mockResolvedValue({
      jpgPairs: [],
      txtFiles: [],
      errors: []
    })
    const child = makeChild()
    const workspace = useProjectWorkspace()
    workspace.parents = [makeParent(child)]

    await workspace.scanChild(child)

    expect(child.psdStats ?? []).toEqual([])
    expect(child.statsVersion).toBe(PAIRED_PSD_STATS_VERSION)
  })
})

/**
 * 批量标记在 await 之间**抱着旧对象引用**写派生缓存。
 *
 * `persistParentsProgress()` 里 `this.parents = snapshotParents(this.parents)`
 * 会把整棵树换成**新对象**（每话都换）。批量循环取到 `child` 之后要跨好几个 await
 * 才回写 `psdStats/psdModeStats`，期间只要任何并发流程跑到 persist（点卡片标记 /
 * Ctrl+Z / 扫描 / 手动刷新），成果就落在**孤儿对象**上，随后落盘的是新对象里那份
 * 旧计数 —— 标记是对的，侧栏/首页的数字却退回标记前，重启也不自修。
 * 见 2026-09-30 审查 high。
 */
describe('批量标记跨 await 不许抱旧对象', () => {
  it('await 之间插进来一次 persistParentsProgress，落库的仍是重取后的新数字', async () => {
    bridgeMock('scanChildProject').mockResolvedValue({
      jpgPairs: [
        {
          jpgPath: `${FOLDER}\\01.jpg`,
          psd: { absPath: `${FOLDER}\\01.psd`, mtimeMs: 2000, ctimeMs: 1000, status: 'pending' }
        }
      ],
      txtFiles: [],
      errors: []
    })

    const child = makeChild()
    const workspace = useProjectWorkspace()
    workspace.parents = [makeParent(child)]
    workspace.psdStatusOverridesLoaded = true

    // ★ 在"读底稿"的那次 await 里插一次**并发 persist**：它会把 this.parents 换成新对象。
    let calls = 0
    bridgeMock('memoryGetProject').mockImplementation(async () => {
      calls += 1
      if (calls === 2) await workspace.persistParentsProgress()
      return null
    })

    const result = await workspace.markChildProjects(['c2'], 'done', 'typeset')

    expect(result.marked).toBe(1)
    const payload = projectSaveProgress.mock.calls.at(-1)?.[0] as
      | Array<{ childId: string; psdStats?: PsdStat[] }>
      | undefined
    const persisted = payload?.find((update) => update.childId === 'c2')
    // 旧缓存是 3 页；这一话实际只扫到 1 页 —— 落库的必须是新的 1 页。
    expect(persisted?.psdStats ?? []).toHaveLength(1)
    expect(workspace.findChild('c2')?.psdStats ?? []).toHaveLength(1)
  })
})

/**
 * 「目录不在」与「读不到」必须能分开（2026-10-01）。
 *
 * 用户经常整理本地文件，把某一话整个文件夹删掉/改名是**预期操作**；而权限不足、
 * 网络盘没挂载才是真故障。两者都仍然"不写库"（见上面的 describe），但提示方式
 * 不同：前者走安静的状态条，后者才弹红色告警。
 *
 * 这里锁的就是"能区分"这件事 —— 类型一旦在传递中丢掉，界面会静默退回
 * "每次切回窗口弹一次红字"，而那正是用户报的骚扰。
 */
describe('目录不在 vs 读不到：错误类型要能分开', () => {
  it('rootMissing=true → ChildRootMissingError，且依旧不动旧缓存', async () => {
    bridgeMock('scanChildProject').mockResolvedValue({
      jpgPairs: [],
      txtFiles: [],
      errors: [{ path: FOLDER, msg: 'ENOENT: no such file or directory, realpath' }],
      rootMissing: true
    })
    const child = makeChild()
    const workspace = useProjectWorkspace()
    workspace.parents = [makeParent(child)]

    await expect(workspace.scanChild(child)).rejects.toBeInstanceOf(ChildRootMissingError)

    expect(child.psdStats ?? []).toHaveLength(3)
    expect(child.lastMtimeMs).toBe(111)
    expect(projectSaveProgress).not.toHaveBeenCalled()
  })

  it('rootMissing 缺失（默认 mock = 真读不到）→ 普通 Error，不是 ChildRootMissingError', async () => {
    const child = makeChild()
    const workspace = useProjectWorkspace()
    workspace.parents = [makeParent(child)]

    await expect(workspace.scanChild(child)).rejects.toThrow()
    await expect(workspace.scanChild(child)).rejects.not.toBeInstanceOf(ChildRootMissingError)
  })
})
