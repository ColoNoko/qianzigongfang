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
import { GUIDE_VERSION } from '@renderer/features/guide/guide-config'
import GuideDialog from '@renderer/features/guide/GuideDialog.vue'
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
      'work-mode-open',
      'guide-open',
      'night-mode-toggle'
    ])

    await wrapper.get('[data-testid="nav-fonts"]').trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.name).toBe('fonts')
    expect(wrapper.text()).toContain('字体内容')
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
      {
        id: 'p1',
        title: 'ドラゴンボール',
        lastMtimeMs: 0,
        children: [chapter('c1', 'ドラゴンボール')]
      }
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

    it('首次打开快速上手', async () => {
      const wrapper = await mountApp(0)
      const guide = wrapper.getComponent(GuideDialog)
      expect(guide.props('open')).toBe(true)
      expect(guide.props('startWithEntry')).toBe(false)
    })
    it('设置未读完或已经看过时不自动弹出', async () => {
      for (const [version, loaded] of [[0, false], [GUIDE_VERSION, true]] as const) {
        const wrapper = await mountApp(version, loaded)
        expect(wrapper.getComponent(GuideDialog).props('open')).toBe(false)
        wrapper.unmount()
      }
    })
    it('手动打开功能查阅，关闭已读指引不重复写库', async () => {
      const wrapper = await mountApp(GUIDE_VERSION)
      await wrapper.get('[data-testid="guide-open"]').trigger('click')
      const guide = wrapper.getComponent(GuideDialog)
      expect(guide.props('open')).toBe(true)
      expect(guide.props('startWithEntry')).toBe(true)
      guide.vm.$emit('close')
      await flushPromises()
      expect(guide.props('open')).toBe(false)
      expect(storeSet).not.toHaveBeenCalled()
    })
    it('关闭首次指引会保存已读版本', async () => {
      const wrapper = await mountApp(0)
      wrapper.getComponent(GuideDialog).vm.$emit('close')
      await flushPromises()
      expect(storeSet).toHaveBeenCalledWith('ui.guideSeenVersion', GUIDE_VERSION)
    })
  })
})
