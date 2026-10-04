// @vitest-environment jsdom
/**
 * 截图检查：工作台的三块"表面" —— 缩略图卡片、侧栏/项目树、进度条。
 *
 * 为什么单独建这一份：`sidebar-modes` 与 `project-index` 只截了树与项目页，
 * 而本轮改的恰恰是**卡片的媒体底、悬停/选中态、进度条填充**（交接文档 §15.3
 * 已经写明"选中态没有任何截图覆盖"）。没有这张图，改配色只能靠肉眼看代码。
 *
 * 顺带当色板用：面板 4 直接摆出各层表面色与四种状态的色块，
 * 对比度复核时按这张图取色即可。
 *
 *   pnpm run build && node_modules\.bin\vitest.CMD run --config vitest.visual.config.ts
 *   → <工作区>/temp/visual/workbench/{dark,light}.png
 */
import { describe, it, vi } from 'vitest'
import { defineComponent, h, watch, type PropType } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { shoot } from './panel-harness'
import type { JpgPsdPair, ParentProject } from '@shared/types'
import { DONE_OFFSET_MS, PAIRED_PSD_STATS_VERSION } from '@shared/status'

// Project.vue 读路由参数来取当前话；页头/页脚面板要挂真实组件，所以这里按
// Project.spec 的做法只 mock useRoute/useRouter。
const { mockRoute } = vi.hoisted(() => ({
  mockRoute: { params: { parentTitle: '町野さん', childId: 'c1' } }
}))
vi.mock('vue-router', () => ({
  useRoute: () => mockRoute,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() })
}))

import ThumbGrid from '@renderer/components/ThumbGrid.vue'
import ProjectSidebar from '@renderer/components/ProjectSidebar.vue'
import FooterBar from '@renderer/components/FooterBar.vue'
import Project from '@renderer/views/Project.vue'
import Dashboard from '@renderer/views/Dashboard.vue'
import { useProjectWorkspace } from '@renderer/stores/projectWorkspace'

/** 一张"漫画页"占位图（纯 SVG，不引用任何真实作品）。
 *  刻意用中性灰：这张面板是用来判断"卡片本身长什么样"的，
 *  如果占位图自带颜色，就会把配色的判断带偏。 */
function fakePage(label: string, tint: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="162" height="212" viewBox="0 0 162 212">
  <rect width="162" height="212" fill="#ffffff"/>
  <rect x="6" y="6" width="150" height="96" fill="${tint}" opacity="0.35"/>
  <rect x="6" y="110" width="150" height="46" fill="${tint}" opacity="0.2"/>
  <rect x="6" y="164" width="150" height="42" fill="${tint}" opacity="0.35"/>
  <text x="81" y="60" font-family="sans-serif" font-size="13" fill="#333" text-anchor="middle">${label}</text>
</svg>`
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

function makeItems(): Array<{
  id: string
  filename: string
  thumbUrl: string | null
  mtimeText: string
  status: 'done' | 'pending' | 'none'
}> {
  return [
    { id: '1', filename: '01.jpg', thumbUrl: fakePage('01', '#6f6f6f'), mtimeText: '2026/8/14', status: 'done' },
    { id: '2', filename: '02.jpg', thumbUrl: fakePage('02', '#6f6f6f'), mtimeText: '2026/8/14', status: 'pending' },
    { id: '3', filename: '03.jpg', thumbUrl: fakePage('03', '#6f6f6f'), mtimeText: '2026/8/14', status: 'pending' },
    { id: '4', filename: '04.jpg', thumbUrl: fakePage('04', '#6f6f6f'), mtimeText: '2026/8/14', status: 'done' },
    { id: '5', filename: '05.jpg', thumbUrl: fakePage('05', '#6f6f6f'), mtimeText: '2026/8/14', status: 'pending' },
    { id: '6', filename: '06.jpg', thumbUrl: null, mtimeText: '2026/8/14', status: 'none' }
  ]
}

function makeParents(): ParentProject[] {
  return [
    {
      id: 'p1',
      title: '町野さん',
      lastMtimeMs: 3000,
      children: [
        {
          id: 'c1',
          parentTitle: '町野さん',
          folderPath: 'D:\\漫画\\町野さん\\第11集',
          chapterNumber: '第11集',
          projectTitle: '直到你的愿望实现为止',
          lastMtimeMs: 3000,
          // 24 张里 9 张已标记完成：done 用"ctimeMs = mtimeMs - DONE_OFFSET_MS"编码
          // （见 shared/status.ts），写成时间戳才能让进度条真的填起来。
          psdStats: Array.from({ length: 24 }, (_, i) =>
            i < 9
              ? { mtimeMs: 1_700_000_000_000, ctimeMs: 1_700_000_000_000 - DONE_OFFSET_MS }
              : { mtimeMs: 1_700_000_000_000, ctimeMs: 1_700_000_000_000 }
          )
        },
        {
          id: 'c2',
          parentTitle: '町野さん',
          folderPath: 'D:\\漫画\\町野さん\\第10集',
          chapterNumber: '第10集',
          projectTitle: '番外 · 夏日祭',
          lastMtimeMs: 2000,
          psdStats: Array.from({ length: 18 }, () => ({ mtimeMs: 0, ctimeMs: 0 }))
        }
      ]
    },
    { id: 'p2', title: '前女友学姐', lastMtimeMs: 1000, children: [] }
  ]
}

/**
 * 24 张图、其中 9 张已标记完成 —— 页脚的进度条因此不是 0% 也不是 100%，
 * 能同时看出"已完成的部分"和"还剩多少"。
 */
function makePairs(): JpgPsdPair[] {
  return Array.from({ length: 24 }, (_, i) => ({
    jpgPath: `D:\\漫画\\町野さん\\第11集\\${String(i + 1).padStart(2, '0')}.jpg`,
    psd: {
      absPath: `D:\\漫画\\町野さん\\第11集\\${String(i + 1).padStart(2, '0')}.psd`,
      mtimeMs: 1_700_000_000_000,
      ctimeMs:
        i < 9 ? 1_700_000_000_000 - DONE_OFFSET_MS : 1_700_000_000_000,
      status: i < 9 ? ('done' as const) : ('pending' as const),
      // 页头/页脚走的是 computeModeCounts()，它读的是 modes.typeset —— 不是时间戳
      // （时间戳只有 isTypesetDone 那条老路径用）。两个都得写对，数字才是 9/24。
      modes: {
        typeset: i < 9,
        translated: false,
        proofread: false,
        supervised: false
      }
    }
  }))
}

/** 把第 1、4 张卡片点成选中态：截图要能看出"选中 ≠ 悬停"。 */
async function mountGridWithSelection() {  const wrapper = mount(ThumbGrid, { props: { items: makeItems() } })
  const el = wrapper.vm.scrollContainer as HTMLElement
  Object.defineProperty(el, 'clientWidth', { value: 560, configurable: true })
  Object.defineProperty(el, 'clientHeight', { value: 560, configurable: true })
  Object.defineProperty(el, 'scrollTop', { value: 0, configurable: true })
  wrapper.vm.measureAndLoad()
  await wrapper.vm.$nextTick()
  const cards = wrapper.findAll('.thumb-card')
  await cards[0].trigger('click')
  await cards[3].trigger('click', { ctrlKey: true })
  await wrapper.vm.$nextTick()
  return wrapper
}

/**
 * 缩略图列表的桩：挂载后自动选中前 3 张卡片，让页头的「标记嵌字 / 标记未嵌字」
 * 呈现**可用**状态 —— 否则两个按钮都是 disabled（40% 透明），截出来的颜色
 * 并不是真实观感。
 */
const ProjectThumbListStub = defineComponent({
  name: 'ProjectThumbList',
  props: {
    pairs: { type: Array as PropType<JpgPsdPair[]>, default: () => [] }
  },
  emits: ['selectionChange'],
  setup(props, { emit }) {
    watch(
      () => props.pairs.length,
      () => {
        if (props.pairs.length > 0) emit('selectionChange', props.pairs.slice(0, 3))
      },
      { immediate: true }
    )
    return () => h('div', { class: 'thumb-list-stub' })
  }
})

describe('workbench surfaces', () => {
  it('renders the thumbnail grid, the sidebar/tree and both progress-bar states', async () => {
    setActivePinia(createPinia())

    const grid = await mountGridWithSelection()

    const sidebar = mount(ProjectSidebar, {
      props: {
        parents: makeParents(),
        loading: false,
        activeChildId: 'c2',
        mode: 'typeset'
      }
    })
    // 树默认全收起（§4.4），想截到子行必须自己点开父项目。
    // 点击处理挂在行的内层 div 上（外层只负责拖拽排序），点外层不会展开。
    await sidebar.findAll('[data-parent-id] > div')[0].trigger('click')
    await sidebar.vm.$nextTick()

    const emptyBar = mount(FooterBar, {
      props: { progress: { done: 0, total: 24, pct: 0 }, mode: 'typeset' }
    })
    const filledBar = mount(FooterBar, {
      props: { progress: { done: 15, total: 24, pct: 62.5 }, mode: 'typeset' }
    })

    // 色板：每个 token 只干一件事，这一排就是本轮"Material layer"的对照表。
    const swatches = [
      ['bg 画布', 'var(--bg)'],
      ['bg-raised 面板', 'var(--bg-raised)'],
      ['bg-sunken 凹陷', 'var(--bg-sunken)'],
      ['media-bg 媒体底', 'var(--media-bg)'],
      ['hover-surface 悬停', 'var(--hover-surface)'],
      ['select-surface 选中', 'var(--select-surface)'],
      ['primary 主色', 'var(--primary)'],
      ['done 完成', 'var(--done)'],
      ['border 描边', 'var(--border)'],
      ['hairline 细线', 'var(--hairline)']
    ]
    const palette = `<div style="padding:12px;background:var(--bg-raised);width:100%;height:100%;box-sizing:border-box">
      ${swatches
        .map(
          ([label, value]) =>
            `<div style="display:flex;align-items:center;gap:8px;margin-bottom:7px">
              <span style="width:22px;height:22px;border-radius:6px;border:1px solid var(--border);background:${value}"></span>
              <span style="font-size:11px;color:var(--text-secondary)">${label}</span>
            </div>`
        )
        .join('')}
    </div>`

    const files = await shoot({
      name: 'workbench',
      panels: [
        { label: '缩略图网格（第 1、4 张为选中态）', html: grid.html(), width: 560, height: '340px' },
        { label: '侧栏 + 项目树（展开）', html: sidebar.html(), width: 300, height: '300px' },
        {
          label: '进度条：0/24 与 15/24',
          html: `<div style="padding:12px;background:var(--bg-raised);height:100%;box-sizing:border-box">
            <div style="height:24px">${emptyBar.html()}</div>
            <div style="height:24px;margin-top:12px">${filledBar.html()}</div>
          </div>`,
          width: 320,
          height: '300px'
        },
        { label: 'Material tokens', html: palette, width: 220, height: '300px' }
      ]
    })

    if (files.length !== 2) throw new Error(`预期 dark/light 两张图，实际 ${files.length} 张`)
  })

  it('renders the workbench header toolbar and footer with real components', async () => {
    // 页头/页脚的样式是本轮改动最密集的地方（四级按钮 + 进度条），而它没法脱离
    // 路由与工作区 store 单独挂载。这里照 Project.spec 的做法：把重子组件换成桩，
    // 但 **AppSelect 与 ProjectFooter 用真的** —— 那两块正是要看的东西。
    setActivePinia(createPinia())
    window.comicType = {
      storeGet: vi.fn().mockResolvedValue(null),
      storeSet: vi.fn().mockResolvedValue(undefined),
      projectGetTree: vi.fn().mockResolvedValue([]),
      projectSaveProgress: vi.fn().mockResolvedValue(undefined),
      scanChildProject: vi
        .fn()
        .mockResolvedValue({ jpgPairs: makePairs(), txtFiles: [], errors: [] }),
      listDir: vi.fn().mockResolvedValue([]),
      openPath: vi.fn().mockResolvedValue({ ok: true }),
      pickDirectory: vi.fn().mockResolvedValue(null)
    } as unknown as typeof window.comicType

    const parents = makeParents()
    const workspace = useProjectWorkspace()
    workspace.parents = parents
    workspace.setActiveChild(parents[0].children[0], [])

    const wrapper = mount(Project, {
      global: {
        stubs: {
          'router-link': { template: '<a><slot /></a>', props: ['to'] },
          ProjectSidebar: { name: 'ProjectSidebar', template: '<div />' },
          ProjectThumbList: ProjectThumbListStub,
          CompareViewer: { name: 'CompareViewer', template: '<div />' },
          ProjectFormModal: { name: 'ProjectFormModal', template: '<div />' }
        }
      }
    })
    await flushPromises()
    await wrapper.vm.$nextTick()

    const header = wrapper.find('header')
    if (!header.exists()) throw new Error('页头没渲染出来，截图会是一张空图')

    const files = await shoot({
      name: 'workbench-header',
      panels: [
        { label: '工作台页头（工具条四级 + 模式统计胶囊）', html: header.html(), width: 620, height: '120px' },
        { label: '工作台页脚（标签在左、胶囊条在右）', html: wrapper.find('footer').html(), width: 620, height: '70px' }
      ],
      scale: 2
    })

    if (files.length !== 2) throw new Error(`预期 dark/light 两张图，实际 ${files.length} 张`)
  })

  it('renders the dashboard sections', async () => {
    // 首页是除工作台之外最常看的一屏。它需要项目 store 里有数据，所以照
    // Dashboard.spec 的做法给 projectGetTree 喂一份真实的树。
    setActivePinia(createPinia())
    // 用"当前时间"而不是 1970：成就概览的当月/当年数字按完成时间分月统计，
    // 时间戳放在 1970 会让首页那三张卡显示成 0，截出来不像真实使用状态。
    const now = Date.now()
    const done = { mtimeMs: now, ctimeMs: now - DONE_OFFSET_MS }
    const pending = { mtimeMs: now, ctimeMs: now }
    const stats = (nDone: number, nPending: number): Array<{ mtimeMs: number; ctimeMs: number }> => [
      ...Array.from({ length: nDone }, () => done),
      ...Array.from({ length: nPending }, () => pending)
    ]
    const child = (
      id: string,
      chapterNumber: string,
      projectTitle: string,
      psdStats: Array<{ mtimeMs: number; ctimeMs: number }>,
      lastMtimeMs: number
    ): ParentProject['children'][number] => ({
      id,
      parentTitle: '町野さん',
      folderPath: `D:\\漫画\\町野さん\\${chapterNumber}`,
      chapterNumber,
      projectTitle,
      lastMtimeMs,
      psdStats,
      // 缓存版本号必须引用常量：写死数字会在升版本时被判过期而重算。
      statsVersion: PAIRED_PSD_STATS_VERSION
    })
    const parents: ParentProject[] = [
      {
        id: 'p1',
        title: '町野さん',
        lastMtimeMs: 4000,
        children: [
          child('c1', '第11集', '直到你的愿望实现为止', stats(9, 15), 4000),
          child('c2', '第10集', '番外 · 夏日祭', stats(18, 0), 3000),
          child('c3', '第9集', '第9集', stats(0, 24), 2000)
        ]
      },
      { id: 'p2', title: '前女友学姐', lastMtimeMs: 1000, children: [] }
    ]
    window.comicType = {
      projectGetTree: vi.fn().mockResolvedValue(parents),
      storeGet: vi.fn().mockResolvedValue(undefined),
      projectSaveProgress: vi.fn().mockResolvedValue(undefined),
      scanChildProject: vi.fn().mockResolvedValue({ jpgPairs: [], txtFiles: [], errors: [] })
    } as unknown as typeof window.comicType

    const wrapper = mount(Dashboard)
    await flushPromises()
    await wrapper.vm.$nextTick()

    if (!wrapper.find('[data-testid="recent-projects"]').exists()) {
      throw new Error('首页没渲染出「继续上次的项目」，截图会是一张空图')
    }

    const files = await shoot({
      name: 'dashboard',
      panels: [
        {
          label: '首页（继续上次的项目 / 已完成 · 待嵌字 / 成就概览）',
          html: wrapper.html(),
          width: 900,
          height: '620px'
        }
      ]
    })
    if (files.length !== 2) throw new Error(`预期 dark/light 两张图，实际 ${files.length} 张`)
  })
})
