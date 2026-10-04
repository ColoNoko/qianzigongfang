// @vitest-environment jsdom
/**
 * 批量标记（侧栏「已X全部 / 未X全部」）不得抹掉目标子项目**其它模式**的标记。
 *
 * 现场：用户报了「我选中一话，它就自动将子项目以当前状态全部标记了」。
 * 查数据时发现更严重的一件事 —— 那一次批量标记把 **15 话 / 153 个文件**的
 * 其它模式标记（监修）一起写成了 false（证据见交接文档）。
 *
 * 根因（这条用例锁的就是它）：
 *   `markChildProjects()` 只对**当前打开的那一话**加载过「已记住的标记」
 *   （`loadRememberedStatuses()` 只在单话的 `scanChild()` 里调），批量目标里
 *   其余各话在内存里**没有**这份记录；而 `rememberModeStatuses()` 是这样合并的：
 *
 *     currentModes = this.psdModeStatuses[path] ?? pair.psd.modes ?? 空
 *                    └ 没加载 → undefined      └ 扫描器从来不填 modes → undefined
 *
 *   → 合并的底稿是「四个模式全 false」，再把当前模式设成目标值 → 写库时
 *   其它模式被一起写成 false。而 `persistParentsProgress()` 又会把这次算出来的
 *   `psdModeStats`（其它模式 = 0）整棵树刷回库 → 侧栏/成就页跟着显示成 0。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useProjectWorkspace } from '../projectWorkspace'
import type { ChildProject, ParentProject, WorkModeStatus } from '@shared/types'

const FOLDER = 'D:\\comic\\ch2'
const PSD = `${FOLDER}\\01.psd`

/** 与 projectWorkspace.ts 里的 normalizePathForLookup 保持一致。 */
const pathKey = (absPath: string): string =>
  absPath.replace(/\\/g, '/').normalize('NFC').toLocaleLowerCase()

function makeChild(): ChildProject {
  return {
    id: 'c2',
    parentTitle: '父级',
    folderPath: FOLDER,
    chapterNumber: '2',
    projectTitle: '第2集',
    lastMtimeMs: 0
  }
}

function makeParent(child: ChildProject): ParentProject {
  return { id: 'p1', title: '父级', lastMtimeMs: 0, children: [child] }
}

interface Spies {
  memorySetStatuses: ReturnType<typeof vi.fn>
  projectSaveProgress: ReturnType<typeof vi.fn>
  /** 覆盖旧式 overrides 的读取（`psdStatusOverrides` 那个 key）。 */
  storeGet?: ReturnType<typeof vi.fn>
  /** 覆盖"库里已记住的标记"的读取。 */
  memoryGetProject?: ReturnType<typeof vi.fn>
}

function installBridge(spies: Spies): void {
  window.comicType = {
    // 扫描器**不会**给 pair.psd 带 modes —— 这正是内存里那份记录的另一个来源也失效的原因
    scanChildProject: vi.fn().mockResolvedValue({
      jpgPairs: [
        {
          jpgPath: `${FOLDER}\\01.jpg`,
          psd: { absPath: PSD, mtimeMs: 2000, ctimeMs: 1000, status: 'pending' }
        }
      ],
      txtFiles: [],
      errors: []
    }),
    listDir: vi.fn().mockResolvedValue([]),
    stat: vi.fn(),
    readFileDataURL: vi.fn().mockResolvedValue('data:image/jpeg;base64,AAA'),
    pickDirectory: vi.fn(),
    pickToolFile: vi.fn(),
    readFileBuffer: vi.fn(),
    openPath: vi.fn(),
    storeGet: spies.storeGet ?? vi.fn().mockResolvedValue(undefined),
    storeSet: vi.fn().mockResolvedValue(undefined),
    // 这一话在库里的**真实记录**：校对与监修都是 true
    memoryGetProject:
      spies.memoryGetProject ??
      vi.fn().mockResolvedValue({
        childId: 'c2',
        folderPath: FOLDER,
        updatedAt: 0,
        files: {
          [pathKey(PSD)]: {
            path: PSD,
            status: 'pending',
            mtimeMs: 2000,
            updatedAt: 0,
            modes: { typeset: false, translated: false, proofread: true, supervised: true },
            // modeStatsFromPairs 是**按完成时间戳**统计的（不是按布尔位），所以这里要给出时间戳
            modeTimestamps: { proofread: 111, supervised: 222 }
          }
        }
      }),
    memorySetStatuses: spies.memorySetStatuses,
    projectGetTree: vi.fn().mockResolvedValue([]),
    projectSaveTree: vi.fn().mockResolvedValue(undefined),
    projectSaveProgress: spies.projectSaveProgress,
    projectDeleteChildren: vi.fn().mockResolvedValue(undefined),
    projectRenameParent: vi.fn().mockResolvedValue(undefined),
    projectReorderParents: vi.fn().mockResolvedValue(undefined)
  } as unknown as typeof window.comicType
}

describe('批量标记不能毁掉其它模式', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('批量标记「校对」时：只发改动的那一个模式，且不清掉「监修」的派生缓存', async () => {
    const memorySetStatuses = vi.fn().mockResolvedValue(undefined)
    const projectSaveProgress = vi.fn().mockResolvedValue(undefined)
    installBridge({ memorySetStatuses, projectSaveProgress })

    const workspace = useProjectWorkspace()
    const child = makeChild()
    workspace.parents = [makeParent(child)]

    // 注意：这里**没有**先 scanChild(c2) —— 批量操作本来就不会先去打开每一话
    await workspace.markChildProjects(['c2'], 'done', 'proofread')

    // ① 写库载荷是**补丁**：只带本次改的那一个模式。
    //    主进程按 patch 与库里的值合并（setStoredProjectMemoryStatuses），
    //    所以库里那条 supervised:true 不会被碰。
    expect(memorySetStatuses).toHaveBeenCalledTimes(1)
    const updates = memorySetStatuses.mock.calls[0][2] as Array<{
      modes: Partial<WorkModeStatus>
    }>
    expect(updates[0].modes).toEqual({ proofread: true })

    // ② 派生缓存也要对：这一话的「监修」在库里是 true，批量标完之后
    //    它必须还是 1 条 —— 以前这里会被算成 0，并被 persistParentsProgress()
    //    整棵树刷回库（侧栏/成就页跟着显示 0）。
    expect(child.psdModeStats?.proofread).toHaveLength(1)
    expect(child.psdModeStats?.supervised).toHaveLength(1)
  })

  /**
   * 旧式 overrides 的迁移写回：只写 typeset 这一位。
   * 发整份 `modes` 就等于"覆盖四个模式" —— 库里该路径若已有其它模式的标记会被抹掉。
   * （这条路径要求"库里有其它模式标记、但当前路径查不到记录"，所以用 memoryGetProject=null
   *   模拟"该子项目下没有这行的记录"。）
   */
  it('旧式标记迁移只发 typeset 补丁，不覆盖库里的其它模式', async () => {
    const memorySetStatuses = vi.fn().mockResolvedValue(undefined)
    installBridge({
      memorySetStatuses,
      projectSaveProgress: vi.fn().mockResolvedValue(undefined),
      // 旧版本留下的 overrides（key 就是那个全局旧表）
      storeGet: vi.fn((key: string) =>
        Promise.resolve(key === 'psdStatusOverrides' ? { [PSD]: 'done' } : undefined)
      ),
      memoryGetProject: vi.fn().mockResolvedValue(null)
    })

    const workspace = useProjectWorkspace()
    const child = makeChild()
    workspace.parents = [makeParent(child)]

    await workspace.scanChild(child)

    expect(memorySetStatuses).toHaveBeenCalledTimes(1)
    const updates = memorySetStatuses.mock.calls[0][2] as Array<Record<string, unknown>>
    expect(updates[0].modes).toEqual({ typeset: true }) // 补丁：只有这一个键
    expect(updates[0].modeTimestamps).toBeUndefined() // 不传 = 保留库里的时间戳
  })

  /** 「标记嵌字」的完成时间戳必须与写进内存的那个值同源，且是个正数（0 的语义是"清掉"）。 */
  it('标记完成时，写库的时间戳是与内存同源的正数（不是 0）', async () => {
    const memorySetStatuses = vi.fn().mockResolvedValue(undefined)
    installBridge({ memorySetStatuses, projectSaveProgress: vi.fn().mockResolvedValue(undefined) })

    const workspace = useProjectWorkspace()
    const child = makeChild()
    workspace.parents = [makeParent(child)]

    // scanChild 会顺带写一次迁移/记忆，先清掉计数，只看下面这次「标记完成」
    const pairs = await workspace.scanChild(child)
    memorySetStatuses.mockClear()
    await workspace.rememberStatuses(child, pairs, 'done')

    const updates = memorySetStatuses.mock.calls[0][2] as Array<{
      modeTimestamps: Record<string, number>
    }>
    const sent = updates[0].modeTimestamps.typeset
    expect(sent).toBeGreaterThan(0)
    // 与内存里的那一份一致 —— 侧栏按时间戳统计完成数，两者不同源就会"库里对、界面 0"
    expect(workspace.psdModeTimestamps[PSD]?.typeset).toBe(sent)
  })

  /**
   * 派生缓存必须以**库里的合并结果**为准。
   * 场景：读底稿 →（别的实例改了这一行）→ 我们写补丁。库里现在多了一个 translated，
   * 而"客户端内存自己合并出来的那份"并不知道 —— 侧栏就会显示错数字（库是对的）。
   * 修法是写完之后再从库里读一遍（`markChildProjects` 里的第二次 loadRememberedStatuses）。
   */
  it('批量写完之后按库里的结果重算派生缓存（别的实例同时改过也要跟上）', async () => {
    const memorySetStatuses = vi.fn().mockResolvedValue(undefined)
    const authoritative = {
      childId: 'c2',
      folderPath: FOLDER,
      updatedAt: 0,
      files: {
        [pathKey(PSD)]: {
          path: PSD,
          status: 'pending',
          mtimeMs: 2000,
          updatedAt: 0,
          // 读了底稿之后，别的实例把「翻译」也标上了
          modes: { typeset: false, translated: true, proofread: true, supervised: true },
          modeTimestamps: { translated: 999, proofread: 111, supervised: 222 }
        }
      }
    }
    installBridge({
      memorySetStatuses,
      projectSaveProgress: vi.fn().mockResolvedValue(undefined),
      memoryGetProject: vi
        .fn()
        // 第 1 次 = 写库前的底稿（还不知道 translated）
        .mockResolvedValueOnce({
          childId: 'c2',
          folderPath: FOLDER,
          updatedAt: 0,
          files: {
            [pathKey(PSD)]: {
              path: PSD,
              status: 'pending',
              mtimeMs: 2000,
              updatedAt: 0,
              modes: { typeset: false, translated: false, proofread: true, supervised: true },
              modeTimestamps: { proofread: 111, supervised: 222 }
            }
          }
        })
        // 第 2 次 = 写完之后的权威读取
        .mockResolvedValue(authoritative)
    })

    const workspace = useProjectWorkspace()
    const child = makeChild()
    workspace.parents = [makeParent(child)]

    await workspace.markChildProjects(['c2'], 'done', 'proofread')

    expect(child.psdModeStats?.proofread).toHaveLength(1)
    expect(child.psdModeStats?.supervised).toHaveLength(1)
    expect(child.psdModeStats?.translated).toHaveLength(1) // ← 只看底稿的话这里是 0
  })
})
