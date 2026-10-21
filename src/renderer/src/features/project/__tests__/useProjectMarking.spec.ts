import { describe, expect, it, vi } from 'vitest'
import { computed, effectScope, ref } from 'vue'
import type { JpgPsdPair, WorkMode } from '@shared/types'
const mocks = vi.hoisted(() => ({
  settings: { activeWorkMode: 'translated' },
  workspace: { activeChild: { id: 'chapter' }, rememberModeStatuses: vi.fn(), applyPsdStatusOverrides: vi.fn((pairs) => pairs), persistParentsProgress: vi.fn() }
}))
vi.mock('@renderer/stores/settings', () => ({ useSettingsStore: () => mocks.settings }))
vi.mock('@renderer/stores/projectWorkspace', () => ({ useProjectWorkspace: () => mocks.workspace, psdStatsFromPairs: vi.fn() }))
vi.mock('@renderer/stores/achievements', () => ({ useAchievementsStore: () => ({ refresh: vi.fn() }) }))
import { useProjectMarking } from '../useProjectMarking'
describe('card mode marking', () => {
  it('routes current-mode changes through the chapter session without changing the global default', () => {
    mocks.settings.activeWorkMode = 'translated'
    const mode = ref<WorkMode>('translated')
    const setCurrentMode = vi.fn((next: WorkMode) => { mode.value = next })
    const scope = effectScope()
    const marking = scope.run(() => useProjectMarking({
      pairs: ref([]), currentParent: computed(() => null),
      currentMode: computed(() => mode.value), setCurrentMode
    }))!
    try {
      marking.setActiveMode('proofread')
      expect(setCurrentMode).toHaveBeenCalledWith('proofread')
      expect(marking.activeMode.value).toBe('proofread')
      expect(mocks.settings.activeWorkMode).toBe('translated')
    } finally { scope.stop() }
  })

  it.each(['translated', 'proofread', 'supervised'] as const)('toggles only %s, independently of typeset status', async mode => {
    vi.clearAllMocks()
    mocks.settings.activeWorkMode = mode
    const pair = { psd: { absPath: 'C:/book/001.psd', status: 'done', modes: { typeset: true, translated: false, proofread: false, supervised: false } }, jpgPath: 'C:/book/001.jpg' } as JpgPsdPair
    const scope = effectScope()
    const marking = scope.run(() => useProjectMarking({ pairs: ref([pair]), currentParent: computed(() => null) }))!
    try {
      await marking.onMark(pair)
      expect(mocks.workspace.rememberModeStatuses).toHaveBeenLastCalledWith(mocks.workspace.activeChild, [pair], mode, true, expect.objectContaining({source:'card',mode,targetStatus:'done'}))
      pair.psd.modes![mode] = true
      await marking.onMark(pair)
      expect(mocks.workspace.rememberModeStatuses).toHaveBeenLastCalledWith(mocks.workspace.activeChild, [pair], mode, false, expect.objectContaining({source:'card',mode,targetStatus:'pending'}))
      expect(pair.psd.modes!.typeset).toBe(true)
    } finally { scope.stop() }
  })
})
