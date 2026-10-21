// @vitest-environment jsdom

/**
 * 父级职责在**加载路径**上不能丢（2026-10-03）。
 *
 * 现场：职责存进了库（`key_value_store['projects']` 里确实有 `duties`），
 * 但**一重启就不见** —— 因为 `hydrateParents()` 是按固定字段重建对象的，
 * 没列到的字段会被静默丢掉。界面于是退回"按标记推断"，用户手点的那些看起来白点了；
 * 更糟的是之后任何一次整树保存都会把丢过字段的树写回去（数据真的没了）。
 *
 * 这里锁：加载必须带回职责，并且**照样洗一遍**（垃圾值 / 超两个都不许进内存）。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useProjectWorkspace } from '../projectWorkspace'
import { useToastStore } from '../toast'

beforeEach(() => {
  setActivePinia(createPinia())
  window.comicType = {
    projectGetTree: vi.fn().mockResolvedValue([]),
    storeGet: vi.fn().mockResolvedValue(undefined),
    storeSet: vi.fn().mockResolvedValue(undefined)
  } as unknown as typeof window.comicType
})

function treeWith(duties: unknown): unknown[] {
  return [
    {
      id: 'p1',
      title: '青梅亭亭__校对&监修',
      duties,
      lastMtimeMs: 0,
      children: [
        {
          id: 'c1',
          parentTitle: '青梅亭亭__校对&监修',
          folderPath: 'D:\\漫画\\青梅亭亭\\第1集',
          chapterNumber: '第1集',
          projectTitle: '第1话',
          lastMtimeMs: 0
        }
      ]
    }
  ]
}

describe('加载项目树时保留职责', () => {
  it('库里有职责 → 加载后还在（重启不掉），且按规范顺序', async () => {
    window.comicType.projectGetTree = vi.fn().mockResolvedValue(treeWith(['supervised', 'proofread']))
    const workspace = useProjectWorkspace()

    await workspace.loadParents()

    expect(workspace.parents[0].duties).toEqual(['proofread', 'supervised'])
  })

  it('库里的职责是垃圾 / 超过两个 → 洗掉（内存里也不许留脏值）', async () => {
    window.comicType.projectGetTree = vi.fn().mockResolvedValue(treeWith(['校对', 'a', 'b', 'c']))
    const workspace = useProjectWorkspace()

    await workspace.loadParents()

    expect(workspace.parents[0].duties).toEqual([])
  })

  it('没有这个字段 → undefined（不是空数组，界面据此走"按标记推断"）', async () => {
    window.comicType.projectGetTree = vi
      .fn()
      .mockResolvedValue(treeWith(undefined))
    const workspace = useProjectWorkspace()

    await workspace.loadParents()

    expect(workspace.parents[0].duties).toBeUndefined()
  })

  it('显式清空会保留 []，重新加载不退回历史推断', async () => {
    let stored = treeWith(['proofread'])
    window.comicType.projectGetTree = vi.fn(async () => structuredClone(stored)) as typeof window.comicType.projectGetTree
    window.comicType.projectSetParentDuties = vi.fn(async (_id, duties) => { stored = treeWith(duties) })
    const workspace = useProjectWorkspace()
    await workspace.loadParents()
    await workspace.setParentDuties('p1', [])
    expect(workspace.parents[0].duties).toEqual([])
    workspace.parents = []
    await workspace.loadParents()
    expect(workspace.parents[0].duties).toEqual([])
  })

  /**
   * 主进程拒绝时（例如父级已不在库里）**界面与库不许各说各话**（2026-10-03 审查修复）。
   *
   * 以前的写法有两处松：主进程找不到父级时**静默返回**（不写库、也不报错），
   * 渲染层 `await` 之后却**无条件**改本地 —— 于是界面显示"设好了"、库里其实没有。
   * 现在：主进程抛错，渲染层捕获、提示、且一个字都不改。
   */
  it('主进程报错 → 本地一个字都不改，并且要让人看见（不许静默吞掉）', async () => {
    window.comicType.projectGetTree = vi.fn().mockResolvedValue(treeWith(undefined))
    window.comicType.projectSetParentDuties = vi
      .fn()
      .mockRejectedValue(new Error('父级不存在：p1'))
    const workspace = useProjectWorkspace()
    await workspace.loadParents()

    await workspace.setParentDuties('p1', ['typeset'])

    expect(workspace.parents[0].duties).toBeUndefined()
    const toast = useToastStore().toasts.at(-1)
    expect(toast?.type).toBe('error')
    expect(toast?.message).toContain('设置职责失败')
  })
})
