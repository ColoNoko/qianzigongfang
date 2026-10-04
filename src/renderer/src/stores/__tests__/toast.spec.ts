// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useToastStore } from '../toast'

beforeEach(() => {
  setActivePinia(createPinia())
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useToastStore', () => {
  it('addToast pushes a toast with a generated id', () => {
    const store = useToastStore()
    const id = store.addToast({ type: 'success', message: 'hello', duration: 0 })
    expect(store.toasts).toHaveLength(1)
    expect(store.toasts[0].id).toBe(id)
    expect(store.toasts[0].type).toBe('success')
    expect(store.toasts[0].message).toBe('hello')
  })

  it('removeToast removes the matching toast', () => {
    const store = useToastStore()
    const id = store.addToast({ type: 'error', message: 'oops', duration: 0 })
    expect(store.toasts).toHaveLength(1)
    store.removeToast(id)
    expect(store.toasts).toHaveLength(0)
  })

  it('removeToast is a no-op for an unknown id', () => {
    const store = useToastStore()
    store.addToast({ type: 'warning', message: 'x', duration: 0 })
    store.removeToast('nonexistent')
    expect(store.toasts).toHaveLength(1)
  })

  it('auto-dismisses after the default 3000 ms duration', () => {
    const store = useToastStore()
    store.addToast({ type: 'success', message: 'auto' })
    expect(store.toasts).toHaveLength(1)
    vi.advanceTimersByTime(2999)
    expect(store.toasts).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(store.toasts).toHaveLength(0)
  })

  it('auto-dismisses after a custom duration', () => {
    const store = useToastStore()
    store.addToast({ type: 'error', message: 'custom', duration: 500 })
    vi.advanceTimersByTime(499)
    expect(store.toasts).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(store.toasts).toHaveLength(0)
  })

  it('duration=0 keeps the toast until manually removed', () => {
    const store = useToastStore()
    const id = store.addToast({ type: 'warning', message: 'persistent', duration: 0 })
    vi.advanceTimersByTime(10000)
    expect(store.toasts).toHaveLength(1)
    store.removeToast(id)
    expect(store.toasts).toHaveLength(0)
  })

  it('manual removeToast cancels a pending auto-dismiss timer', () => {
    const store = useToastStore()
    const id = store.addToast({ type: 'success', message: 'cancel me', duration: 1000 })
    store.removeToast(id)
    expect(store.toasts).toHaveLength(0)
    // Advancing past the original timer should not re-add or error.
    vi.advanceTimersByTime(2000)
    expect(store.toasts).toHaveLength(0)
  })
})