import { shallowReactive } from 'vue'
import type { JpgPsdPair } from '@shared/types'
import { sameMedia } from '@shared/media'
import { encodeSource, disposeMediaPool } from './media-scheduler'

export type ThumbnailState = {
  status: 'idle' | 'queued' | 'loading' | 'ready' | 'error'
  url: string | null
  error?: string
  source?: 'psd' | 'image' | 'fallback'
  bytes?: number
}
type Loaded = { url: string; bytes: number; source: 'psd' | 'image' | 'fallback'; error?: string }
export const thumbnailKey = (p: JpgPsdPair): string =>
  JSON.stringify([
    p.psd.absPath.replace(/\\/g, '/').toLowerCase(),
    p.psd.mtimeMs,
    p.psd.size ?? 0,
    p.jpgPath ?? null,
    Boolean(p.previewOnly)
  ])

/** Owns interest, cancellation, revisions and URLs. No grid owns an independent cache. */
export class ThumbnailService {
  readonly states = shallowReactive(new Map<string, ThumbnailState>())
  private queue = new Map<string, JpgPsdPair>()
  private visible = new Map<object, Set<string>>()
  private wanted = new Map<object, Set<string>>()
  private controllers = new Map<string, AbortController>()
  private touched = new Map<string, number>()
  private active = 0
  private memory = 0
  constructor(
    private loader: (
      pair: JpgPsdPair,
      signal?: AbortSignal,
      priority?: number
    ) => Promise<string | Loaded>,
    private concurrency = 4,
    private capacity = 96,
    private memoryLimit = 64 * 1024 * 1024
  ) {}
  state(pair: JpgPsdPair): ThumbnailState {
    return this.states.get(thumbnailKey(pair)) ?? { status: 'idle', url: null }
  }
  setVisible(owner: object, pairs: JpgPsdPair[], nearby: JpgPsdPair[] = []): void {
    const previous = this.visible.get(owner) ?? new Set<string>()
    this.visible.set(owner, new Set(pairs.map(thumbnailKey)))
    this.wanted.set(owner, new Set([...pairs, ...nearby].map(thumbnailKey)))
    this.retireUnwanted()
    for (const pair of pairs) {
      const newlyVisible = !previous.has(thumbnailKey(pair))
      if (newlyVisible) this.recovered.delete(thumbnailKey(pair))
      this.request(pair, newlyVisible, owner)
    }
    for (const pair of nearby) this.request(pair, false, owner)
    this.trim()
    this.drain()
  }
  release(owner: object): void {
    this.visible.delete(owner)
    this.wanted.delete(owner)
    this.retireUnwanted()
    this.trim()
  }
  private owned = new Set<string>()
  private isWanted(key: string): boolean {
    return [...this.wanted.values()].some((keys) => keys.has(key))
  }
  private isVisible(key: string): boolean {
    return [...this.visible.values()].some((keys) => keys.has(key))
  }
  private retireUnwanted(): void {
    for (const key of this.owned) {
      if (this.isWanted(key)) continue
      this.queue.delete(key)
      const controller = this.controllers.get(key)
      if (controller) {
        this.controllers.delete(key)
        controller.abort()
        this.remove(key)
      } else if (this.states.get(key)?.status === 'queued') this.remove(key)
      this.owned.delete(key)
    }
  }
  request(pair: JpgPsdPair, retry = false, owner?: object): void {
    const key = thumbnailKey(pair)
    if (owner) {
      if (!this.wanted.get(owner)?.has(key)) return
      this.owned.add(key)
    }
    const state = this.states.get(key)
    const expiredFallback =
      state?.source === 'fallback' && Date.now() - (this.touched.get(key) ?? 0) > 30_000
    if (
      state &&
      state.status !== 'idle' &&
      !(retry && (state.status === 'error' || state.source === 'fallback')) &&
      !expiredFallback
    ) {
      if (state.source !== 'fallback') this.touched.set(key, Date.now())
      return
    }
    this.remove(key)
    this.touched.set(key, Date.now())
    this.states.set(key, { status: 'queued', url: null })
    this.queue.set(key, pair)
    this.drain()
  }
  private recovered = new Set<string>()
  async imageFailed(pair: JpgPsdPair, url: string): Promise<void> {
    const key = thumbnailKey(pair)
    if (this.states.get(key)?.url !== url) return
    this.remove(key)
    const state: ThumbnailState = { status: 'error', url: null, error: '缩略图解码失败，请重试' }
    this.states.set(key, state)
    await window.comicType
      .invalidatePsdThumbnail(pair.psd.absPath, pair.psd.mtimeMs)
      .catch(() => undefined)
    if (this.states.get(key) !== state || this.recovered.has(key)) return
    this.recovered.add(key)
    if (this.recovered.size > this.capacity)
      this.recovered.delete(this.recovered.values().next().value!)
    if (this.isWanted(key)) this.request(pair, true)
  }
  private drain(): void {
    while (this.active < this.concurrency && this.queue.size) {
      const key =
        [...this.queue.keys()].find((k) => this.isVisible(k)) ?? this.queue.keys().next().value!
      const pair = this.queue.get(key)!
      this.queue.delete(key)
      const controller = new AbortController()
      this.controllers.set(key, controller)
      const deadline = setTimeout(
        () => controller.abort(new Error('缩略图读取或生成超时，请重试')),
        30_000
      )
      this.active++
      this.states.set(key, { status: 'loading', url: null })
      const aborted = new Promise<never>((_, reject) =>
        controller.signal.addEventListener('abort', () => reject(controller.signal.reason), {
          once: true
        })
      )
      const load = Promise.resolve()
        .then(() => this.loader(pair, controller.signal, this.isVisible(key) ? 0 : 2))
        .then((result) => {
          if (controller.signal.aborted) {
            if (typeof result !== 'string') URL.revokeObjectURL(result.url)
            throw controller.signal.reason
          }
          return result
        })
      void Promise.race([load, aborted])
        .then((result) => {
          if (this.controllers.get(key) !== controller) return
          const value =
            typeof result === 'string'
              ? { url: result, bytes: result.length * 2, source: 'psd' as const }
              : result
          this.memory += value.bytes
          this.states.set(key, { status: 'ready', ...value })
        })
        .catch((error) => {
          if (this.controllers.get(key) === controller)
            this.states.set(key, {
              status: 'error',
              url: null,
              error: error instanceof Error ? error.message : String(error)
            })
        })
        .finally(() => {
          clearTimeout(deadline)
          if (this.controllers.get(key) === controller) this.controllers.delete(key)
          this.active--
          this.trim()
          this.drain()
        })
    }
  }
  private remove(key: string): void {
    const state = this.states.get(key)
    this.memory -= state?.bytes ?? 0
    if (state?.url?.startsWith('blob:')) URL.revokeObjectURL(state.url)
    this.states.delete(key)
    this.touched.delete(key)
  }
  private trim(): void {
    const candidates = [...this.states.keys()]
      .filter(
        (key) =>
          !this.isVisible(key) && !['queued', 'loading'].includes(this.states.get(key)!.status)
      )
      .sort((a, b) => (this.touched.get(a) ?? 0) - (this.touched.get(b) ?? 0))
    while (
      (this.states.size > this.capacity || this.memory > this.memoryLimit) &&
      candidates.length
    )
      this.remove(candidates.shift()!)
  }
  destroy(): void {
    this.recovered.clear()
    this.owned.clear()
    this.queue.clear()
    this.wanted.clear()
    this.visible.clear()
    for (const controller of this.controllers.values()) controller.abort()
    this.controllers.clear()
    for (const key of this.states.keys()) this.remove(key)
  }
}

async function renderImage(
  path: string,
  raster: boolean,
  signal?: AbortSignal,
  priority = 0
): Promise<{ bytes: ArrayBuffer; width: number; height: number }> {
  const info = await window.comicType.mediaInfo(path)
  if (signal?.aborted) throw signal.reason
  const result = await encodeSource(
    path,
    info,
    { raster, maxEdge: 480, format: 'png' },
    signal,
    priority
  )
  if (!sameMedia(info, await window.comicType.mediaInfo(path)))
    throw new Error('源文件仍在写入，请稍后重试')
  return result
}
async function loadThumbnail(
  pair: JpgPsdPair,
  signal?: AbortSignal,
  priority = 0
): Promise<Loaded> {
  const make = (
    bytes: ArrayBuffer | Uint8Array,
    source: Loaded['source'],
    width = 480,
    height = 480,
    error?: string
  ): Loaded => {
    if (signal?.aborted) throw signal.reason
    const blob = new Blob([new Uint8Array(bytes instanceof ArrayBuffer ? bytes : bytes).buffer], {
      type: 'image/png'
    })
    return { url: URL.createObjectURL(blob), bytes: blob.size + width * height * 4, source, error }
  }
  const path = pair.previewOnly ? (pair.jpgPath ?? pair.psd.absPath) : pair.psd.absPath
  const source = pair.previewOnly ? 'image' : 'psd'
  try {
    const cached = await window.comicType.readPsdThumbnailBytes(path, pair.psd.mtimeMs)
    if (cached) {
      try {
        const decoded = await createImageBitmap(new Blob([new Uint8Array(cached).buffer]))
        decoded.close()
        return make(cached, source)
      } catch {
        await window.comicType.invalidatePsdThumbnail(pair.psd.absPath, pair.psd.mtimeMs)
      }
    }
  } catch {
    /* Cache failure must not prevent decoding. */
  }
  let error: unknown
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const current = await window.comicType.mediaInfo(path)
      if (
        current.mtimeMs !== pair.psd.mtimeMs ||
        (pair.psd.size !== undefined && current.size !== pair.psd.size)
      )
        throw new Error('源文件已更新，等待项目同步')
      const image = await renderImage(path, Boolean(pair.previewOnly), signal, priority)
      void window.comicType
        .writePsdThumbnailBytes(path, pair.psd.mtimeMs, new Uint8Array(image.bytes), current.size)
        .catch(() => undefined)
      return make(image.bytes, source, image.width, image.height)
    } catch (failure) {
      if (signal?.aborted) throw signal.reason
      error = failure
      if (attempt || !/写入|更新|EBUSY|EACCES|ENOENT/.test(String(failure))) break
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
  }
  if (!pair.previewOnly && pair.jpgPath) {
    const image = await renderImage(pair.jpgPath, true, signal, priority)
    return make(
      image.bytes,
      'fallback',
      image.width,
      image.height,
      `PSD 预览失败，当前显示原图：${String(error)}`
    )
  }
  throw error
}
let service: ThumbnailService | undefined
export function getThumbnailService(): ThumbnailService {
  return (service ??= new ThumbnailService(loadThumbnail))
}
export function resetThumbnailService(): void {
  service?.destroy()
  service = undefined
  disposeMediaPool()
}
