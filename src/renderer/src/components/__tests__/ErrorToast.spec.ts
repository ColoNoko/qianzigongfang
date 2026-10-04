// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import ErrorToast from '../ErrorToast.vue'
import { useToastStore } from '@renderer/stores/toast'

beforeEach(() => {
  setActivePinia(createPinia())
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('ErrorToast', () => {
  it('renders nothing when the store is empty', () => {
    const wrapper = mount(ErrorToast)
    expect(wrapper.findAll('[data-testid="error-toast-container"] > *')).toHaveLength(0)
  })

  it('renders toasts from the store with their messages', () => {
    const store = useToastStore()
    store.addToast({ type: 'success', message: '保存成功', duration: 0 })
    store.addToast({ type: 'error', message: '加载失败', duration: 0 })

    const wrapper = mount(ErrorToast)
    const items = wrapper.findAll('[data-testid="error-toast-container"] > *')
    expect(items).toHaveLength(2)
    expect(wrapper.text()).toContain('保存成功')
    expect(wrapper.text()).toContain('加载失败')
  })

  it('applies type-based styling (success=accent, error=red)', () => {
    const store = useToastStore()
    store.addToast({ type: 'success', message: 'ok', duration: 0 })
    store.addToast({ type: 'error', message: 'bad', duration: 0 })

    const wrapper = mount(ErrorToast)
    const items = wrapper.findAll('[data-testid="error-toast-container"] > *')
    expect(items[0].classes()).toContain('bg-accent')
    expect(items[1].classes()).toContain('bg-danger')
    expect(items[0].classes()).toContain('font-bold')
  })

  it('auto-dismisses toasts after the store duration elapses', async () => {
    const store = useToastStore()
    store.addToast({ type: 'warning', message: 'soon gone', duration: 1000 })

    const wrapper = mount(ErrorToast)
    expect(wrapper.text()).toContain('soon gone')

    vi.advanceTimersByTime(1000)
    expect(store.toasts).toHaveLength(0)
    // Re-render check: the wrapper reflects the now-empty store.
    await nextTick()
    expect(wrapper.findAll('[data-testid="error-toast-container"] > *')).toHaveLength(0)
  })

  it('clicking a toast removes it from the store', async () => {
    const store = useToastStore()
    store.addToast({ type: 'error', message: 'click me', duration: 0 })

    const wrapper = mount(ErrorToast)
    const item = wrapper.find('[data-testid="error-toast-container"] > *')
    await item.trigger('click')
    expect(store.toasts).toHaveLength(0)
  })
})
