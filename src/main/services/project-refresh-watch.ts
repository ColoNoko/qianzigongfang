import { directoryWatchPool } from './directory-watch-pool'

export interface RefreshWatcherLike {
  close(): void
}

export type RefreshWatchFn = (
  path: string,
  onEvent: () => void,
  onError: () => void
) => RefreshWatcherLike

export interface ProjectRefreshWatchOptions {
  watchFn?: RefreshWatchFn
  debounceMs?: number
  pollIntervalMs?: number
  maxPaths?: number
}

interface Entry {
  watcher?: RefreshWatcherLike
  debounce?: ReturnType<typeof setTimeout>
  poll?: ReturnType<typeof setInterval>
}

/**
 * 目录监听器（2026-10-05 从 0.4.0 的 project-refresh 思路移植，大幅简化）。
 *
 * 职责只有一条：**目录变了，通知外面去把扫描缓存刷一遍**。
 *   · 优先 `fs.watch`（递归），事件去抖 `debounceMs`（PS 存盘是一串连续写）；
 *   · `fs.watch` 不可用（网络盘 / 平台不支持递归监听）→ 回退成轮询 `pollIntervalMs`；
 *   · 有界：最多 `maxPaths` 个（默认 32），超出把**最旧**的那个停掉 —— 只监听
 *     "最近被扫过的那些话"，而不是库里几百个目录全挂 watcher。
 *
 * ⚠️ 与原版（WebContents 订阅 + 事件推送）的差别见本文件下方接线处的注释。
 */
export class ProjectRefreshWatch {
  private entries = new Map<string, Entry>()
  private readonly watchFn: RefreshWatchFn
  private readonly debounceMs: number
  private readonly pollIntervalMs: number
  private readonly maxPaths: number

  constructor(
    private onChange: (path: string) => void,
    options: ProjectRefreshWatchOptions = {}
  ) {
    this.watchFn =
      options.watchFn ?? ((path, onEvent) => directoryWatchPool.subscribe(path, onEvent))
    this.debounceMs = options.debounceMs ?? 1000
    this.pollIntervalMs = options.pollIntervalMs ?? 15_000
    this.maxPaths = options.maxPaths ?? 32
  }

  get size(): number {
    return this.entries.size
  }

  has(path: string): boolean {
    return this.entries.has(path)
  }

  add(path: string): void {
    if (this.entries.has(path)) return
    this.evictIfNeeded()

    const entry: Entry = {}
    this.entries.set(path, entry)
    const fallback = (): void => {
      if (this.entries.get(path) !== entry || entry.poll) return
      entry.watcher?.close()
      entry.watcher = undefined
      entry.poll = setInterval(() => this.onChange(path), this.pollIntervalMs)
    }
    try {
      entry.watcher = this.watchFn(path, () => this.schedule(path), fallback)
    } catch {
      // 平台不支持递归监听 / 网络盘：回退成轮询。
      fallback()
    }
  }

  remove(path: string): void {
    const entry = this.entries.get(path)
    if (!entry) return
    if (entry.debounce) clearTimeout(entry.debounce)
    if (entry.poll) clearInterval(entry.poll)
    entry.watcher?.close()
    this.entries.delete(path)
  }

  dispose(): void {
    for (const path of [...this.entries.keys()]) this.remove(path)
  }

  private schedule(path: string): void {
    const entry = this.entries.get(path)
    if (!entry) return
    if (entry.debounce) clearTimeout(entry.debounce)
    entry.debounce = setTimeout(() => {
      if (this.entries.has(path)) this.onChange(path)
    }, this.debounceMs)
  }

  private evictIfNeeded(): void {
    if (this.entries.size < this.maxPaths) return
    // Map 保持插入顺序：第一个键 = 最久没动的那个。
    const oldest = this.entries.keys().next().value as string | undefined
    if (oldest !== undefined) this.remove(oldest)
  }
}
