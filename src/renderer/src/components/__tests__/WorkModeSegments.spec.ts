// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import WorkModeSegments from '../WorkModeSegments.vue'
import { useSettingsStore, WORK_MODES_STORAGE_KEY } from '@renderer/stores/settings'

beforeEach(() => {
  setActivePinia(createPinia())
  window.comicType = {
    storeGet: vi.fn().mockResolvedValue(undefined),
    storeSet: vi.fn().mockResolvedValue(undefined)
  } as unknown as typeof window.comicType
})

it('单模式隐藏切换，多模式只提供启用项并发出选择', async () => {
  const wrapper = mount(WorkModeSegments, {
    props: { modelValue: 'translated', modes: ['translated'] }
  })
  expect(wrapper.find('input').exists()).toBe(false)
  expect(wrapper.text()).toBe('翻译')
  await wrapper.setProps({ modes: ['translated', 'proofread'] })
  expect(wrapper.findAll('button').map((button) => button.text())).toEqual(['翻译', '校对'])
  await wrapper.findAll('button')[1].trigger('click')
  expect(wrapper.emitted('update:modelValue')).toEqual([['proofread']])
})

it('启用范围和当前模式一起持久化，重载恢复，禁用项和空选择不能生效', async () => {
  const settings = useSettingsStore()
  await settings.saveWorkModes(['translated', 'proofread'])
  await settings.setActiveWorkMode('proofread')
  const saved = vi.mocked(window.comicType.storeSet).mock.calls.at(-1)![1]
  window.comicType.storeGet = vi.fn(async (key) =>
    key === WORK_MODES_STORAGE_KEY ? saved : undefined
  )
  setActivePinia(createPinia())
  const restored = useSettingsStore()
  await restored.loadSettings()
  expect(restored.enabledWorkModes).toEqual(['translated', 'proofread'])
  expect(restored.activeWorkMode).toBe('proofread')
  await restored.setActiveWorkMode('supervised')
  await restored.saveWorkModes([])
  expect(restored.activeWorkMode).toBe('proofread')
  await restored.saveWorkModes(['translated'])
  expect(restored.activeWorkMode).toBe('translated')
})

it('写入失败保留原设置', async () => {
  const settings = useSettingsStore()
  vi.mocked(window.comicType.storeSet).mockRejectedValue(new Error('disk full'))
  await settings.saveWorkModes(['proofread'])
  expect(settings.enabledWorkModes).toHaveLength(4)
  expect(settings.activeWorkMode).toBe('typeset')
  expect(settings.savingWorkModes).toBe(false)
})
