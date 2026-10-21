import { directoryWatchPool } from './directory-watch-pool'
import { extname, resolve, relative, isAbsolute } from 'node:path'
import { app, type WebContents } from 'electron'
import { projectScans } from './project-scans'

export { projectScans } from './project-scans'

type Subscription = {
  owner: WebContents
  path: string
  visible: boolean
  watcher?: { close(): void }
  timer?: ReturnType<typeof setTimeout>
  poll?: ReturnType<typeof setTimeout>
  fingerprint?: string
  disposed: boolean
}
const boundOwners = new WeakSet<WebContents>()
const subscriptions = new Map<number, Subscription>()
const extensions = new Set([
  '.psd',
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.gif',
  '.bmp',
  '.avif',
  '.jfif',
  '.txt'
])
function attach(sub: Subscription): void {
  if (sub.watcher || sub.disposed) return
  try {
    sub.watcher = directoryWatchPool.subscribe(sub.path, (filename) => {
      if (
        filename &&
        extname(String(filename)) &&
        !extensions.has(extname(String(filename)).toLowerCase())
      )
        return
      projectScans.invalidate(sub.path)
      schedule(sub)
    })
  } catch {
    /* Missing/network directories are retried by polling. */
  }
}
function schedule(sub: Subscription): void {
  if (sub.timer) clearTimeout(sub.timer)
  sub.timer = setTimeout(
    () => {
      sub.timer = undefined
      void refresh(sub)
    },
    sub.visible ? 900 : 5000
  )
}
async function refresh(sub: Subscription, confirm = false): Promise<void> {
  if (sub.disposed || sub.owner.isDestroyed()) return
  attach(sub)
  try {
    const result = await projectScans.request(sub.path)
    if (result.status === 'unavailable') {
      sub.watcher?.close()
      sub.watcher = undefined
    }
    const fingerprint = JSON.stringify({ ...result, revision: undefined })
    if (!sub.disposed && !sub.owner.isDestroyed() && (confirm || fingerprint !== sub.fingerprint)) {
      sub.fingerprint = fingerprint
      sub.owner.send('comicType:projectChanged', { folderPath: sub.path })
    }
  } catch {
    if (!sub.disposed && !sub.owner.isDestroyed())
      sub.owner.send('comicType:projectChanged', { folderPath: sub.path })
  }
}
function poll(sub: Subscription): void {
  if (sub.poll) clearTimeout(sub.poll)
  sub.poll = setTimeout(
    async () => {
      // A manual request may have displayed an error even when files are unchanged.
      // Confirm the recovered state on every fallback poll so that error can clear.
      await refresh(sub, true)
      if (!sub.disposed) poll(sub)
    },
    sub.visible ? 30_000 : 120_000
  )
}
export function watchProject(owner: WebContents, path: string | null, visible = true): void {
  const previous = subscriptions.get(owner.id)
  if (previous && path && resolve(previous.path) === resolve(path)) {
    previous.visible = visible
    if (previous.poll) clearTimeout(previous.poll)
    poll(previous)
    return
  }
  if (previous) {
    previous.disposed = true
    previous.watcher?.close()
    clearTimeout(previous.timer)
    clearTimeout(previous.poll)
    subscriptions.delete(owner.id)
  }
  if (!path) return
  if (!isAbsolute(path)) throw new Error('项目路径必须是绝对路径')
  const sub: Subscription = { owner, path: resolve(path), visible, disposed: false }
  subscriptions.set(owner.id, sub)
  attach(sub)
  poll(sub)
  if (!boundOwners.has(owner)) {
    boundOwners.add(owner)
    owner.once('destroyed', () => watchProject(owner, null))
  }
}
/** Called after an application-owned save; coalesces with OS watcher notifications. */
export function notifyProjectWrite(path: string): void {
  for (const sub of subscriptions.values()) {
    const rel = relative(sub.path, resolve(path))
    if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) {
      projectScans.invalidate(sub.path)
      schedule(sub)
    }
  }
}
app.once?.('before-quit', () => {
  for (const sub of [...subscriptions.values()]) watchProject(sub.owner, null)
  directoryWatchPool.dispose()
})
