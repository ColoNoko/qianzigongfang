import { sameMedia, type MediaInfo } from '@shared/media'
import { encodeSource } from './media-scheduler'
import type { EncodedImage } from '@renderer/workers/psd-pool'

export interface PreviewLease {
  url: string
  width: number
  height: number
  release(): void
}
type Image = { url: string; width: number; height: number; bytes: number }
type Entry = {
  controller: AbortController
  promise: Promise<Image>
  users: number
  touched: number
  image?: Image
}
const aborted = (): Error => new DOMException('预览已取消', 'AbortError')
/** Shared full-resolution previews; referenced images stay alive until every viewer releases them. */
export class PreviewCache {
  private entries = new Map<string, Entry>()
  constructor(
    private render: (
      path: string,
      info: MediaInfo,
      raster: boolean,
      signal: AbortSignal,
      priority: number
    ) => Promise<EncodedImage> = (path, info, raster, signal, priority) =>
      encodeSource(path, info, { raster, format: 'png' }, signal, priority),
    private capacity = 8,
    private byteLimit = 256 * 1024 * 1024
  ) {}
  async acquire(
    path: string,
    raster: boolean,
    signal?: AbortSignal,
    priority = -1
  ): Promise<PreviewLease> {
    if (signal?.aborted) throw aborted()
    const info = await window.comicType.mediaInfo(path)
    if (signal?.aborted) throw aborted()
    const key = JSON.stringify([
      path.replace(/\\/g, '/').toLowerCase(),
      info.size,
      info.mtimeMs,
      raster
    ])
    let entry = this.entries.get(key)
    if (!entry) {
      const controller = new AbortController()
      entry = {
        controller,
        users: 0,
        touched: Date.now(),
        promise: Promise.resolve(null as unknown as Image)
      }
      const created = entry
      created.promise = Promise.resolve()
        .then(() => this.render(path, info, raster, controller.signal, priority))
        .then(async (result) => {
          if (!sameMedia(info, await window.comicType.mediaInfo(path)))
            throw new Error('源文件已更新，请重试')
          if (controller.signal.aborted) throw aborted()
          const blob = new Blob([result.bytes], { type: 'image/png' })
          const image = {
            url: URL.createObjectURL(blob),
            width: result.width,
            height: result.height,
            bytes: blob.size + result.width * result.height * 4
          }
          created.image = image
          this.trim()
          return image
        })
        .catch((error) => {
          if (this.entries.get(key) === created) this.entries.delete(key)
          throw error
        })
      this.entries.set(key, created)
    }
    const current = entry
    current.users++
    current.touched = Date.now()
    return new Promise<PreviewLease>((resolve, reject) => {
      let released = false
      const release = () => {
        if (released) return
        released = true
        signal?.removeEventListener('abort', cancel)
        current.users--
        current.touched = Date.now()
        if (!current.users && !current.image) {
          current.controller.abort()
          if (this.entries.get(key) === current) this.entries.delete(key)
        }
        this.trim()
      }
      const cancel = () => {
        release()
        reject(aborted())
      }
      signal?.addEventListener('abort', cancel, { once: true })
      current.promise.then(
        (image) => {
          if (released) return
          resolve({ url: image.url, width: image.width, height: image.height, release })
        },
        (error) => {
          release()
          reject(error)
        }
      )
    })
  }
  private trim(): void {
    const ready = [...this.entries.entries()].filter(([, entry]) => entry.image)
    let bytes = ready.reduce((total, [, entry]) => total + entry.image!.bytes, 0)
    let count = ready.length
    for (const [key, entry] of ready.sort((a, b) => a[1].touched - b[1].touched)) {
      if (bytes <= this.byteLimit && count <= this.capacity) break
      if (entry.users) continue
      URL.revokeObjectURL(entry.image!.url)
      this.entries.delete(key)
      bytes -= entry.image!.bytes
      count--
    }
  }
  destroy(): void {
    for (const entry of this.entries.values()) {
      entry.controller.abort()
      if (entry.image) URL.revokeObjectURL(entry.image.url)
    }
    this.entries.clear()
  }
}
export const previewCache = new PreviewCache()
