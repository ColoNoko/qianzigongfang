// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { computed, effectScope, ref, type EffectScope } from 'vue'
import { flushPromises } from '@vue/test-utils'
import type { ChildProject, ParentProject, WorkMode } from '@shared/types'
import { useSettingsStore } from '@renderer/stores/settings'
import { useChapterWorkMode } from '../useChapterWorkMode'

const scopes: EffectScope[] = []
function chapter(id: string, translated = 0, proofread = 0, total = 10): ChildProject {
  const stats = (count: number) => Array.from({ length: count }, () => ({ mtimeMs: 0, ctimeMs: 0 }))
  return {
    id, parentTitle: 'book', folderPath: `/book/${id}`, chapterNumber: id,
    projectTitle: id, lastMtimeMs: 0, psdStats: stats(total),
    psdModeStats: { typeset: [], translated: stats(translated), proofread: stats(proofread), supervised: [] }
  }
}
function book(id: string, duties: WorkMode[], children = [chapter('c1'), chapter('c2')]): ParentProject {
  return { id, title: id, lastMtimeMs: 0, duties, children }
}
function open(parent: ParentProject, ready = true) {
  const activeParent = ref(parent)
  const index = ref(0)
  const duties = ref(parent.duties ?? [])
  const dutiesReady = ref(ready)
  const requestedMode = ref<unknown>(undefined)
  const child = computed(() => activeParent.value.children[index.value])
  const scope = effectScope()
  scopes.push(scope)
  const result = scope.run(() => useChapterWorkMode({
    parent: activeParent, child, duties, dutiesReady, requestedMode
  }))!
  return { ...result, activeParent, index, duties, dutiesReady, requestedMode }
}

beforeEach(() => {
  setActivePinia(createPinia())
  window.comicType = { storeSet: vi.fn().mockResolvedValue(undefined), storeGet: vi.fn() } as unknown as typeof window.comicType
  useSettingsStore().settingsLoaded = true
})
afterEach(() => { scopes.splice(0).forEach(scope => scope.stop()) })

describe('chapter entry and current mode', () => {
  it('enters assigned duties and permits manual modes outside a legacy enabled list', async () => {
    const settings = useSettingsStore()
    vi.mocked(window.comicType.storeGet).mockImplementation(async key => key === 'ui.workModes'
      ? { enabled: ['proofread'], active: 'proofread' } : undefined)
    await settings.loadSettings()
    const view = open(book('a', ['translated']))
    expect(view.currentMode.value).toBe('translated')
    view.setCurrentMode('supervised')
    expect(view.currentMode.value).toBe('supervised')
    view.index.value = 1
    expect(view.currentMode.value).toBe('translated')
    await flushPromises()
    expect(settings.projectWorkModes.a).toBe('translated')
    expect(settings.activeWorkMode).toBe('proofread')
  })

  it('enters the only duty and keeps it when the global default changes', async () => {
    const settings = useSettingsStore()
    const view = open(book('a', ['proofread']))
    expect(view.currentMode.value).toBe('proofread')
    await settings.setActiveWorkMode('translated')
    expect(view.currentMode.value).toBe('proofread')
    expect(settings.projectWorkModes.a).toBe('proofread')
    expect(view.duties.value).toEqual(['proofread'])
  })

  it.each([
    ['slower', 'proofread'], ['faster', 'translated']
  ] as const)('uses this chapter progress for %s priority, not the book aggregate', (priority, expected) => {
    useSettingsStore().dutyModePriority = priority
    const view = open(book('a', ['translated', 'proofread'], [chapter('c1', 9, 1), chapter('c2', 0, 20, 20)]))
    expect(view.currentMode.value).toBe(expected)
  })

  it('breaks equal progress ties canonically and restores a valid remembered role before progress', () => {
    const settings = useSettingsStore()
    const first = open(book('a', ['proofread', 'translated']))
    expect(first.currentMode.value).toBe('translated')
    settings.projectWorkModes.b = 'proofread'
    const remembered = open(book('b', ['translated', 'proofread'], [chapter('b1', 0, 10)]))
    expect(remembered.currentMode.value).toBe('proofread')
  })

  it('skips disabled or removed remembered roles and never mutates duties', () => {
    const settings = useSettingsStore()
    settings.enabledWorkModes = ['translated', 'proofread']
    settings.activeWorkMode = 'translated'
    settings.projectWorkModes.a = 'supervised'
    const view = open(book('a', ['supervised', 'proofread']))
    expect(view.currentMode.value).toBe('proofread')
    view.setCurrentMode('supervised')
    expect(view.currentMode.value).toBe('proofread')
    expect(view.duties.value).toEqual(['supervised', 'proofread'])
  })

  it('no-duty entry follows the default, permits a session choice, then resets at the next chapter', async () => {
    const settings = useSettingsStore()
    settings.projectWorkModes.a = 'proofread'
    settings.activeWorkMode = 'translated'
    const view = open(book('a', []))
    expect(view.currentMode.value).toBe('translated')
    view.setCurrentMode('proofread')
    expect(view.currentMode.value).toBe('proofread')
    await settings.setActiveWorkMode('supervised')
    expect(view.currentMode.value).toBe('proofread')
    view.index.value = 1
    expect(view.currentMode.value).toBe('supervised')
    expect(window.comicType.storeSet).not.toHaveBeenCalledWith('ui.projectWorkModes', expect.anything())
    expect(view.duties.value).toEqual([])
  })

  it('a new global default only affects the next no-duty chapter entry', async () => {
    const settings = useSettingsStore()
    const view = open(book('a', []))
    expect(view.currentMode.value).toBe('typeset')
    await settings.setActiveWorkMode('translated')
    expect(view.currentMode.value).toBe('typeset')
    view.index.value = 1
    expect(view.currentMode.value).toBe('translated')
  })

  it('disabling the current role chooses an enabled fallback without changing duties', async () => {
    const settings = useSettingsStore()
    const view = open(book('a', ['proofread']))
    expect(view.currentMode.value).toBe('proofread')
    await settings.saveWorkModes(['translated'], 'translated')
    expect(view.currentMode.value).toBe('translated')
    expect(view.duties.value).toEqual(['proofread'])
  })

  it('a manual non-duty mode is session-only and the saved eligible role returns on entry', async () => {
    const settings = useSettingsStore()
    settings.projectWorkModes.a = 'proofread'
    const view = open(book('a', ['translated', 'proofread']))
    view.setCurrentMode('supervised')
    await flushPromises()
    expect(view.currentMode.value).toBe('supervised')
    expect(settings.projectWorkModes.a).toBe('proofread')
    expect(view.duties.value).toEqual(['translated', 'proofread'])
    view.index.value = 1
    expect(view.currentMode.value).toBe('proofread')
  })

  it.each([
    [['translated'], 'translated'], [[], 'typeset']
  ] as [WorkMode[], WorkMode][])('duty edits to %j only affect the next entry', async (duties, nextMode) => {
    const settings = useSettingsStore()
    const view = open(book('a', ['proofread']))
    await flushPromises()
    expect(view.currentMode.value).toBe('proofread')
    expect(settings.projectWorkModes.a).toBe('proofread')
    vi.mocked(window.comicType.storeSet).mockClear()
    view.duties.value = duties
    expect(view.currentMode.value).toBe('proofread')
    view.setCurrentMode('proofread')
    await flushPromises()
    expect(window.comicType.storeSet).not.toHaveBeenCalled()
    view.index.value = 1
    expect(view.currentMode.value).toBe(nextMode)
    await flushPromises()
    expect(settings.projectWorkModes.a).toBe(duties.length ? nextMode : 'proofread')
  })

  it('waits for inferred duties and settings without overwriting a newer manual choice', async () => {
    const settings = useSettingsStore()
    settings.settingsLoaded = false
    const view = open(book('a', []), false)
    view.setCurrentMode('proofread')
    view.duties.value = ['translated', 'proofread']
    settings.projectWorkModes.a = 'translated'
    settings.activeWorkMode = 'supervised'
    settings.settingsLoaded = true
    view.dutiesReady.value = true
    await flushPromises()
    expect(view.currentMode.value).toBe('proofread')
    expect(settings.projectWorkModes.a).toBe('proofread')
  })

  it('delayed inferred duties select their role rather than remembering the provisional global mode', async () => {
    const view = open(book('a', []), false)
    expect(view.currentMode.value).toBe('typeset')
    expect(window.comicType.storeSet).not.toHaveBeenCalled()
    view.duties.value = ['proofread']
    view.dutiesReady.value = true
    await flushPromises()
    expect(view.currentMode.value).toBe('proofread')
    expect(useSettingsStore().projectWorkModes.a).toBe('proofread')
  })

  it('rapid navigation sees the pending work choice and late writes cannot change another chapter', async () => {
    let finish!: () => void
    vi.mocked(window.comicType.storeSet).mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve }))
    const view = open(book('a', ['translated', 'proofread']))
    view.setCurrentMode('proofread')
    view.index.value = 1
    expect(view.currentMode.value).toBe('proofread')
    view.duties.value = []
    view.activeParent.value = book('b', [])
    expect(view.currentMode.value).toBe('typeset')
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    finish()
    await flushPromises()
    expect(view.currentMode.value).toBe('typeset')
    expect(useSettingsStore().projectWorkModes.a).toBe('proofread')
    expect(useSettingsStore().projectWorkModes.b).toBeUndefined()
  })

  it('honors an explicit enabled route mode without rewriting duties or their last role', async () => {
    const settings = useSettingsStore()
    settings.projectWorkModes.a = 'proofread'
    const view = open(book('a', ['proofread']))
    view.requestedMode.value = 'supervised'
    await flushPromises()
    expect(view.currentMode.value).toBe('supervised')
    expect(settings.projectWorkModes.a).toBe('proofread')
    expect(view.duties.value).toEqual(['proofread'])
  })
})
