// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type DOMWrapper, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import type { JpgPsdPair, ParentProject } from '@shared/types'

// vi.hoisted ensures mockRoute exists before the vi.mock factory runs.
const { mockRoute } = vi.hoisted(() => ({
  mockRoute: {
    params: {
      parentTitle: '',
      childId: ''
    }
  }
}))

// Mock only useRoute/useRouter — router-link is stubbed in mount options.
const { mockPush } = vi.hoisted(() => ({ mockPush: vi.fn() }))
vi.mock('vue-router', () => ({
  useRoute: () => mockRoute,
  useRouter: () => ({ push: mockPush })
}))

import Project from '../Project.vue'
import { useProjectWorkspace } from '@renderer/stores/projectWorkspace'
import { useSettingsStore } from '@renderer/stores/settings'
import { useToastStore } from '@renderer/stores/toast'

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
        }
      ]
    }
  ]
}

/** 造一条真实的 PSD 对 —— 假数据空数组没法验证"选中能不能活过重扫"。 */
function makePair(name: string): JpgPsdPair {
  return {
    jpgPath: `/tmp/第1話/${name}.jpg`,
    psd: { absPath: `/tmp/第1話/${name}.psd`, mtimeMs: 1, ctimeMs: 1, status: 'pending' }
  }
}

/** 工具栏那两个「标记X」按钮没有 testid，按文案找（既有用例也是这么找的）。 */
function toolbarMarkButton(wrapper: VueWrapper, label: string): DOMWrapper<HTMLButtonElement> {
  const button = wrapper.findAll('button').find((item) => item.text() === label)
  if (!button) throw new Error(`工具栏里找不到按钮「${label}」`)
  return button
}

/** Minimal stubs for child components so tests don't need their deps. */
const ProjectSidebarStub = {
  name: 'ProjectSidebar',
  props: ['parents', 'loading'],
  template: '<div class="project-sidebar-stub"><slot /></div>'
}
const ProjectThumbListStub = {
  name: 'ProjectThumbList',
  props: ['pairs', 'folderPath'],
  // thumbnails：底部缩略图条的数据来源（不声明的话，多根节点组件会报"监听器无法自动继承"）。
  emits: ['selectionChange', 'compare', 'thumbnails'],
  template:
    '<div>' +
    '<button class="project-thumb-list-stub" @click="$emit(\'selectionChange\', pairs)">select</button>' +
    '<button class="thumb-open-second" @click="$emit(\'compare\', pairs[1])">open second</button>' +
    '</div>'
}
const ProjectFooterStub = {
  name: 'ProjectFooter',
  props: ['progress'],
  template: '<div class="project-footer-stub"><slot /></div>'
}
const CompareViewerStub = {
  name: 'CompareViewer',
  props: ['jpgPath', 'psdPath', 'visible', 'playing', 'thumbStripOpen', 'advanceAfterMark'],
  // ready / stopPlayback：看图三件套新增的两个挂钩（多根节点 + 不声明 = Vue 会警告）。
  // next / previous / openPsd 是它本来就对外发的（这里一并声明，免得再来一条同样的警告）。
  emits: ['mark', 'close', 'ready', 'stopPlayback', 'next', 'previous', 'openPsd'],
  template:
    '<div class="compare-viewer-stub">' +
    '<button class="compare-mark-done" @click="$emit(\'mark\', \'done\')">mark done</button>' +
    '<button class="compare-mark-pending" @click="$emit(\'mark\', \'pending\')">mark pending</button>' +
    '<button class="compare-close" @click="$emit(\'close\')">close</button>' +
    '</div>'
}
const ProjectFormModalStub = {
  name: 'ProjectFormModal',
  props: ['mode', 'initialData'],
  template: '<div class="project-form-modal-stub"><slot /></div>'
}

beforeEach(() => {
  setActivePinia(createPinia())
  mockPush.mockReset()
  window.comicType = {
    storeGet: vi.fn().mockResolvedValue([]),
    storeSet: vi.fn().mockResolvedValue(undefined),
    projectGetTree: vi.fn().mockResolvedValue([]),
    projectSaveProgress: vi.fn().mockResolvedValue(undefined),
    scanChildProject: vi.fn().mockResolvedValue({ jpgPairs: [], txtFiles: [], errors: [] }),
    listDir: vi.fn().mockResolvedValue([]),
    stat: vi
      .fn()
      .mockResolvedValue({ mtimeMs: 0, ctimeMs: 0, size: 0, isFile: true, isDirectory: false }),
    readFileDataURL: vi.fn().mockResolvedValue('data:image/jpeg;base64,test'),
    readFileBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
    openPath: vi.fn().mockResolvedValue({ ok: true }),
    pickDirectory: vi.fn().mockResolvedValue(null)
  } as unknown as typeof window.comicType
})

describe('Project', () => {
  it('renders header with decoded title and subtitle path for valid params', () => {
    mockRoute.params = {
      parentTitle: encodeURIComponent('ドラゴンボール'),
      childId: 'c1'
    }
    const store = useProjectWorkspace()
    store.parents = makeParents()

    const wrapper = mount(Project, {
      global: {
        stubs: {
          'router-link': { template: '<a><slot /></a>', props: ['to'] },
          ProjectSidebar: ProjectSidebarStub,
          ProjectThumbList: ProjectThumbListStub,
          ProjectFooter: ProjectFooterStub,
          CompareViewer: CompareViewerStub,
          ProjectFormModal: ProjectFormModalStub
        }
      }
    })

    // Header shows the active chapter, not the URI-encoded route segment.
    expect(wrapper.find('h2').text()).toBe('第1集 · vol1')
    // Subtitle shows the child's absolute folder path.
    // 用结构定位（页头里唯一的 <p>）而不是配色类：路径在本轮被降级为
    // tertiary 文本，按颜色类找会跟着配色一起碎掉。
    expect(wrapper.find('header p').text()).toBe('/tmp/第1話')
  })

  it('shows 项目不存在 and 返回首页 button when childId not found', async () => {
    mockRoute.params = {
      parentTitle: encodeURIComponent('ワンピース'),
      childId: 'nonexistent'
    }
    // Store left empty — the tree still has to load before we can claim the
    // child is gone.

    const wrapper = mount(Project, {
      global: {
        stubs: {
          'router-link': { template: '<a><slot /></a>', props: ['to'] },
          ProjectSidebar: ProjectSidebarStub,
          ProjectThumbList: ProjectThumbListStub,
          ProjectFooter: ProjectFooterStub,
          CompareViewer: CompareViewerStub,
          ProjectFormModal: ProjectFormModalStub
        }
      }
    })

    // 第一帧：树还没到，不能断言"项目不存在"。
    // 旧实现在这里直接渲染整屏空状态，数据到达后再跳成工作台 —— 用户看到的
    // 就是"画面一闪而过"。这条锁住"加载中不得下结论"。
    expect(wrapper.text()).toContain('加载中')
    expect(wrapper.text()).not.toContain('项目不存在')

    await flushPromises()

    expect(wrapper.text()).toContain('项目不存在')
    expect(wrapper.text()).toContain('返回首页')
    // The CTA button navigates to '/' via router.push.
    const btn = wrapper.find('button')
    expect(btn.exists()).toBe(true)
    await btn.trigger('click')
    expect(mockPush).toHaveBeenCalledWith('/')
  })

  it('uses the adjustable project-list divider and a flexible preview area', () => {
    mockRoute.params = {
      parentTitle: encodeURIComponent('ドラゴンボール'),
      childId: 'c1'
    }
    const store = useProjectWorkspace()
    store.parents = makeParents()

    const wrapper = mount(Project, {
      global: {
        stubs: {
          'router-link': { template: '<a><slot /></a>', props: ['to'] },
          ProjectSidebar: ProjectSidebarStub,
          ProjectThumbList: ProjectThumbListStub,
          ProjectFooter: ProjectFooterStub,
          CompareViewer: CompareViewerStub,
          ProjectFormModal: ProjectFormModalStub
        }
      }
    })

    const sidebar = wrapper.find('aside')
    expect(sidebar.classes()).toContain('h-full')
    expect(wrapper.find('[data-testid="split-pane-divider"]').exists()).toBe(true)

    const main = wrapper.find('section')
    expect(main.classes()).toContain('h-full')
    expect(main.classes()).toContain('min-w-0')
  })

  it('toolbar marks selected PSDs as done', async () => {
    mockRoute.params = {
      parentTitle: encodeURIComponent('ドラゴンボール'),
      childId: 'c1'
    }
    const store = useProjectWorkspace()
    store.parents = makeParents()
    const pair = {
      jpgPath: '/tmp/第1話/page_001.jpg',
      psd: {
        absPath: '/tmp/第1話/page_001.psd',
        mtimeMs: 600_000,
        ctimeMs: 600_000,
        status: 'pending' as const
      }
    }
    window.comicType.scanChildProject = vi.fn().mockResolvedValue({
      jpgPairs: [pair],
      txtFiles: [],
      errors: []
    })
    window.comicType.storeGet = vi.fn((key: string) =>
      Promise.resolve(key === 'psdStatusOverrides' ? {} : [])
    )

    const wrapper = mount(Project, {
      global: {
        stubs: {
          'router-link': { template: '<a><slot /></a>', props: ['to'] },
          ProjectSidebar: ProjectSidebarStub,
          ProjectThumbList: ProjectThumbListStub,
          ProjectFooter: ProjectFooterStub,
          CompareViewer: CompareViewerStub,
          ProjectFormModal: ProjectFormModalStub
        }
      }
    })
    await flushPromises()

    await wrapper.find('.project-thumb-list-stub').trigger('click')
    const markDoneButton = wrapper.findAll('button').find((button) => button.text() === '标记嵌字')
    expect(markDoneButton?.attributes('disabled')).toBeUndefined()
    await markDoneButton!.trigger('click')
    await flushPromises()

    expect(window.comicType.storeSet).toHaveBeenCalledWith('psdStatusOverrides', {
      '/tmp/第1話/page_001.psd': 'done'
    })
    expect(window.comicType.projectSaveProgress).toHaveBeenCalledWith(expect.any(Array))
    const rememberedStat = store.findChild('c1')?.psdStats?.[0]
    expect(rememberedStat && rememberedStat.mtimeMs - rememberedStat.ctimeMs).toBeGreaterThan(
      5 * 60 * 1000
    )
  })

  it('header shows a single figure for the active mode and agrees with the footer', async () => {
    mockRoute.params = { parentTitle: encodeURIComponent('ドラゴンボール'), childId: 'c1' }
    const store = useProjectWorkspace()
    store.parents = makeParents()
    store.setActiveChild(store.parents[0].children[0], [])

    // Render the footer's own prop so the two figures can be compared directly.
    const FigureFooterStub = {
      name: 'ProjectFooter',
      props: ['progress', 'mode'],
      template: '<div class="footer-figure">{{ progress.done }}/{{ progress.total }}</div>'
    }

    const wrapper = mount(Project, {
      global: {
        stubs: {
          'router-link': { template: '<a><slot /></a>', props: ['to'] },
          ProjectSidebar: ProjectSidebarStub,
          ProjectThumbList: ProjectThumbListStub,
          ProjectFooter: FigureFooterStub,
          CompareViewer: CompareViewerStub,
          ProjectFormModal: ProjectFormModalStub
        }
      }
    })
    await flushPromises()

    // Exactly one stat — the four-mode row is gone.
    const stats = wrapper.findAll('[data-testid^="mode-stat-"]')
    expect(stats).toHaveLength(1)
    expect(stats[0].attributes('data-testid')).toBe('mode-stat-typeset')
    // Head and footer read the same computed, so they cannot drift apart.
    expect(stats[0].text()).toBe(wrapper.find('.footer-figure').text())
  })

  /**
   * 2026-09-23 真机报告：「进入对照视图后，标记X 按钮点不动」。
   *
   * 根因不在对照视图，在重扫：`scanActiveChild()` 扫完之后**无条件**把选中清空，
   * 而它挂在 window 的 focus 上（Project.vue 的 refreshActiveChild）。
   * 于是"从 Photoshop 切回来""点进一个没激活的窗口"都会把选中抹掉，
   * 工具栏那两个按钮跟着变灰 —— 用户看到的现象就是"在对照视图里标不了"。
   *
   * 时序之所以看起来像"进了对照视图才坏"：重扫是**异步**的。
   * 双击缩略图那两下先选中、再打开对照视图（此刻按钮还能点），
   * 紧接着上一次 focus 触发的重扫跑完，选中才被抹掉。
   */
  describe('重扫与选中项', () => {
    function mountProject(): VueWrapper {
      return mount(Project, {
        global: {
          stubs: {
            'router-link': { template: '<a><slot /></a>', props: ['to'] },
            ProjectSidebar: ProjectSidebarStub,
            ProjectThumbList: ProjectThumbListStub,
            ProjectFooter: ProjectFooterStub,
            CompareViewer: CompareViewerStub,
            ProjectFormModal: ProjectFormModalStub
          }
        }
      }) as VueWrapper
    }

    it('窗口重新获得焦点触发重扫时，还存在的选中项必须留下', async () => {
      mockRoute.params = { parentTitle: encodeURIComponent('ドラゴンボール'), childId: 'c1' }
      const store = useProjectWorkspace()
      store.parents = makeParents()
      const pair = makePair('page_001')
      window.comicType.scanChildProject = vi
        .fn()
        .mockResolvedValue({ jpgPairs: [pair], txtFiles: [], errors: [] })

      const wrapper = mountProject()
      await flushPromises()

      await wrapper.get('.project-thumb-list-stub').trigger('click')
      expect(toolbarMarkButton(wrapper, '标记嵌字').attributes('disabled')).toBeUndefined()

      // 从别的窗口切回来 —— 就是"从 Photoshop 回来"那一下。
      window.dispatchEvent(new Event('focus'))
      await flushPromises()

      expect(toolbarMarkButton(wrapper, '标记嵌字').attributes('disabled')).toBeUndefined()
      expect(toolbarMarkButton(wrapper, '标记未嵌字').attributes('disabled')).toBeUndefined()
    })

    it('重扫后确实消失的条目，才从选中里去掉', async () => {
      mockRoute.params = { parentTitle: encodeURIComponent('ドラゴンボール'), childId: 'c1' }
      const store = useProjectWorkspace()
      store.parents = makeParents()
      const kept = makePair('page_001')
      const gone = makePair('page_002')
      const scan = vi
        .fn()
        .mockResolvedValueOnce({ jpgPairs: [kept, gone], txtFiles: [], errors: [] })
        // 第二次重扫时 page_002 已经不在了（被删掉/改名）。
        .mockResolvedValue({ jpgPairs: [kept], txtFiles: [], errors: [] })
      window.comicType.scanChildProject = scan
      window.comicType.storeGet = vi.fn((key: string) =>
        Promise.resolve(key === 'psdStatusOverrides' ? {} : [])
      )

      const wrapper = mountProject()
      await flushPromises()

      await wrapper.get('.project-thumb-list-stub').trigger('click')
      expect(toolbarMarkButton(wrapper, '标记嵌字').attributes('disabled')).toBeUndefined()

      window.dispatchEvent(new Event('focus'))
      await flushPromises()

      // 还剩下的那条仍选中 → 按钮仍可点。
      expect(toolbarMarkButton(wrapper, '标记嵌字').attributes('disabled')).toBeUndefined()

      await toolbarMarkButton(wrapper, '标记嵌字').trigger('click')
      await flushPromises()

      // 而且只标记了留下来的那一条 —— 消失的那条不该被写进覆盖表。
      expect(window.comicType.storeSet).toHaveBeenCalledWith('psdStatusOverrides', {
        '/tmp/第1話/page_001.psd': 'done'
      })
    })
  })

  /**
   * 对照视图里那两个按钮必须标**当前显示的那一张**。
   *
   * 它不能靠工具栏代劳：那个视图里没有缩略图那种"选中"概念，
   * 用方向键翻到第 5 页时工具栏标的仍是最初双击的那一张 —— 静默标错，
   * 比标不上更糟（用户会以为已经标好了）。
   */
  it('对照视图里的「标记X」作用于当前显示的那一张，而不是缩略图里的旧选中项', async () => {
    mockRoute.params = { parentTitle: encodeURIComponent('ドラゴンボール'), childId: 'c1' }
    const store = useProjectWorkspace()
    store.parents = makeParents()
    const first = makePair('page_001')
    const second = makePair('page_002')
    window.comicType.scanChildProject = vi
      .fn()
      .mockResolvedValue({ jpgPairs: [first, second], txtFiles: [], errors: [] })
    window.comicType.storeGet = vi.fn((key: string) =>
      Promise.resolve(key === 'psdStatusOverrides' ? {} : [])
    )

    const wrapper = mount(Project, {
      global: {
        stubs: {
          'router-link': { template: '<a><slot /></a>', props: ['to'] },
          ProjectSidebar: ProjectSidebarStub,
          ProjectThumbList: ProjectThumbListStub,
          ProjectFooter: ProjectFooterStub,
          CompareViewer: CompareViewerStub,
          ProjectFormModal: ProjectFormModalStub
        }
      }
    })
    await flushPromises()

    // 进对照视图之前，缩略图里是"两张都选中"的状态。
    await wrapper.get('.project-thumb-list-stub').trigger('click')
    // 打开对照视图看的是第二张。
    await wrapper.get('.thumb-open-second').trigger('click')
    expect(wrapper.find('.compare-viewer-stub').exists()).toBe(true)

    await wrapper.get('.compare-mark-done').trigger('click')
    await flushPromises()

    // 只标了当前显示的那一张，没有连带把第一张也标上。
    expect(window.comicType.storeSet).toHaveBeenCalledWith('psdStatusOverrides', {
      '/tmp/第1話/page_002.psd': 'done'
    })
  })

  /**
   * 同一个动作不能在一屏里出现两次 —— 用户不知道该点哪个。
   * 对照视图有自己的「标记X」（作用于当前显示的那一张），工具栏那两只让位。
   *
   * 但**模式下拉要留着**：对照视图的按钮文案跟着它走，它不是多余的控件。
   */
  it('对照视图打开时工具栏那两个「标记X」让位，关掉后回来', async () => {
    mockRoute.params = { parentTitle: encodeURIComponent('ドラゴンボール'), childId: 'c1' }
    const store = useProjectWorkspace()
    store.parents = makeParents()
    window.comicType.scanChildProject = vi
      .fn()
      .mockResolvedValue({
        jpgPairs: [makePair('page_001'), makePair('page_002')],
        txtFiles: [],
        errors: []
      })

    const wrapper = mount(Project, {
      global: {
        stubs: {
          'router-link': { template: '<a><slot /></a>', props: ['to'] },
          ProjectSidebar: ProjectSidebarStub,
          ProjectThumbList: ProjectThumbListStub,
          ProjectFooter: ProjectFooterStub,
          CompareViewer: CompareViewerStub,
          ProjectFormModal: ProjectFormModalStub
        }
      }
    })
    await flushPromises()

    const hasToolbarMark = (label: string): boolean =>
      wrapper.findAll('button').some((button) => button.text() === label)

    // 缩略图状态：两只都在（对照视图没开）。
    expect(hasToolbarMark('标记嵌字')).toBe(true)
    expect(hasToolbarMark('标记未嵌字')).toBe(true)

    await wrapper.get('.thumb-open-second').trigger('click')
    expect(wrapper.find('.compare-viewer-stub').exists()).toBe(true)

    // 对照状态：让位给视图内自己的按钮，一个都不留。
    expect(hasToolbarMark('标记嵌字')).toBe(false)
    expect(hasToolbarMark('标记未嵌字')).toBe(false)
    expect(wrapper.find('.compare-mark-done').exists()).toBe(true)
    // 但模式下拉还在 —— 它决定对照视图那两个按钮的文案。
    expect(wrapper.find('[data-testid="mark-mode-select"]').exists()).toBe(true)

    await wrapper.get('.compare-close').trigger('click')
    await flushPromises()

    // 退出对照后，工具栏那两只回来。
    expect(hasToolbarMark('标记嵌字')).toBe(true)
    expect(hasToolbarMark('标记未嵌字')).toBe(true)
  })
})

/**
 * 看图三件套（缩略图条 / 自动播放）在工作台这一层的接线。
 *
 * 这两件事的"脑子"都在 `Project.vue`：它才知道当前是第几张、下一张是谁、什么时候该停。
 * CompareViewer 与 ProjectThumbList 都是 stub —— 这里测的是接线，不是它们内部。
 */
describe('Project 看图三件套接线', () => {
  function mountWorkbench(): VueWrapper {
    return mount(Project, {
      global: {
        stubs: {
          'router-link': { template: '<a><slot /></a>', props: ['to'] },
          ProjectSidebar: ProjectSidebarStub,
          ProjectThumbList: ProjectThumbListStub,
          ProjectFooter: ProjectFooterStub,
          CompareViewer: CompareViewerStub,
          ProjectFormModal: ProjectFormModalStub
        }
      }
    })
  }

  async function setupTwoPages() {
    mockRoute.params = { parentTitle: encodeURIComponent('ドラゴンボール'), childId: 'c1' }
    const store = useProjectWorkspace()
    store.parents = makeParents()
    window.comicType.scanChildProject = vi
      .fn()
      .mockResolvedValue({
        jpgPairs: [makePair('page_001'), makePair('page_002')],
        txtFiles: [],
        errors: []
      })
    window.comicType.storeGet = vi.fn((key: string) =>
      Promise.resolve(key === 'psdStatusOverrides' ? {} : [])
    )
    const wrapper = mountWorkbench()
    await flushPromises()
    return wrapper
  }

  function viewerOf(wrapper: VueWrapper) {
    return wrapper.findComponent({ name: 'CompareViewer' })
  }

  function playToggle(wrapper: VueWrapper): DOMWrapper<HTMLButtonElement> {
    return wrapper.get('[data-testid="viewer-play-toggle"]') as DOMWrapper<HTMLButtonElement>
  }

  it('两个按钮只在预览 / 对照状态出现，退出后消失', async () => {
    const wrapper = await setupTwoPages()
    expect(wrapper.find('[data-testid="viewer-play-toggle"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="viewer-thumb-strip-toggle"]').exists()).toBe(false)

    await wrapper.get('.thumb-open-second').trigger('click')
    expect(wrapper.find('[data-testid="viewer-play-toggle"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="viewer-thumb-strip-toggle"]').exists()).toBe(true)

    await wrapper.get('.compare-close').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="viewer-play-toggle"]').exists()).toBe(false)
  })

  it('缩略图条：按钮展开、再点收起、右侧图标也能收起', async () => {
    const wrapper = await setupTwoPages()
    await wrapper.get('.thumb-open-second').trigger('click')

    expect(wrapper.find('[data-testid="viewer-thumb-strip"]').exists()).toBe(false)

    await wrapper.get('[data-testid="viewer-thumb-strip-toggle"]').trigger('click')
    expect(wrapper.find('[data-testid="viewer-thumb-strip"]').exists()).toBe(true)

    await wrapper.get('[data-testid="viewer-thumb-strip-toggle"]').trigger('click')
    expect(wrapper.find('[data-testid="viewer-thumb-strip"]').exists()).toBe(false)

    await wrapper.get('[data-testid="viewer-thumb-strip-toggle"]').trigger('click')
    await wrapper.get('[data-testid="viewer-thumb-strip-collapse"]').trigger('click')
    expect(wrapper.find('[data-testid="viewer-thumb-strip"]').exists()).toBe(false)
  })

  it('缩略图条用的是网格上报的那份内存图：上报什么就显示什么，条自己不去读图', async () => {
    const wrapper = await setupTwoPages()
    await wrapper.get('.thumb-open-second').trigger('click')
    await wrapper.get('[data-testid="viewer-thumb-strip-toggle"]').trigger('click')

    // 还没上报时是页码占位，一个 <img> 都没有。
    expect(wrapper.findAll('[data-testid="viewer-thumb-track"] img')).toHaveLength(0)

    wrapper.findComponent({ name: 'ProjectThumbList' }).vm.$emit('thumbnails', {
      '/tmp/第1話/page_001.psd': 'data:image/png;base64,aaa'
    })
    await flushPromises()

    const images = wrapper.findAll('[data-testid="viewer-thumb-track"] img')
    expect(images).toHaveLength(1)
    expect(images[0].attributes('src')).toBe('data:image/png;base64,aaa')
  })

  it('点缩略图方块 → 直接跳到那一张（与双击缩略图走同一条路）', async () => {
    const wrapper = await setupTwoPages()
    await wrapper.get('.thumb-open-second').trigger('click')
    expect(viewerOf(wrapper).props('psdPath')).toBe('/tmp/第1話/page_002.psd')

    await wrapper.get('[data-testid="viewer-thumb-strip-toggle"]').trigger('click')
    await wrapper.findAll('[data-testid="viewer-thumb-track"] button')[0].trigger('click')
    await flushPromises()

    expect(viewerOf(wrapper).props('psdPath')).toBe('/tmp/第1話/page_001.psd')
    expect(
      wrapper.findAll('[data-testid="viewer-thumb-track"] button')[0].attributes('data-active')
    ).toBe('true')
  })

  it('播放：等这一张就绪再计时；到最后一页停下、按钮变回 ▶', async () => {
    const wrapper = await setupTwoPages()
    // 先看第二张（也就是最后一页）。
    await wrapper.get('.thumb-open-second').trigger('click')
    expect(viewerOf(wrapper).props('psdPath')).toBe('/tmp/第1話/page_002.psd')

    vi.useFakeTimers()
    try {
      // 在最后一页点播放 = 从第一页重播。
      await playToggle(wrapper).trigger('click')
      expect(viewerOf(wrapper).props('psdPath')).toBe('/tmp/第1話/page_001.psd')
      expect(playToggle(wrapper).attributes('aria-label')).toBe('停止播放')

      // 这一张显示好了 → 从这一刻开始算 2 秒（默认间隔）。
      viewerOf(wrapper).vm.$emit('ready')
      await nextTick()
      vi.advanceTimersByTime(2000)
      await nextTick()
      expect(viewerOf(wrapper).props('psdPath')).toBe('/tmp/第1話/page_002.psd')
      expect(playToggle(wrapper).attributes('aria-label')).toBe('停止播放')

      // 已经是最后一页：再等一拍 → 停下，▶ 回来。
      viewerOf(wrapper).vm.$emit('ready')
      await nextTick()
      vi.advanceTimersByTime(2000)
      await nextTick()
      expect(viewerOf(wrapper).props('psdPath')).toBe('/tmp/第1話/page_002.psd')
      expect(playToggle(wrapper).attributes('aria-label')).toBe('自动播放')
    } finally {
      vi.useRealTimers()
    }
  })

  it('播放中：手动翻页 / 点画面任意位置 / 退出预览，三种都会停', async () => {
    const wrapper = await setupTwoPages()
    await wrapper.get('.thumb-open-second').trigger('click')

    // 手动翻页（方向键那条路 = CompareViewer 的 next 事件）
    await playToggle(wrapper).trigger('click')
    expect(playToggle(wrapper).attributes('aria-label')).toBe('停止播放')
    viewerOf(wrapper).vm.$emit('next')
    await flushPromises()
    expect(playToggle(wrapper).attributes('aria-label')).toBe('自动播放')

    // 点画面任意位置（事件从画面冒泡到内容区）
    await playToggle(wrapper).trigger('click')
    expect(playToggle(wrapper).attributes('aria-label')).toBe('停止播放')
    await wrapper.get('.compare-viewer-stub').trigger('click')
    expect(playToggle(wrapper).attributes('aria-label')).toBe('自动播放')

    // 退出预览 → 播放停 + 胶片收起（再进来是干净的一屏）
    await playToggle(wrapper).trigger('click')
    await wrapper.get('[data-testid="viewer-thumb-strip-toggle"]').trigger('click')
    await wrapper.get('.compare-close').trigger('click')
    await flushPromises()

    await wrapper.get('.thumb-open-second').trigger('click')
    expect(playToggle(wrapper).attributes('aria-label')).toBe('自动播放')
    expect(wrapper.find('[data-testid="viewer-thumb-strip"]').exists()).toBe(false)
  })

  it('Esc（播放中）：只停播放，不退出预览', async () => {
    const wrapper = await setupTwoPages()
    await wrapper.get('.thumb-open-second').trigger('click')
    await playToggle(wrapper).trigger('click')

    viewerOf(wrapper).vm.$emit('stopPlayback')
    await flushPromises()

    expect(playToggle(wrapper).attributes('aria-label')).toBe('自动播放')
    expect(wrapper.find('.compare-viewer-stub').exists()).toBe(true)
  })

  it('只有一张时播放按钮是禁用的（"点了没反应"会被当成程序坏了）', async () => {
    mockRoute.params = { parentTitle: encodeURIComponent('ドラゴンボール'), childId: 'c1' }
    const store = useProjectWorkspace()
    store.parents = makeParents()
    window.comicType.scanChildProject = vi
      .fn()
      .mockResolvedValue({ jpgPairs: [makePair('page_001')], txtFiles: [], errors: [] })
    window.comicType.storeGet = vi.fn((key: string) =>
      Promise.resolve(key === 'psdStatusOverrides' ? {} : [])
    )
    const wrapper = mountWorkbench()
    await flushPromises()

    wrapper.findComponent({ name: 'ProjectThumbList' }).vm.$emit('compare', makePair('page_001'))
    await flushPromises()

    const play = wrapper.get('[data-testid="viewer-play-toggle"]')
      .element as HTMLButtonElement
    expect(play.disabled).toBe(true)
    // 缩略图按钮仍然可用（就一张也值得看一眼条上的高亮）
    const strip = wrapper.get('[data-testid="viewer-thumb-strip-toggle"]')
      .element as HTMLButtonElement
    expect(strip.disabled).toBe(false)
  })
})

/**
 * 标记台账在工作台这一层的接线（第十四轮）：撤销按钮 / Ctrl+Z / 标记记录入口。
 *
 * 台账本身（写库、撤销的精确还原）由主进程侧的 spec 锁；这里只锁"界面有没有接对线"。
 */
describe('Project 撤销标记与标记记录', () => {
  function mountWorkbench(): VueWrapper {
    return mount(Project, {
      global: {
        stubs: {
          'router-link': { template: '<a><slot /></a>', props: ['to'] },
          ProjectSidebar: ProjectSidebarStub,
          ProjectThumbList: ProjectThumbListStub,
          ProjectFooter: ProjectFooterStub,
          CompareViewer: CompareViewerStub,
          ProjectFormModal: ProjectFormModalStub
        }
      }
    })
  }

  function undoOperation() {
    return {
      opId: 'op-1',
      at: 1790520000000,
      kind: 'mark' as const,
      source: 'toolbar' as const,
      mode: 'supervised' as const,
      targetStatus: 'done' as const,
      children: [{ childId: 'c1', folderPath: '/tmp/第1話', entries: [] }],
      fileCount: 3,
      skippedCount: 0
    }
  }

  async function setup(options?: { undoable?: boolean }) {
    mockRoute.params = { parentTitle: encodeURIComponent('ドラゴンボール'), childId: 'c1' }
    const store = useProjectWorkspace()
    store.parents = makeParents()
    window.comicType.scanChildProject = vi
      .fn()
      .mockResolvedValue({
        jpgPairs: [makePair('page_001'), makePair('page_002')],
        txtFiles: [],
        errors: []
      })
    window.comicType.storeGet = vi.fn((key: string) =>
      Promise.resolve(key === 'psdStatusOverrides' ? {} : [])
    )
    // 第一次问"有可撤销的吗"给一条；撤销之后再问就没有了（一次操作只能撤销一次）。
    const undoable = options?.undoable !== false
    const findUndoable = vi
      .fn()
      .mockResolvedValueOnce(undoable ? undoOperation() : null)
      .mockResolvedValue(null)
    const undoMark = vi
      .fn()
      .mockResolvedValue({ revertedFiles: 3, childIds: ['c1'], operation: null })
    window.comicType.memoryFindUndoableMark = findUndoable
    window.comicType.memoryUndoMark = undoMark
    window.comicType.memoryListMarkAudit = vi.fn().mockResolvedValue([])

    const wrapper = mountWorkbench()
    await flushPromises()
    return { wrapper, undoMark, findUndoable }
  }

  function undoButton(wrapper: VueWrapper): DOMWrapper<HTMLButtonElement> {
    return wrapper.get('[data-testid="mark-undo-button"]') as DOMWrapper<HTMLButtonElement>
  }

  it('没有可撤销的操作时按钮禁用；有则可点，点了把 opId 交给主进程并重扫当前话', async () => {
    const { wrapper, undoMark } = await setup()
    expect(undoButton(wrapper).element.disabled).toBe(false)
    expect(undoButton(wrapper).attributes('title')).toContain('撤销')

    const scansBefore = (window.comicType.scanChildProject as ReturnType<typeof vi.fn>).mock.calls
      .length
    await undoButton(wrapper).trigger('click')
    await flushPromises()

    expect(undoMark).toHaveBeenCalledWith('op-1')
    // 受影响的正是当前这一话 → 要重扫，界面数字才不会停在旧值
    expect(
      (window.comicType.scanChildProject as ReturnType<typeof vi.fn>).mock.calls.length
    ).toBeGreaterThan(scansBefore)
    // 撤销之后不能重复撤销（台账口径：一次操作只还原一次）
    expect(undoButton(wrapper).element.disabled).toBe(true)
  })

  it('没有可撤销的操作时按钮就是禁用的（不是"点了没反应"）', async () => {
    const { wrapper } = await setup({ undoable: false })
    expect(undoButton(wrapper).element.disabled).toBe(true)
  })

  it('Ctrl+Z 也能撤销；但焦点在输入框里时不抢（输入框自己的撤销归它）', async () => {
    const { wrapper, undoMark } = await setup()

    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }))
    await flushPromises()
    expect(undoMark).not.toHaveBeenCalled()

    input.blur()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true }))
    await flushPromises()
    expect(undoMark).toHaveBeenCalledWith('op-1')
    input.remove()
    expect(wrapper.find('[data-testid="mark-undo-button"]').exists()).toBe(true)
  })

  it('「记录」按钮打开标记记录对话框', async () => {
    const { wrapper } = await setup()

    expect(wrapper.find('[data-testid="mark-history-dialog"]').exists()).toBe(false)
    await wrapper.get('[data-testid="mark-history-button"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="mark-history-dialog"]').exists()).toBe(true)
  })
})

/**
 * C3：开了「标记后下一张」时，在对照视图里标一下就翻页；到头停下（不回卷）。
 * 开关状态本身由 CompareViewer 显示、由这里写进设置 —— 所以这里连"传下去了没有"一起锁。
 */
describe('Project 标记后下一张', () => {
  function mountWorkbench(): VueWrapper {
    return mount(Project, {
      global: {
        stubs: {
          'router-link': { template: '<a><slot /></a>', props: ['to'] },
          ProjectSidebar: ProjectSidebarStub,
          ProjectThumbList: ProjectThumbListStub,
          ProjectFooter: ProjectFooterStub,
          CompareViewer: CompareViewerStub,
          ProjectFormModal: ProjectFormModalStub
        }
      }
    })
  }

  async function setup() {
    mockRoute.params = { parentTitle: encodeURIComponent('ドラゴンボール'), childId: 'c1' }
    const store = useProjectWorkspace()
    store.parents = makeParents()
    window.comicType.scanChildProject = vi
      .fn()
      .mockResolvedValue({
        jpgPairs: [makePair('page_001'), makePair('page_002')],
        txtFiles: [],
        errors: []
      })
    window.comicType.storeGet = vi.fn((key: string) =>
      Promise.resolve(key === 'psdStatusOverrides' ? {} : [])
    )
    window.comicType.memoryFindUndoableMark = vi.fn().mockResolvedValue(null)
    const wrapper = mountWorkbench()
    await flushPromises()
    return wrapper
  }

  function viewerOf(wrapper: VueWrapper) {
    return wrapper.findComponent({ name: 'CompareViewer' })
  }

  it('默认关：标记后停在原页；打开后标一下翻到下一张；到最后一页停下（不回卷）', async () => {
    const wrapper = await setup()
    const settings = useSettingsStore()

    // 从第 1 张进对照视图
    wrapper.findComponent({ name: 'ProjectThumbList' }).vm.$emit('compare', makePair('page_001'))
    await flushPromises()
    expect(viewerOf(wrapper).props('psdPath')).toBe('/tmp/第1話/page_001.psd')
    expect(viewerOf(wrapper).props('advanceAfterMark')).toBe(false)

    // 默认关 → 标记后不动
    await wrapper.get('.compare-mark-done').trigger('click')
    await flushPromises()
    expect(viewerOf(wrapper).props('psdPath')).toBe('/tmp/第1話/page_001.psd')

    // 打开开关（宿主把它写进设置，并传回给视图）
    settings.setAdvanceAfterMark(true)
    await flushPromises()
    expect(viewerOf(wrapper).props('advanceAfterMark')).toBe(true)

    await wrapper.get('.compare-mark-done').trigger('click')
    await flushPromises()
    expect(viewerOf(wrapper).props('psdPath')).toBe('/tmp/第1話/page_002.psd')

    // 已经是最后一页 → 停在原地
    await wrapper.get('.compare-mark-done').trigger('click')
    await flushPromises()
    expect(viewerOf(wrapper).props('psdPath')).toBe('/tmp/第1話/page_002.psd')
  })
})

/**
 * 「职责 → 落脚时对齐一次模式」（2026-10-03）。
 *
 * 用户要的是"少点几下"：进这本漫画时自动切到职责对应的工序，
 * 但**不能变成打扰** —— 同一本里换话、自己手动切走，都不许被拉回来。
 * 纯决策（选哪个模式）在 `shared/__tests__/duties.spec.ts` 里锁着，这里锁"什么时候切"。
 */
describe('职责 → 落脚对齐模式', () => {
  function mountProject(): VueWrapper {
    return mount(Project, {
      global: {
        stubs: {
          'router-link': { template: '<a><slot /></a>', props: ['to'] },
          ProjectSidebar: ProjectSidebarStub,
          ProjectThumbList: ProjectThumbListStub,
          ProjectFooter: ProjectFooterStub,
          CompareViewer: CompareViewerStub,
          ProjectFormModal: ProjectFormModalStub
        }
      }
    }) as VueWrapper
  }

  function parentsWithDuties(duties: ParentProject['duties']): ParentProject[] {
    const parents = makeParents()
    parents[0].duties = duties
    return parents
  }

  it('进这本（职责=校对）→ 工具栏切成「标记校对」，并给一条轻提示', async () => {
    mockRoute.params = { parentTitle: encodeURIComponent('ドラゴンボール'), childId: 'c1' }
    const store = useProjectWorkspace()
    store.parents = parentsWithDuties(['proofread'])
    window.comicType.scanChildProject = vi
      .fn()
      .mockResolvedValue({ jpgPairs: [makePair('page_001')], txtFiles: [], errors: [] })

    const wrapper = mountProject()
    // 对齐要等"这一话扫完"（scanning 落到 false），实测要跨几轮微任务 ⇒ 轮询等待，
    // 别用固定次数的 flush（同一套 setup 会时快时慢，锁会变成抽奖）。
    await vi.waitFor(() => {
      expect(toolbarMarkButton(wrapper, '标记校对')).toBeTruthy()
    })
    // 提示由应用外壳渲染（不在这棵树里）⇒ 断 toast store 里的那条消息
    const messages = useToastStore().toasts.map((item) => item.message).join('|')
    expect(messages).toContain('已按职责切到')
  })

  it('没声明职责、也没有标记可推断 → 保持默认「嵌字」，不弹任何提示', async () => {
    mockRoute.params = { parentTitle: encodeURIComponent('ドラゴンボール'), childId: 'c1' }
    const store = useProjectWorkspace()
    store.parents = parentsWithDuties(undefined)
    window.comicType.scanChildProject = vi
      .fn()
      .mockResolvedValue({ jpgPairs: [makePair('page_001')], txtFiles: [], errors: [] })

    const wrapper = mountProject()
    await vi.waitFor(() => {
      expect(wrapper.find('[data-testid="mode-stat-typeset"]').exists()).toBe(true)
    })

    expect(toolbarMarkButton(wrapper, '标记嵌字')).toBeTruthy()
    expect(useToastStore().toasts.map((item) => item.message).join('|')).not.toContain(
      '已按职责切到'
    )
  })

  it('自己手动切走之后，重扫不会再把你拉回职责模式', async () => {
    mockRoute.params = { parentTitle: encodeURIComponent('ドラゴンボール'), childId: 'c1' }
    const store = useProjectWorkspace()
    store.parents = parentsWithDuties(['proofread'])
    window.comicType.scanChildProject = vi
      .fn()
      .mockResolvedValue({ jpgPairs: [makePair('page_001')], txtFiles: [], errors: [] })

    const wrapper = mountProject()
    await vi.waitFor(() => {
      expect(toolbarMarkButton(wrapper, '标记校对')).toBeTruthy()
    })

    // 手动切回「嵌字」：走真实的下拉（不 stub AppSelect）
    await wrapper.get('[data-testid="mark-mode-select-trigger"]').trigger('click')
    await wrapper.get('[data-testid="mark-mode-select-option-typeset"]').trigger('click')
    await nextTick()
    expect(toolbarMarkButton(wrapper, '标记嵌字')).toBeTruthy()

    // 窗口重新获得焦点 → 重扫（同一本漫画）→ 模式必须留在用户选的地方
    window.dispatchEvent(new Event('focus'))
    await flushPromises()
    await nextTick()
    await vi.waitFor(() => {
      expect(toolbarMarkButton(wrapper, '标记嵌字')).toBeTruthy()
    })
    // 注意：`toolbarMarkButton` 找不到就抛错，所以"不存在"要用 some() 查（别拿它当返回值判空）
    expect(wrapper.findAll('button').some((item) => item.text() === '标记校对')).toBe(false)
  })
})
