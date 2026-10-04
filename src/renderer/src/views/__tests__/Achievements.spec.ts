// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import type { DashboardParent } from '@renderer/stores/project'
import type { ChildMarkStatistics } from '@shared/ipc-api'

/**
 * 「四个模式都给了数组」这份契约的**测试侧底稿**（2026-10-01 第一批 A3）。
 * 原本是 `shared/mark-stats.ts` 里只被测试使用的导出，已搬进测试文件。
 */
function emptyCompletedTimestamps(): ChildMarkStatistics['completedTimestamps'] {
  return { typeset: [], translated: [], proofread: [], supervised: [] }
}

// --- echarts mock -----------------------------------------------------------
// ECharts cannot run in jsdom (no canvas dimensions). Mock init to return
// a stub chart instance with the methods the component calls.
const { mockSetOption } = vi.hoisted(() => ({
  mockSetOption: vi.fn()
}))
vi.mock('echarts', () => ({
  init: vi.fn(() => ({
    setOption: mockSetOption,
    resize: vi.fn(),
    dispose: vi.fn()
  }))
}))

// --- useProjectStore mock ---------------------------------------------------
// vi.hoisted ensures the mutable array exists before the mock factory runs.
const { mockProjects, mockLoadProjects, mockMarkStatistics } = vi.hoisted(() => ({
  mockProjects: [] as DashboardParent[],
  mockLoadProjects: vi.fn().mockResolvedValue(undefined),
  // 第十五轮起成就只吃**标记记录**（memoryMarkStatistics），不再吃项目树里的 psdStats。
  mockMarkStatistics: [] as ChildMarkStatistics[]
}))

vi.mock('@renderer/stores/project', () => ({
  useProjectStore: () => ({
    projects: mockProjects,
    loadProjects: mockLoadProjects
  })
}))

// Import after mocks are registered.
import Achievements from '../Achievements.vue'
import { useAchievementsStore } from '@renderer/stores/achievements'
import { useThemeStore } from '@renderer/stores/theme'

// --- test data helpers ------------------------------------------------------
/** A PSD stat that is "done" (mtimeMs - ctimeMs > 5 min). */
const DONE_STAT = { mtimeMs: 600_000, ctimeMs: 0 }
/** A PSD stat that is "pending" (not done). */
const PENDING_STAT = { mtimeMs: 1000, ctimeMs: 0 }

function makeParent(opts: {
  id: string
  title: string
  children: Array<{ id: string; folderPath: string; chapterNumber: string; projectTitle: string }>
}): DashboardParent {
  return {
    id: opts.id,
    title: opts.title,
    lastMtimeMs: 0,
    children: opts.children.map((c) => ({
      id: c.id,
      parentTitle: opts.title,
      folderPath: c.folderPath,
      chapterNumber: c.chapterNumber,
      projectTitle: c.projectTitle,
      lastMtimeMs: 0,
      psdStats: []
    }))
  }
}

/**
 * 把"这个目录里有哪些文件、标成了什么状态"翻译成两样东西：
 *   · 项目树里的 psdStats（老的磁盘口径，仍然给侧栏/工作台用）；
 *   · **标记记录**（`mockMarkStatistics`）—— 成就页现在只吃这一份。
 * 两者都由同一个输入派生，所以测试读起来还是"这个目录有 2 个 PSD、都标完了"。
 */
function recordStatisticsFor(
  childId: string,
  folderPath: string,
  entries: { name: string; isDirectory: boolean; absPath: string }[],
  stat: typeof DONE_STAT
): ChildMarkStatistics {
  const files = entries.filter((entry) => entry.name.toLowerCase().endsWith('.psd'))
  const done = stat.mtimeMs - stat.ctimeMs > 5 * 60 * 1000
  return {
    childId,
    folderPath,
    fileCount: files.length,
    completedTimestamps: {
      ...emptyCompletedTimestamps(),
      typeset: done ? files.map(() => stat.mtimeMs) : []
    }
  }
}

function setupComicType(
  entries: { name: string; isDirectory: boolean; absPath: string }[],
  stat: typeof DONE_STAT
): void {
  const stats = entries
    .filter((entry) => entry.name.toLowerCase().endsWith('.psd'))
    .map(() => ({ mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs }))
  for (const parent of mockProjects) {
    for (const child of parent.children) {
      child.psdStats = stats.map((item) => ({ ...item }))
      mockMarkStatistics.push(recordStatisticsFor(child.id, child.folderPath, entries, stat))
    }
  }
  window.comicType = {
    memoryMarkStatistics: vi.fn(() => Promise.resolve([...mockMarkStatistics])),
    scanChildProject: vi.fn().mockResolvedValue({
      jpgPairs: entries
        .filter((entry) => entry.name.toLowerCase().endsWith('.psd'))
        .map((entry) => ({
          jpgPath: entry.absPath.replace(/\.psd$/i, '.jpg'),
          psd: {
            absPath: entry.absPath,
            mtimeMs: stat.mtimeMs,
            ctimeMs: stat.ctimeMs,
            status: stat.mtimeMs - stat.ctimeMs > 5 * 60 * 1000 ? 'done' : 'pending'
          }
        })),
      txtFiles: [],
      errors: []
    })
  } as unknown as typeof window.comicType
}

beforeEach(() => {
  mockProjects.length = 0
  mockMarkStatistics.length = 0
  mockLoadProjects.mockClear()
  mockSetOption.mockClear()
})

describe('Achievements', () => {
  it('renders chart container and total count when done PSDs exist', async () => {
    const parent = makeParent({
      id: 'p1',
      title: 'ドラゴンボール',
      children: [
        { id: 'c1', folderPath: '/tmp/child1', chapterNumber: '第1話', projectTitle: 'vol1' }
      ]
    })
    mockProjects.push(parent)

    setupComicType(
      [
        { name: 'page1.psd', isDirectory: false, absPath: '/tmp/child1/page1.psd' },
        { name: 'page2.psd', isDirectory: false, absPath: '/tmp/child1/page2.psd' },
        { name: 'notpsd.txt', isDirectory: false, absPath: '/tmp/child1/notpsd.txt' }
      ],
      DONE_STAT
    )

    const pinia = createPinia()
    setActivePinia(pinia)
    const wrapper = mount(Achievements, { global: { plugins: [pinia] } })
    await flushPromises()

    expect(wrapper.find('[data-testid="chart-container"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="total-count"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="total-count"]').text()).toContain('2')
    expect(wrapper.find('[data-testid="total-count"]').text()).toContain('嵌字项目数: 1')
    expect(wrapper.find('[data-testid="empty-state"]').exists()).toBe(false)
    expect(window.comicType.scanChildProject).not.toHaveBeenCalled()
  })

  it('shows empty state when zero done PSDs', async () => {
    const parent = makeParent({
      id: 'p1',
      title: 'ドラゴンボール',
      children: [
        { id: 'c1', folderPath: '/tmp/child1', chapterNumber: '第1話', projectTitle: 'vol1' }
      ]
    })
    mockProjects.push(parent)

    setupComicType(
      [{ name: 'page1.psd', isDirectory: false, absPath: '/tmp/child1/page1.psd' }],
      PENDING_STAT
    )

    const pinia = createPinia()
    setActivePinia(pinia)
    const wrapper = mount(Achievements, { global: { plugins: [pinia] } })
    await flushPromises()

    expect(wrapper.find('[data-testid="empty-state"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="empty-state"]').text()).toContain('暂无成就数据')
    expect(wrapper.find('[data-testid="chart-container"]').exists()).toBe(false)
  })

  it('refresh button calls store refresh action', async () => {
    const parent = makeParent({
      id: 'p1',
      title: 'ドラゴンボール',
      children: [
        { id: 'c1', folderPath: '/tmp/child1', chapterNumber: '第1話', projectTitle: 'vol1' }
      ]
    })
    mockProjects.push(parent)

    setupComicType(
      [{ name: 'page1.psd', isDirectory: false, absPath: '/tmp/child1/page1.psd' }],
      DONE_STAT
    )

    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useAchievementsStore()
    const refreshSpy = vi.spyOn(store, 'refresh')

    const wrapper = mount(Achievements, { global: { plugins: [pinia] } })
    await flushPromises()

    // Initial mount called refresh once.
    expect(refreshSpy).toHaveBeenCalledTimes(1)

    // Click the refresh button — should call refresh again.
    refreshSpy.mockClear()
    await wrapper.find('[data-testid="refresh-btn"]').trigger('click')
    expect(refreshSpy).toHaveBeenCalledTimes(1)
  })

  it('renders year/month view mode controls', async () => {
    setupComicType([], PENDING_STAT)

    const pinia = createPinia()
    setActivePinia(pinia)
    const wrapper = mount(Achievements, { global: { plugins: [pinia] } })
    await flushPromises()

    expect(wrapper.find('[data-testid="achievement-year-mode"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="achievement-month-mode"]').exists()).toBe(true)
  })

  it('uses high-contrast chart axes and labels in night mode', async () => {
    const parent = makeParent({
      id: 'p1',
      title: '漫画',
      children: [{ id: 'c1', folderPath: '/tmp/c1', chapterNumber: '1', projectTitle: '第一集' }]
    })
    parent.children[0].psdStats = [{ ...DONE_STAT }]
    mockProjects.push(parent)
    setupComicType(
      [{ name: 'page1.psd', isDirectory: false, absPath: '/tmp/c1/page1.psd' }],
      DONE_STAT
    )

    const pinia = createPinia()
    setActivePinia(pinia)
    useThemeStore().setTheme('dark')
    mount(Achievements, { global: { plugins: [pinia] } })
    await flushPromises()

    const option = mockSetOption.mock.calls.at(-1)?.[0]
    // 意图不变：夜间的坐标轴与标签必须是"高对比度"颜色。机制变了 —— 它们不再
    // 写死灰值，而是直接取主题 token（--fg-muted / --fg）。这里按 themeVariable
    // 的同一条规则取值：读得到就用读到的，读不到才落回 fallback。
    // 谁把图表颜色改回硬编码，这条就会红。
    const themed = (name: string, fallback: string): string =>
      getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
    expect(option.xAxis.axisLabel.color).toBe(themed('--fg-muted', '#d0d0d0'))
    expect(option.legend.textStyle.color).toBe(themed('--fg', '#f2f2f2'))
    expect(option.series[0].label.color).toBe(themed('--fg', '#f2f2f2'))
  })

  it('成就只吃标记记录：**把磁盘上的图删了，历史也不掉**（第十五轮的核心）', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useAchievementsStore()
    const parent = makeParent({
      id: 'p1',
      title: 'ドラゴンボール',
      children: [
        { id: 'c1', folderPath: '/tmp/child1', chapterNumber: '第1話', projectTitle: 'vol1' }
      ]
    })
    mockProjects.push(parent)
    // 记录里这一话标完了 2 张
    mockMarkStatistics.push({
      childId: 'c1',
      folderPath: '/tmp/child1',
      fileCount: 2,
      completedTimestamps: { ...emptyCompletedTimestamps(), typeset: [600_000, 700_000] }
    })
    ;(window as unknown as { comicType: unknown }).comicType = {
      memoryMarkStatistics: vi.fn(() => Promise.resolve([...mockMarkStatistics])),
      scanChildProject: vi.fn()
    } as unknown as typeof window.comicType

    await store.refresh()
    expect(store.total).toBe(2)
    expect(store.totalProjectCount).toBe(1)

    // 现在把"磁盘上的图"清空（删图 / 挪走）：项目树里那一话什么也不剩 ——
    // 老版本到这里历史就缩水成 0 了。
    parent.children[0].psdStats = []
    await store.refresh()
    expect(store.total).toBe(2)
    expect(store.totalProjectCount).toBe(1)
    expect(window.comicType.scanChildProject).not.toHaveBeenCalled()
  })

  it('取消标记会让数字掉下去；只标了一半的纪录不算"整话完成"', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useAchievementsStore()
    ;(window as unknown as { comicType: unknown }).comicType = {
      memoryMarkStatistics: vi.fn(() => Promise.resolve([...mockMarkStatistics])),
      scanChildProject: vi.fn()
    } as unknown as typeof window.comicType

    // 三张里只完成一张 → 计入完成条目，但不算"整话完成"
    mockMarkStatistics.push({
      childId: 'c1',
      folderPath: '/tmp/c1',
      fileCount: 3,
      completedTimestamps: { ...emptyCompletedTimestamps(), typeset: [600_000] }
    })
    await store.refresh()
    expect(store.total).toBe(1)
    expect(store.totalProjectCount).toBe(0)

    // 全部取消标记 → 全掉
    mockMarkStatistics[0].completedTimestamps.typeset = []
    await store.refresh()
    expect(store.total).toBe(0)
    expect(store.totalProjectCount).toBe(0)
  })

  it('切模式用缓存重算（不再跑 IPC），且各模式互不干扰', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useAchievementsStore()
    const memoryMarkStatistics = vi.fn(() =>
      Promise.resolve([
        {
          childId: 'c1',
          folderPath: '/tmp/c1',
          fileCount: 1,
          completedTimestamps: {
            ...emptyCompletedTimestamps(),
            typeset: [600_000],
            supervised: [800_000, 900_000]
          }
        }
      ])
    )
    ;(window as unknown as { comicType: unknown }).comicType = {
      memoryMarkStatistics,
      scanChildProject: vi.fn()
    } as unknown as typeof window.comicType

    await store.refresh()
    expect(store.total).toBe(1)

    store.setSelectedMode('supervised')
    expect(store.total).toBe(2)
    expect(memoryMarkStatistics).toHaveBeenCalledTimes(1)
  })

  it('"整话完成"按话计（同一父级下两话算两个），与父级数量无关', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useAchievementsStore()
    mockMarkStatistics.push(
      {
        childId: 'c1',
        folderPath: '/tmp/c1',
        fileCount: 1,
        completedTimestamps: { ...emptyCompletedTimestamps(), typeset: [600_000] }
      },
      {
        childId: 'c2',
        folderPath: '/tmp/c2',
        fileCount: 1,
        completedTimestamps: { ...emptyCompletedTimestamps(), typeset: [700_000] }
      }
    )
    mockProjects.push(
      makeParent({
        id: 'p1',
        title: '同一部漫画',
        children: [
          { id: 'c1', folderPath: '/tmp/c1', chapterNumber: '1', projectTitle: 'c1' },
          { id: 'c2', folderPath: '/tmp/c2', chapterNumber: '2', projectTitle: 'c2' }
        ]
      })
    )
    ;(window as unknown as { comicType: unknown }).comicType = {
      memoryMarkStatistics: vi.fn(() => Promise.resolve([...mockMarkStatistics])),
      scanChildProject: vi.fn()
    } as unknown as typeof window.comicType

    await store.refresh()

    expect(store.total).toBe(2)
    expect(store.totalProjectCount).toBe(2)
  })

  it('runs silent refresh every five minutes without overlapping', async () => {
    vi.useFakeTimers()
    window.comicType = {
      storeGet: vi.fn().mockResolvedValue(undefined),
      scanChildProject: vi.fn()
    } as unknown as typeof window.comicType
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useAchievementsStore()
    const refreshSpy = vi.spyOn(store, 'refresh').mockResolvedValue(undefined)

    store.startSilentRefresh()
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000)
    expect(refreshSpy).toHaveBeenCalledTimes(1)

    store.loading = true
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000)
    expect(refreshSpy).toHaveBeenCalledTimes(1)
    store.stopSilentRefresh()
    vi.useRealTimers()
  })
})
