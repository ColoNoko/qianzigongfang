// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import type { DashboardParent } from '@renderer/stores/project'
import { PAIRED_PSD_STATS_VERSION } from '@shared/status'

// --- vue-router mock -------------------------------------------------------
const { mockPush } = vi.hoisted(() => ({ mockPush: vi.fn() }))
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: mockPush })
}))

// Import after mocks are registered.
import Dashboard from '../Dashboard.vue'
import { useAchievementsStore } from '@renderer/stores/achievements'

// --- test data helpers -----------------------------------------------------
/** A PSD stat that is "done" (mtimeMs - ctimeMs > 5 min). */
const DONE_PSD = { mtimeMs: 600_000, ctimeMs: 0 }
/** A PSD stat that is "pending" (not done). */
const PENDING_PSD = { mtimeMs: 0, ctimeMs: 0 }

function makeParent(opts: {
  id: string
  title: string
  children: Array<{
    id: string
    chapterNumber: string
    projectTitle: string
    psdStats: { mtimeMs: number; ctimeMs: number }[]
    lastMtimeMs?: number
  }>
}): DashboardParent {
  return {
    id: opts.id,
    title: opts.title,
    lastMtimeMs: opts.children.reduce((m, c) => Math.max(m, c.lastMtimeMs ?? 0), 0),
    children: opts.children.map((c) => ({
      id: c.id,
      parentTitle: opts.title,
      folderPath: `/tmp/${c.id}`,
      chapterNumber: c.chapterNumber,
      projectTitle: c.projectTitle,
      lastMtimeMs: c.lastMtimeMs ?? 0,
      psdStats: c.psdStats,
      // 引用当前版本号：写死数字会在缓存版本升级时被判定过期而重算。
      statsVersion: PAIRED_PSD_STATS_VERSION
    }))
  }
}

function setupStore(data: unknown): void {
  window.comicType = {
    projectGetTree: vi.fn().mockResolvedValue(data),
    storeGet: vi.fn().mockResolvedValue(undefined),
    projectSaveProgress: vi.fn().mockResolvedValue(undefined),
    scanChildProject: vi.fn().mockResolvedValue({
      jpgPairs: [
        {
          jpgPath: '/tmp/page.jpg',
          psd: {
            absPath: '/tmp/page.psd',
            mtimeMs: Date.now(),
            ctimeMs: Date.now() - 600_000,
            status: 'done'
          }
        }
      ],
      txtFiles: [],
      errors: []
    })
  } as unknown as typeof window.comicType
}

async function mountDashboard() {
  const pinia = createPinia()
  setActivePinia(pinia)
  const wrapper = mount(Dashboard, { global: { plugins: [pinia] } })
  await flushPromises()
  return wrapper
}

beforeEach(() => {
  mockPush.mockReset()
})

describe('Dashboard', () => {
  it('empty registry shows the 添加项目 CTA', async () => {
    setupStore([])
    const wrapper = await mountDashboard()
    expect(wrapper.find('[data-testid="add-project-cta"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="focus-card"]').exists()).toBe(false)
  })

  it('recent card shows parent title + formatted chapter; clicking navigates to project route', async () => {
    const parent = makeParent({
      id: 'p1',
      title: 'ドラゴンボール',
      children: [
        {
          id: 'c1',
          chapterNumber: '第1話',
          projectTitle: 'vol1',
          psdStats: [DONE_PSD, PENDING_PSD],
          lastMtimeMs: 1000
        }
      ]
    })
    setupStore([parent])
    const wrapper = await mountDashboard()

    const card = wrapper.find('[data-testid="recent-project-card"]')
    expect(card.exists()).toBe(true)
    expect(card.text()).toContain('ドラゴンボール')
    expect(card.text()).toContain('第1集')

    await card.trigger('click')
    expect(mockPush).toHaveBeenCalledWith(
      '/project/' + encodeURIComponent('ドラゴンボール') + '/c1'
    )
  })

  it('done children appear in the 已完成项目 column with PSD counts', async () => {
    const parent = makeParent({
      id: 'p1',
      title: 'ワンピース',
      children: [
        { id: 'c1', chapterNumber: '第1話', projectTitle: 'v1', psdStats: [DONE_PSD] },
        { id: 'c2', chapterNumber: '第2話', projectTitle: 'v2', psdStats: [DONE_PSD, DONE_PSD] }
      ]
    })
    setupStore([parent])
    const wrapper = await mountDashboard()

    const section = wrapper.find('[data-testid="completed-section"]')
    expect(section.exists()).toBe(true)
    expect(section.findAll('li')).toHaveLength(2)
    expect(section.text()).toContain('ワンピース')
    expect(section.text()).toContain('2 PSD')
  })

  it('child with pct=0 appears in 待嵌字项目 column with PSD count', async () => {
    const parent = makeParent({
      id: 'p1',
      title: 'ナルト',
      children: [{ id: 'c1', chapterNumber: '第1話', projectTitle: 'v1', psdStats: [PENDING_PSD] }]
    })
    setupStore([parent])
    const wrapper = await mountDashboard()

    const section = wrapper.find('[data-testid="pending-section"]')
    expect(section.exists()).toBe(true)
    expect(section.findAll('li')).toHaveLength(1)
    expect(section.text()).toContain('第1集')
    expect(section.text()).toContain('1 PSD')
  })

  it('shows achievement summary cards at the bottom', async () => {
    const parent = makeParent({
      id: 'p1',
      title: 'ナルト',
      children: [{ id: 'c1', chapterNumber: '第1話', projectTitle: 'v1', psdStats: [DONE_PSD] }]
    })
    setupStore([parent])
    const wrapper = await mountDashboard()
    await flushPromises()

    expect(wrapper.find('[data-testid="dashboard-achievements"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="dashboard-month-count"]').text()).toContain('当月嵌字数量')
    expect(wrapper.find('[data-testid="dashboard-year-count"]').text()).toContain('当年嵌字数量')
    expect(wrapper.find('[data-testid="dashboard-total-count"]').text()).toContain('总嵌字数量')
  })

  it('uses a three-column recent-project grid when three projects are available', async () => {
    const parent = makeParent({
      id: 'p1',
      title: '龙珠',
      children: [1, 2, 3].map((number) => ({
        id: `c${number}`,
        chapterNumber: String(number),
        projectTitle: `v${number}`,
        psdStats: [PENDING_PSD],
        lastMtimeMs: number
      }))
    })
    setupStore([parent])
    const wrapper = await mountDashboard()

    expect(wrapper.findAll('[data-testid="recent-project-card"]')).toHaveLength(3)
    expect(wrapper.find('[data-testid="recent-projects"] .grid').classes()).toContain('grid-cols-3')
  })

  it('uses two independent status cards that fill the remaining height', async () => {
    const parent = makeParent({
      id: 'p1',
      title: '龙珠',
      children: [
        { id: 'c1', chapterNumber: '1', projectTitle: '完成', psdStats: [DONE_PSD] },
        { id: 'c2', chapterNumber: '2', projectTitle: '待办', psdStats: [PENDING_PSD] }
      ]
    })
    setupStore([parent])
    const wrapper = await mountDashboard()

    const status = wrapper.get('[data-testid="status-overview-section"]')
    expect(status.classes()).toContain('flex-1')
    expect(status.classes()).toContain('grid-cols-2')
    expect(wrapper.get('[data-testid="completed-section"]').classes()).toContain('bg-card-bg')
    expect(wrapper.get('[data-testid="pending-section"]').classes()).toContain('bg-card-bg')
  })
})

/**
 * 首页「统计模式」（第十五轮 B1）。
 *
 * 以前首页写死嵌字口径（`computeProgress(child.psdStats)`），而侧栏/工作台/成就页都跟模式 ——
 * 切到监修时首页和侧栏说的不是一回事。现在首页走**侧栏用的同一个函数** `childModeProgress`，
 * 并且与「成就」页共用同一个模式（改一处两页一起变）。
 */
describe('Dashboard 统计模式', () => {
  function mountDashboard(): ReturnType<typeof mount> {
    const pinia = createPinia()
    setActivePinia(pinia)
    return mount(Dashboard, { global: { plugins: [pinia] } })
  }

  function oneChildWithHalfSupervised(): DashboardParent {
    const parent = makeParent({
      id: 'p1',
      title: 'ドラゴンボール',
      children: [
        {
          id: 'c1',
          chapterNumber: '第1集',
          projectTitle: 'vol1',
          psdStats: [DONE_PSD, DONE_PSD]
        }
      ]
    })
    // 嵌字：2/2 完成；监修：只标了 1/2（这就是"两个口径"的分叉点）
    parent.children[0].psdModeStats = {
      typeset: [],
      translated: [],
      proofread: [],
      supervised: [{ mtimeMs: 600_000, ctimeMs: 0 }]
    }
    return parent
  }

  it('默认嵌字口径：2/2 的那一话出现在「已完成项目」', async () => {
    setupStore([oneChildWithHalfSupervised()])
    const wrapper = mountDashboard()
    await flushPromises()

    expect(wrapper.get('[data-testid="completed-section"]').text()).toContain('第1集')
    expect(wrapper.get('[data-testid="pending-section"]').text()).toContain('待嵌字项目')
  })

  it('切到监修：进度改从 psdModeStats 取 —— 1/2 就不算完成，列标题也跟着换', async () => {
    setupStore([oneChildWithHalfSupervised()])
    const wrapper = mountDashboard()
    await flushPromises()

    const select = wrapper.findComponent({ name: 'AppSelect' })
    select.vm.$emit('change', 'supervised')
    await flushPromises()

    expect(wrapper.get('[data-testid="completed-section"]').text()).not.toContain('第1集')
    expect(wrapper.get('[data-testid="pending-section"]').text()).toContain('待监修项目')
  })

  it('底部的成就卡片标题跟着模式走（数字本来就跟模式，以前只有标题在骗人）', async () => {
    setupStore([oneChildWithHalfSupervised()])
    const wrapper = mountDashboard()
    await flushPromises()

    expect(wrapper.get('[data-testid="dashboard-month-count"]').text()).toContain('当月嵌字数量')

    wrapper.findComponent({ name: 'AppSelect' }).vm.$emit('change', 'proofread')
    await flushPromises()

    expect(wrapper.get('[data-testid="dashboard-month-count"]').text()).toContain('当月校对数量')
    expect(wrapper.get('[data-testid="dashboard-total-count"]').text()).toContain('总校对数量')
    // 卡片里那行小字以前也写死"嵌字项目数"
    expect(wrapper.get('[data-testid="dashboard-month-count"]').text()).toContain('校对项目数')
  })

  it('模式下拉存在且与成就页共用同一个模式（选完两页一致）', async () => {
    setupStore([oneChildWithHalfSupervised()])
    const wrapper = mountDashboard()
    await flushPromises()

    expect(wrapper.find('[data-testid="dashboard-mode-select"]').exists()).toBe(true)

    wrapper.findComponent({ name: 'AppSelect' }).vm.$emit('change', 'supervised')
    await flushPromises()

    const achievements = useAchievementsStore()
    expect(achievements.selectedMode).toBe('supervised')
  })
})
