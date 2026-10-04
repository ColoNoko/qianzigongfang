// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import AppSelect from '../AppSelect.vue'

describe('AppSelect', () => {
  it('uses an app-rendered green menu and emits the selected value', async () => {
    const wrapper = mount(AppSelect, {
      props: {
        modelValue: 'all',
        testId: 'category',
        options: [
          { value: 'all', label: '全部' },
          { value: 'chinese', label: '中文' }
        ]
      }
    })

    await wrapper.get('[data-testid="category-trigger"]').trigger('click')
    const chinese = wrapper.get('[data-testid="category-option-chinese"]')
    expect(chinese.classes()).toContain('hover:bg-selected-bg')

    await chinese.trigger('click')
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual(['chinese'])
  })

  it('filters searchable options while keeping the original trigger menu', async () => {
    const wrapper = mount(AppSelect, {
      props: {
        modelValue: 'regular',
        testId: 'font',
        searchable: true,
        options: [
          { value: 'regular', label: '思源黑体 - Regular' },
          { value: 'bold', label: '思源黑体 - Bold' },
          { value: 'other', label: 'Arial - Regular' }
        ]
      }
    })

    await wrapper.get('[data-testid="font-trigger"]').trigger('click')
    await wrapper.get('[data-testid="font-search"]').setValue('Bold')
    expect(wrapper.find('[data-testid="font-option-bold"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="font-option-regular"]').exists()).toBe(false)
    await wrapper.get('[data-testid="font-option-bold"]').trigger('click')
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['bold'])
  })
})
