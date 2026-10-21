// @vitest-environment jsdom

/**
 * 项目树在**加载**时不许丢字段（2026-10-03）。
 *
 * 现场：`hydrateParents()` / `hydrate()` 都是**按固定字段重建**对象的，没列到的字段被
 * 静默丢掉。已经因此出过两次同源问题：
 *   ① 职责（`duties`）—— 存进库了，一重启就不见（界面退回"按标记推断"）；
 *   ② 记住的扫描根（`sourceRoots`）—— 界面上看不出来，但**一次整树保存就会把它抹掉**
 *      （`importProjectTree()` 会 `projectSaveTree(parents)`，写回去的树里没有这个字段）。
 *      这是真数据丢失：主进程以 `sourceRoots` 为主字段（多根自检靠它），丢了就退化成单根。
 *
 * 这里锁：两个 store 的加载路径都必须把扫描根带回来，且垃圾值不许进内存。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useProjectWorkspace } from '../projectWorkspace'
import { useProjectStore } from '../project'

function treeWith(parent: Record<string, unknown>): unknown[] {
  return [
    {
      id: 'p1',
      title: '搬砖',
      lastMtimeMs: 0,
      children: [
        {
          id: 'c1',
          parentTitle: '搬砖',
          folderPath: 'D:\\漫画\\搬砖\\无\\第1集',
          chapterNumber: '第1集',
          projectTitle: '第1话',
          lastMtimeMs: 0
        }
      ],
      ...parent
    }
  ]
}

beforeEach(() => {
  setActivePinia(createPinia())
  window.comicType = {
    projectGetTree: vi.fn().mockResolvedValue([]),
    projectSaveProgress: vi.fn().mockResolvedValue(undefined),
    storeGet: vi.fn().mockResolvedValue(undefined),
    storeSet: vi.fn().mockResolvedValue(undefined)
  } as unknown as typeof window.comicType
})

describe('加载时保留"记住的扫描根"', () => {
  it('工作台：库里有多个根 → 加载后还是多个（整树保存才不会把它写没）', async () => {
    // 真实场景：搬砖\{无,有}\<章节> —— 三个子项目横跨两个目录，必须记住两个根
    window.comicType.projectGetTree = vi
      .fn()
      .mockResolvedValue(treeWith({ sourceRoots: ['D:\\漫画\\搬砖\\无', 'D:\\漫画\\搬砖\\有'] }))
    const workspace = useProjectWorkspace()

    await workspace.loadParents()

    expect(workspace.parents[0].sourceRoots).toEqual(['D:\\漫画\\搬砖\\无', 'D:\\漫画\\搬砖\\有'])
  })

  it('首页：同一棵树也要带回扫描根（它同样会把树写回去）', async () => {
    window.comicType.projectGetTree = vi
      .fn()
      .mockResolvedValue(treeWith({ sourceRoots: ['D:\\漫画\\搬砖\\无'] }))
    const projectStore = useProjectStore()

    await projectStore.loadProjects()

    expect(projectStore.projects[0].sourceRoots).toEqual(['D:\\漫画\\搬砖\\无'])
  })

  it('垃圾值 / 空串被滤掉；一个都没有时是 undefined（不是空数组）', async () => {
    window.comicType.projectGetTree = vi
      .fn()
      .mockResolvedValue(treeWith({ sourceRoots: ['  ', 42, null, 'D:\\漫画\\搬砖\\有'] }))
    const workspace = useProjectWorkspace()

    await workspace.loadParents()
    expect(workspace.parents[0].sourceRoots).toEqual(['D:\\漫画\\搬砖\\有'])

    window.comicType.projectGetTree = vi.fn().mockResolvedValue(treeWith({ sourceRoots: 'x' }))
    await workspace.loadParents()
    expect(workspace.parents[0].sourceRoots).toBeUndefined()
  })

  it('父级上的"清单字段"必须整体带过去（新增字段时这条就是提醒）', async () => {
    // 这是**契约**：hydrate 是固定字段重建，没列到的字段会被静默丢掉。
    // 已经栽过两次（duties、sourceRoots）—— 新增父级字段时请把它加进这条用例。
    window.comicType.projectGetTree = vi.fn().mockResolvedValue(
      treeWith({
        sourceRoot: 'D:\\漫画\\搬砖\\无',
        sourceRoots: ['D:\\漫画\\搬砖\\无', 'D:\\漫画\\搬砖\\有'],
        duties: ['proofread', 'supervised']
      })
    )
    const workspace = useProjectWorkspace()

    await workspace.loadParents()

    const parent = workspace.parents[0]
    expect(parent.sourceRoot).toBe('D:\\漫画\\搬砖\\无')
    expect(parent.sourceRoots).toEqual(['D:\\漫画\\搬砖\\无', 'D:\\漫画\\搬砖\\有'])
    expect(parent.duties).toEqual(['proofread', 'supervised'])
  })

  it('旧的单根字段 sourceRoot 继续照原样带着（兼容，不许顺手删）', async () => {
    window.comicType.projectGetTree = vi
      .fn()
      .mockResolvedValue(treeWith({ sourceRoot: 'D:\\漫画\\搬砖\\无' }))
    const workspace = useProjectWorkspace()

    await workspace.loadParents()

    expect(workspace.parents[0].sourceRoot).toBe('D:\\漫画\\搬砖\\无')
  })
})

/**
 * 职责（`duties`）—— 2026-10-03 的现场：**存进库了、一重启就不见**
 * （界面退回"按标记推断"，用户手点的看起来白点了）。
 *
 * ⚠️ 两个 store 的加载路径都要带回来：首页那个（`stores/project.ts` 的 `hydrate`）
 * 在进度页做出来之前一直漏着 —— 而进度页正是要用它。
 */
describe('加载时保留职责', () => {
  it('工作台：库里有职责 → 加载后还在，并按规范顺序（嵌 → 翻 → 校 → 监）', async () => {
    window.comicType.projectGetTree = vi
      .fn()
      .mockResolvedValue(treeWith({ duties: ['supervised', 'proofread'] }))
    const workspace = useProjectWorkspace()

    await workspace.loadParents()

    expect(workspace.parents[0].duties).toEqual(['proofread', 'supervised'])
  })

  it('首页：同一棵树也要带回职责（它同样会把树写回去）', async () => {
    window.comicType.projectGetTree = vi.fn().mockResolvedValue(treeWith({ duties: ['proofread'] }))
    const projectStore = useProjectStore()

    await projectStore.loadProjects()

    expect(projectStore.projects[0].duties).toEqual(['proofread'])
  })

  it('垃圾值 / 重复 / 超过两个都被洗掉；一个都没有时是 undefined（不是空数组）', async () => {
    window.comicType.projectGetTree = vi
      .fn()
      .mockResolvedValue(
        treeWith({ duties: ['  ', 42, 'proofread', 'proofread', 'nope', 'typeset', 'supervised'] })
      )
    const workspace = useProjectWorkspace()

    await workspace.loadParents()

    expect(workspace.parents[0].duties).toEqual(['typeset', 'proofread'])

    window.comicType.projectGetTree = vi.fn().mockResolvedValue(treeWith({ duties: [] }))
    const empty = useProjectWorkspace()
    await empty.loadParents()
    expect(empty.parents[0].duties).toBeUndefined()
  })
})

/**
 * 子项目上的字段同样不许丢（2026-10-05，R1 的内容指纹）。
 *
 * 父级字段栽过两次（duties / sourceRoots），这条把**子项目**也钉住：
 * `contentFingerprint` 是"改名认领"的比对基准，丢了就再也认不回改名后的那一话。
 */
describe('子项目字段：内容指纹必须原样带过去（R1）', () => {
  function treeWithChildField(): unknown[] {
    return [
      {
        id: 'p1',
        title: '搬砖',
        lastMtimeMs: 0,
        children: [
          {
            id: 'c1',
            parentTitle: '搬砖',
            folderPath: 'D:\\漫画\\搬砖\\无\\第1集',
            chapterNumber: '1',
            projectTitle: '第1话',
            lastMtimeMs: 0,
            contentFingerprint: 'abc123'
          }
        ]
      }
    ]
  }

  it('两个 store 的加载路径都要把 contentFingerprint 带回来', async () => {
    window.comicType.projectGetTree = vi.fn().mockResolvedValue(treeWithChildField())

    const workspace = useProjectWorkspace()
    await workspace.loadParents()
    expect(workspace.parents[0].children[0].contentFingerprint).toBe('abc123')

    const projectStore = useProjectStore()
    await projectStore.loadProjects()
    expect(projectStore.projects[0].children[0].contentFingerprint).toBe('abc123')
  })
})
