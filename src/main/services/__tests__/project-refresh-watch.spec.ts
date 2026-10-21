// @vitest-environment node
/**
 * `ProjectRefreshWatch`（2026-10-05 从 0.4.0 的 project-refresh 思路移植，大幅简化）。
 *
 * 职责只有一条：**目录变了，通知外面去把扫描缓存刷一遍**。
 *   · 优先 `fs.watch`（递归），事件去抖 `debounceMs`；
 *   · `fs.watch` 不可用（网络盘 / 不支持递归）→ 回退成轮询 `pollIntervalMs`；
 *   · 有界：最多 `maxPaths` 个，超出把最旧的停掉。
 *
 * ⚠️ 与原版的差别（写清楚）：0.4.0 是"每个订阅者（WebContents）一把 watcher，
 * 变完直接推送事件给渲染层"。本项目**没有事件推送通道**，所以做成"主进程热缓存"：
 * 变更 → 重扫并刷新缓存；渲染层照旧靠自己的轻轮询 / 焦点刷新来取。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProjectRefreshWatch, type RefreshWatcherLike } from '../project-refresh-watch'

function fakeWatch() {
  const closed: string[] = []
  const handlers = new Map<string, () => void>()
  const watchFn = vi.fn((path: string, onEvent: () => void): RefreshWatcherLike => {
    handlers.set(path, onEvent)
    return { close: () => closed.push(path) }
  })
  return { closed, handlers, watchFn }
}

let onChange: ReturnType<typeof vi.fn<(path: string) => void>>
let watch: ProjectRefreshWatch

beforeEach(() => {
  vi.useFakeTimers()
  onChange = vi.fn()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('ProjectRefreshWatch — 变更后通知重扫', () => {
  it('监听中途报错后关闭 watcher 并持续轮询，移除后停止', () => {
    let fail = (): void => {}
    const close = vi.fn()
    watch = new ProjectRefreshWatch(onChange, {
      watchFn: (_path, _event, onError) => {
        fail = onError
        return { close }
      },
      pollIntervalMs: 100
    })
    watch.add('A')
    fail()
    fail()
    expect(close).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(200)
    expect(onChange).toHaveBeenCalledTimes(2)
    watch.remove('A')
    fail()
    vi.advanceTimersByTime(200)
    expect(onChange).toHaveBeenCalledTimes(2)
  })
  it('fs.watch 可用 ⇒ 事件去抖后只通知一次', () => {
    const { watchFn, handlers } = fakeWatch()
    watch = new ProjectRefreshWatch(onChange, { watchFn, debounceMs: 1000 })
    watch.add('D:\\漫画\\第1話')

    const emit = handlers.get('D:\\漫画\\第1話')!
    emit()
    emit() // 快速连发
    vi.advanceTimersByTime(999)
    expect(onChange).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith('D:\\漫画\\第1話')
  })

  it('fs.watch 不可用 ⇒ 回退轮询，每隔 pollIntervalMs 通知一次', () => {
    const watchFn = vi.fn(() => {
      throw new Error('EPERM: recursive watch unsupported')
    })
    watch = new ProjectRefreshWatch(onChange, { watchFn, pollIntervalMs: 15_000 })

    watch.add('Z:\\网络盘\\第1話')
    vi.advanceTimersByTime(15_000)
    expect(onChange).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(15_000)
    expect(onChange).toHaveBeenCalledTimes(2)
  })

  it('remove 之后不再通知（watcher 关闭 / 轮询停止）', () => {
    const { closed, handlers } = fakeWatch()
    watch = new ProjectRefreshWatch(onChange, { watchFn: vi.fn(), debounceMs: 500 })
    // 用一个能拿 handler 的 fake 重写更简单：直接用上面的 fakeWatch
    watch = new ProjectRefreshWatch(onChange, {
      watchFn: (path, onEvent) => {
        handlers.set(path, onEvent)
        return { close: () => closed.push(path) }
      },
      debounceMs: 500
    })
    watch.add('D:\\漫画\\第1話')
    watch.remove('D:\\漫画\\第1話')

    handlers.get('D:\\漫画\\第1話')!()
    vi.advanceTimersByTime(600)
    expect(onChange).not.toHaveBeenCalled()
    expect(closed).toContain('D:\\漫画\\第1話')
  })

  it('有界：超过 maxPaths 时把最旧的那个停掉', () => {
    const { closed, watchFn } = fakeWatch()
    watch = new ProjectRefreshWatch(onChange, { watchFn, maxPaths: 2 })

    watch.add('A')
    watch.add('B')
    watch.add('C')

    expect(watch.has('A')).toBe(false)
    expect(watch.has('B')).toBe(true)
    expect(watch.has('C')).toBe(true)
    expect(closed).toContain('A')
    expect(watchFn).toHaveBeenCalledTimes(3)
  })
})
