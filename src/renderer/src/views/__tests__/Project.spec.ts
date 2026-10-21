import { config, enableAutoUnmount } from '@vue/test-utils'
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

config.global.stubs.teleport = true
config.global.renderStubDefaultSlot = true
enableAutoUnmount(afterEach)
import { flushPromises, mount, type DOMWrapper, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import type { JpgPsdPair, ParentProject } from '@shared/types'

// vi.hoisted ensures mockRoute exists before the vi.mock factory runs.
const { mockRoute } = vi.hoisted(() => ({
  mockRoute: {
    query: {},
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

import { getThumbnailService, thumbnailKey } from '@renderer/services/thumbnails'
import Project from '../Project.vue'
import WorkModeSegments from '@renderer/components/WorkModeSegments.vue'
import type { WorkMode } from '@shared/types'
import SourceRootDialog from '@renderer/features/project/SourceRootDialog.vue'
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

/** Current chapter mode has its own control; changing the global default is not a chapter switch. */
async function selectChapterMode(wrapper: VueWrapper, mode: WorkMode): Promise<void> {
  wrapper.getComponent(WorkModeSegments).vm.$emit('update:modelValue', mode)
  await flushPromises()
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
/**
 * 5e 那条"草稿丢改动 + 键重映射"的锁需要**两条不同序号**的草稿改动。
 * 打开之后，替身按钮交替报第 1 / 第 5 条；**默认关着**（既有用例的默认行为一字不变）。
 * 每个用例开始前在顶层 `beforeEach` 里复位。
 */
let editSeqSwitch = false

const CompareViewerStub = {
  name: 'CompareViewer',
  data() {
    return { editCount: 0 }
  },
  // ⚠️ 这个方法替身是**必须的**：宿主会通过 ref 调 `scrollTranslationRowIntoView`
  // （"新增之后右栏滚过去"）。真组件暴露了它，替身不暴露 ⇒ 抛 `is not a function`
  // （本轮就是这么抓到的）。本仓踩过一次同类：测试工装的疏漏与真回归长得一样。
  // 它做成 `vi.fn()` 是为了让用例能直接断言"到底滚没滚、滚到第几条"。
  methods: {
    scrollTranslationRowIntoView: vi.fn(),
    /**
     * ⚠️ **默认行为一字不变**：点一下就改第 1 条（既有用例全靠这条默认）。
     * 只有 5e 那条"草稿丢改动 + 键重映射"的锁需要**两条不同序号**的改动，
     * 它自己把 {@link editSeqSwitch} 打开 ⇒ 这里交替报第 1 / 第 5 条。
     * （用模块级开关而不是 `globalThis`：Vue 的**模板表达式**只认一个白名单全局，
     *  `globalThis` 不在其中 —— 本轮踩过，报的是 "Cannot read properties of undefined"。）
     */
    onEditClick(this: { editCount: number; $emit: (event: string, ...args: unknown[]) => void }) {
      if (editSeqSwitch && this.editCount++ > 0) {
        this.$emit('translationEditText', 5, '另一条新译文')
        return
      }
      this.$emit('translationEditText', 1, '新译文')
    }
  },
  props: [
    'jpgPath',
    'psdPath',
    'visible',
    'playing',
    'thumbStripOpen',
    'advanceAfterMark',
    // P1 译文对照：给了 ⇒ 右栏是译文（契约跟着结构更新，断言一个字没改）
    'translation',
    // 2026-10-06 页码跳转：页头那枚进度胶囊删掉，换成原图分屏右上角的页码
    'pageNumber',
    'pageCount',
    // 第 5 批 5d-2：宿主把"刚新增的那一条"透传给右栏（瞬时高亮）。
    // ⚠️ **必须声明**：VTU 的 `props()` 只返回**声明过**的 prop —— 不声明就永远读到 `undefined`，
    // 那条断言就静默变成"测了个空气"（比红更糟）。
    'justAddedIndex'
  ],
  // ready / stopPlayback：看图三件套新增的两个挂钩（多根节点 + 不声明 = Vue 会警告）。
  // next / previous / openPsd 是它本来就对外发的（这里一并声明，免得再来一条同样的警告）。
  emits: [
    'mark',
    'close',
    'ready',
    'stopPlayback',
    'next',
    'previous',
    'openPsd',
    'pickPage',
    // P2 译文编辑 + 第 2 批（档位 / 理由 / 导出）：不声明就是一堆"监听器无法自动继承"的警告
    'translationEditText',
    'translationEditGroup',
    'translationMoveAnchor',
    'translationUndo',
    'translationDiscard',
    'translationSave',
    'translationMode',
    'translationEditReason',
    'translationExportReviews',
    // 第 3 批：另存一份译文
    'translationSaveAs',
    // 第 4 批：撤销校对 / 只删记录
    'translationUnreview',
    'translationDropReview',
    // 第 5 批 5d-2：新增框（图上的手势 + 页头那枚开关）
    'translationAddFrame',
    'translationAddFrameMode'
  ],
  template:
    '<div class="compare-viewer-stub">' +
    '<button class="compare-mark-done" @click="$emit(\'mark\', \'done\')">mark done</button>' +
    '<button class="compare-mark-pending" @click="$emit(\'mark\', \'pending\')">mark pending</button>' +
    '<button class="compare-close" @click="$emit(\'close\')">close</button>' +
    // 第 2 批：右栏那三个动作（改一条译文 / 手动改档位 / 导出校对记录）的替身按钮
    // ⚠️ 点一次改第 1 条、再点一次改第 5 条：5e 那条"草稿丢改动 + 键重映射"的锁需要
    //    **两条不同序号的改动**（一条要被删、一条要被挪），只有一个序号的话那条锁是空的。
    // ⚠️ 默认行为**一字不变**：点一下就改第 1 条（既有用例全靠这条默认行为；我第一版
    //    直接把默认改成"改第 5 条"，当场撞坏了两条旧锁 —— 工装不许悄悄改默认）。
    //    只有 5e 那条"草稿丢改动 + 键重映射"的锁需要**两条不同序号**的改动，
    //    它自己把 `globalThis.__EDIT_SEQ__` 打开，于是交替报第 1 / 第 5 条。
    '<button class="translation-edit-text-stub" @click="onEditClick">right pane edit</button>' +
    '<button class="translation-mode-stub" @click="$emit(\'translationMode\', \'translate\')">right pane mode</button>' +
    '<button class="translation-export-stub" @click="$emit(\'translationExportReviews\')">right pane export</button>' +
    '<button class="translation-save-as-stub" @click="$emit(\'translationSaveAs\')">right pane save as</button>' +
    '<button class="translation-unreview-stub" @click="$emit(\'translationUnreview\', 1)">right pane unreview</button>' +
    '<button class="translation-drop-stub" @click="$emit(\'translationDropReview\', 1)">right pane drop</button>' +
    // 第 5 批 5d-2：原图上"点一下 / 右键一下"与页头那枚开关
    '<button class="add-frame-inside-stub" @click="$emit(\'translationAddFrame\', \'框内\', 0.25, 0.75)">add inside</button>' +
    '<button class="add-frame-outside-stub" @click="$emit(\'translationAddFrame\', \'框外\', 0.5, 0.5)">add outside</button>' +
    '<button class="add-frame-mode-stub" @click="$emit(\'translationAddFrameMode\', true)">add frame mode on</button>' +
    '</div>'
}
const ProjectFormModalStub = {
  name: 'ProjectFormModal',
  props: ['mode', 'initialData'],
  template: '<div class="project-form-modal-stub"><slot /></div>'
}

beforeEach(() => {
  // 5e 那条锁会打开替身的"交替改条目"开关；**每个用例开始前必须关掉**
  //（这种开关不清就会串到别的用例上 —— 我第一版忘了复位，当场撞坏 8 条旧锁）。
  editSeqSwitch = false
  setActivePinia(createPinia())
  useSettingsStore().settingsLoaded = true
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
    pickDirectory: vi.fn().mockResolvedValue(null),
    // P1 译文对照的通道（默认"这一话没有 txt"；用它的用例自己覆盖）
    readChapterTranslation: vi.fn().mockResolvedValue({
      status: 'not-found',
      file: null,
      txtCount: 0,
      message: '话目录里没有 .txt 文件',
      document: null
    }),
    // 第 2 批：校对记录的三个通道（默认"一条都没记过"）
    listTranslationReviews: vi.fn().mockResolvedValue({ ok: true, records: [], message: '' }),
    saveTranslationReview: vi.fn().mockResolvedValue({ ok: true }),
    // 第 4 批：删一条校对记录
    deleteTranslationReview: vi.fn().mockResolvedValue({ ok: true, deleted: true }),
    // 第 3 批：另存一份译文（默认"用户取消"= 界面一个字都不该说）
    exportChapterTranslation: vi
      .fn()
      .mockResolvedValue({ ok: false, kind: 'canceled', message: '' }),
    exportTranslationReview: vi.fn().mockResolvedValue({ saved: true, path: '/tmp/校对记录.txt' })
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

  /**
   * 「修改扫描目录」的**宿主接线**（2026-10-05，需求二）。
   *
   * 侧栏那条链有三段：树里的按钮 → 侧栏转发 → 宿主开弹窗。
   * 前两段各有自己的锁（`ProjectTree.spec` / `ProjectSidebar.spec`），
   * 这里锁最后一段：**event 真的能开出一个显示"当前扫描目录"的弹窗**。
   * 少了这一段，前两段全绿、用户点了还是没反应 —— 本仓库对"点了没反应"一向零容忍。
   */
  it('侧栏管理模式抛「扫描目录」⇒ 打开弹窗并显示当前扫描目录', async () => {
    mockRoute.params = {
      parentTitle: encodeURIComponent('ドラゴンボール'),
      childId: 'c1'
    }
    const store = useProjectWorkspace()
    store.parents = makeParents()
    const preview = {
      canDetect: true,
      sourceRoot: '/tmp',
      sourceRoots: ['/tmp'],
      candidates: [],
      duplicatePaths: 0
    }
    ;(window.comicType as unknown as { selfCheckPreview: unknown }).selfCheckPreview = vi
      .fn()
      .mockResolvedValue(preview)

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

    wrapper.findComponent(ProjectSidebarStub).vm.$emit('editSourceRoot', 'p1')
    await flushPromises()

    const dialog = wrapper.findComponent(SourceRootDialog)
    expect(dialog.props('visible')).toBe(true)
    expect(dialog.props('parentTitle')).toBe('ドラゴンボール')
    // "当前"不是从库里那个字段抄的，而是问主进程要的权威结果
    expect(window.comicType.selfCheckPreview).toHaveBeenCalledWith('p1')
    expect(dialog.props('currentRoots')).toEqual(['/tmp'])
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

    // 2026-10-06（用户拍板）：页头那枚统计胶囊**已删**（连同四模式各自那枚）。
    // 删得掉是因为它与页脚读**同一个 computed** —— 信息在页脚，页头重复显示而已。
    expect(wrapper.findAll('[data-testid^="mode-stat-"]')).toHaveLength(0)
    // 而页脚那条照旧在（**信息没丢**，这才是"删得掉"的证据）
    expect(wrapper.find('.footer-figure').text()).toBeTruthy()
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
    window.comicType.scanChildProject = vi.fn().mockResolvedValue({
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
    expect(wrapper.find('[data-testid="mark-mode-select"]').exists()).toBe(false)

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
    window.comicType.scanChildProject = vi.fn().mockResolvedValue({
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

  it('缩略图条直接复用共享缓存，不另存一份可能失效的 URL', async () => {
    const wrapper = await setupTwoPages()
    await wrapper.get('.thumb-open-second').trigger('click')
    await wrapper.get('[data-testid="viewer-thumb-strip-toggle"]').trigger('click')

    // 还没上报时是页码占位，一个 <img> 都没有。
    expect(wrapper.findAll('[data-testid="viewer-thumb-track"] img')).toHaveLength(0)

    await flushPromises()
    const actualPair = (
      wrapper.findComponent({ name: 'ProjectThumbList' }).props('pairs') as JpgPsdPair[]
    )[0]
    const key = thumbnailKey(actualPair)
    getThumbnailService().states.set(key, { status: 'ready', url: 'data:image/png;base64,aaa' })
    await flushPromises()

    const images = wrapper.findAll('[data-testid="viewer-thumb-track"] img')
    expect(images).toHaveLength(1)
    expect(images[0].attributes('src')).toBe('data:image/png;base64,aaa')
    getThumbnailService().states.delete(key)
    await flushPromises()
    expect(wrapper.findAll('[data-testid="viewer-thumb-track"] img')).toHaveLength(0)
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

    const play = wrapper.get('[data-testid="viewer-play-toggle"]').element as HTMLButtonElement
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
    window.comicType.scanChildProject = vi.fn().mockResolvedValue({
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

  it('第5批 · **对照视图里 Ctrl+Z 不撤标记**（用户拍板：撤销标记只在缩略图视图管用）', async () => {
    const { wrapper, undoMark } = await setup()
    // 打开对照视图（那层覆盖窗）
    await wrapper.get('.thumb-open-second').trigger('click')
    await flushPromises()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true }))
    await flushPromises()
    expect(undoMark).not.toHaveBeenCalled()
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
    window.comicType.scanChildProject = vi.fn().mockResolvedValue({
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
describe('职责与当前章节工作模式', () => {
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

  it('进入章节按职责选择模式，但不覆盖全局默认模式', async () => {
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
      expect(toolbarMarkButton(wrapper, '标记已校对')).toBeTruthy()
    })
    expect(useSettingsStore().activeWorkMode).toBe('typeset')
    // 提示由应用外壳渲染（不在这棵树里）⇒ 断 toast store 里的那条消息
    const messages = useToastStore()
      .toasts.map((item) => item.message)
      .join('|')
    expect(messages).not.toContain('已按职责切到')
  })

  it('没声明职责、也没有标记可推断 → 保持默认「嵌字」，不弹任何提示', async () => {
    mockRoute.params = { parentTitle: encodeURIComponent('ドラゴンボール'), childId: 'c1' }
    const store = useProjectWorkspace()
    store.parents = parentsWithDuties(undefined)
    window.comicType.scanChildProject = vi
      .fn()
      .mockResolvedValue({ jpgPairs: [makePair('page_001')], txtFiles: [], errors: [] })

    const wrapper = mountProject()
    // 等这一话挂上。原来是等 `mode-stat-typeset` 出现 —— 那枚已删，
    // 改用「工具栏的标记按钮」当就绪信号（同一时刻才可能出现）。
    await vi.waitFor(() => {
      expect(toolbarMarkButton(wrapper, '标记已嵌字')).toBeTruthy()
    })
    expect(
      useToastStore()
        .toasts.map((item) => item.message)
        .join('|')
    ).not.toContain('已按职责切到')
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
      expect(toolbarMarkButton(wrapper, '标记已校对')).toBeTruthy()
    })

    // 通过真实分段控件切到监修
    await selectChapterMode(wrapper, 'supervised')
    await flushPromises()
    await nextTick()
    expect(toolbarMarkButton(wrapper, '标记已监修')).toBeTruthy()

    // 窗口重新获得焦点 → 重扫（同一本漫画）→ 模式必须留在用户选的地方
    window.dispatchEvent(new Event('focus'))
    await flushPromises()
    await nextTick()
    await vi.waitFor(() => {
      expect(toolbarMarkButton(wrapper, '标记已监修')).toBeTruthy()
    })
    // 注意：`toolbarMarkButton` 找不到就抛错，所以"不存在"要用 some() 查（别拿它当返回值判空）
    expect(wrapper.findAll('button').some((item) => item.text() === '标记已校对')).toBe(false)
  })
})

/**
 * P1「译文对照」的**宿主接线**（2026-10-06）：入口是**模式驱动**。
 *
 * 用户拍板：翻译 / 校对模式 → 对照视图右栏换成译文；嵌字 / 监修 → 右栏仍是 PSD。
 * 这两条锁的正是"什么时候才去读译文" —— 读错了模式就是白读一次盘。
 */
describe('Project · 译文对照（P1）：入口是模式驱动', () => {
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

  /** 造一份"这一话的译文"：两张图，第 2 张有两条。 */
  function translationDocument(): Record<string, unknown> {
    return {
      sourcePath: '/tmp/第1話/译文.txt',
      version: { first: 1, last: 0 },
      groups: ['框内', '框外'],
      images: [
        {
          fileName: 'page_002.jpg',
          labels: [
            {
              index: 1,
              group: '框内',
              text: '难道是我说错话了?',
              position: { unit: 'normalized', x: 0.5, y: 0.5 }
            },
            {
              index: 4,
              group: '框外',
              text: '嘟囔',
              position: { unit: 'normalized', x: 0.25, y: 0.75 }
            }
          ]
        }
      ],
      warnings: []
    }
  }

  it('嵌字模式 ⇒ 不给译文模型，而且**一次都不去读**（白读一次盘就是白等）', async () => {
    mockRoute.params = { parentTitle: encodeURIComponent('ドラゴンボール'), childId: 'c1' }
    const store = useProjectWorkspace()
    store.parents = makeParents()
    const read = vi.fn().mockResolvedValue({
      status: 'ok',
      file: { path: '/tmp/第1話/译文.txt', name: '译文.txt', mtimeMs: 1 },
      txtCount: 1,
      message: '',
      document: translationDocument()
    })
    window.comicType.readChapterTranslation = read
    window.comicType.scanChildProject = vi.fn().mockResolvedValue({
      jpgPairs: [makePair('page_001'), makePair('page_002')],
      txtFiles: [],
      errors: []
    })

    const wrapper = mountProject()
    await flushPromises()
    await wrapper.get('.thumb-open-second').trigger('click')
    await flushPromises()

    expect(wrapper.findComponent(CompareViewerStub).props('translation')).toBeNull()
    expect(read).not.toHaveBeenCalled()
  })

  it('切到「翻译」⇒ 给出译文模型，并按"当前这一页"解析出条目', async () => {
    mockRoute.params = { parentTitle: encodeURIComponent('ドラゴンボール'), childId: 'c1' }
    const store = useProjectWorkspace()
    store.parents = makeParents()
    const read = vi.fn().mockResolvedValue({
      status: 'ok',
      file: { path: '/tmp/第1話/译文.txt', name: '译文.txt', mtimeMs: 1 },
      txtCount: 1,
      message: '',
      document: translationDocument()
    })
    window.comicType.readChapterTranslation = read
    window.comicType.scanChildProject = vi.fn().mockResolvedValue({
      jpgPairs: [makePair('page_001'), makePair('page_002')],
      txtFiles: [],
      errors: []
    })

    const wrapper = mountProject()
    await flushPromises()
    // 打开第 2 页（`page_002`）的对照视图
    await wrapper.get('.thumb-open-second').trigger('click')
    await flushPromises()

    // 手动切到「翻译」：走真实下拉（不 stub AppSelect）
    await selectChapterMode(wrapper, 'translated')
    await flushPromises()
    await nextTick()

    // 读的是**话自己的目录**
    expect(read).toHaveBeenCalledWith('/tmp/第1話')

    const model = wrapper.findComponent(CompareViewerStub).props('translation') as {
      loading: boolean
      entry: { fileName: string } | null
      groups: string[]
    }
    expect(model).not.toBeNull()
    expect(model.entry?.fileName).toBe('page_002.jpg')
    expect(model.groups).toEqual(['框内', '框外'])
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// 译文栏改版第 2 批：两档开关（翻译 / 校对）＋ 校对记录
// ══════════════════════════════════════════════════════════════════════════════

describe('Project · 译文栏第 2 批：档位联动 与 校对记录', () => {
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

  /** 这一话的译文：两张图；`page_002` 上有两条。 */
  function translationDocument(): Record<string, unknown> {
    return {
      sourcePath: '/tmp/第1話/译文.txt',
      version: { first: 1, last: 0 },
      groups: ['框内', '框外'],
      images: [
        {
          fileName: 'page_002.jpg',
          labels: [
            {
              index: 1,
              group: '框内',
              text: '难道是我说错话了?',
              position: { unit: 'normalized', x: 0.5, y: 0.5 }
            },
            {
              index: 4,
              group: '框外',
              text: '嘟囔',
              position: { unit: 'normalized', x: 0.25, y: 0.75 }
            }
          ]
        }
      ],
      warnings: []
    }
  }

  function reviewRecord(partial: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      folderPath: '/tmp/第1話',
      imageName: 'page_002.jpg',
      labelIndex: 1,
      page: 2,
      originalText: '（第一次校对时的原文）',
      reviewedText: '（第一次校对写进去的稿子）',
      reason: '语气太软，改成肯定句',
      at: 1,
      ...partial
    }
  }

  function setup(records: Array<Record<string, unknown>> = []): VueWrapper {
    mockRoute.params = { parentTitle: encodeURIComponent('ドラゴンボール'), childId: 'c1' }
    const store = useProjectWorkspace()
    store.parents = makeParents()
    window.comicType.readChapterTranslation = vi.fn().mockResolvedValue({
      status: 'ok',
      file: { path: '/tmp/第1話/译文.txt', name: '译文.txt', mtimeMs: 1 },
      txtCount: 1,
      message: '',
      document: translationDocument()
    })
    window.comicType.scanChildProject = vi.fn().mockResolvedValue({
      jpgPairs: [makePair('page_001'), makePair('page_002')],
      txtFiles: [],
      errors: []
    })
    window.comicType.listTranslationReviews = vi
      .fn()
      .mockResolvedValue({ ok: true, records, message: '' })
    window.comicType.saveTranslationReview = vi.fn().mockResolvedValue({ ok: true })
    window.comicType.saveChapterTranslation = vi.fn().mockResolvedValue({
      ok: true,
      changed: true,
      backupPath: '/tmp/bak/译文.txt',
      fingerprint: { size: 1, mtimeMs: 1, sha256: 'a'.repeat(64) }
    })
    return mountProject()
  }

  /** 打开第 2 页的对照视图，并把四模式切到指定工序（走真实下拉，不 stub AppSelect）。 */
  async function openWithMode(
    wrapper: VueWrapper,
    mode: 'translated' | 'proofread'
  ): Promise<void> {
    // 先让首帧的扫描落地（缩略图条要有 pairs 才画得出按钮）
    await flushPromises()
    await wrapper.get('.thumb-open-second').trigger('click')
    await flushPromises()
    await selectChapterMode(wrapper, mode)
    await flushPromises()
    await nextTick()
  }

  interface TranslationModel {
    mode: string
    reviewCount: number
    reviews: Record<number, { originalText: string; reason: string }>
    notice: string
    entry: { fileName: string } | null
  }
  function model(wrapper: VueWrapper): TranslationModel {
    return wrapper
      .findComponent(CompareViewerStub)
      .props('translation') as unknown as TranslationModel
  }

  it('切到「校对」工序 ⇒ 译文栏**自动切到校对档**（联动）', async () => {
    const wrapper = setup()
    await openWithMode(wrapper, 'proofread')
    expect(model(wrapper).mode).toBe('review')
  })

  it('切到「翻译」工序 ⇒ 翻译档（不是所有模式都进校对档）', async () => {
    const wrapper = setup()
    await openWithMode(wrapper, 'translated')
    expect(model(wrapper).mode).toBe('translate')
  })

  it('手动把档位改回去 ⇒ **本会话内不再跟着四模式走**', async () => {
    const wrapper = setup()
    await openWithMode(wrapper, 'proofread')
    expect(model(wrapper).mode).toBe('review')

    // 右栏那枚开关（替身按钮代替真实点击，它发的就是同一条事件）
    await wrapper.get('.translation-mode-stub').trigger('click')
    await nextTick()
    expect(model(wrapper).mode).toBe('translate')

    // 再切一次工序：不该被重新拽回校对档
    await selectChapterMode(wrapper, 'translated')
    await flushPromises()
    await selectChapterMode(wrapper, 'proofread')
    await flushPromises()
    expect(model(wrapper).mode).toBe('translate')
  })

  it('这一话有记录 ⇒ 模型里带上"这一页的原文/理由"与整话已校条数', async () => {
    const wrapper = setup([reviewRecord()])
    await openWithMode(wrapper, 'proofread')
    // 读的是**话自己的目录**
    expect(window.comicType.listTranslationReviews).toHaveBeenCalledWith('/tmp/第1話')
    const current = model(wrapper)
    expect(current.reviewCount).toBe(1)
    expect(current.reviews[1]).toEqual({
      originalText: '（第一次校对时的原文）',
      reason: '语气太软，改成肯定句'
    })
    // 不在这一页的条目不该出现
    expect(Object.keys(current.reviews)).toEqual(['1'])
  })

  it('记录读不出来 ⇒ 说人话（不假装"这一话没校对过"）', async () => {
    const wrapper = setup()
    window.comicType.listTranslationReviews = vi
      .fn()
      .mockResolvedValue({ ok: false, records: [], message: '读不了校对记录：库锁着' })
    await openWithMode(wrapper, 'proofread')
    // 重新触发一次读（切档位不会重读，这里换页触发）
    await wrapper.get('.thumb-open-second').trigger('click')
    await flushPromises()
    expect(model(wrapper).notice).toContain('读不了校对记录')
  })

  it('校对档下改一条 ⇒ 覆盖保存进 txt，并写一条记录（原文 = **记录里那份**，理由留着）', async () => {
    const wrapper = setup([reviewRecord()])
    await openWithMode(wrapper, 'proofread')
    await wrapper.get('.translation-edit-text-stub').trigger('click')
    await flushPromises()

    // ① 真的走的是"覆盖保存"那条现成通道（没有第二条写盘路径）
    const saveCall = (window.comicType.saveChapterTranslation as unknown as Mock).mock.calls.at(
      -1
    )?.[0] as { filePath: string; edits: unknown[] }
    expect(saveCall.filePath).toBe('/tmp/第1話/译文.txt')
    expect(saveCall.edits).toEqual([{ imageName: 'page_002.jpg', labelIndex: 1, text: '新译文' }])

    // ② 记录：原文是**已有的那份**（第二次校对不许把唯一的原文顶掉），理由原样留着
    const reviewCall = (window.comicType.saveTranslationReview as unknown as Mock).mock.calls.at(
      -1
    )?.[0] as Record<string, unknown>
    expect(reviewCall).toMatchObject({
      folderPath: '/tmp/第1話',
      imageName: 'page_002.jpg',
      labelIndex: 1,
      page: 2,
      originalText: '（第一次校对时的原文）',
      reviewedText: '新译文',
      reason: '语气太软，改成肯定句'
    })
    expect(typeof reviewCall.at).toBe('number')
  })

  it('**理由绝不进 txt**（负向锁：写盘载荷里连 "reason" 这个词都没有）', async () => {
    const wrapper = setup([reviewRecord()])
    await openWithMode(wrapper, 'proofread')
    await wrapper.get('.translation-edit-text-stub').trigger('click')
    await flushPromises()

    const saveCall = (window.comicType.saveChapterTranslation as unknown as Mock).mock.calls.at(
      -1
    )?.[0] as unknown
    const payload = JSON.stringify(saveCall)
    expect(payload).not.toContain('语气太软')
    expect(payload).not.toContain('reason')
  })

  it('翻译档下改一条 ⇒ **不写记录**（那一档不是校对）', async () => {
    const wrapper = setup()
    await openWithMode(wrapper, 'translated')
    await wrapper.get('.translation-edit-text-stub').trigger('click')
    await flushPromises()
    expect(window.comicType.saveChapterTranslation).toHaveBeenCalled()
    expect(window.comicType.saveTranslationReview).not.toHaveBeenCalled()
  })

  it('导出：把**当前话**拼成文本交给主进程（「校」取 txt 现在那份；无评不写「评：」）', async () => {
    const wrapper = setup([
      reviewRecord(),
      reviewRecord({
        labelIndex: 4,
        originalText: '',
        reviewedText: '（旧稿）',
        reason: ''
      })
    ])
    await openWithMode(wrapper, 'proofread')
    await wrapper.get('.translation-export-stub').trigger('click')
    await flushPromises()

    const request = (window.comicType.exportTranslationReview as unknown as Mock).mock.calls.at(
      -1
    )?.[0] as { text: string; defaultFileName: string }
    expect(request.defaultFileName).toBe('ドラゴンボール-第1集-校对记录.txt')
    const lines = request.text.split('\n')
    expect(lines[0]).toBe('作品：ドラゴンボール')
    expect(lines[1]).toBe('话：第1集')
    expect(lines[2]).toMatch(/^时间：\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)
    expect(lines[3]).toBe('已校：2 条')
    // 「校」= **现在 txt 里的值**（记录里那份是当时写的，之后可能又被改过）
    expect(request.text).toContain(
      '第2页·page_002.jpg\n翻：（第一次校对时的原文）\n校：难道是我说错话了?\n评：语气太软，改成肯定句'
    )
    // 原文为空的那条照写漏翻那句；它没有理由 ⇒ 不写「评：」那一行
    expect(request.text).toContain('翻：（无 —— 翻译漏了这处）\n校：嘟囔')
    expect(request.text.split('评：')).toHaveLength(2)
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// 译文栏改版第 3 批：另存一份译文（不动话目录里那份）
// ══════════════════════════════════════════════════════════════════════════════

describe('Project · 译文栏第 3 批：另存一份译文', () => {
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

  function translationDocument(): Record<string, unknown> {
    return {
      sourcePath: '/tmp/第1話/译文.txt',
      version: { first: 1, last: 0 },
      groups: ['框内', '框外'],
      images: [
        {
          fileName: 'page_002.jpg',
          labels: [
            {
              index: 1,
              group: '框内',
              text: '难道是我说错话了?',
              position: { unit: 'normalized', x: 0.5, y: 0.5 }
            }
          ]
        }
      ],
      warnings: []
    }
  }

  function setup(): VueWrapper {
    mockRoute.params = { parentTitle: encodeURIComponent('ドラゴンボール'), childId: 'c1' }
    const store = useProjectWorkspace()
    store.parents = makeParents()
    window.comicType.readChapterTranslation = vi.fn().mockResolvedValue({
      status: 'ok',
      file: { path: '/tmp/第1話/译文.txt', name: '译文.txt', mtimeMs: 1 },
      txtCount: 1,
      message: '',
      document: translationDocument()
    })
    window.comicType.scanChildProject = vi.fn().mockResolvedValue({
      jpgPairs: [makePair('page_001'), makePair('page_002')],
      txtFiles: [],
      errors: []
    })
    return mountProject()
  }

  async function openTranslated(wrapper: VueWrapper): Promise<void> {
    await flushPromises()
    await wrapper.get('.thumb-open-second').trigger('click')
    await flushPromises()
    await selectChapterMode(wrapper, 'translated')
    await flushPromises()
    await nextTick()
  }

  interface ExportRequest {
    sourcePath: string | null
    edits: unknown[]
    defaultFileName: string
    defaultDirectory: string
    pages: string[]
  }

  function exportMock(
    result: Record<string, unknown> = { ok: true, path: '/tmp/x.txt', bytes: 12, generated: false }
  ): ReturnType<typeof vi.fn> {
    const mock = vi.fn().mockResolvedValue(result)
    window.comicType.exportChapterTranslation = mock as never
    return mock
  }

  function lastRequest(mock: ReturnType<typeof vi.fn>): ExportRequest {
    return mock.mock.calls.at(-1)?.[0] as ExportRequest
  }

  function notice(wrapper: VueWrapper): string {
    return (
      wrapper.findComponent(CompareViewerStub).props('translation') as unknown as {
        notice: string
      }
    ).notice
  }

  it('点「另存…」⇒ 交出这份 txt、话目录、默认名与按页序的图名', async () => {
    const wrapper = setup()
    const mock = exportMock()
    await openTranslated(wrapper)
    await wrapper.get('.translation-save-as-stub').trigger('click')
    await flushPromises()

    const request = lastRequest(mock)
    expect(request.sourcePath).toBe('/tmp/第1話/译文.txt')
    expect(request.defaultDirectory).toBe('/tmp/第1話')
    // 默认名沿用那份 txt 的名字 + 时间戳（同一个位置反复另存不会互相覆盖）
    expect(request.defaultFileName).toMatch(/^译文-另存-\d{8}-\d{4}\.txt$/)
    expect(request.pages).toEqual(['page_001.jpg', 'page_002.jpg'])
    expect(request.edits).toEqual([])
  })

  it('**还没落盘的改动要跟着另存走**（另存出来的得是"界面上现在这份"）', async () => {
    const wrapper = setup()
    const mock = exportMock()
    // 让"保存"失败 ⇒ 草稿里的那条改动**还留着**（就是"还没落盘"那种状态）
    window.comicType.saveChapterTranslation = vi.fn().mockRejectedValue(new Error('写盘失败'))
    await openTranslated(wrapper)
    await wrapper.get('.translation-edit-text-stub').trigger('click')
    await flushPromises()
    await wrapper.get('.translation-save-as-stub').trigger('click')
    await flushPromises()

    expect(lastRequest(mock).edits).toEqual([
      { imageName: 'page_002.jpg', labelIndex: 1, text: '新译文' }
    ])
  })

  it('这一话没有可解析的 txt ⇒ sourcePath 传 null（主进程从零生成），默认名改用话目录名', async () => {
    const wrapper = setup()
    const mock = exportMock()
    window.comicType.readChapterTranslation = vi.fn().mockResolvedValue({
      status: 'not-found',
      file: null,
      txtCount: 0,
      message: '话目录里没有 .txt 文件',
      document: null
    })
    await openTranslated(wrapper)
    await wrapper.get('.translation-save-as-stub').trigger('click')
    await flushPromises()

    const request = lastRequest(mock)
    expect(request.sourcePath).toBeNull()
    expect(request.defaultFileName).toMatch(/^第1話-另存-\d{8}-\d{4}\.txt$/)
    // 从零生成那份要把页面交出去（不然主进程只能造一个空文件）
    expect(request.pages).toEqual(['page_001.jpg', 'page_002.jpg'])
  })

  it('**还在读译文的时候点另存 ⇒ 拒绝**（这时"有没有 txt"还没答案，赌错就把空底稿当译文存出去了）', async () => {
    const wrapper = setup()
    const mock = exportMock()
    // 读这一话的译文**永不返回** ⇒ `result` 一直是 null（就是刚进页面那一瞬）
    window.comicType.readChapterTranslation = vi.fn().mockReturnValue(new Promise(() => {}))
    await openTranslated(wrapper)
    await wrapper.get('.translation-save-as-stub').trigger('click')
    await flushPromises()

    expect(mock).not.toHaveBeenCalled()
    expect(notice(wrapper)).toContain('还在读这一话的译文')
  })

  it('另存失败 ⇒ 状态条说人话；**用户取消一个字都不说**', async () => {
    const wrapper = setup()
    const mock = exportMock({
      ok: false,
      kind: 'invalid',
      message: '那是这一话的原文本身。要写回原件请用「保存」，另存请换一个位置。'
    })
    await openTranslated(wrapper)
    await wrapper.get('.translation-save-as-stub').trigger('click')
    await flushPromises()
    expect(notice(wrapper)).toContain('请用「保存」')

    mock.mockResolvedValue({ ok: false, kind: 'canceled', message: '' })
    await wrapper.get('.translation-save-as-stub').trigger('click')
    await flushPromises()
    expect(notice(wrapper)).toBe('')
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// 译文栏第 4 批：撤销校对（先写回原文、成功了才删记录）／只删记录
// ══════════════════════════════════════════════════════════════════════════════

describe('Project · 译文栏第 4 批：校对反悔这条路', () => {
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

  function translationDocument(): Record<string, unknown> {
    return {
      sourcePath: '/tmp/第1話/译文.txt',
      version: { first: 1, last: 0 },
      groups: ['框内', '框外'],
      images: [
        {
          fileName: 'page_002.jpg',
          labels: [
            {
              index: 1,
              group: '框内',
              text: '难道是我说错话了?',
              position: { unit: 'normalized', x: 0.5, y: 0.5 }
            }
          ]
        }
      ],
      warnings: []
    }
  }

  /** 一条"已经校对过"的记录：原文与现在 txt 里的值故意不同，好分辨方向。 */
  const RECORD = {
    folderPath: '/tmp/第1話',
    imageName: 'page_002.jpg',
    labelIndex: 1,
    page: 2,
    originalText: '（校对前的原文）',
    reviewedText: '难道是我说错话了?',
    reason: '语气太软',
    at: 1
  }

  function setup(): VueWrapper {
    mockRoute.params = { parentTitle: encodeURIComponent('ドラゴンボール'), childId: 'c1' }
    const store = useProjectWorkspace()
    store.parents = makeParents()
    window.comicType.readChapterTranslation = vi.fn().mockResolvedValue({
      status: 'ok',
      file: {
        path: '/tmp/第1話/译文.txt',
        name: '译文.txt',
        mtimeMs: 1,
        size: 1024,
        sha256: 'a'.repeat(64)
      },
      txtCount: 1,
      message: '',
      document: translationDocument()
    })
    window.comicType.scanChildProject = vi.fn().mockResolvedValue({
      jpgPairs: [makePair('page_001'), makePair('page_002')],
      txtFiles: [],
      errors: []
    })
    window.comicType.listTranslationReviews = vi
      .fn()
      .mockResolvedValue({ ok: true, records: [RECORD], message: '' })
    window.comicType.saveChapterTranslation = vi.fn().mockResolvedValue({
      ok: true,
      changed: true,
      backupPath: '/tmp/bak/译文.txt',
      fingerprint: { size: 1, mtimeMs: 1, sha256: 'a'.repeat(64) }
    })
    window.comicType.deleteTranslationReview = vi
      .fn()
      .mockResolvedValue({ ok: true, deleted: true })
    return mountProject()
  }

  async function openTranslated(wrapper: VueWrapper): Promise<void> {
    await flushPromises()
    await wrapper.get('.thumb-open-second').trigger('click')
    await flushPromises()
    await selectChapterMode(wrapper, 'translated')
    await flushPromises()
    await nextTick()
  }

  function modelNotice(wrapper: VueWrapper): string {
    return (
      wrapper.findComponent(CompareViewerStub).props('translation') as unknown as {
        notice: string
        changedIndices: number[]
      }
    ).notice
  }

  function changedIndices(wrapper: VueWrapper): number[] {
    return (
      wrapper.findComponent(CompareViewerStub).props('translation') as unknown as {
        changedIndices: number[]
      }
    ).changedIndices
  }

  it('撤销校对：**先把原文写回 txt**，成功了才删记录（顺序是一条锁）', async () => {
    const wrapper = setup()
    const save = window.comicType.saveChapterTranslation as unknown as ReturnType<typeof vi.fn>
    const drop = window.comicType.deleteTranslationReview as unknown as ReturnType<typeof vi.fn>
    await openTranslated(wrapper)
    await wrapper.get('.translation-unreview-stub').trigger('click')
    await flushPromises()

    // ① 写回的是**记录里那份原文**，走的是「保存」那条通道（带基指纹）
    const payload = save.mock.calls.at(-1)?.[0] as {
      filePath: string
      base: { sha256: string }
      edits: unknown[]
    }
    expect(payload.filePath).toBe('/tmp/第1話/译文.txt')
    expect(payload.base.sha256).toBe('a'.repeat(64))
    expect(payload.edits).toEqual([
      { imageName: 'page_002.jpg', labelIndex: 1, text: '（校对前的原文）' }
    ])

    // ② 删记录，且**必须排在写盘之后**（反过来就是把唯一的原文丢了）
    expect(drop.mock.calls.at(-1)?.[0]).toEqual({
      folderPath: '/tmp/第1話',
      imageName: 'page_002.jpg',
      labelIndex: 1
    })
    expect(save.mock.invocationCallOrder.at(-1)!).toBeLessThan(
      drop.mock.invocationCallOrder.at(-1)!
    )
    // ③ 撤销完要重读这一话（右栏得显示回原文）
    expect(window.comicType.readChapterTranslation).toHaveBeenCalledTimes(2)
  })

  it('**写盘失败 ⇒ 一条记录都不删**（原文还在库里，用户还能再试）', async () => {
    const wrapper = setup()
    const drop = window.comicType.deleteTranslationReview as unknown as ReturnType<typeof vi.fn>
    window.comicType.saveChapterTranslation = vi
      .fn()
      .mockResolvedValue({ ok: false, kind: 'io', message: '写不进去' })
    await openTranslated(wrapper)
    await wrapper.get('.translation-unreview-stub').trigger('click')
    await flushPromises()

    expect(drop).not.toHaveBeenCalled()
    expect(modelNotice(wrapper)).toContain('写不进去')
  })

  it('撞上冲突 ⇒ 也**不删记录**，而且给一句能照着做的人话（不复用草稿那个弹窗）', async () => {
    const wrapper = setup()
    const drop = window.comicType.deleteTranslationReview as unknown as ReturnType<typeof vi.fn>
    window.comicType.saveChapterTranslation = vi.fn().mockResolvedValue({
      ok: false,
      kind: 'conflict',
      message: '这个 txt 在你读进来之后被改过了',
      current: { size: 2, mtimeMs: 2, sha256: 'b'.repeat(64) }
    })
    await openTranslated(wrapper)
    await wrapper.get('.translation-unreview-stub').trigger('click')
    await flushPromises()

    expect(drop).not.toHaveBeenCalled()
    expect(modelNotice(wrapper)).toContain('重新读一遍')
  })

  it('**只删记录**：一个字节都不写 txt', async () => {
    const wrapper = setup()
    const save = window.comicType.saveChapterTranslation as unknown as ReturnType<typeof vi.fn>
    const drop = window.comicType.deleteTranslationReview as unknown as ReturnType<typeof vi.fn>
    await openTranslated(wrapper)
    await wrapper.get('.translation-drop-stub').trigger('click')
    await flushPromises()

    expect(drop).toHaveBeenCalledTimes(1)
    expect(save).not.toHaveBeenCalled()
  })

  it('草稿里那条**还没落盘的改动要一起丢掉**（否则下一次自动保存会把刚撤销的写回去）', async () => {
    const wrapper = setup()
    // 先让"保存"失败 ⇒ 草稿里留下一条没落盘的改动（就是"还没落盘"那种状态）
    window.comicType.saveChapterTranslation = vi.fn().mockRejectedValue(new Error('写盘失败'))
    await openTranslated(wrapper)
    await wrapper.get('.translation-edit-text-stub').trigger('click')
    await flushPromises()
    expect(changedIndices(wrapper)).toEqual([1])

    // 撤销那一下：写盘成功
    window.comicType.saveChapterTranslation = vi.fn().mockResolvedValue({
      ok: true,
      changed: true,
      backupPath: null,
      fingerprint: { size: 1, mtimeMs: 1, sha256: 'a'.repeat(64) }
    })
    await wrapper.get('.translation-unreview-stub').trigger('click')
    await flushPromises()

    expect(changedIndices(wrapper)).toEqual([])
  })
})

/**
 * 回退最近一次保存 · Ctrl+Z 连退链（2026-10-07）
 *
 * 优先级（用户拍板）：**有草稿 → 撤草稿；没草稿但本会话存过 → 退一步；栈空 → 落到原有行为。**
 * 每按一次退**一步**，一直退到本会话开始为止（真值在主进程那个会话堆栈里）。
 */
describe('Project · 回退最近一次保存：Ctrl+Z 连退链', () => {
  function translationDocument(): Record<string, unknown> {
    return {
      sourcePath: '/tmp/第1話/译文.txt',
      version: { first: 1, last: 0 },
      groups: ['框内', '框外'],
      images: [
        {
          fileName: 'page_002.jpg',
          labels: [
            {
              index: 1,
              group: '框内',
              text: '难道是我说错话了?',
              position: { unit: 'normalized', x: 0.5, y: 0.5 }
            }
          ]
        }
      ],
      warnings: []
    }
  }

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

  function okSaved(): Record<string, unknown> {
    return {
      ok: true,
      changed: true,
      backupPath: '/tmp/bak/译文.txt',
      fingerprint: { size: 1, mtimeMs: 1, sha256: 'a'.repeat(64) }
    }
  }

  function setup(options: { save?: Mock } = {}): VueWrapper {
    mockRoute.params = { parentTitle: encodeURIComponent('ドラゴンボール'), childId: 'c1' }
    const store = useProjectWorkspace()
    store.parents = makeParents()
    window.comicType.readChapterTranslation = vi.fn().mockResolvedValue({
      status: 'ok',
      file: {
        path: '/tmp/第1話/译文.txt',
        name: '译文.txt',
        mtimeMs: 1,
        size: 1024,
        sha256: 'a'.repeat(64)
      },
      txtCount: 1,
      message: '',
      document: translationDocument()
    })
    window.comicType.scanChildProject = vi.fn().mockResolvedValue({
      jpgPairs: [makePair('page_001'), makePair('page_002')],
      txtFiles: [],
      errors: []
    })
    window.comicType.saveChapterTranslation = options.save ?? vi.fn().mockResolvedValue(okSaved())
    window.comicType.undoChapterTranslation = vi.fn().mockResolvedValue({
      ok: true,
      changed: true,
      backupPath: '/tmp/bak/译文.txt',
      fingerprint: { size: 1, mtimeMs: 2, sha256: 'b'.repeat(64) }
    })
    return mountProject()
  }

  async function openTranslated(wrapper: VueWrapper): Promise<void> {
    await flushPromises()
    await wrapper.get('.thumb-open-second').trigger('click')
    await flushPromises()
    await selectChapterMode(wrapper, 'translated')
    await flushPromises()
    await nextTick()
  }

  /** 右栏看到的"这一页改过哪几条"（空数组 = 草稿干净）。 */
  function changedIndices(wrapper: VueWrapper): number[] {
    return (
      wrapper.findComponent(CompareViewerStub).props('translation') as unknown as {
        changedIndices: number[]
      }
    ).changedIndices
  }

  function undoCalls(): Mock {
    return window.comicType.undoChapterTranslation as unknown as Mock
  }

  function ctrlZ(): void {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true }))
  }

  /**
   * ⚠️ `Project` 把 Ctrl+Z 的监听挂在 `window` 上，而本套件里**前面的用例并没有卸载组件**
   * （VTU 默认不自动卸载）⇒ 那些实例会**一起响应同一个 keydown**，而它们的 `canUndoSaved`
   * 可能还是 true（各自那个测试里存过盘）。所以量之前先把这些"别人留下的"喂到没得可退
   * （它们的会话深度都只有个位数），再清一次调用记录 —— 这样数出来的才是**这一条**的。
   */
  async function drainLeftoverWorkbenches(): Promise<void> {
    for (let round = 0; round < 8; round += 1) {
      ctrlZ()
      await flushPromises()
    }
    undoCalls().mockClear()
  }

  it('锁1 · 有草稿时 Ctrl+Z **仍然撤草稿**：回退通道一次都不发（不许抢）', async () => {
    // 第一次存成功（立起"本会话有可退的保存"），第二次存失败（草稿留在手里）
    const save = vi.fn().mockResolvedValueOnce(okSaved()).mockRejectedValue(new Error('写盘失败'))
    const wrapper = setup({ save })
    await openTranslated(wrapper)
    await drainLeftoverWorkbenches()

    await wrapper.get('.translation-edit-text-stub').trigger('click')
    await flushPromises()
    await wrapper.get('.translation-edit-text-stub').trigger('click')
    await flushPromises()
    // 此刻两样都可用：草稿非空 + 本会话有可退的保存
    expect(changedIndices(wrapper)).toEqual([1])

    ctrlZ()
    await flushPromises()

    // 走的是"撤草稿"那条：草稿被撤干净，**回退通道一次都没调**
    expect(changedIndices(wrapper)).toEqual([])
    expect(undoCalls()).not.toHaveBeenCalled()
  })

  it('锁2 · 没草稿、本会话保存过 ⇒ Ctrl+Z 退一步（发一次回退）', async () => {
    const wrapper = setup()
    await openTranslated(wrapper)
    await drainLeftoverWorkbenches()

    await wrapper.get('.translation-edit-text-stub').trigger('click')
    await flushPromises()
    expect(changedIndices(wrapper)).toEqual([]) // 已经落盘，草稿是干净的

    ctrlZ()
    await flushPromises()

    expect(undoCalls()).toHaveBeenCalledTimes(1)
  })

  it('锁3 · 没草稿、本会话没保存过 ⇒ 一个回退都不发（落到原有行为）', async () => {
    const wrapper = setup()
    await openTranslated(wrapper)
    await drainLeftoverWorkbenches()

    ctrlZ()
    await flushPromises()

    expect(undoCalls()).not.toHaveBeenCalled()
  })

  it('锁4 · **连退**：连按两次退两步；退到本会话开始之后再按就不发了', async () => {
    const wrapper = setup()
    await openTranslated(wrapper)
    await drainLeftoverWorkbenches()

    await wrapper.get('.translation-edit-text-stub').trigger('click')
    await flushPromises()
    await wrapper.get('.translation-edit-text-stub').trigger('click')
    await flushPromises()

    ctrlZ()
    await flushPromises()
    ctrlZ()
    await flushPromises()
    expect(undoCalls()).toHaveBeenCalledTimes(2)

    // 栈空：这一下不再发回退（落到原有行为），而且**不是静默吞键**
    ctrlZ()
    await flushPromises()
    expect(undoCalls()).toHaveBeenCalledTimes(2)
  })
})

/**
 * 第 5 批「新增框」5d-2（2026-10-07）：**宿主的接线**。
 *
 * 这里锁的是那条"一刀切"与它的两条拒绝路 —— 用户拍板的原话是
 * **"有 txt 走插入、没有走新建"**，而这一刀**切在宿主这一侧**（组件不判）。
 * 另外两档必须**拒绝并说人话**（`null` = 还在读、`error` = 目录读不了）：
 * 赌错了不是"报个错"，而是**凭空新建一份 txt** 或**插进不确定的那份** —— 都在改用户数据。
 */
describe('Project · 译文栏第 5 批：新增框（页面接线）', () => {
  /** 与相邻几个 describe 同一套最小替身（本套件每个 describe 都自带一份）。 */
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

  function translationDocumentWith(): Record<string, unknown> {
    return {
      sourcePath: '/tmp/第1話/译文.txt',
      version: { first: 1, last: 0 },
      groups: ['框内', '框外'],
      images: [
        {
          fileName: 'page_002.jpg',
          labels: [
            {
              index: 1,
              group: '框内',
              text: '难道是我说错话了?',
              position: { unit: 'normalized', x: 0.5, y: 0.5 }
            },
            {
              // 刚新增的那一条：坐标是**写进文件后**的值（用户点的是 0.25 / 0.75 附近）
              index: 5,
              group: '框外',
              text: '',
              position: { unit: 'normalized', x: 0.5, y: 0.5 }
            }
          ]
        }
      ],
      warnings: []
    }
  }

  function okSaved(): Record<string, unknown> {
    return {
      ok: true,
      changed: true,
      backupPath: '/tmp/bak/译文.txt',
      fingerprint: { size: 1, mtimeMs: 1, sha256: 'a'.repeat(64) }
    }
  }

  function setup(options: { read?: Record<string, unknown> } = {}): VueWrapper {
    mockRoute.params = { parentTitle: encodeURIComponent('ドラゴンボール'), childId: 'c1' }
    const store = useProjectWorkspace()
    store.parents = makeParents()
    // ⚠️ 读译文那一枪**必须在挂载之前**换掉：挂载时就会读一次，之后再改 mock 已经晚了
    // （组件手上拿的还是第一枪的结果 ⇒ 测出来的不是被测行为）。
    window.comicType.readChapterTranslation = vi.fn().mockResolvedValue(
      options.read ?? {
        status: 'ok',
        file: {
          path: '/tmp/第1話/译文.txt',
          name: '译文.txt',
          mtimeMs: 1,
          size: 1024,
          sha256: 'a'.repeat(64)
        },
        txtCount: 1,
        message: '',
        document: translationDocumentWith()
      }
    )
    window.comicType.scanChildProject = vi.fn().mockResolvedValue({
      jpgPairs: [makePair('page_001'), makePair('page_002')],
      txtFiles: [],
      errors: []
    })
    window.comicType.saveChapterTranslation = vi.fn().mockResolvedValue(okSaved())
    window.comicType.undoChapterTranslation = vi.fn().mockResolvedValue({
      ok: true,
      changed: true,
      backupPath: '/tmp/bak/译文.txt',
      fingerprint: { size: 1, mtimeMs: 2, sha256: 'b'.repeat(64) }
    })
    window.comicType.insertChapterTranslation = vi.fn().mockResolvedValue({
      ...okSaved(),
      insertedIndex: 5
    })
    window.comicType.createChapterTranslation = vi.fn().mockResolvedValue({
      ok: true,
      path: '/tmp/第1話/第1話.txt',
      fileName: '第1話.txt',
      insertedIndex: 1,
      fingerprint: { size: 1, mtimeMs: 1, sha256: 'a'.repeat(64) }
    })
    return mountProject()
  }

  async function openTranslated(wrapper: VueWrapper): Promise<void> {
    await flushPromises()
    await wrapper.get('.thumb-open-second').trigger('click')
    await flushPromises()
    await selectChapterMode(wrapper, 'translated')
    await flushPromises()
    await nextTick()
  }

  function paneModel(wrapper: VueWrapper): Record<string, unknown> {
    return wrapper.findComponent(CompareViewerStub).props('translation') as unknown as Record<
      string,
      unknown
    >
  }

  /** 替换过的方法要能 `.toHaveBeenCalledWith` ⇒ 这里把替身按"一个组件 + 那几个方法"来读。 */
  function viewerStub(wrapper: VueWrapper): {
    props: (name?: string) => unknown
    vm: { scrollTranslationRowIntoView: ReturnType<typeof vi.fn> }
  } {
    return wrapper.findComponent(CompareViewerStub) as unknown as {
      props: (name?: string) => unknown
      vm: { scrollTranslationRowIntoView: ReturnType<typeof vi.fn> }
    }
  }

  /**
   * 抓"滚过去"这一下。
   *
   * ⚠️ 用 `vi.spyOn` 抓实例上的方法，**不要**把 `vi.fn()` 留在替身定义里：
   * 那个 `vi.fn()` 是**模块级**共享的，跨用例累计调用（而且 `toHaveBeenCalledWith` 会
   * 直接抛 `is not a spy or a call to a spy`）。本仓的规矩：断言不许依赖"别的用例干了什么"。
   */
  function spyScroll(wrapper: VueWrapper): ReturnType<typeof vi.fn> {
    return vi.spyOn(viewerStub(wrapper).vm, 'scrollTranslationRowIntoView')
  }

  function insertCalls(): Mock {
    return window.comicType.insertChapterTranslation as unknown as Mock
  }

  function createCalls(): Mock {
    return window.comicType.createChapterTranslation as unknown as Mock
  }

  it('默认关：进对照视图时页头那枚开关是关的（图上手势也是关的）', async () => {
    const wrapper = setup()
    await openTranslated(wrapper)

    expect(paneModel(wrapper).addFrameMode).toBe(false)
  })

  it('页头开关被点 ⇒ 宿主接住，并把开着这件事传回右栏（只有一个状态来源）', async () => {
    const wrapper = setup()
    await openTranslated(wrapper)

    await wrapper.get('.add-frame-mode-stub').trigger('click')
    await flushPromises()

    expect(paneModel(wrapper).addFrameMode).toBe(true)
  })

  it('**有 txt** ⇒ 走插入：带上这一页的图名、坐标与分组；写完重读一次盘', async () => {
    const wrapper = setup()
    await openTranslated(wrapper)
    const readsBefore = (window.comicType.readChapterTranslation as unknown as Mock).mock.calls
      .length

    await wrapper.get('.add-frame-inside-stub').trigger('click')
    await flushPromises()

    expect(createCalls()).not.toHaveBeenCalled()
    const call = insertCalls().mock.calls.at(-1)?.[0] as Record<string, unknown>
    expect(call.filePath).toBe('/tmp/第1話/译文.txt')
    expect(call.insert).toEqual({
      imageName: 'page_002.jpg',
      groupName: '框内',
      position: { x: 0.25, y: 0.75 }
    })
    // 写完重读：盘上内容变了，下一句保存要拿新指纹
    expect((window.comicType.readChapterTranslation as unknown as Mock).mock.calls.length).toBe(
      readsBefore + 1
    )
  })

  it('**没有 txt 那一侧**：图名用当前页的**裸文件名**（txt 里没有记录可抄）', async () => {
    const wrapper = setup({
      read: {
        status: 'not-found',
        file: null,
        txtCount: 0,
        message: '找到 0 份 txt',
        document: null
      }
    })
    await openTranslated(wrapper)

    await wrapper.get('.add-frame-inside-stub').trigger('click')
    await flushPromises()

    const call = createCalls().mock.calls.at(-1)?.[0] as Record<string, unknown>
    // 目录与扩展名都要剥掉：新建出来的那份拿它当 `>>>>>>>>[名字]<<<<<<<<`
    expect((call.insert as Record<string, unknown>).imageName).toBe('page_002.jpg')
  })

  it('**一份能解析的 txt 都没有** ⇒ 走从零新建（落在话目录、带这一话的页序）', async () => {
    const wrapper = setup({
      read: {
        status: 'not-found',
        file: null,
        txtCount: 0,
        message: '找到 0 份 txt',
        document: null
      }
    })
    await openTranslated(wrapper)

    await wrapper.get('.add-frame-outside-stub').trigger('click')
    await flushPromises()

    expect(insertCalls()).not.toHaveBeenCalled()
    const call = createCalls().mock.calls.at(-1)?.[0] as Record<string, unknown>
    expect(call.folderPath).toContain('第1話')
    expect(call.pages).toEqual(['page_001.jpg', 'page_002.jpg'])
    expect((call.insert as Record<string, unknown>).groupName).toBe('框外')
  })

  it('**目录读不了（error）** ⇒ 拒绝、说人话，两条写盘路**一次都不走**', async () => {
    const wrapper = setup({
      read: {
        status: 'error',
        file: null,
        txtCount: 0,
        message: '读不了话目录：盘掉了',
        document: null
      }
    })
    await openTranslated(wrapper)

    await wrapper.get('.add-frame-inside-stub').trigger('click')
    await flushPromises()

    expect(insertCalls()).not.toHaveBeenCalled()
    expect(createCalls()).not.toHaveBeenCalled()
    expect(paneModel(wrapper).notice).toContain('盘掉了')
  })

  it('插入失败（冲突）⇒ 照实说人话，且**不**去新建一份（两条路不许互相兜底）', async () => {
    const wrapper = setup()
    await openTranslated(wrapper)
    window.comicType.insertChapterTranslation = vi.fn().mockResolvedValue({
      ok: false,
      kind: 'conflict',
      message: '这个 txt 在你读进来之后被改过了'
    })

    await wrapper.get('.add-frame-inside-stub').trigger('click')
    await flushPromises()

    expect(createCalls()).not.toHaveBeenCalled()
    expect(paneModel(wrapper).notice).toContain('被改过')
  })

  it('新增成功 ⇒ 那一行**瞬时高亮**（不建立固定选中），并且说明句带"可撤销"', async () => {
    const wrapper = setup()
    await openTranslated(wrapper)

    const scrolled = spyScroll(wrapper)
    await wrapper.get('.add-frame-inside-stub').trigger('click')
    await flushPromises()

    expect(viewerStub(wrapper).props('justAddedIndex')).toBe(5)
    expect(paneModel(wrapper).activeIndex ?? null).toBeNull()
    expect(paneModel(wrapper).notice).toContain('可撤销')
    // 滚过去：宿主通过 ref 调右栏（复用那**一个** scrollRowIntoView，不新写第二个滚动）
    expect(scrolled).toHaveBeenCalledWith(5)
  })

  /**
   * ⚠️ **2026-10-07 真机抓到的 bug（本轮修的第二个）**：
   * 状态条写着「Ctrl+Z 可撤销」，**按下去却什么都不发生**。
   *
   * 根因：渲染层那份"还有几步可退"的**镜像**只有 `useChapterTranslationDraft.save()` 会 `+1`
   * （它管的是"草稿写盘"那条路），而"新增框"走的是**另一条写盘路**
   * （`insertChapterTranslation` / `createChapterTranslation`，主进程直接写、并把会话基线压了栈）。
   * 主进程那份历史是真的有（所以状态条那句不是谎话），但**镜像没加** ⇒
   * `canUndoSaved` 恒为 false ⇒ Ctrl+Z 连通道都不发。
   *
   * 这两条锁盯的就是"新增之后那个数字必须上来、且按下去真的退"。
   */
  it('新增框之后，镜像必须知道"多了一次可退的保存" ⇒ Ctrl+Z 真的退一步（真机 bug 的锁）', async () => {
    const wrapper = setup()
    await openTranslated(wrapper)
    const undoMock = window.comicType.undoChapterTranslation as unknown as Mock

    expect(paneModel(wrapper).canUndoSaved).toBe(false)
    await wrapper.get('.add-frame-inside-stub').trigger('click')
    await flushPromises()

    // ① 状态条有"可退" ⇒ 镜像必须真的 +1（不是靠旧值或别的什么巧合）
    expect(paneModel(wrapper).canUndoSaved).toBe(true)

    // ② 按下去必须**真的发了一次**回退通道，且带着这一份 txt 的当前指纹。
    // ⚠️ 断言的是"**发过了、载荷对**"，**不是**"只发了一次"：本套件里前面的用例并没有卸载
    //    组件（VTU 默认不自动卸载），它们的 `window` keydown 监听还活着，也会响应这一下 ——
    //    那是**测试工装**的噪音，数绝对次数会把这条锁变成它本身不该管的事。
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true }))
    await flushPromises()
    expect(undoMock).toHaveBeenCalled()
    const payload = undoMock.mock.calls.at(-1)?.[0] as Record<string, unknown>
    expect(payload.filePath).toBe('/tmp/第1話/译文.txt')

    // ③ 退完这一步，本实例的镜像要减回去 —— 且状态条那句"可撤销"该收掉了
    expect(paneModel(wrapper).canUndoSaved).toBe(false)
    expect(paneModel(wrapper).notice).not.toContain('可撤销')
  })

  it('从零新建那份也走同一条镜像（新建同样是"一次可退的写盘"）', async () => {
    const wrapper = setup({
      read: {
        status: 'not-found',
        file: null,
        txtCount: 0,
        message: '找到 0 份 txt',
        document: null
      }
    })
    await openTranslated(wrapper)
    window.comicType.readChapterTranslation = vi.fn().mockResolvedValue({
      status: 'ok',
      file: {
        path: '/tmp/第1話/第1話.txt',
        name: '第1話.txt',
        mtimeMs: 1,
        size: 200,
        sha256: 'c'.repeat(64)
      },
      txtCount: 1,
      message: '',
      document: translationDocumentWith()
    })

    await wrapper.get('.add-frame-inside-stub').trigger('click')
    await flushPromises()

    expect(paneModel(wrapper).canUndoSaved).toBe(true)
  })

  it('认不出是哪一条 ⇒ **不点亮任何一行**（宁可什么都不亮，也不点亮错的那行）', async () => {
    const wrapper = setup()
    await openTranslated(wrapper)
    // 主进程算出来的序号在重读回来的文档里不存在，坐标也对不上**任何一条**
    // （点在图中央会正好撞上原来那条 0.5/0.5 ⇒ 那样测的就不是"认不出"了）
    window.comicType.insertChapterTranslation = vi.fn().mockResolvedValue({
      ...okSaved(),
      insertedIndex: 99
    })
    wrapper.findComponent(CompareViewerStub).vm.$emit('translationAddFrame', '框内', 0.33, 0.66)
    await flushPromises()

    expect(viewerStub(wrapper).props('justAddedIndex')).toBeNull()
  })
})

/**
 * 第 5 批 5e（2026-10-07）：**宿主的删除链路**（右栏菜单第三项 / 锚点右键，两条入口同一个动作）。
 *
 * 五跳里属于宿主的那几跳都在这里：③ 写盘请求发出（载荷对）→ ④ 主进程写成功 →
 * ⑤ 镜像更新（Ctrl+Z 能退）。另外锁三件宿主自己的事：
 * · **草稿**：删这条时先丢它自己的改动、并把同图 > 被删序号的键 -1；
 * · **反馈**：状态条一句，**且不高亮任何一行**（用户拍板 Q7=B —— 删掉的东西没法高亮，
 *   "顶上来的那条"严格说不是被删的那个，点亮它会被误读成"新加了这一条"）；
 * · **拒绝**：没有 txt / 还在读 / 读不了 ⇒ 一个字节都不写。
 */
describe('Project · 译文栏第 5 批 5e：删除译文（宿主接线）', () => {
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

  function documentWith(): Record<string, unknown> {
    return {
      sourcePath: '/tmp/第1話/译文.txt',
      version: { first: 1, last: 0 },
      groups: ['框内', '框外'],
      images: [
        {
          fileName: 'page_002.jpg',
          labels: [1, 5, 6].map((index) => ({
            index,
            group: '框内',
            text: `第 ${index} 句`,
            position: { unit: 'normalized', x: 0.5, y: 0.5 }
          }))
        }
      ],
      warnings: []
    }
  }

  /** 删掉第 1 条**之后**的文档（原 5/6 各往前挪一位）。 */
  function documentAfterDelete(): Record<string, unknown> {
    const doc = documentWith()
    const images = doc.images as Array<{ labels: Array<{ index: number }> }>
    images[0].labels = images[0].labels
      .filter((label) => label.index !== 1)
      .map((label) => ({ ...label, index: label.index - 1 }))
    return doc
  }

  function setup(options: { read?: Record<string, unknown> } = {}): VueWrapper {
    mockRoute.params = { parentTitle: encodeURIComponent('ドラゴンボール'), childId: 'c1' }
    const store = useProjectWorkspace()
    store.parents = makeParents()
    window.comicType.readChapterTranslation = vi
      .fn()
      .mockResolvedValueOnce(
        options.read ?? {
          status: 'ok',
          file: {
            path: '/tmp/第1話/译文.txt',
            name: '译文.txt',
            mtimeMs: 1,
            size: 1024,
            sha256: 'a'.repeat(64)
          },
          txtCount: 1,
          message: '',
          document: documentWith()
        }
      )
      .mockResolvedValue(
        options.read ?? {
          status: 'ok',
          file: {
            path: '/tmp/第1話/译文.txt',
            name: '译文.txt',
            mtimeMs: 1,
            size: 1024,
            sha256: 'a'.repeat(64)
          },
          txtCount: 1,
          message: '',
          // 删掉第 1 条之后的文档：原第 5 条现在成了第 4 条（序号重排过）
          document: documentAfterDelete()
        }
      )
    window.comicType.scanChildProject = vi.fn().mockResolvedValue({
      jpgPairs: [makePair('page_001'), makePair('page_002')],
      txtFiles: [],
      errors: []
    })
    window.comicType.saveChapterTranslation = vi.fn().mockResolvedValue({
      ok: true,
      changed: true,
      backupPath: '/tmp/bak/译文.txt',
      fingerprint: { size: 1, mtimeMs: 1, sha256: 'a'.repeat(64) }
    })
    window.comicType.undoChapterTranslation = vi.fn().mockResolvedValue({
      ok: true,
      changed: true,
      backupPath: '/tmp/bak/译文.txt',
      fingerprint: { size: 1, mtimeMs: 2, sha256: 'b'.repeat(64) }
    })
    window.comicType.deleteChapterTranslation = vi.fn().mockResolvedValue({
      ok: true,
      changed: true,
      backupPath: '/tmp/bak/译文.txt',
      fingerprint: { size: 1, mtimeMs: 3, sha256: 'c'.repeat(64) },
      deletedIndex: 3,
      renumbered: [4, 5]
    })
    return mountProject()
  }

  async function openTranslated(wrapper: VueWrapper): Promise<void> {
    await flushPromises()
    await wrapper.get('.thumb-open-second').trigger('click')
    await flushPromises()
    await selectChapterMode(wrapper, 'translated')
    await flushPromises()
    await nextTick()
  }

  function paneModel(wrapper: VueWrapper): Record<string, unknown> {
    return wrapper.findComponent(CompareViewerStub).props('translation') as unknown as Record<
      string,
      unknown
    >
  }

  function viewerStub(wrapper: VueWrapper): {
    props: (name?: string) => unknown
    vm: { scrollTranslationRowIntoView: ReturnType<typeof vi.fn> }
  } {
    return wrapper.findComponent(CompareViewerStub) as unknown as {
      props: (name?: string) => unknown
      vm: { scrollTranslationRowIntoView: ReturnType<typeof vi.fn> }
    }
  }

  function deleteCalls(): Mock {
    return window.comicType.deleteChapterTranslation as unknown as Mock
  }

  /** 让宿主收到"锚点右键 / 行菜单第三项"那一下（两条入口到宿主是同一个事件）。 */
  function fireDelete(wrapper: VueWrapper, index: number): void {
    wrapper.findComponent(CompareViewerStub).vm.$emit('translationDeleteEntry', index)
  }

  it('③ 写盘请求发出：载荷带上这一份 txt、当前指纹、要删的图名与序号', async () => {
    const wrapper = setup()
    await openTranslated(wrapper)

    fireDelete(wrapper, 1)
    await flushPromises()

    const call = deleteCalls().mock.calls.at(-1)?.[0] as Record<string, unknown>
    expect(call.filePath).toBe('/tmp/第1話/译文.txt')
    expect(call.delete).toEqual({ imageName: 'page_002.jpg', labelIndex: 1 })
    expect((call.base as Record<string, unknown>).sha256).toBe('a'.repeat(64))
  })

  it('④⑤ 写成功后：状态条一句 + **不高亮任何一行**（Q7=B）+ 镜像立起来（Ctrl+Z 能退）', async () => {
    const wrapper = setup()
    await openTranslated(wrapper)
    const undoMock = window.comicType.undoChapterTranslation as unknown as Mock

    fireDelete(wrapper, 3)
    await flushPromises()

    // 反馈：状态条那句
    expect(paneModel(wrapper).notice).toContain('已删除')
    // **不高亮任何一行**（用户拍板 B）
    expect(viewerStub(wrapper).props('justAddedIndex')).toBeNull()
    expect(paneModel(wrapper).activeIndex ?? null).toBeNull()
    // 镜像立起来 ⇒ 按 Ctrl+Z 真的会发一次回退
    expect(paneModel(wrapper).canUndoSaved).toBe(true)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true }))
    await flushPromises()
    expect(undoMock).toHaveBeenCalled()
  })

  it('草稿：删这条时**先丢它自己的改动**，并把同图 > 被删序号的键 -1', async () => {
    const wrapper = setup()
    // ⚠️ 平时**失焦即存**会把草稿立刻清空 ⇒ 想验"宿主在删除时怎么对待手上的草稿"，
    //    必须让自动保存**失败**（草稿才会留在手上）。这是唯一能让这条锁非空的做法 ——
    //    不留草稿的话，断言"改动没了"是恒真的（本仓把这种叫"假锁"）。
    window.comicType.saveChapterTranslation = vi.fn().mockResolvedValue({
      ok: false,
      kind: 'conflict',
      message: '先别存（这条用例要的就是"草稿还压在手上"）'
    })
    await openTranslated(wrapper)
    // 造两条草稿改动：**第 1 条**（这条要被删）与**第 5 条**（要跟着挪到 4）
    // Emit explicit row identities: the stub can remount while conflict state updates.
    wrapper.findComponent(CompareViewerStub).vm.$emit('translationEditText', 1, '新译文')
    await flushPromises()
    wrapper.findComponent(CompareViewerStub).vm.$emit('translationEditText', 5, '另一条新译文')
    await flushPromises()
    const before = paneModel(wrapper).changedIndices as number[]
    expect(before).toContain(1)
    expect(before).toContain(5)

    fireDelete(wrapper, 1)
    await flushPromises()

    const changed = paneModel(wrapper).changedIndices as number[]
    // ① 被删那条自己的改动**没了**（它连译文一起消失）
    expect(changed).not.toContain(1)
    // ② 原来第 5 条的改动**挪到了 4**（不挪的话下一次保存会写到另一句话上）
    expect(changed).toContain(4)
    expect(changed).not.toContain(5)
  })

  it('删除失败（冲突）⇒ 照实说人话，**不**假装删掉了', async () => {
    const wrapper = setup()
    await openTranslated(wrapper)
    window.comicType.deleteChapterTranslation = vi.fn().mockResolvedValue({
      ok: false,
      kind: 'conflict',
      message: '这个 txt 在你读进来之后被改过了'
    })

    fireDelete(wrapper, 3)
    await flushPromises()

    expect(paneModel(wrapper).notice).toContain('被改过')
    expect(paneModel(wrapper).canUndoSaved).toBe(false)
  })

  it('**没有可解析的 txt** ⇒ 拒绝、一个字节都不写（说人话）', async () => {
    const wrapper = setup({
      read: {
        status: 'not-found',
        file: null,
        txtCount: 0,
        message: '找到 0 份 txt',
        document: null
      }
    })
    await openTranslated(wrapper)

    fireDelete(wrapper, 3)
    await flushPromises()

    expect(deleteCalls()).not.toHaveBeenCalled()
    // 没有 txt ⇒ 没有"这一页的条目"可言 ⇒ 走的是那条"对不上记录"的人话（不是"没有"）
    expect(paneModel(wrapper).notice).toBeTruthy()
    expect(String(paneModel(wrapper).notice)).toContain('删不了')
  })
})

