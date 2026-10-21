// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import ProjectSidebar from '../ProjectSidebar.vue'
import ProjectTree from '../ProjectTree.vue'
import { useToastStore } from '@renderer/stores/toast'
import type { ParentProject, WorkMode } from '@shared/types'

/** 侧栏现在会用到 toast store（父级行勾选整批时的提示），所以每次都要有 active pinia。 */
beforeEach(() => {
  setActivePinia(createPinia())
})

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
    }
  ]
}

/** Mount helper with real ProjectTree (integration) and default props. */
function mountSidebar(parents: ParentProject[] = makeParents()) {
  return mount(ProjectSidebar, {
    props: { parents, loading: false }
  })
}

describe('ProjectSidebar', () => {
  it('shows add and batch management', () => {
    const wrapper = mountSidebar()
    expect(wrapper.find('[data-testid="sidebar-actions"]').findAll('button').map(b => b.text())).toEqual(['添加', '批量管理'])
  })

  it('click 添加 emits add', async () => {
    const wrapper = mountSidebar()
    await wrapper.find('[data-testid="sidebar-actions"]').findAll('button')[0].trigger('click')
    expect(wrapper.emitted('add')).toBeTruthy()
    expect(wrapper.emitted('add')!.length).toBe(1)
  })

  it('chapter context actions work without first selecting the chapter', async () => {
    window.confirm = vi.fn(() => true)
    const wrapper = mountSidebar()
    const tree = wrapper.findComponent(ProjectTree)
    tree.vm.$emit('manageChild', 'c2')
    expect(wrapper.emitted('manage')?.[0]).toEqual(['c2'])
    tree.vm.$emit('deleteChild', 'p1', 'c2')
    await Promise.resolve()
    expect(wrapper.emitted('delete')?.[0]).toEqual(['p1', 'c2'])
  })
  it('cancelled removal does not emit delete', async () => {
    window.confirm = vi.fn(() => false)
    const wrapper = mountSidebar()
    wrapper.findComponent(ProjectTree).vm.$emit('deleteChild', 'p1', 'c1')
    await Promise.resolve()
    expect(wrapper.emitted('delete')).toBeFalsy()
  })
  it('passes parent rename events through', () => {
    const wrapper = mountSidebar()
    wrapper.findComponent(ProjectTree).vm.$emit('renameParent', 'p1', '新漫画')
    expect(wrapper.emitted('renameParent')?.[0]).toEqual(['p1', '新漫画'])
  })
  it('multi-select marks a child, exposes batch actions, and ESC exits', async () => {
    const wrapper = mountSidebar()
    const tree = wrapper.findComponent(ProjectTree)
    await tree.findAll('.font-bold')[0].trigger('click')
    await wrapper.get('[data-testid="multi-select-button"]').trigger('click')

    expect(wrapper.get('[data-testid="multi-select-button"]').text()).toBe('退出管理')
    const childRows = tree.get('[data-testid="child-list"]').findAll('div.cursor-pointer')
    await childRows[0].trigger('click')

    expect(childRows[0].classes()).toContain('bg-selected-bg')
    expect(wrapper.get('[data-testid="multi-select-button"]').text()).toBe('退出管理')
    expect(wrapper.find('[data-testid="batch-done-button"]').exists()).toBe(true)
    await wrapper.get('[data-testid="batch-done-button"]').trigger('click')
    expect(wrapper.emitted('batchMark')![0]).toEqual([['c1'], 'done'])
    expect(wrapper.get('[data-testid="multi-select-button"]').text()).toBe('退出管理')
    expect(childRows[0].classes()).not.toContain('bg-selected-bg')

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await wrapper.vm.$nextTick()
    expect(wrapper.get('[data-testid="multi-select-button"]').text()).toBe('批量管理')
    expect(childRows[0].classes()).not.toContain('bg-selected-bg')
  })

  it('clicking a parent in multi-select marks all of its children', async () => {
    const wrapper = mountSidebar()
    await wrapper.get('[data-testid="multi-select-button"]').trigger('click')
    const tree = wrapper.findComponent(ProjectTree)
    const parentRow = tree.findAll('.font-bold')[0]
    await parentRow.trigger('click')

    expect(parentRow.classes()).toContain('bg-selected-bg')
    await wrapper.get('[data-testid="batch-pending-button"]').trigger('click')
    expect(wrapper.emitted('batchMark')![0]).toEqual([['c1', 'c2'], 'pending'])
    expect(wrapper.get('[data-testid="multi-select-button"]').text()).toBe('退出管理')
    expect(parentRow.classes()).not.toContain('bg-selected-bg')
  })

  /**
   * 一次点击就勾选整批（几十话很常见）—— 必须给出可见提示。
   * 2026-09-26 的现场就是"不知道那一下勾了多少话"，直到点下批量按钮才发现。
   */
  it('管理模式下点父级行勾选整批时，弹出提示（不再悄无声息）', async () => {
    const wrapper = mountSidebar()
    const toast = useToastStore()
    await wrapper.get('[data-testid="multi-select-button"]').trigger('click')

    await wrapper.findComponent(ProjectTree).findAll('.font-bold')[0].trigger('click')

    expect(toast.toasts).toHaveLength(1)
    expect(toast.toasts[0].type).toBe('warning')
    expect(toast.toasts[0].message).toBe('已勾选「ドラゴンボール」全部 2 话（点批量按钮才会写入）')

    // 再点一次是"取消勾选"，不该再刷一条提示
    await wrapper.findComponent(ProjectTree).findAll('.font-bold')[0].trigger('click')
    expect(toast.toasts).toHaveLength(1)
  })

  it('「扫描目录」从树里转发到宿主（宿主负责开弹窗）', async () => {
    const wrapper = mountSidebar()
    await wrapper.get('[data-testid="multi-select-button"]').trigger('click')

    wrapper.findComponent(ProjectTree).vm.$emit('editSourceRoot', 'p1')
    expect(wrapper.emitted('editSourceRoot')?.[0]).toEqual(['p1'])
  })

  it('空父级（没有子项目）点下去不报「全部 0 话」', async () => {
    const wrapper = mountSidebar([
      { id: 'pEmpty', title: '空项目', lastMtimeMs: 0, children: [] },
      ...makeParents()
    ])
    const toast = useToastStore()
    await wrapper.get('[data-testid="multi-select-button"]').trigger('click')

    // 第一行就是那个空父级
    await wrapper.findComponent(ProjectTree).findAll('.font-bold')[0].trigger('click')

    expect(toast.toasts).toHaveLength(0)
  })

  it('batch delete requires confirmation and emits all marked children', async () => {
    window.confirm = vi.fn(() => true)
    const wrapper = mountSidebar()
    await wrapper.get('[data-testid="multi-select-button"]').trigger('click')
    const tree = wrapper.findComponent(ProjectTree)
    const parentRow = tree.findAll('.font-bold')[0]
    await parentRow.trigger('click')

    await wrapper.get('[data-testid="batch-delete-button"]').trigger('click')

    expect(window.confirm).toHaveBeenCalledWith(
      '确定删除选中的 2 个项目吗？\n此操作会移除项目记录，但不会删除原文件。'
    )
    expect(wrapper.emitted('batchDelete')?.[0]).toEqual([['c1', 'c2']])
  })

  it('batch buttons follow the active work mode without changing the emit payload', async () => {
    const wrapper = mount(ProjectSidebar, {
      props: { parents: makeParents(), loading: false, mode: 'translated' }
    })
    await wrapper.get('[data-testid="multi-select-button"]').trigger('click')

    expect(wrapper.get('[data-testid="batch-done-button"]').text()).toBe('标记已翻译')
    expect(wrapper.get('[data-testid="batch-pending-button"]').text()).toBe('取消标记')

    // The mode travels as a prop, not as part of the event — the payload keeps
    // its historical 'done' | 'pending' shape.
    await wrapper.findComponent(ProjectTree).findAll('.font-bold')[0].trigger('click')
    await wrapper.get('[data-testid="batch-done-button"]').trigger('click')
    expect(wrapper.emitted('batchMark')![0]).toEqual([['c1', 'c2'], 'done'])
  })

  it('batch buttons use the current system mode wording for every mode', async () => {
    const cases: Array<[WorkMode, string, string]> = [
      ['typeset', '标记已嵌字', '取消标记'],
      ['proofread', '标记已校对', '取消标记'],
      ['supervised', '标记已监修', '取消标记']
    ]
    for (const [mode, doneLabel, pendingLabel] of cases) {
      const wrapper = mount(ProjectSidebar, {
        props: { parents: makeParents(), loading: false, mode }
      })
      await wrapper.get('[data-testid="multi-select-button"]').trigger('click')
      expect(wrapper.get('[data-testid="batch-done-button"]').text()).toBe(doneLabel)
      expect(wrapper.get('[data-testid="batch-pending-button"]').text()).toBe(pendingLabel)
    }
  })

  /**
   * 工作台侧栏是**唯一**该吸顶的树宿主（「项目」列表页由整页滚动，吸顶会糊到
   * 页面标题上，见 docs/侧栏父级吸顶-优化方案.md §3.1）。
   * 这条锁住接线本身：把 `:sticky-parent-header="true"` 删掉就会红。
   */
  it('侧栏里的树必须开着吸顶，并给截图工装留出滚动口锚点', () => {
    const wrapper = mountSidebar()
    const tree = wrapper.findComponent(ProjectTree)

    expect(tree.props('stickyParentHeader')).toBe(true)
    expect(tree.findAll('.font-bold')[0].classes()).toContain('sticky')
    // 截图脚本要能在注入的页面里直接拿到滚动口（工具栏在它外面）
    expect(wrapper.find('[data-testid="tree-scroll"]').exists()).toBe(true)
  })
})

// Confirmation UI is covered separately; preserve these business decision tests.
vi.mock('@renderer/services/confirm', () => ({ confirmAction: (message: string) => Promise.resolve(window.confirm(message)) }))

it('selects a Shift range and Ctrl+A only within the current manga', async () => {
  const parents = makeParents()
  parents[0].children.push({...parents[0].children[0],id:'c3',chapterNumber:'3',folderPath:'/tmp/3'})
  parents.push({...parents[0],id:'p2',title:'Other',children:[{...parents[0].children[0],id:'other'}]})
  const wrapper = mountSidebar(parents)
  await wrapper.get('[data-testid="multi-select-button"]').trigger('click')
  const tree = wrapper.findComponent(ProjectTree)
  tree.vm.$emit('toggleChildMark','c1',new MouseEvent('click'))
  tree.vm.$emit('toggleChildMark','c3',new MouseEvent('click',{shiftKey:true}))
  await wrapper.vm.$nextTick()
  expect([...(tree.props('markedChildIds') ?? [])].sort()).toEqual(['c1','c2','c3'])
  tree.vm.$emit('toggleChildMark','c2',new MouseEvent('click'))
  await wrapper.vm.$nextTick()
  document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'a',ctrlKey:true,bubbles:true}))
  await wrapper.vm.$nextTick()
  expect([...(tree.props('markedChildIds') ?? [])].sort()).toEqual(['c1','c2','c3'])
  wrapper.unmount()
})
