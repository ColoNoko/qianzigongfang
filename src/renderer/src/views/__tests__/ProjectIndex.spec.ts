// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import type { ParentProject } from '@shared/types'

const { mockRoute, mockReplace } = vi.hoisted(() => ({
  mockRoute: { query: {} as Record<string, unknown>, params: {} as Record<string, unknown> },
  mockReplace: vi.fn()
}))

vi.mock('vue-router', () => ({
  useRoute: () => mockRoute,
  useRouter: () => ({ replace: mockReplace, push: vi.fn() })
}))

import ProjectIndex from '../ProjectIndex.vue'
import { useProjectWorkspace } from '@renderer/stores/projectWorkspace'

function makeParents(): ParentProject[] {
  return [
    {
      id: 'p1',
      title: 'ドラゴンボール',
      lastMtimeMs: 2000,
      children: [
        {
          id: 'c1',
          parentTitle: 'ドラゴンボール',
          folderPath: '/tmp/第1話',
          chapterNumber: '第1話',
          projectTitle: 'vol1',
          lastMtimeMs: 1000
        },
        {
          id: 'c2',
          parentTitle: 'ドラゴンボール',
          folderPath: '/tmp/第2話',
          chapterNumber: '第2話',
          projectTitle: 'vol2',
          lastMtimeMs: 1500
        }
      ]
    },
    {
      id: 'p2',
      title: 'ワンピース',
      lastMtimeMs: 500,
      children: [
        {
          id: 'c3',
          parentTitle: 'ワンピース',
          folderPath: '/tmp/第10話',
          chapterNumber: '第10話',
          projectTitle: 'vol10',
          lastMtimeMs: 500
        }
      ]
    }
  ]
}

/** Seeds the store so onMounted skips its `loadParents()` (no IPC needed). */
function mountIndex(parents = makeParents()): ReturnType<typeof mount> {
  const workspace = useProjectWorkspace()
  workspace.parents = parents
  return mount(ProjectIndex)
}

/** Scoped to the tree — the page also renders a bold 项目 heading. */
function tree(wrapper: ReturnType<typeof mount>) {
  return wrapper.get('[data-testid="project-index-tree"]')
}

beforeEach(() => {
  setActivePinia(createPinia())
  mockReplace.mockReset()
  mockRoute.query = {}
  window.comicType = {
    storeGet: vi.fn().mockResolvedValue(undefined),
    storeSet: vi.fn().mockResolvedValue(undefined)
  } as unknown as typeof window.comicType
})

describe('ProjectIndex', () => {
  it('opens with every project collapsed', () => {
    const wrapper = mountIndex()

    // Parent rows are listed…
    expect(tree(wrapper).text()).toContain('ドラゴンボール')
    expect(tree(wrapper).text()).toContain('ワンピース')
    // …but no chapter is rendered until a project is opened.
    expect(tree(wrapper).text()).not.toContain('第1集')
    expect(tree(wrapper).text()).not.toContain('第10集')
    expect(tree(wrapper).findAll('.font-bold')).toHaveLength(2)
  })

  it('reveals only the project that was clicked', async () => {
    const wrapper = mountIndex()

    await tree(wrapper).findAll('.font-bold')[0].trigger('click')
    expect(tree(wrapper).text()).toContain('第1集')
    expect(tree(wrapper).text()).toContain('第2集')
    // The sibling project must stay closed.
    expect(tree(wrapper).text()).not.toContain('第10集')
  })

  it('collapses a project again when its row is clicked twice', async () => {
    const wrapper = mountIndex()

    await tree(wrapper).findAll('.font-bold')[0].trigger('click')
    expect(tree(wrapper).text()).toContain('第1集')

    await tree(wrapper).findAll('.font-bold')[0].trigger('click')
    expect(tree(wrapper).text()).not.toContain('第1集')
  })

  it('leaves the self-check button out — this page cannot run that flow', () => {
    const wrapper = mountIndex()

    // The workbench sidebar owns the self-check flow; here the button would be
    // a control that silently does nothing.
    expect(tree(wrapper).find('[data-testid="self-check-button"]').exists()).toBe(false)
  })

  /**
   * 吸顶是工作台侧栏专有的（docs/侧栏父级吸顶-优化方案.md §3.1）：这一页的树在
   * overflow-hidden 卡片里、由**整页**滚动，父级行一旦吸顶就会糊到「项目」标题上。
   *
   * 这条盯的是 `stickyParentHeader` 的**默认值**：哪天有人把它翻成 true
   * （或忘了给「项目」页关掉），这里会立刻红 —— 也就是要"能抓到它要防的那类失败"。
   */
  it('父级行不吸顶、子行不留表头余量 —— 这一页由整页滚动', async () => {
    const wrapper = mountIndex()

    await tree(wrapper).findAll('.font-bold')[0].trigger('click')

    const parentRows = tree(wrapper).findAll('.font-bold')
    expect(parentRows).toHaveLength(2)
    for (const row of parentRows) {
      // 吸顶那一套**逐个列全**，别只挑几个：上一次就是漏了 `border-hairline`，
      // 于是被展开的父级行在「项目」页多出一条只属于侧栏的分界线而没人发现。
      expect(row.classes()).not.toContain('sticky')
      expect(row.classes()).not.toContain('top-0')
      expect(row.classes()).not.toContain('z-10')
      expect(row.classes()).not.toContain('bg-card-bg')
      expect(row.classes()).not.toContain('border-hairline')
    }

    const childRows = tree(wrapper).findAll('[data-child-id]')
    expect(childRows).toHaveLength(2)
    for (const row of childRows) {
      expect(row.classes()).not.toContain('scroll-mt-[41px]')
    }
  })

  it('navigates to the workbench of the clicked chapter', async () => {
    const wrapper = mountIndex()

    await tree(wrapper).findAll('.font-bold')[0].trigger('click')
    const chapterRow = tree(wrapper)
      .findAll('div.cursor-pointer')
      .find((row) => row.text().includes('第1集'))
    expect(chapterRow).toBeTruthy()
    await chapterRow!.trigger('click')

    expect(mockReplace).toHaveBeenCalledWith(
      '/project/' + encodeURIComponent('ドラゴンボール') + '/c1'
    )
  })
})
