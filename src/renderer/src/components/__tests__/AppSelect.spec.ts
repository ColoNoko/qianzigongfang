// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest'
import { config, enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import AppSelect from '../AppSelect.vue'
import { Select } from '../ui/select'
config.global.stubs.teleport = true
config.global.renderStubDefaultSlot = true
enableAutoUnmount(afterEach)
it('preserves numeric and empty business values and ignores disabled options', () => {
  const wrapper = mount(AppSelect, { props: { modelValue: '', options: [
    { value: '', label: '默认' }, { value: 12, label: '十二' }, { value: 20, label: '不可用', disabled: true }
  ] } })
  const select = wrapper.getComponent(Select)
  select.vm.$emit('update:modelValue', 'option:12')
  select.vm.$emit('update:modelValue', 'option:20')
  select.vm.$emit('update:modelValue', 'option:')
  expect(wrapper.emitted('update:modelValue')).toEqual([[12], ['']])
})
it('searches by label and chooses the original value', async () => {
  const wrapper = mount(AppSelect, { attachTo: document.body, props: { modelValue: 'a', searchable: true, testId: 'font', options: [
    { value: 'a', label: '宋体' }, { value: 'b', label: '黑体' }
  ] } })
  await wrapper.get('[data-testid="font-trigger"]').trigger('click')
  await flushPromises()
  await wrapper.get('[data-testid="font-search"]').setValue('黑')
  await flushPromises()
  await wrapper.get('[data-testid="font-option-b"]').trigger('click')
  expect(wrapper.emitted('change')).toEqual([['b']])
  expect(wrapper.get('[data-testid="font-trigger"]').attributes('aria-expanded')).toBe('false')
})
