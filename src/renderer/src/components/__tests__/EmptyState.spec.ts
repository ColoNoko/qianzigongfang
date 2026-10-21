// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import EmptyState from '../EmptyState.vue'


describe('EmptyState', () => {

  it('renders a CTA button and calls ctaAction on click', async () => {
    const action = vi.fn()
    const wrapper = mount(EmptyState, {
      props: { headline: '空', ctaText: '添加项目', ctaAction: action, ctaTestId: 'add-cta' }
    })
    const btn = wrapper.find('button')
    expect(btn.exists()).toBe(true)
    expect(btn.text()).toBe('添加项目')
    expect(btn.attributes('data-testid')).toBe('add-cta')
    await btn.trigger('click')
    expect(action).toHaveBeenCalledTimes(1)
  })
})