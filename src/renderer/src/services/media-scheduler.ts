import {
  PsdWorkerPool,
  type EncodedImage,
  type ImageEncodeOptions
} from '@renderer/workers/psd-pool'
import type { MediaInfo } from '@shared/media'

type Pending = {
  bytes: number
  priority: number
  signal?: AbortSignal
  start: () => void
  reject: (error: Error) => void
  detach: () => void
}
const aborted = (): Error => new DOMException('任务已取消', 'AbortError')
/** One memory budget for preview generation and full-size export, including file reads. */
export class MediaScheduler {
  private queue: Pending[] = []
  private active = 0
  private used = 0
  constructor(
    private budget = 768 * 1024 * 1024,
    private concurrency = 4
  ) {}
  run<T>(
    bytes: number,
    priority: number,
    signal: AbortSignal | undefined,
    task: () => Promise<T>
  ): Promise<T> {
    if (signal?.aborted) return Promise.reject(aborted())
    return new Promise((resolve, reject) => {
      const item: Pending = {
        bytes: Math.min(this.budget, Math.max(1, Number.isFinite(bytes) ? bytes : this.budget)),
        priority,
        signal,
        reject,
        detach: () => signal?.removeEventListener('abort', cancel),
        start: () => {
          item.detach()
          this.active++
          this.used += item.bytes
          void Promise.resolve()
            .then(task)
            .then(resolve, reject)
            .finally(() => {
              this.active--
              this.used -= item.bytes
              this.drain()
            })
        }
      }
      const cancel = () => {
        this.queue = this.queue.filter((entry) => entry !== item)
        item.detach()
        reject(aborted())
        this.drain()
      }
      signal?.addEventListener('abort', cancel, { once: true })
      this.queue.push(item)
      this.drain()
    })
  }
  private drain(): void {
    this.queue.sort((a, b) => a.priority - b.priority)
    while (this.active < this.concurrency && this.queue.length) {
      const item = this.queue[0]
      if (this.used + item.bytes > this.budget) return
      this.queue.shift()!.start()
    }
  }
}
export const mediaScheduler = new MediaScheduler()
let pool: PsdWorkerPool | undefined
export async function encodeSource(
  path: string,
  info: MediaInfo,
  options: ImageEncodeOptions,
  signal?: AbortSignal,
  priority = 0
): Promise<EncodedImage> {
  return mediaScheduler.run(info.estimatedBytes, priority, signal, async () => {
    const data = await window.comicType.readMedia(path, info)
    if (signal?.aborted) throw aborted()
    const buffer = new Uint8Array(data).buffer
    pool ??= new PsdWorkerPool(4)
    return pool.encode(buffer, options, signal)
  })
}
export function disposeMediaPool(): void {
  pool?.destroy()
  pool = undefined
}
