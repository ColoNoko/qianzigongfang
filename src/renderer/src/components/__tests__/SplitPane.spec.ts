// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { enableAutoUnmount, mount } from '@vue/test-utils'
import SplitPane from '../SplitPane.vue'
import { ResizablePanelGroup, ResizablePanel } from '../ui/resizable'
enableAutoUnmount(afterEach)
afterEach(() => vi.useRealTimers())
it('restores saved proportions and debounces user layout persistence', async () => {
  vi.useFakeTimers()
  const wrapper = mount(SplitPane, { props: { primaryPercent: 42 }, slots: { primary: '列表', secondary: '预览' } })
  expect(wrapper.getComponent(ResizablePanel).props('defaultSize')).toBe(42)
  const group = wrapper.getComponent(ResizablePanelGroup)
  group.vm.$emit('layout', [42, 58])
  expect(wrapper.emitted('update:primaryPercent')).toBeUndefined()
  await wrapper.get('[data-testid="split-pane-divider"]').trigger('keydown', { key: 'Shift' })
  group.vm.$emit('layout', [45, 55]); group.vm.$emit('layout', [46, 54])
  await vi.advanceTimersByTimeAsync(300)
  expect(wrapper.emitted('update:primaryPercent')).toEqual([[46]])
})
