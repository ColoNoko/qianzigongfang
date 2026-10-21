import { watch } from 'node:fs'
import { resolve } from 'node:path'

type Listener = (filename?: string) => void
interface WatchHandle {
  close(): void
}
type WatchFactory = (path: string, changed: Listener, failed: () => void) => WatchHandle
interface Entry {
  listeners: Set<Listener>
  watcher?: WatchHandle
  poll?: ReturnType<typeof setInterval>
}

/** One OS watcher and fallback timer per path, shared by cache and window subscriptions. */
export class DirectoryWatchPool {
  private readonly entries = new Map<string, Entry>()

  constructor(
    private readonly factory: WatchFactory = (path, changed, failed) => {
      const watcher = watch(path, { recursive: true }, (_event, filename) =>
        changed(filename == null ? undefined : String(filename))
      )
      watcher.on('error', failed)
      return watcher
    },
    private readonly pollMs = 15_000
  ) {}

  subscribe(path: string, listener: Listener): WatchHandle {
    const resolved = resolve(path)
    const key = process.platform === 'win32' ? resolved.toLowerCase() : resolved
    let entry = this.entries.get(key)
    if (!entry) {
      entry = { listeners: new Set() }
      this.entries.set(key, entry)
      const current = entry
      const changed: Listener = (filename) => {
        for (const notify of [...current.listeners]) notify(filename)
      }
      const fallback = (): void => {
        if (this.entries.get(key) !== current || current.poll) return
        current.watcher?.close()
        current.watcher = undefined
        current.poll = setInterval(() => changed(), this.pollMs)
        current.poll.unref?.()
      }
      try {
        current.watcher = this.factory(resolved, changed, fallback)
      } catch {
        fallback()
      }
    }
    const current = entry
    // Each subscription has its own token, even when callers reuse the same callback.
    const notify: Listener = (filename) => listener(filename)
    current.listeners.add(notify)
    return {
      close: () => {
        current.listeners.delete(notify)
        if (current.listeners.size || this.entries.get(key) !== current) return
        current.watcher?.close()
        if (current.poll) clearInterval(current.poll)
        this.entries.delete(key)
      }
    }
  }

  dispose(): void {
    for (const entry of this.entries.values()) {
      entry.listeners.clear()
      entry.watcher?.close()
      if (entry.poll) clearInterval(entry.poll)
    }
    this.entries.clear()
  }
}

export const directoryWatchPool = new DirectoryWatchPool()
