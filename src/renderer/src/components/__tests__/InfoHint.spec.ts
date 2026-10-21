// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest'
import { config, enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import InfoHint from '../InfoHint.vue'
config.global.stubs.teleport = true
config.global.renderStubDefaultSlot = true
enableAutoUnmount(afterEach)
it('opens labelled help and closes on a second click', async () => {
  const wrapper = mount(InfoHint, { attachTo: document.body, props: { label: '统计说明' }, slots: { default: '按当前职责统计' } })
  const trigger = wrapper.get('button')
  expect(trigger.attributes('aria-label')).toBe('统计说明')
  await trigger.trigger('click')
  await flushPromises()
  expect(wrapper.text()).toContain('按当前职责统计')
  expect(trigger.attributes('aria-expanded')).toBe('true')
  await trigger.trigger('click')
  expect(trigger.attributes('aria-expanded')).toBe('false')
})
