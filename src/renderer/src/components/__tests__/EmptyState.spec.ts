// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import EmptyState from '../EmptyState.vue'

describe('EmptyState', () => {
  it('renders the default icon and the headline', () => {
    const wrapper = mount(EmptyState, { props: { headline: '暂无数据' } })
    expect(wrapper.text()).toContain('(╥_╥)')
    expect(wrapper.text()).toContain('暂无数据')
  })

  it('renders a custom icon when provided', () => {
    const wrapper = mount(EmptyState, { props: { icon: '(；￣Д￣)', headline: '空' } })
    expect(wrapper.text()).toContain('(；￣Д￣)')
  })

  it('does not render a CTA button when ctaText is omitted', () => {
    const wrapper = mount(EmptyState, { props: { headline: '空' } })
    expect(wrapper.find('button').exists()).toBe(false)
  })

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