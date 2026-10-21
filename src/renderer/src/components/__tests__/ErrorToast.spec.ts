// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { enableAutoUnmount, mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { toast } from 'vue-sonner'
import ErrorToast from '../ErrorToast.vue'
import { useToastStore } from '@renderer/stores/toast'
vi.mock('vue-sonner', () => ({ toast: { loading: vi.fn(), success: vi.fn(), error: vi.fn(), warning: vi.fn(), dismiss: vi.fn() }, Toaster: { template: '<div />' } }))
enableAutoUnmount(afterEach)
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks() })
it('forwards notifications once and dismisses them after three seconds', async () => {
  vi.useFakeTimers(); setActivePinia(createPinia())
  const store = useToastStore(); mount(ErrorToast)
  const id = store.addToast({ type: 'success', message: '已保存' }); await nextTick()
  expect(toast.success).toHaveBeenCalledTimes(1)
  expect(toast.success).toHaveBeenCalledWith('已保存', expect.objectContaining({ id }))
  await vi.advanceTimersByTimeAsync(3000)
  expect(store.toasts).toHaveLength(0)
  expect(toast.dismiss).toHaveBeenCalledWith(id)
})

it('updates a persistent progress toast without duplicating it', async () => {
  vi.useFakeTimers(); setActivePinia(createPinia())
  const store = useToastStore(); mount(ErrorToast)
  const id = store.addToast({ type: 'loading', message: '扫描 1/2', duration: 0 }); await nextTick()
  await vi.advanceTimersByTimeAsync(5000)
  expect(store.toasts).toHaveLength(1)
  store.updateToast(id, '扫描 2/2'); await nextTick()
  expect(toast.loading).toHaveBeenLastCalledWith('扫描 2/2', expect.objectContaining({ id }))
  expect(store.toasts).toHaveLength(1)
  store.removeToast(id); await nextTick()
  expect(toast.dismiss).toHaveBeenCalledWith(id)
})
