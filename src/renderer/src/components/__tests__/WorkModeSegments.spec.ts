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

it('旧启用范围不再限制模式，默认模式保存后可重载且空选择不生效', async () => {
  const values = new Map<string, unknown>([[WORK_MODES_STORAGE_KEY, { enabled: ['translated', 'proofread'], active: 'proofread' }]])
  window.comicType.storeGet = vi.fn(async (key) =>
    values.get(key)
  )
  vi.mocked(window.comicType.storeSet).mockImplementation(async (key, value) => { values.set(key, structuredClone(value)) })
  const settings = useSettingsStore()
  await settings.loadSettings()
  expect(settings.enabledWorkModes).toEqual(['typeset', 'translated', 'proofread', 'supervised'])
  expect(settings.activeWorkMode).toBe('proofread')
  await settings.setActiveWorkMode('supervised')
  await settings.saveWorkModes([])
  setActivePinia(createPinia())
  const restored = useSettingsStore()
  await restored.loadSettings()
  expect(restored.activeWorkMode).toBe('supervised')
  expect(restored.enabledWorkModes).toHaveLength(4)
})

it('写入失败保留原设置', async () => {
  const settings = useSettingsStore()
  vi.mocked(window.comicType.storeSet).mockRejectedValue(new Error('disk full'))
  await settings.saveWorkModes(['proofread'])
  expect(settings.enabledWorkModes).toHaveLength(4)
  expect(settings.activeWorkMode).toBe('typeset')
  expect(settings.savingWorkModes).toBe(false)
})
