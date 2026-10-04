// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import type { ParentProject } from '@shared/types'

// vi.hoisted runs before the vi.mock factory. We use a holder object so the
// factory can create a reactive route (via dynamic import of vue) and store
// it for both the mock and the test to access. A reactive route is required
// so the component's watch(() => route.params.childId, ...) actually fires
// when we mutate params in test 3.
const { mockRoute } = vi.hoisted(() => ({
  mockRoute: { current: null as null | { params: { parentTitle: string; childId: string } } }
}))

vi.mock('vue-router', async () => {
  const { reactive } = await import('vue')
  mockRoute.current = reactive({ params: { parentTitle: '', childId: '' } })
  return {
    useRoute: () => mockRoute.current,
    useRouter: () => ({ push: vi.fn() })
  }
})

import Project from '../Project.vue'
import { useProjectWorkspace } from '@renderer/stores/projectWorkspace'

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
          lastMtimeMs: 2000
        }
      ]
    }
  ]
}

/** Minimal stubs for child components so tests don't need their deps. */
const ProjectSidebarStub = {
  name: 'ProjectSidebar',
  props: ['parents', 'loading'],
  emits: ['select'],
  template:
    "<button class=\"project-sidebar-stub\" @click=\"$emit('select', 'p1', 'c2')\">switch</button>"
}
const ProjectThumbListStub = {
  name: 'ProjectThumbList',
  props: ['pairs', 'folderPath'],
  emits: ['compare'],
  template:
    '<button class="project-thumb-list-stub" @click="$emit(\'compare\', pairs[0])">preview</button>'
}
const ProjectFooterStub = {
  name: 'ProjectFooter',
  props: ['progress'],
  template: '<div class="project-footer-stub"><slot /></div>'
}
const CompareViewerStub = {
  name: 'CompareViewer',
  props: ['jpgPath', 'psdPath', 'visible'],
  template: '<div class="compare-viewer-stub"><slot /></div>'
}
const ProjectFormModalStub = {
  name: 'ProjectFormModal',
  props: ['mode', 'initialData'],
  template: '<div class="project-form-modal-stub"><slot /></div>'
}

beforeEach(() => {
  setActivePinia(createPinia())
  if (mockRoute.current) {
    mockRoute.current.params = { parentTitle: '', childId: '' }
  }
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

describe('Project transitions', () => {
  it('valid childId → workspace.activeChild set on mount', () => {
    mockRoute.current!.params = {
      parentTitle: encodeURIComponent('ドラゴンボール'),
      childId: 'c1'
    }
    const store = useProjectWorkspace()
    store.parents = makeParents()

    mount(Project, {
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

    expect(store.activeChild).not.toBeNull()
    expect(store.activeChild?.id).toBe('c1')
  })

  it('invalid childId → workspace.activeChild null on mount', () => {
    mockRoute.current!.params = {
      parentTitle: encodeURIComponent('ドラゴンボール'),
      childId: 'nonexistent'
    }
    const store = useProjectWorkspace()
    store.parents = makeParents()

    mount(Project, {
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

    expect(store.activeChild).toBeNull()
  })

  it('route childId changes → workspace updates active child', async () => {
    mockRoute.current!.params = {
      parentTitle: encodeURIComponent('ドラゴンボール'),
      childId: 'c1'
    }
    const store = useProjectWorkspace()
    store.parents = makeParents()

    mount(Project, {
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

    expect(store.activeChild?.id).toBe('c1')

    // Simulate route change: mutate the reactive route param.
    mockRoute.current!.params.childId = 'c2'
    await nextTick()

    expect(store.activeChild?.id).toBe('c2')
  })

  it('selecting another project in the sidebar while previewing closes the compare viewer', async () => {
    mockRoute.current!.params = {
      parentTitle: encodeURIComponent('ドラゴンボール'),
      childId: 'c1'
    }
    const store = useProjectWorkspace()
    store.parents = makeParents()
    window.comicType.scanChildProject = vi.fn().mockResolvedValue({
      jpgPairs: [
        {
          jpgPath: '/tmp/page.jpg',
          psd: {
            absPath: '/tmp/page.psd',
            mtimeMs: 1,
            ctimeMs: 1,
            status: 'pending'
          }
        }
      ],
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
    await wrapper.get('.project-thumb-list-stub').trigger('click')
    expect(wrapper.find('.compare-viewer-stub').exists()).toBe(true)

    await wrapper.get('.project-sidebar-stub').trigger('click')
    expect(wrapper.find('.compare-viewer-stub').exists()).toBe(false)
  })

  it('进入详情页 → 左侧树自动展开父级并高亮当前话（真实侧栏 + 真实 ProjectTree）', async () => {
    mockRoute.current!.params = {
      parentTitle: encodeURIComponent('ドラゴンボール'),
      childId: 'c2'
    }
    const store = useProjectWorkspace()
    store.parents = makeParents()

    const wrapper = mount(Project, {
      global: {
        stubs: {
          'router-link': { template: '<a><slot /></a>', props: ['to'] },
          // 注意：ProjectSidebar **不桩** —— 这条用例要的就是真实侧栏 + 真实树。
          ProjectThumbList: ProjectThumbListStub,
          ProjectFooter: ProjectFooterStub,
          CompareViewer: CompareViewerStub,
          ProjectFormModal: ProjectFormModalStub
        }
      }
    })
    await flushPromises()

    // 父级被自动展开：两个子行都在 DOM 里。
    const rows = wrapper.findAll('[data-child-id]')
    expect(rows.map((row) => row.attributes('data-child-id'))).toEqual(['c1', 'c2'])

    const active = wrapper.get('[data-child-id="c2"]')
    expect(active.classes()).toContain('bg-card-bg-hover')
    expect(active.classes()).toContain('text-accent')
    expect(wrapper.get('[data-child-id="c1"]').classes()).not.toContain('text-accent')
  })

})
