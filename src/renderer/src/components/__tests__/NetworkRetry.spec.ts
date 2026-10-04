// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import NetworkRetry from '../NetworkRetry.vue'

describe('NetworkRetry', () => {
  it('renders the default message and a retry button', () => {
    const wrapper = mount(NetworkRetry)
    expect(wrapper.text()).toContain('网络较慢，正在加载...')
    const btn = wrapper.find('[data-testid="retry-button"]')
    expect(btn.exists()).toBe(true)
    expect(btn.text()).toBe('重试')
  })

  it('emits retry when the retry button is clicked', async () => {
    const wrapper = mount(NetworkRetry)
    const btn = wrapper.find('[data-testid="retry-button"]')
    await btn.trigger('click')
    const events = wrapper.emitted('retry')
    expect(events).toBeTruthy()
    expect(events!.length).toBe(1)
  })

  it('shows the error text when the error prop is provided', () => {
    const wrapper = mount(NetworkRetry, {
      props: { error: '连接超时，请检查网络' }
    })
    expect(wrapper.text()).toContain('连接超时，请检查网络')
  })

  it('does not render error text when error is null', () => {
    const wrapper = mount(NetworkRetry)
    expect(wrapper.find('.text-danger').exists()).toBe(false)
  })
})