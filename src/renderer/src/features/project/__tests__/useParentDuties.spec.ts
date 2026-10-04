// @vitest-environment jsdom

/**
 * 职责表（`useParentDuties`）—— 2026-10-03。
 *
 * 界面上的样子全由这张表决定：`声明过的 > 按标记推断 > 空`。
 * 这里锁三件事：
 * 1. 声明过的职责**原样胜出**（不许被推断覆盖）；
 * 2. 没声明时按标记推断（数据形状照 `ChildMarkStatistics` 的真实形状：一堆时间戳）；
 * 3. 一点标记都没有 → 空（不许凭空猜，界面就只占位不画标签）。
 *
 * ⚠️ 这条锁是补的：第一版没有它，结果"某些父级不显示标签"是在真机上才发现的
 * （照片里 TRIGGER 有 60 个嵌字标记却没标签）。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, h } from 'vue'
import { mount } from '@vue/test-utils'
import { useParentDuties } from '../useParentDuties'
import { useProjectWorkspace } from '@renderer/stores/projectWorkspace'
import { useAchievementsStore } from '@renderer/stores/achievements'
import type { ChildMarkStatistics } from '@shared/ipc-api'
import type { ParentProject } from '@shared/types'

/** 造一份真实形状的统计：每种模式给一串时间戳（长度 = 该模式完成条目数）。 */
function stat(childId: string, counts: Partial<Record<'typeset' | 'translated' | 'proofread' | 'supervised', number>>): ChildMarkStatistics {
  const stamps = (n: number) => Array.from({ length: n }, (_, index) => index + 1)
  return {
    childId,
    folderPath: `/tmp/${childId}`,
    fileCount: 0,
    completedTimestamps: {
      typeset: stamps(counts.typeset ?? 0),
      translated: stamps(counts.translated ?? 0),
      proofread: stamps(counts.proofread ?? 0),
      supervised: stamps(counts.supervised ?? 0)
    }
  }
}

function parent(id: string, childIds: string[], duties?: ParentProject['duties']): ParentProject {
  return {
    id,
    title: id,
    ...(duties ? { duties } : {}),
    lastMtimeMs: 0,
    children: childIds.map((childId) => ({
      id: childId,
      parentTitle: id,
      folderPath: `/tmp/${childId}`,
      chapterNumber: '第1集',
      projectTitle: '第1话',
      lastMtimeMs: 0
    }))
  }
}

/** 在一个真组件里用组合式（onMounted / computed 都要有宿主）。 */
function withSetup<T>(composable: () => T): { result: T } {
  let result!: T
  const Host = defineComponent({
    setup() {
      result = composable()
      return () => h('div')
    }
  })
  mount(Host)
  return { result }
}

beforeEach(() => {
  setActivePinia(createPinia())
  window.comicType = { storeGet: vi.fn(), storeSet: vi.fn() } as unknown as typeof window.comicType
})

describe('职责表：声明 > 推断 > 空', () => {
  it('声明过的职责原样胜出（哪怕标记指向另一个模式）', () => {
    const workspace = useProjectWorkspace()
    workspace.parents = [parent('p1', ['c1'], ['translated'])]
    const achievements = useAchievementsStore()
    achievements.statistics = [stat('c1', { typeset: 60 })]
    achievements.loaded = true

    const { result } = withSetup(() => useParentDuties())

    expect(result.dutyMap.value.p1).toEqual(['translated'])
  })

  it('没声明时按标记推断：一个父级把各话的标记汇总后取最多（真实语料：TRIGGER 60 个嵌字）', () => {
    const workspace = useProjectWorkspace()
    workspace.parents = [parent('p1', ['c1', 'c2'])]
    const achievements = useAchievementsStore()
    achievements.statistics = [stat('c1', { typeset: 40 }), stat('c2', { typeset: 20, supervised: 5 })]
    achievements.loaded = true

    const { result } = withSetup(() => useParentDuties())

    expect(result.dutyMap.value.p1).toEqual(['typeset'])
  })

  it('一点标记都没有 → 空（界面只占位、不画标签）', () => {
    const workspace = useProjectWorkspace()
    workspace.parents = [parent('p1', ['c1'])]
    const achievements = useAchievementsStore()
    achievements.statistics = [stat('c1', { typeset: 1 })]
    achievements.loaded = true

    const { result } = withSetup(() => useParentDuties())

    expect(result.dutyMap.value.p1).toEqual([])
  })

  it('统计还没加载（首帧）时不报错，加载完自己补上', async () => {
    const workspace = useProjectWorkspace()
    workspace.parents = [parent('p1', ['c1'])]
    const achievements = useAchievementsStore()
    achievements.statistics = []
    achievements.loaded = false
    // 别真去发 IPC：让 refresh 拿到空数组就收工
    ;(window.comicType as unknown as Record<string, unknown>).memoryMarkStatistics = vi
      .fn()
      .mockResolvedValue([stat('c1', { proofread: 9 })])

    const { result } = withSetup(() => useParentDuties())
    expect(result.dutyMap.value.p1).toEqual([])

    await vi.waitFor(() => {
      expect(result.dutyMap.value.p1).toEqual(['proofread'])
    })
  })
})
