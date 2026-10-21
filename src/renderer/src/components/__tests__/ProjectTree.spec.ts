import { DropdownMenu, DropdownMenuItem } from '../ui/dropdown-menu'
import { flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import StatisticsTimeMenu from '@renderer/features/project/StatisticsTimeMenu.vue'
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { config, enableAutoUnmount, mount } from '@vue/test-utils'
config.global.stubs.teleport = true
config.global.renderStubDefaultSlot = true
enableAutoUnmount(afterEach)
import ProjectTree from '../ProjectTree.vue'
import type { ParentProject, WorkMode } from '@shared/types'

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
          lastMtimeMs: 1000,
          psdStats: [
            { mtimeMs: 600_001, ctimeMs: 0 },
            { mtimeMs: 0, ctimeMs: 0 }
          ]
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

async function selectParentAction(wrapper: ReturnType<typeof mount>, text: string) {
  wrapper.findComponent(DropdownMenu).vm.$emit('update:open', true)
  await wrapper.vm.$nextTick()
  const item = wrapper.findAllComponents(DropdownMenuItem).find(item => item.text() === text)
  expect(item).toBeTruthy()
  item!.vm.$emit('select', new Event('select'))
  await wrapper.vm.$nextTick()
}
describe('ProjectTree', () => {
  it('renders 2 parent rows; clicking chevron on first parent expands it showing 2 children', async () => {
    const wrapper = mount(ProjectTree, { props: { parents: makeParents() } })

    // Both parent titles rendered.
    const parentRows = wrapper.findAll('.font-bold')
    expect(parentRows).toHaveLength(2)
    expect(parentRows[0].text()).toContain('ドラゴンボール')
    expect(parentRows[1].text()).toContain('ワンピース')

    // Collapsed initially — no child rows visible.
    expect(wrapper.html()).not.toContain('第1話')

    // Click the first parent row (chevron lives inside it) to expand.
    await parentRows[0].trigger('click')
    expect(wrapper.html()).toContain('第1集')
    expect(wrapper.html()).toContain('第2集')

    // Both children rendered (child block sits under the expanded parent).
    const childBlock = wrapper.get('[data-testid="child-list"]')
    expect(childBlock.findAll('div.cursor-pointer')).toHaveLength(2)
  })

  it('clicking a child row emits select with correct parentId and childId', async () => {
    const wrapper = mount(ProjectTree, { props: { parents: makeParents() } })

    // Expand first parent.
    await wrapper.findAll('.font-bold')[0].get('button[aria-label="展开子项目"]').trigger('click')

    // Click the first child row.
    const childBlock = wrapper.get('[data-testid="child-list"]')
    const childRows = childBlock.findAll('div.cursor-pointer')
    await childRows[0].trigger('click')

    const selectEvents = wrapper.emitted('select')
    expect(selectEvents).toBeTruthy()
    // Children use natural chapter order regardless of file modification time.
    expect(selectEvents![0]).toEqual(['p1', 'c1'])
  })

  it('sorts numeric and decimal chapters naturally, with custom labels last', async () => {
    const parent = makeParents()[0]
    parent.children = [
      {
        ...parent.children[0],
        id: 'c10',
        chapterNumber: '10',
        projectTitle: 'ten',
        lastMtimeMs: 5000
      },
      {
        ...parent.children[0],
        id: 'cspecial',
        chapterNumber: '番外篇',
        projectTitle: 'special',
        lastMtimeMs: 9000
      },
      {
        ...parent.children[0],
        id: 'c2',
        chapterNumber: '2',
        projectTitle: 'two',
        lastMtimeMs: 100
      },
      {
        ...parent.children[0],
        id: 'c15',
        chapterNumber: '1.5',
        projectTitle: 'one-half',
        lastMtimeMs: 8000
      }
    ]

    const wrapper = mount(ProjectTree, { props: { parents: [parent] } })
    await wrapper.get('button[aria-label="展开子项目"]').trigger('click')

    const labels = wrapper
      .get('[data-testid="child-list"]')
      .findAll('div.cursor-pointer')
      .map((row) => row.text())
    expect(labels).toEqual([
      expect.stringContaining('第1.5集'),
      expect.stringContaining('第2集'),
      expect.stringContaining('第10集'),
      expect.stringContaining('番外篇')
    ])
  })

  it('supports descending numeric order while keeping custom labels last', async () => {
    const parent = makeParents()[0]
    parent.children = [
      { ...parent.children[0], id: 'c1', chapterNumber: '1' },
      { ...parent.children[0], id: 'c10', chapterNumber: '10' },
      { ...parent.children[0], id: 'cspecial', chapterNumber: '番外篇' }
    ]
    const wrapper = mount(ProjectTree, {
      props: { parents: [parent], childSortOrder: 'descending' }
    })
    await wrapper.get('button[aria-label="展开子项目"]').trigger('click')

    const labels = wrapper
      .get('[data-testid="child-list"]')
      .findAll('div.cursor-pointer')
      .map((row) => row.text())
    expect(labels[0]).toContain('第10集')
    expect(labels[1]).toContain('第1集')
    expect(labels[2]).toContain('番外篇')
  })

  it('clicking chevron emits expand with parent id and boolean', async () => {
    const wrapper = mount(ProjectTree, { props: { parents: makeParents() } })

    // Click first parent row → expand true.
    await wrapper.findAll('.font-bold')[0].trigger('click')
    let expandEvents = wrapper.emitted('expand')
    expect(expandEvents).toBeTruthy()
    expect(expandEvents![0]).toEqual(['p1', true])

    // Click again → expand false.
    await wrapper.findAll('.font-bold')[0].trigger('click')
    expandEvents = wrapper.emitted('expand')
    expect(expandEvents![1]).toEqual(['p1', false])
  })

  it('starts fully collapsed and only highlights the active child once its parent is open', async () => {
    const wrapper = mount(ProjectTree, {
      props: { parents: makeParents(), activeChildId: 'c2' }
    })

    // No auto-expand on mount: the active chapter stays hidden until the user
    // opens its parent themselves.
    expect(wrapper.text()).not.toContain('第2集')

    await wrapper.findAll('.font-bold')[0].trigger('click')
    const activeRow = wrapper
      .findAll('div.cursor-pointer')
      .find((row) => row.text().includes('第2集'))
    expect(activeRow?.attributes('aria-current')).toBe('true')
  })

  it('keeps the current collapsed state when another project is deleted', async () => {
    const parents = makeParents()
    const wrapper = mount(ProjectTree, {
      props: { parents, activeChildId: 'c2' }
    })

    // The user opens the parent, then explicitly collapses it again.
    await wrapper.findAll('.font-bold')[0].trigger('click')
    expect(wrapper.text()).toContain('第2集')
    await wrapper.findAll('.font-bold')[0].trigger('click')
    expect(wrapper.text()).not.toContain('第2集')

    // Deleting another child replaces the parents array, but must not reopen it.
    await wrapper.setProps({
      parents: [
        {
          ...parents[0],
          children: parents[0].children.filter((child) => child.id !== 'c1')
        },
        parents[1]
      ]
    })
    expect(wrapper.text()).not.toContain('第2集')
  })

  /**
   * 「修改扫描目录」入口（2026-10-05，需求二）。
   *
   * 三条一起锁：
   *   ① 只在**管理模式**出现（普通模式那一行已经很挤，而且这个动作属于"整理"而不是"干活"）；
   *   ② 点了 emit 父级 id；
   *   ③ **不许顺手勾选整批** —— 管理模式里点父级行的语义是"勾选这一本全部话"，
   *      少一个 @click.stop，用户点一下"扫描目录"就会把几十话悄悄勾上
   *      （本仓库为"悄无声息地勾选"已经踩过一次）。
   */
  it('管理模式下父级行多一个「扫描目录」：点了 emit、且不勾选整批', async () => {
    const normal = mount(ProjectTree, { props: { parents: makeParents() } })
    expect(normal.find('[data-testid="parent-source-root-button"]').exists()).toBe(false)

    const wrapper = mount(ProjectTree, {
      props: { parents: makeParents(), multiSelect: true }
    })
    await selectParentAction(wrapper, '扫描目录')
    expect(wrapper.emitted('editSourceRoot')?.[0]).toEqual(['p1'])
    expect(wrapper.emitted('toggleParentMark'), '点入口按钮不该勾选整批').toBeFalsy()
  })

  it('clicking parent 重命名 turns the title into an input and enter emits renameParent', async () => {
    const wrapper = mount(ProjectTree, {
      props: { parents: makeParents(), multiSelect: true }
    })

    await selectParentAction(wrapper, '重命名漫画')

    const input = wrapper.find('input[data-parent-edit-id="p1"]')
    expect(input.exists()).toBe(true)
    await input.setValue('新龙珠')
    await input.trigger('keydown.enter')

    expect(wrapper.emitted('renameParent')![0]).toEqual(['p1', '新龙珠'])
    expect(wrapper.emitted('expand')).toBeFalsy()
  })

  it('shows compact chapter progress', async () => {
    const normalWrapper = mount(ProjectTree, { props: { parents: makeParents() } })
    expect(normalWrapper.text()).not.toContain('重命名')

    const wrapper = mount(ProjectTree, {
      props: { parents: makeParents(), multiSelect: true }
    })
    await wrapper.findAll('.font-bold')[0].get('button[aria-label="展开子项目"]').trigger('click')
    expect(wrapper.text()).toContain('嵌字进度1/2')
  })

  it('multi-select mode still expands from the arrow and parent double-click', async () => {
    const wrapper = mount(ProjectTree, {
      props: { parents: makeParents(), multiSelect: true, markedChildIds: [] }
    })
    const firstParent = wrapper.findAll('.font-bold')[0]
    const arrow = firstParent.get('button[aria-label="展开子项目"]')

    await arrow.trigger('click')
    expect(wrapper.text()).toContain('第1集')
    expect(wrapper.emitted('toggleParentMark')).toBeFalsy()

    await firstParent.trigger('dblclick')
    expect(wrapper.text()).not.toContain('第1集')
    expect(wrapper.emitted('expand')).toHaveLength(2)
  })

  it('allows parent projects to be reordered by drag only in management mode', async () => {
    const wrapper = mount(ProjectTree, {
      props: { parents: makeParents(), multiSelect: true, markedChildIds: [] }
    })
    const rows = wrapper.findAll('[data-parent-id]')
    const firstRowChildren = rows[0].find('.font-bold').element.children
    expect(firstRowChildren[firstRowChildren.length - 1]).toBe(
      rows[0].get('[data-testid="parent-drag-handle"]').element
    )
    const dataTransfer = {
      effectAllowed: '',
      dropEffect: '',
      setData: vi.fn(),
      getData: vi.fn().mockReturnValue('p1')
    }

    await rows[0].trigger('dragstart', { dataTransfer })
    await rows[1].trigger('dragover', { dataTransfer })
    await rows[1].trigger('drop', { dataTransfer })

    expect(wrapper.emitted('reorderParent')?.[0]).toEqual(['p1', 'p2'])

    await wrapper.setProps({ multiSelect: false })
    expect(wrapper.findAll('[data-parent-id]')[0].attributes('draggable')).toBe('false')
  })

  it('labels each row with the active work mode, not always 嵌字', async () => {
    const parents: ParentProject[] = [
      {
        id: 'p1',
        title: '漫画',
        lastMtimeMs: 0,
        children: [
          {
            id: 'c1',
            parentTitle: '漫画',
            folderPath: '/tmp/第1話',
            chapterNumber: '第1話',
            projectTitle: 'vol1',
            lastMtimeMs: 0,
            // 3 countable files, none of them manually typeset.
            psdStats: [
              { mtimeMs: 0, ctimeMs: 0 },
              { mtimeMs: 0, ctimeMs: 0 },
              { mtimeMs: 0, ctimeMs: 0 }
            ],
            psdModeStats: {
              typeset: [],
              translated: [{ mtimeMs: 1, ctimeMs: 1 }],
              proofread: [],
              supervised: []
            }
          }
        ]
      }
    ]

    // 翻译模式：文案与数字都来自 psdModeStats.translated。
    const translated = mount(ProjectTree, {
      props: { parents, activeChildId: 'c1', mode: 'translated' }
    })
    await translated.get('button[aria-label="展开子项目"]').trigger('click')
    expect(translated.text()).toContain('翻译进度1/3')
    expect(translated.text()).not.toContain('嵌字进度')

    // 嵌字模式：同一话改从 psdStats 取数（已是"只认手动标记"口径），因此是 0/3。
    const typeset = mount(ProjectTree, {
      props: { parents, activeChildId: 'c1', mode: 'typeset' }
    })
    await typeset.get('button[aria-label="展开子项目"]').trigger('click')
    expect(typeset.text()).toContain('嵌字进度0/3')
  })

  describe('revealActiveChild（工作台侧栏专用）', () => {
    it('打开开关时自动展开当前话所属的父级，并给它高亮', async () => {
      const wrapper = mount(ProjectTree, {
        props: { parents: makeParents(), activeChildId: 'c1', revealActiveChild: true }
      })
      await wrapper.vm.$nextTick()

      // 父级被自动展开了：两个子行都在 DOM 里。
      expect(wrapper.findAll('[data-child-id]')).toHaveLength(2)
      const active = wrapper.get('[data-child-id="c1"]')
      expect(active.attributes('aria-current')).toBe('true')
    })

    it('默认（不开开关）保持全收起 —— 「项目」列表页靠这条', () => {
      const wrapper = mount(ProjectTree, {
        props: { parents: makeParents(), activeChildId: 'c1' }
      })
      expect(wrapper.findAll('[data-child-id]')).toHaveLength(0)
    })

    it('用户手动折叠后不会被重新展开（只跟着 activeChildId 变化）', async () => {
      const wrapper = mount(ProjectTree, {
        props: { parents: makeParents(), activeChildId: 'c1', revealActiveChild: true }
      })
      await wrapper.vm.$nextTick()
      expect(wrapper.findAll('[data-child-id]')).toHaveLength(2)

      await wrapper.get('button[aria-label="折叠子项目"]').trigger('click')
      await wrapper.vm.$nextTick()
      expect(wrapper.findAll('[data-child-id]')).toHaveLength(0)
    })
  })

  /**
   * 吸顶（docs/侧栏父级吸顶-优化方案.md）。
   *
   * 这些断言锁的是**类名字面量**：`sticky` 掉了、`z-10` 掉了、`scroll-mt` 的像素值
   * 改了，都会在这里红。真正"钉住了没有"由截图工装那组图看（静态快照能区分
   * "首行是父级标题"与"首行是子项目行"）。
   */
  describe('stickyParentHeader（工作台侧栏专用）', () => {
    it('默认不开：父级行不吸顶、不多兜一层底色、展开也不补细线（「项目」列表页靠这条）', async () => {
      const wrapper = mount(ProjectTree, { props: { parents: makeParents() } })

      const parentRow = wrapper.findAll('.font-bold')[0]
      expect(parentRow.classes()).not.toContain('sticky')
      expect(parentRow.classes()).not.toContain('bg-card-bg')

      await parentRow.trigger('click')
      // 细线是吸顶的表头/正文分界，只属于侧栏；「项目」页展开后**不能**多出这条线
      // （曾漏过一次：这条判断当时没跟着 stickyParentHeader 走）。
      expect(wrapper.findAll('.font-bold')[0].classes()).not.toContain('border-hairline')
      expect(wrapper.get('[data-child-id="c1"]').classes()).not.toContain('scroll-mt-[80px]')
    })

    it('打开后：展开的父级行吸顶（sticky/top-0/z-10 + 不透明底 + 1px 细线），子行留出表头高度', async () => {
      const wrapper = mount(ProjectTree, {
        props: { parents: makeParents(), stickyParentHeader: true }
      })

      const collapsed = wrapper.findAll('.font-bold')[0]
      expect(collapsed.classes()).toContain('sticky')
      expect(collapsed.classes()).toContain('top-0')
      expect(collapsed.classes()).toContain('z-10')
      // 吸顶行是**盖在**滚动内容上的 → 底色必须不透明
      expect(collapsed.classes()).toContain('bg-card-bg')
      // 收起时不要多一条线：外层已经 border-b 了，再加就是 1px 挨 1px 的双线
      expect(collapsed.classes()).not.toContain('border-hairline')

      await collapsed.trigger('click')
      const expanded = wrapper.findAll('.font-bold')[0]
      expect(expanded.classes()).toContain('border-hairline')
      // 标题与职责分成两层后，定位仍需避开吸顶表头。
      expect(wrapper.get('[data-child-id="c1"]').classes()).toContain('scroll-mt-[80px]')
    })

    it('多选标记态：底色仍是选中色，且与吸顶底色显式互斥（不靠 Tailwind 的输出顺序）', () => {
      const wrapper = mount(ProjectTree, {
        props: {
          parents: makeParents(),
          stickyParentHeader: true,
          multiSelect: true,
          markedChildIds: ['c1', 'c2']
        }
      })

      const rows = wrapper.findAll('.font-bold')
      // p1 的两个子项目都被标记 → 父级行是"选中"态
      expect(rows[0].classes()).toContain('bg-selected-bg')
      expect(rows[0].classes()).not.toContain('bg-card-bg')
      // p2 没被标记 → 吸顶底色照常
      expect(rows[1].classes()).toContain('bg-card-bg')
      expect(rows[1].classes()).not.toContain('bg-selected-bg')
    })
  })
})

// Assignment labels open an editor; they never act as work-mode toggles.
describe('父级职责标签', () => {
  const dutiesProps: Record<string, WorkMode[]> = { p1: ['proofread'] }

  it('职责全称按规范顺序排列', () => {
    // ⚠️ 组件的**唯一**输入是宿主算好的 `parentDuties`（它不认识父级自带的 duties，
    // 也不认识"推断"）—— 所以这里必须走 prop，而不是直接改 parents[].duties。
    const wrapper = mount(ProjectTree, {
      props: { parents: makeParents(), parentDuties: { p1: ['supervised', 'proofread'] } }
    })
    const chips = wrapper.findAll('[data-testid="parent-duty-pill"] [data-duty-mode]')
    expect(chips.map((node) => node.text())).toEqual(['校对', '监修'])
  })

  it('宿主传进来的 dutyMap 优先于父级自身字段（推断值走这条路）', () => {
    const wrapper = mount(ProjectTree, {
      props: { parents: makeParents(), parentDuties: { p2: ['typeset'] } }
    })
    expect(wrapper.find('[data-testid="parent-duty-typeset"]').text()).toBe('嵌字')
    // p1 没给 → 不画
    expect(wrapper.findAll('[data-testid="parent-duty-slot"]')[0].find('span').exists()).toBe(false)
  })

  it('点标签开菜单、点选项 emit setDuties（点标签本身不许触发展开）', async () => {
    const wrapper = mount(ProjectTree, {
      props: { parents: makeParents(), parentDuties: { ...dutiesProps } }
    })
    const chip = wrapper.findAll('[data-testid="parent-duty-pill"]')[0]
    await chip.trigger('click')

    // 点标签不该把父级展开（父级行整体是可点区域）
    expect(wrapper.emitted('expand')).toBeUndefined()
    expect(wrapper.find('[data-testid="parent-duty-menu"]').exists()).toBe(true)

    await wrapper.find('[data-testid="parent-duty-option-supervised"]').trigger('click')
    expect(wrapper.emitted('setDuties')![0]).toEqual(['p1', ['proofread', 'supervised']])
  })

  it('已经两个时第三个选项禁用（最多两个是硬规则）', async () => {
    const wrapper = mount(ProjectTree, {
      props: { parents: makeParents(), parentDuties: { p1: ['typeset', 'translated'] } }
    })
    await wrapper.findAll('[data-testid="parent-duty-pill"]')[0].trigger('click')

    const blocked = wrapper.find('[data-testid="parent-duty-option-proofread"]')
    expect(blocked.attributes('disabled')).toBeDefined()
    // 禁用还得**看得出来**：否则"点了没反应"会被当成程序坏了
    // 已选中的那两个仍可点（点一下＝取消）
    expect(
      wrapper.find('[data-testid="parent-duty-option-typeset"]').attributes('disabled')
    ).toBeUndefined()
  })

  it('取消唯一那个职责 → emit 空数组（清空是合法操作）', async () => {
    const wrapper = mount(ProjectTree, {
      props: { parents: makeParents(), parentDuties: { p1: ['proofread'] } }
    })
    await wrapper.findAll('[data-testid="parent-duty-pill"]')[0].trigger('click')
    await wrapper.find('[data-testid="parent-duty-option-proofread"]').trigger('click')
    expect(wrapper.emitted('setDuties')![0]).toEqual(['p1', []])
  })

  it('点菜单外面要能关掉它；菜单内部按下不许误关（真机鼠标事件顺序）', async () => {
    // ⚠️ 必须 attachTo：这条锁的是挂在 `document` 上的"点外面关闭"，
    // 不挂进文档的话 pointerdown 根本冒泡不到 document（那样这条锁会假绿）。
    const wrapper = mount(ProjectTree, {
      props: { parents: makeParents(), parentDuties: { ...dutiesProps } },
      attachTo: document.body
    })
    try {
      await wrapper.findAll('[data-testid="parent-duty-pill"]')[0].trigger('click')

      // ① 菜单**内部**按下：不许关 —— 否则后续的 click 会落空（选项就选不中了）。
      // 真实鼠标顺序：pointerdown 先冒泡到 document，click 才到按钮上。
      const option = wrapper.find('[data-testid="parent-duty-option-supervised"]')
      await option.trigger('pointerdown')
      expect(wrapper.find('[data-testid="parent-duty-menu"]').exists()).toBe(true)

      await option.trigger('click')
      expect(wrapper.emitted('setDuties')![0]).toEqual(['p1', ['proofread', 'supervised']])
      expect(wrapper.find('[data-testid="parent-duty-menu"]').exists()).toBe(true)

      // ② 点**外面**（另一行的标题区）：必须关。
      // ⚠️ 注意"外面"的边界是**整个槽**（胶囊 + 菜单），不是"只有菜单"：
      // 点另一行的**胶囊**不算外面 —— 那一下会把菜单切到那一行（toggle 的语义），
      // 所以这里拿"行本身"当靶子。
      await wrapper.findAll('.font-bold')[1].trigger('pointerdown')
      expect(wrapper.find('[data-testid="parent-duty-menu"]').exists()).toBe(false)
    } finally {
      wrapper.unmount()
    }
  })

  it('再点一次胶囊就收起（点槽外能关、点胶囊也能关，两者都要）', async () => {
    // 2026-10-03：上一轮修"点外面关闭"时把守卫写成"只排除菜单"，于是点胶囊会
    // 先被 pointerdown 关掉、再被 click 打开 ⇒ **永远关不掉**。这条锁就是那次回归。
    const wrapper = mount(ProjectTree, {
      props: { parents: makeParents(), parentDuties: { ...dutiesProps } },
      attachTo: document.body
    })
    try {
      const chip = () => wrapper.findAll('[data-testid="parent-duty-pill"]')[0]
      await chip().trigger('click')
      expect(wrapper.find('[data-testid="parent-duty-menu"]').exists()).toBe(true)

      // 真实鼠标：先 pointerdown（现在它在"槽"内 ⇒ 不许动菜单），再 click（由 toggle 收起）
      await chip().trigger('pointerdown')
      expect(
        wrapper.find('[data-testid="parent-duty-menu"]').exists(),
        'pointerdown 落在胶囊上时不许把菜单关掉（否则 click 又会把它打开）'
      ).toBe(true)

      await chip().trigger('click')
      expect(wrapper.find('[data-testid="parent-duty-menu"]').exists()).toBe(false)
    } finally {
      wrapper.unmount()
    }
  })

  it('职责菜单打开时，那一行被抬到其他项目之上（否则菜单会被下面的行盖住）', async () => {
    const wrapper = mount(ProjectTree, {
      props: { parents: makeParents(), parentDuties: { p1: ['proofread'] } }
    })

    // 关闭时不该有多余的层级（不然吸顶/选中态的层级会乱）
    expect(wrapper.findAll('.font-bold')[0].classes()).not.toContain('z-30')

    await wrapper.findAll('[data-testid="parent-duty-pill"]')[0].trigger('click')

    // 打开的那一行抬起来；它的邻居不受影响
    expect(wrapper.findAll('.font-bold')[0].classes()).toContain('z-30')
    expect(wrapper.findAll('.font-bold')[1].classes()).not.toContain('z-30')
  })
})


describe('responsibilities stay separate from work mode', () => {
  it('clicking a colored duty opens its editor, without switching mode or opening the project', async () => {
    const wrapper = mount(ProjectTree, {
      props: {
        parents: makeParents(),
        parentDuties: { p1: ['translated', 'proofread'], p2: ['typeset'] },
        parentModes: { p1: 'proofread', p2: 'typeset' }
      }
    })
    const slots = wrapper.findAll('[data-testid="parent-duty-slot"]')
    await slots[0].get('[data-testid="parent-duty-translated"]').trigger('click')
    expect(wrapper.find('[data-testid="parent-duty-menu"]').exists()).toBe(true)
    expect(wrapper.emitted('switchMode')).toBeUndefined()
    expect(wrapper.emitted('expand')).toBeUndefined()
    expect(wrapper.emitted('setDuties')).toBeUndefined()
    await wrapper.get('[data-testid="parent-duty-option-translated"]').trigger('click')
    expect(wrapper.emitted('setDuties')).toEqual([['p1', ['proofread']]])
    expect(slots[1].get('[data-testid="parent-duty-typeset"]').text()).toBe('嵌字')
  })

  it('keeps all assigned duty labels when the host changes mode or disables a mode', async () => {
    const wrapper = mount(ProjectTree, {
      props: {
        parents: makeParents(),
        parentDuties: { p1: ['typeset', 'translated'], p2: ['proofread', 'supervised'] },
        parentModes: { p1: 'typeset', p2: 'proofread' }
      }
    })
    const labels = () => wrapper.findAll('[data-duty-mode]').map(node => ({
      role: node.attributes('data-duty-mode'),
      text: node.text()
    }))
    const before = labels()
    expect(before).toEqual([
      { role: 'typeset', text: '嵌字' }, { role: 'translated', text: '翻译' },
      { role: 'proofread', text: '校对' }, { role: 'supervised', text: '监修' }
    ])
    await wrapper.setProps({ parentModes: { p1: 'translated', p2: 'supervised' }, enabledModes: ['typeset'] })
    expect(labels()).toEqual(before)
    // These are assignment labels, not disabled mode-switch controls.
    expect(wrapper.get('[data-testid="parent-duty-pill"]').attributes('disabled')).toBeUndefined()
    await wrapper.get('[data-testid="parent-duty-translated"]').trigger('click')
    expect(wrapper.find('[data-testid="parent-duty-menu"]').exists()).toBe(true)
    expect(wrapper.emitted('switchMode')).toBeUndefined()
  })

  it('chapter marking and statistics use the current parent mode even outside its assigned duties', async () => {
    setActivePinia(createPinia())
    const wrapper = mount(ProjectTree, {
      props: {
        parents: makeParents(),
        mode: 'typeset',
        parentDuties: { p1: ['translated', 'proofread'] },
        parentModes: { p1: 'supervised' }
      },
      attachTo: document.body
    })
    await wrapper.findAll('button[aria-label="展开子项目"]')[0].trigger('click')
    const row = wrapper.get('[data-child-id="c1"]')
    const dutyLabels = () => wrapper.get('[data-parent-id="p1"]')
      .findAll('[data-duty-mode]').map(label => label.text())
    expect(dutyLabels()).toEqual(['翻译', '校对'])

    // Activate the actual chapter menu and its item, not a synthetic parent emit.
    const markFromMenu = async (label: string) => {
      await row.get('.chapter-actions').trigger('keydown', { key: 'Enter' })
      await flushPromises()
      const action = wrapper.findAllComponents(DropdownMenuItem).find(item => item.text() === label)
      expect(action, `Missing chapter action: ${label}`).toBeTruthy()
      await action!.trigger('click')
      await flushPromises()
    }
    await markFromMenu('标记已监修')
    expect(wrapper.emitted('markChildDone')).toEqual([['c1', 'supervised']])

    await row.trigger('contextmenu', { button: 2, clientX: 1, clientY: 1 })
    await flushPromises()
    const statistics = () => wrapper.findAllComponents(StatisticsTimeMenu)
      .find(menu => menu.props('target').childId === 'c1')
    expect(statistics()).toBeTruthy()
    expect(statistics()!.props('mode')).toBe('supervised')

    await wrapper.setProps({ parentModes: { p1: 'translated' } })
    expect(statistics()!.props('mode')).toBe('translated')
    await row.trigger('keydown', { key: 'Escape' })
    await flushPromises()
    await markFromMenu('标记已翻译')
    expect(wrapper.emitted('markChildDone')).toEqual([
      ['c1', 'supervised'], ['c1', 'translated']
    ])
    expect(dutyLabels()).toEqual(['翻译', '校对'])
    expect(wrapper.emitted('setDuties')).toBeUndefined()
    expect(wrapper.emitted('switchMode')).toBeUndefined()
  })

  it('expanding and collapsing only emits disclosure, even when a duty suggests another mode', async () => {
    const wrapper = mount(ProjectTree, {
      props: { parents: makeParents(), mode: 'typeset', parentDuties: { p1: ['translated'] } }
    })
    await wrapper.findAll('button[aria-label="展开子项目"]')[0].trigger('click')
    await wrapper.get('button[aria-label="折叠子项目"]').trigger('click')
    expect(wrapper.emitted('expand')).toEqual([['p1', true], ['p1', false]])
    expect(wrapper.emitted('switchMode')).toBeUndefined()
    expect(wrapper.emitted('setDuties')).toBeUndefined()
  })

  it('has a keyboard-focusable editor trigger and Escape closes without altering duties', async () => {
    const wrapper = mount(ProjectTree, {
      props: { parents: makeParents(), parentDuties: { p1: ['proofread'] } },
      attachTo: document.body
    })
    const trigger = wrapper.get('[data-testid="parent-duty-pill"]')
    expect(trigger.element.tagName).toBe('BUTTON')
    expect(trigger.attributes('type')).toBe('button')
    expect(trigger.attributes('aria-label')).toContain('校对')
    expect(trigger.attributes('aria-haspopup')).toBe('dialog')
    await trigger.trigger('click')
    await flushPromises()
    expect(trigger.attributes('aria-expanded')).toBe('true')
    expect(wrapper.get('[data-testid="parent-duty-option-proofread"]').attributes('aria-pressed')).toBe('true')
    await wrapper.get('[data-testid="parent-duty-menu"]').trigger('keydown', { key: 'Escape' })
    await flushPromises()
    expect(trigger.attributes('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(trigger.element)
    expect(wrapper.find('[data-testid="parent-duty-menu"]').exists()).toBe(false)
    expect(wrapper.emitted('setDuties')).toBeUndefined()
  })

  it('offers 设置职责 for empty duties and keeps editing available after clearing the last one', async () => {
    const wrapper = mount(ProjectTree, { props: { parents: makeParents(), parentDuties: { p1: [] } } })
    const trigger = wrapper.findAll('[data-testid="parent-duty-chip"]')[0]
    expect(trigger.text()).toBe('设置职责')
    await trigger.trigger('click')
    await wrapper.get('[data-testid="parent-duty-option-proofread"]').trigger('click')
    expect(wrapper.emitted('setDuties')?.at(-1)).toEqual(['p1', ['proofread']])
    await wrapper.setProps({ parentDuties: { p1: ['proofread'] } })
    await wrapper.get('[data-testid="parent-duty-option-proofread"]').trigger('click')
    expect(wrapper.emitted('setDuties')?.at(-1)).toEqual(['p1', []])
    await wrapper.setProps({ parentDuties: { p1: [] } })
    expect(wrapper.findAll('[data-testid="parent-duty-chip"]')[0].text()).toBe('设置职责')
    expect(wrapper.find('[data-testid="parent-duty-menu"]').exists()).toBe(true)
  })

  it('opens the same duties editor from 更多操作 → 修改职责 without selection side effects', async () => {
    const wrapper = mount(ProjectTree, {
      props: { parents: makeParents(), parentDuties: { p1: ['proofread'] }, multiSelect: true }
    })
    await selectParentAction(wrapper, '修改职责')
    expect(wrapper.find('[data-testid="parent-duty-menu"]').exists()).toBe(true)
    expect(wrapper.emitted('toggleParentMark')).toBeUndefined()
    expect(wrapper.emitted('expand')).toBeUndefined()
    expect(wrapper.emitted('switchMode')).toBeUndefined()
  })

  it('keeps full long chapter names and progress accessible, and each click selects exactly once', async () => {
    const parents = makeParents()
    const title = '在星海尽头等待那封迟来的信以及从未说出口的漫长告别与再会之约'
    parents[0].children[0].projectTitle = title
    const wrapper = mount(ProjectTree, { props: { parents } })
    await wrapper.findAll('button[aria-label="展开子项目"]')[0].trigger('click')
    const row = wrapper.get('[data-child-id="c1"]')
    const button = row.get('.chapter-main')
    expect(button.attributes('aria-label')).toContain(title)
    expect(button.attributes('aria-label')).toContain('嵌字进度1/2')
    expect(button.get('span').attributes('title')).toContain(title)
    await button.trigger('click')
    await row.get('.chapter-progress').trigger('click')
    expect(wrapper.emitted('select')).toEqual([['p1', 'c1'], ['p1', 'c1']])
    expect(wrapper.emitted('switchMode')).toBeUndefined()
  })
})
