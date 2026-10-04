// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { setActivePinia } from 'pinia'
import { defineComponent } from 'vue'
import App from '../App.vue'
import { useProjectWorkspace } from '@renderer/stores/projectWorkspace'
import { useSettingsStore } from '@renderer/stores/settings'
import { GUIDE_NAV_ITEMS, GUIDE_BASIC_PAGES, GUIDE_VERSION } from '@renderer/features/guide/guide-pages'
import type { ChildProject } from '@shared/types'

function chapter(id: string, parentTitle: string): ChildProject {
  return {
    id,
    parentTitle,
    folderPath: `/tmp/${id}`,
    chapterNumber: '第1話',
    projectTitle: 'vol1',
    lastMtimeMs: 0
  }
}

const ImportPage = defineComponent({
  name: 'Import',
  template: '<div>导入内容<input data-testid="cached-import-input" /></div>'
})

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'dashboard', component: { template: '<div>首页内容</div>' } },
      { path: '/project', name: 'projectIndex', component: { template: '<div>项目内容</div>' } },
      {
        path: '/project/:parentTitle/:childId',
        name: 'project',
        component: { template: '<div>项目工作区</div>' }
      },
      { path: '/progress', name: 'progress', component: { template: '<div>进度内容</div>' } },
      {
        path: '/achievements',
        name: 'achievements',
        component: { template: '<div>成就内容</div>' }
      },
      { path: '/fonts', name: 'fonts', component: { template: '<div>字体内容</div>' } },
      { path: '/import', name: 'import', component: ImportPage },
      { path: '/settings', name: 'settings', component: { template: '<div>设置内容</div>' } }
    ]
  })
}

let storeSet: ReturnType<typeof vi.fn>

beforeEach(() => {
  storeSet = vi.fn().mockResolvedValue(undefined)
  window.comicType = {
    writeLog: vi.fn().mockResolvedValue(undefined),
    storeGet: vi.fn().mockResolvedValue(undefined),
    storeSet
  } as unknown as typeof window.comicType
})

describe('App navigation', () => {
  it('opens the project index when the project button is clicked', async () => {
    const router = makeRouter()
    await router.push('/')
    await router.isReady()

    const wrapper = mount(App, {
      global: {
        plugins: [createPinia(), router]
      }
    })

    await wrapper.get('[data-testid="nav-project"]').trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.name).toBe('projectIndex')
    expect(wrapper.text()).toContain('项目内容')
  })

  it('keeps the project button active inside a child project route', async () => {
    const router = makeRouter()
    await router.push('/project/comic/child-1')
    await router.isReady()

    const wrapper = mount(App, {
      global: {
        plugins: [createPinia(), router]
      }
    })

    expect(wrapper.get('[data-testid="nav-project"]').classes()).toContain('text-accent')
    expect(wrapper.text()).toContain('项目工作区')
  })

  it('places font management between achievements and settings and opens it', async () => {
    const router = makeRouter()
    await router.push('/')
    await router.isReady()

    const wrapper = mount(App, {
      global: {
        plugins: [createPinia(), router]
      }
    })

    const navTestIds = wrapper
      .findAll('nav button')
      .map((button) => button.attributes('data-testid'))
    expect(navTestIds).toEqual([
      'nav-dashboard',
      'nav-project',
      'nav-progress',
      'nav-achievements',
      'nav-fonts',
      'nav-import',
      'nav-settings',
      'guide-open',
      'night-mode-toggle'
    ])

    await wrapper.get('[data-testid="nav-fonts"]').trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.name).toBe('fonts')
    expect(wrapper.text()).toContain('字体内容')
  })

  it('引导里的导航清单（GUIDE_NAV_ITEMS）与真实导航一致 —— 少了新页这里会红', () => {
    // GUIDE_NAV_ITEMS 是引导第 1 页画那张"导航示意图"、以及"七个方块"文案的**数据源**，
    // 它必须和 App.vue 真正渲染的 7 个功能页对上（顺序也一样）。
    // ⚠️ 新增功能页：改 App.vue 的 navItems + 上面那条 nav 顺序预期时，**忘了同步
    //    GUIDE_NAV_ITEMS** 就会在这里红 —— 这正是"说明书不许和程序说的不一样"那条锁。
    expect([...GUIDE_NAV_ITEMS]).toEqual(['首页', '项目', '进度', '成就', '字体', '导入', '设置'])
  })

  /**
   * 2026-10-04 用户看图后的第 2 条：第 01 页**标题下方那段导语**没跟上
   * （v4 才把这一页改成一屏一条左右翻，导语却只字未提；「七个方块」也没说清
   * 左下角那两枚按钮不在其中）。数字从 `GUIDE_NAV_ITEMS` 推出来，不手抄。
   */
  it('第 01 页导语与真实侧栏一致：八个条目口径统一 + 怎么翻（2026-10-04 收口）', () => {
    const CN = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十']
    const nav = GUIDE_BASIC_PAGES.find((page) => page.id === 'nav')!
    const lead = nav.blocks.find((block) => block.kind === 'lead')!
    const text = lead.text

    // 七个功能页 + 「指引」那条 = 翻页内容恰好 8 条（含 lead：1 + 8）
    const points = nav.blocks.filter((block) => block.kind === 'point')
    expect(points).toHaveLength(GUIDE_NAV_ITEMS.length + 1) // 7 + 指引 = 8
    // 导语说的总数必须与翻页条数一致（此前导语说"七个"而下面翻 8 条 —— 口径裂缝）
    expect(text).toContain(`${CN[points.length]}条`)
    expect(text).toContain(`${CN[GUIDE_NAV_ITEMS.length]}个功能页`)
    // 「指引」在这 8 条里（口径统一的关键：不再说"不属于这七个"然后把又它当一条讲）
    expect(text).toContain('指引')
    // v4 的翻看交互（那一页是"一屏一条"）——不写，读者不会发现那两个箭头
    expect(text).toContain('箭头')
  })

  it('每个导航项都带一枚图标（新增页面时不许只留文字）', async () => {
    const router = makeRouter()
    await router.push('/')
    await router.isReady()

    const wrapper = mount(App, {
      global: {
        plugins: [createPinia(), router]
      }
    })

    for (const name of [
      'dashboard',
      'project',
      'progress',
      'achievements',
      'fonts',
      'import',
      'settings'
    ]) {
      const button = wrapper.get(`[data-testid="nav-${name}"]`)
      expect(button.find('svg').exists(), `nav-${name} 少了图标`).toBe(true)
    }
  })

  it('keeps the Import page mounted while switching navigation tabs', async () => {
    const router = makeRouter()
    await router.push('/import')
    await router.isReady()

    const wrapper = mount(App, {
      global: {
        plugins: [createPinia(), router]
      }
    })
    await wrapper.get('[data-testid="cached-import-input"]').setValue('保留这次导入')
    await wrapper.get('[data-testid="nav-settings"]').trigger('click')
    await flushPromises()
    await wrapper.get('[data-testid="nav-import"]').trigger('click')
    await flushPromises()

    expect(wrapper.get('[data-testid="cached-import-input"]').element).toHaveProperty(
      'value',
      '保留这次导入'
    )
  })

  it('从别的页面切回「项目」→ 回到本会话正在看的那一话', async () => {
    const router = makeRouter()
    await router.push('/achievements')
    await router.isReady()

    const pinia = createPinia()
    setActivePinia(pinia)
    const workspace = useProjectWorkspace()
    // 注册表里确实有这一话 —— 落点判定会校验它还在（见 resolveProjectNavPath）。
    workspace.parents = [
      { id: 'p1', title: 'ドラゴンボール', lastMtimeMs: 0, children: [chapter('c1', 'ドラゴンボール')] }
    ]
    workspace.setActiveChild(chapter('c1', 'ドラゴンボール'), [])

    const wrapper = mount(App, { global: { plugins: [pinia, router] } })
    await wrapper.get('[data-testid="nav-project"]').trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.name).toBe('project')
    expect(router.currentRoute.value.params.childId).toBe('c1')
  })

  it('已经在项目页面上再点「项目」→ 回列表页（列表页不能被锁死）', async () => {
    const router = makeRouter()
    await router.push('/project/comic/child-1')
    await router.isReady()

    const pinia = createPinia()
    setActivePinia(pinia)
    const workspace = useProjectWorkspace()
    workspace.parents = [
      { id: 'p1', title: 'comic', lastMtimeMs: 0, children: [chapter('c1', 'comic')] }
    ]
    workspace.setActiveChild(chapter('c1', 'comic'), [])

    const wrapper = mount(App, { global: { plugins: [pinia, router] } })
    await wrapper.get('[data-testid="nav-project"]').trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.name).toBe('projectIndex')
  })

  /**
   * 新手引导（features/guide）。三件事：
   *   ① 设置读完 + 没看过 → 首启自动弹
   *   ② 已看过 → 不弹
   *   ③ 左下角「指引」随时再打开，关掉之后记下"看过"
   *
   * 注意：其它用例**不会**被引导打扰 —— 那些用例没有调 `loadSettings()`，
   * `settingsLoaded` 一直是 false，判定条件不成立（这也是"等旗子"设计的副作用之一）。
   */
  describe('新手引导', () => {
    async function mountApp(guideSeenVersion: number, loaded = true) {
      const router = makeRouter()
      await router.push('/')
      await router.isReady()

      const pinia = createPinia()
      setActivePinia(pinia)
      const settings = useSettingsStore()
      settings.settingsLoaded = loaded
      settings.guideSeenVersion = guideSeenVersion

      const wrapper = mount(App, { global: { plugins: [pinia, router] } })
      await flushPromises()
      return wrapper
    }

    it('首次打开（设置读完、没看过）自动弹出引导 —— **不给选择，直接进 01**', async () => {
      const wrapper = await mountApp(0)

      expect(wrapper.find('[data-testid="guide-overlay"]').exists()).toBe(true)
      // 首次**不显示入口页**（不给选择），直接落在第 01 页、强制先看基础
      expect(wrapper.find('[data-testid="guide-entry"]').exists()).toBe(false)
      expect(wrapper.get('[data-testid="guide-step"]').text()).toBe('1 / 9')
      expect(wrapper.get('[data-testid="guide-title"]').text()).toContain('01 ')
    })

    it('设置还没读完时不弹（否则每次启动都要闪一下）', async () => {
      const wrapper = await mountApp(0, false)

      expect(wrapper.find('[data-testid="guide-overlay"]').exists()).toBe(false)
    })

    it('已经看过就不再自动弹', async () => {
      const wrapper = await mountApp(GUIDE_VERSION)

      expect(wrapper.find('[data-testid="guide-overlay"]').exists()).toBe(false)
    })

    it('左下角「指引」随时能再打开（已看过的用户再看一遍，不会重复写库）', async () => {
      const wrapper = await mountApp(GUIDE_VERSION)
      expect(wrapper.find('[data-testid="guide-overlay"]').exists()).toBe(false)

      await wrapper.get('[data-testid="guide-open"]').trigger('click')
      expect(wrapper.find('[data-testid="guide-overlay"]').exists()).toBe(true)
      // 从「指引」进来的每一次都从**入口页**开始（分层之后：不能停在上次那一栏）
      expect(wrapper.find('[data-testid="guide-entry"]').exists()).toBe(true)

      // 进基础栏：从第 01 页开始（全局编号）
      await wrapper.get('[data-testid="guide-lane-basics"]').trigger('click')
      expect(wrapper.get('[data-testid="guide-step"]').text()).toBe('1 / 9')

      // 基础 5 页走完（4 次下一步）→ 主按钮变「继续看进阶」
      for (let step = 0; step < 4; step += 1) {
        await wrapper.get('[data-testid="guide-next"]').trigger('click')
      }
      expect(wrapper.get('[data-testid="guide-next"]').text()).toBe('继续看进阶')
      await wrapper.get('[data-testid="guide-next"]').trigger('click')
      expect(wrapper.get('[data-testid="guide-step"]').text()).toBe('6 / 9')

      // 进阶 4 页走完（3 次下一步 + 1 次完成）→ 才关窗
      for (let step = 0; step < 3; step += 1) {
        await wrapper.get('[data-testid="guide-next"]').trigger('click')
      }
      expect(wrapper.get('[data-testid="guide-next"]').text()).toBe('完成')
      await wrapper.get('[data-testid="guide-next"]').trigger('click')
      expect(wrapper.find('[data-testid="guide-overlay"]').exists()).toBe(false)
      // 版本号没变 → 不重复写库（`markGuideSeen` 的幂等）
      expect(storeSet).not.toHaveBeenCalled()
    })

    it('「跳过」也算看过（否则每次启动都来烦人）', async () => {
      const wrapper = await mountApp(0)

      await wrapper.get('[data-testid="guide-skip"]').trigger('click')

      expect(wrapper.find('[data-testid="guide-overlay"]').exists()).toBe(false)
      expect(storeSet).toHaveBeenCalledWith('ui.guideSeenVersion', GUIDE_VERSION)
    })
  })
})
