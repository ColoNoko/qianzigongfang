// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { reactive } from 'vue'
import Project from '../Project.vue'
import WorkModeSegments from '@renderer/components/WorkModeSegments.vue'
import { useSettingsStore } from '@renderer/stores/settings'
import { useProjectWorkspace } from '@renderer/stores/projectWorkspace'
import type { ParentProject } from '@shared/types'

enableAutoUnmount(afterEach)
const { routeHolder } = vi.hoisted(() => ({ routeHolder: { current: {} as { params: { childId: string }; query: Record<string, string> } } }))
vi.mock('vue-router', () => ({ useRoute: () => routeHolder.current, useRouter: () => ({ push: vi.fn() }) }))

const pair = { jpgPath: '/demo/01.jpg', psd: { absPath: '/demo/01.psd', mtimeMs: 1, ctimeMs: 1, status: 'pending' } }
const parents: ParentProject[] = [{
  id: 'p1', title: '这是一部用于测试超长中文标题也不会改变进度列位置的漫画作品', duties: ['translated', 'proofread'], lastMtimeMs: 0,
  children: [{ id: 'c1', parentTitle: '漫画', projectTitle: '很长很长的章节标题'.repeat(8), folderPath: '/demo', chapterNumber: '1', lastMtimeMs: 0 }]
}]
const sidebarStub = { name: 'ProjectSidebar', props: ['parentModes', 'mode'], emits: ['batchMark'], template: '<div />' }
const viewerStub = {
  name: 'CompareViewer', props: ['mode'], emits: ['update:fullscreen', 'close'],
  template: '<div data-preview><button data-expand @click="$emit(\'update:fullscreen\', true)">expand</button><button data-close @click="$emit(\'close\')">close</button></div>'
}

beforeEach(() => {
  routeHolder.current = reactive({ params: { childId: 'c1' }, query: {} })
  setActivePinia(createPinia())
  useProjectWorkspace().parents = structuredClone(parents)
  const settings = useSettingsStore()
  settings.settingsLoaded = true
  settings.projectWorkModes = { p1: 'proofread' }
  window.comicType = {
    storeGet: vi.fn().mockResolvedValue(undefined), storeSet: vi.fn().mockResolvedValue(undefined),
    scanChildProject: vi.fn().mockResolvedValue({ jpgPairs: [pair], txtFiles: [], errors: [] }),
    projectSaveProgress: vi.fn().mockResolvedValue(undefined), listDir: vi.fn().mockResolvedValue([]),
    readChapterTranslation: vi.fn().mockResolvedValue({ status: 'not-found', file: null, txtCount: 0, message: '', document: null }),
    listTranslationReviews: vi.fn().mockResolvedValue({ ok: true, records: [] }),
    openPath: vi.fn().mockResolvedValue({ ok: true })
  } as unknown as typeof window.comicType
})

function mountProject() {
  return mount(Project, { attachTo: document.body, global: { stubs: {
    SplitPane: { template: '<div><aside data-sidebar><slot name="primary" /></aside><main data-secondary><slot name="secondary" /></main></div>' },
    ProjectSidebar: sidebarStub, ProjectFooter: true, ProjectFormModal: true,
    ProjectThumbList: { props: ['pairs'], template: '<button data-open @click="$emit(\'compare\', pairs[0])">preview</button>' },
    CompareViewer: viewerStub, SelfCheckDialog: true, SourceRootDialog: true, MarkHistoryDialog: true,
    TranslationConflictDialog: true, TranslationCreditsEditor: true
  } } })
}

describe('章节工作区接线', () => {
  it('keeps duties, the chapter mode, and the global default independent', async () => {
    const wrapper = mountProject()
    await flushPromises()
    const segments = wrapper.getComponent(WorkModeSegments)
    expect(segments.props('modelValue')).toBe('proofread')
    await useSettingsStore().setActiveWorkMode('supervised')
    await flushPromises()
    expect(segments.props('modelValue')).toBe('proofread')
    segments.vm.$emit('update:modelValue', 'translated')
    await flushPromises()
    expect(segments.props('modelValue')).toBe('translated')
    expect(useSettingsStore().activeWorkMode).toBe('supervised')
    expect(useSettingsStore().projectWorkModes.p1).toBe('translated')
    expect(useProjectWorkspace().parents[0].duties).toEqual(['translated', 'proofread'])
    // A non-duty temporary mode still controls the current sidebar's progress/actions.
    segments.vm.$emit('update:modelValue', 'supervised')
    await flushPromises()
    expect(wrapper.getComponent(sidebarStub).props('parentModes')).toMatchObject({ p1: 'supervised' })
    expect(useSettingsStore().projectWorkModes.p1).toBe('translated')
    segments.vm.$emit('update:modelValue', 'translated')
    await flushPromises()
    window.dispatchEvent(new Event('focus'))
    await flushPromises()
    expect(segments.props('modelValue')).toBe('translated')
  })

  it('expands inside the project surface, preserving the sidebar host and restoring on close', async () => {
    const wrapper = mountProject()
    await flushPromises()
    await wrapper.get('[data-open]').trigger('click')
    await flushPromises()
    const surface = wrapper.get('[data-project-surface]').element
    const workspace = wrapper.get('[data-viewer-workspace]').element
    expect(workspace.parentElement?.matches('[data-secondary]')).toBe(true)
    await wrapper.get('[data-expand]').trigger('click')
    expect(workspace.parentElement).toBe(surface)
    expect(workspace.parentElement).not.toBe(document.body)
    expect(wrapper.find('[data-sidebar]').exists()).toBe(true)
    expect(workspace.getAttribute('data-expanded')).toBe('true')
    await wrapper.get('[data-close]').trigger('click')
    expect(workspace.parentElement?.matches('[data-secondary]')).toBe(true)
    expect(workspace.getAttribute('data-expanded')).toBe('false')
    expect(wrapper.get('h2').attributes('title')).toContain(parents[0].children[0].projectTitle)
  })
})
