// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest'
import { enableAutoUnmount, mount } from '@vue/test-utils'
import ControlInput from '../ui/ControlInput.vue'
import { Slider } from '../ui/slider'
import { SliderRoot } from 'reka-ui'
enableAutoUnmount(afterEach)
it('keeps checked defaults and supplies the legacy change event', async () => {
  const wrapper = mount(ControlInput, { props: { type: 'checkbox', modelValue: true } })
  expect(wrapper.get('[role="checkbox"]').attributes('aria-checked')).toBe('true')
  await wrapper.get('[role="checkbox"]').trigger('click')
  expect(wrapper.emitted('update:modelValue')).toEqual([[false]])
  expect((wrapper.emitted('change')![0][0] as Event).target).toMatchObject({ checked: false })
})
it('retains numeric models and theme slider input values', async () => {
  const input = mount(ControlInput, { props: { type: 'number', modelValue: 2, modelModifiers: { number: true } } })
  await input.get('input').setValue('12')
  expect(input.emitted('update:modelValue')?.at(-1)).toEqual([12])
  const slider = mount(ControlInput, { props: { type: 'range', value: 222 }, attrs: { max: 360 } })
  expect(slider.getComponent(SliderRoot).props('modelValue')).toEqual([222])
  await slider.setProps({ value: 145 })
  expect(slider.getComponent(SliderRoot).props('modelValue')).toEqual([145])
  slider.getComponent(Slider).vm.$emit('update:modelValue', [145])
  expect((slider.emitted('input')![0][0] as Event).target).toMatchObject({ value: '145' })
})
