// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import { DirectoryWatchPool } from '../directory-watch-pool'

afterEach(() => vi.useRealTimers())

it('缓存和窗口共用监听，最后一个订阅释放后才关闭', () => {
  let emit: (filename?: string) => void = () => {}
  const close = vi.fn()
  const factory = vi.fn((_path, changed) => {
    emit = changed
    return { close }
  })
  const pool = new DirectoryWatchPool(factory)
  const cached = vi.fn(),
    window = vi.fn()
  const first = pool.subscribe('chapter', cached)
  const second = pool.subscribe('chapter', window)
  expect(factory).toHaveBeenCalledTimes(1)
  emit('1.psd')
  expect(cached).toHaveBeenCalledWith('1.psd')
  expect(window).toHaveBeenCalledWith('1.psd')
  first.close()
  expect(close).not.toHaveBeenCalled()
  emit('2.psd')
  expect(cached).toHaveBeenCalledTimes(1)
  expect(window).toHaveBeenCalledTimes(2)
  second.close()
  second.close()
  expect(close).toHaveBeenCalledTimes(1)
})

it('中途故障仅启动一个轮询，清理后不再通知', () => {
  vi.useFakeTimers()
  let fail = () => {}
  const close = vi.fn()
  const pool = new DirectoryWatchPool((_path, _changed, failed) => {
    fail = failed
    return { close }
  }, 100)
  const listener = vi.fn()
  const a = pool.subscribe('chapter', listener)
  const b = pool.subscribe('chapter', listener)
  fail()
  fail()
  vi.advanceTimersByTime(100)
  expect(listener).toHaveBeenCalledTimes(2)
  expect(close).toHaveBeenCalledTimes(1)
  a.close()
  vi.advanceTimersByTime(100)
  expect(listener).toHaveBeenCalledTimes(3)
  b.close()
  fail()
  vi.advanceTimersByTime(100)
  expect(listener).toHaveBeenCalledTimes(3)
})

it('监听建立失败可轮询，dispose 释放所有路径', () => {
  vi.useFakeTimers()
  const pool = new DirectoryWatchPool(() => {
    throw new Error('offline')
  }, 100)
  const listener = vi.fn()
  pool.subscribe('a', listener)
  pool.subscribe('b', listener)
  vi.advanceTimersByTime(100)
  expect(listener).toHaveBeenCalledTimes(2)
  pool.dispose()
  vi.advanceTimersByTime(1000)
  expect(listener).toHaveBeenCalledTimes(2)
})
