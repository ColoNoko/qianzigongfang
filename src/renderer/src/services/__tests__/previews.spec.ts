// @vitest-environment jsdom
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { PreviewCache } from '../previews'
const info = { size: 1, mtimeMs: 1, estimatedBytes: 32 }
let caches: PreviewCache[] = []
let url = 0
beforeEach(() => {
  Object.assign(URL, { createObjectURL: vi.fn(() => `blob:${++url}`), revokeObjectURL: vi.fn() })
  Object.assign(window, { comicType: { mediaInfo: vi.fn(async () => ({ ...info })) } })
})
afterEach(() => {
  caches.forEach((c) => c.destroy())
  caches = []
})
function cache(
  render = vi.fn(async () => ({ bytes: new ArrayBuffer(4), width: 640, height: 960 })),
  capacity = 8
) {
  const result = new PreviewCache(render, capacity)
  caches.push(result)
  return { result, render }
}
it('deduplicates concurrent full resolution previews and retains released pages', async () => {
  const { result, render } = cache()
  const [a, b] = await Promise.all([result.acquire('a.psd', false), result.acquire('a.psd', false)])
  expect(render).toHaveBeenCalledTimes(1)
  expect(a.url).toBe(b.url)
  expect([a.width, a.height]).toEqual([640, 960])
  a.release()
  b.release()
  const again = await result.acquire('a.psd', false)
  expect(again.url).toBe(a.url)
  expect(render).toHaveBeenCalledTimes(1)
  again.release()
})
it('checks source revisions and retains active leases when evicting old pages', async () => {
  const { result, render } = cache(undefined, 1)
  const a = await result.acquire('a', false)
  const b = await result.acquire('b', false)
  expect(URL.revokeObjectURL).not.toHaveBeenCalled()
  a.release()
  expect(URL.revokeObjectURL).toHaveBeenCalledWith(a.url)
  b.release()
  vi.mocked(window.comicType.mediaInfo).mockResolvedValue({ ...info, size: 2 })
  const changed = await result.acquire('b', false)
  expect(changed.url).not.toBe(b.url)
  expect(render).toHaveBeenCalledTimes(3)
  changed.release()
})
it('one cancelled subscriber does not cancel another; last cancellation stops work', async () => {
  let finish!: (image: { bytes: ArrayBuffer; width: number; height: number }) => void
  let workSignal!: AbortSignal
  const render = vi.fn((_p, _i, _r, signal: AbortSignal) => {
    workSignal = signal
    return new Promise<any>((resolve) => {
      finish = resolve
    })
  })
  const service = new PreviewCache(render)
  caches.push(service)
  const ca = new AbortController(),
    cb = new AbortController()
  const a = service.acquire('a', false, ca.signal).catch((e) => e.name)
  const b = service.acquire('a', false, cb.signal)
  await vi.waitFor(() => expect(render).toHaveBeenCalledTimes(1))
  ca.abort()
  expect(await a).toBe('AbortError')
  expect(workSignal.aborted).toBe(false)
  finish({ bytes: new ArrayBuffer(4), width: 10, height: 10 })
  const lease = await b
  lease.release()
  const cc = new AbortController()
  const c = service.acquire('c', false, cc.signal).catch((e) => e.name)
  await vi.waitFor(() => expect(render).toHaveBeenCalledTimes(2))
  cc.abort()
  expect(await c).toBe('AbortError')
  expect(workSignal.aborted).toBe(true)
  finish({ bytes: new ArrayBuffer(4), width: 10, height: 10 })
  await Promise.resolve()
  expect(URL.createObjectURL).toHaveBeenCalledTimes(1)
})
it('does not cache a render if the source changes during decoding', async () => {
  const { result } = cache()
  vi.mocked(window.comicType.mediaInfo)
    .mockResolvedValueOnce(info)
    .mockResolvedValue({ ...info, size: 2 })
  await expect(result.acquire('a', false)).rejects.toThrow('更新')
  expect(URL.createObjectURL).not.toHaveBeenCalled()
})
