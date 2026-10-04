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

/** Expand the first parent and click the first child row (sorted desc → c2). */
async function selectFirstChild(wrapper: ReturnType<typeof mountSidebar>): Promise<void> {
  // Scope queries to the ProjectTree child component, and address the child
  // container by `data-testid` — `bg-card-bg` used to be the anchor, but the
  // sidebar root and the (now sticky) parent row both carry that class too.
  const tree = wrapper.findComponent(ProjectTree)
  // Expand first parent.
  await tree.findAll('.font-bold')[0].trigger('click')
  // Click first child row in the expanded block.
  const childBlock = tree.get('[data-testid="child-list"]')
  const childRows = childBlock.findAll('div.cursor-pointer')
  await childRows[0].trigger('click')
}

describe('ProjectSidebar', () => {
  it('renders action buttons (添加/修改/删除/管理) and ProjectTree', () => {
    const wrapper = mountSidebar()
    const buttons = wrapper.find('[data-testid="sidebar-actions"]').findAll('button')
    expect(buttons).toHaveLength(4)
    expect(buttons[0].text()).toBe('添加')
    expect(buttons[1].text()).toBe('修改')
    expect(buttons[2].text()).toBe('删除')
    expect(buttons[3].text()).toBe('管理')
    // ProjectTree is rendered (parent title visible).
    expect(wrapper.html()).toContain('ドラゴンボール')
  })

  it('click 添加 emits add', async () => {
    const wrapper = mountSidebar()
    await wrapper.find('[data-testid="sidebar-actions"]').findAll('button')[0].trigger('click')
    expect(wrapper.emitted('add')).toBeTruthy()
    expect(wrapper.emitted('add')!.length).toBe(1)
  })

  it('多选模式的「取消」排在同一行最右端（与正常模式的「管理」同一个角落）', async () => {
    const wrapper = mountSidebar()

    // 正常模式：「管理」必须是那一行最后一个按钮。
    const normalButtons = wrapper.find('[data-testid="sidebar-actions"]').findAll('button')
    expect(normalButtons[normalButtons.length - 1].attributes('data-testid')).toBe(
      'multi-select-button'
    )
    expect(normalButtons[normalButtons.length - 1].text()).toBe('管理')

    await wrapper.get('[data-testid="multi-select-button"]').trigger('click')

    const buttons = wrapper.find('[data-testid="sidebar-actions"]').findAll('button')
    const cancel = buttons[buttons.length - 1]
    expect(cancel.attributes('data-testid')).toBe('multi-select-button')
    expect(cancel.text()).toBe('取消')
    // 靠自动外边距顶到右端 —— 宽度不够换行时它也仍在自己那一行的右边，
    // 而不是像 flex-1 那样把批量按钮一起拉变形。
    expect(cancel.classes()).toContain('ml-auto')
    // 批量按钮依旧在左边，顺序没变。
    expect(buttons.map((button) => button.attributes('data-testid'))).toEqual([
      'batch-done-button',
      'batch-pending-button',
      'batch-delete-button',
      'multi-select-button'
    ])
  })

  it('select a child → 修改/删除 enabled; 修改 emits manage; 删除 confirms and emits delete', async () => {
    window.confirm = vi.fn(() => true)
    const wrapper = mountSidebar()

    // Before selection: 修改/删除 disabled.
    const actionButtons = wrapper.find('[data-testid="sidebar-actions"]').findAll('button')
    const manageBtn = actionButtons[1]
    const deleteBtn = actionButtons[2]
    expect(manageBtn.attributes('disabled')).toBeDefined()
    expect(deleteBtn.attributes('disabled')).toBeDefined()

    // Select first child (c1 — sorted by natural chapter order).
    await selectFirstChild(wrapper)

    // select re-emitted upward.
    expect(wrapper.emitted('select')).toBeTruthy()
    expect(wrapper.emitted('select')![0]).toEqual(['p1', 'c1'])

    // After selection: buttons enabled.
    expect(manageBtn.attributes('disabled')).toBeUndefined()
    expect(deleteBtn.attributes('disabled')).toBeUndefined()

    // Click 修改 → emits manage with childId.
    await manageBtn.trigger('click')
    expect(wrapper.emitted('manage')).toBeTruthy()
    expect(wrapper.emitted('manage')![0]).toEqual(['c1'])

    // Click 删除 → confirm dialog shown, emits delete with parentId + childId.
    await deleteBtn.trigger('click')
    expect(window.confirm).toHaveBeenCalledWith('确定要删除该项目吗？')
    expect(wrapper.emitted('delete')).toBeTruthy()
    expect(wrapper.emitted('delete')![0]).toEqual(['p1', 'c1'])
  })

  it('click 删除 with confirm=false does NOT emit delete', async () => {
    window.confirm = vi.fn(() => false)
    const wrapper = mountSidebar()

    await selectFirstChild(wrapper)
    const deleteBtn = wrapper.find('[data-testid="sidebar-actions"]').findAll('button')[2]
    await deleteBtn.trigger('click')

    expect(window.confirm).toHaveBeenCalledWith('确定要删除该项目吗？')
    expect(wrapper.emitted('delete')).toBeFalsy()
  })

  it('passes parent rename events through', async () => {
    const wrapper = mountSidebar()
    await wrapper.get('[data-testid="multi-select-button"]').trigger('click')
    const tree = wrapper.findComponent(ProjectTree)
    const manageButton = tree.findAll('button').find((button) => button.text() === '重命名')
    expect(manageButton).toBeTruthy()

    await manageButton!.trigger('click')
    const input = tree.find('input[data-parent-edit-id="p1"]')
    await input.setValue('新漫画')
    await input.trigger('keydown.enter')

    expect(wrapper.emitted('renameParent')![0]).toEqual(['p1', '新漫画'])
  })

  it('multi-select marks a child, exposes batch actions, and ESC exits', async () => {
    const wrapper = mountSidebar()
    const tree = wrapper.findComponent(ProjectTree)
    await tree.findAll('.font-bold')[0].trigger('click')
    await wrapper.get('[data-testid="multi-select-button"]').trigger('click')

    expect(wrapper.get('[data-testid="multi-select-button"]').text()).toBe('取消')
    const childRows = tree.get('[data-testid="child-list"]').findAll('div.cursor-pointer')
    await childRows[0].trigger('click')

    expect(childRows[0].classes()).toContain('bg-selected-bg')
    expect(wrapper.get('[data-testid="multi-select-button"]').text()).toBe('取消')
    expect(wrapper.find('[data-testid="batch-done-button"]').exists()).toBe(true)
    await wrapper.get('[data-testid="batch-done-button"]').trigger('click')
    expect(wrapper.emitted('batchMark')![0]).toEqual([['c1'], 'done'])
    expect(wrapper.get('[data-testid="multi-select-button"]').text()).toBe('取消')
    expect(childRows[0].classes()).not.toContain('bg-selected-bg')

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await wrapper.vm.$nextTick()
    expect(wrapper.get('[data-testid="multi-select-button"]').text()).toBe('管理')
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
    expect(wrapper.get('[data-testid="multi-select-button"]').text()).toBe('取消')
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

    expect(wrapper.get('[data-testid="batch-done-button"]').text()).toBe('已翻全部')
    expect(wrapper.get('[data-testid="batch-pending-button"]').text()).toBe('未翻全部')

    // The mode travels as a prop, not as part of the event — the payload keeps
    // its historical 'done' | 'pending' shape.
    await wrapper.findComponent(ProjectTree).findAll('.font-bold')[0].trigger('click')
    await wrapper.get('[data-testid="batch-done-button"]').trigger('click')
    expect(wrapper.emitted('batchMark')![0]).toEqual([['c1', 'c2'], 'done'])
  })

  it('batch buttons use the single-character wording for every mode', async () => {
    const cases: Array<[WorkMode, string, string]> = [
      ['typeset', '已嵌全部', '未嵌全部'],
      ['proofread', '已校全部', '未校全部'],
      ['supervised', '已监全部', '未监全部']
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
