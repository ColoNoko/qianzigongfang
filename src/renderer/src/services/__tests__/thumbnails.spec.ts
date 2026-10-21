import type { JpgPsdPair } from '@shared/types'
import { expect, it, vi } from 'vitest'
import { ThumbnailService } from '../thumbnails'
const pair = (id: string, mtimeMs = 1) =>
  ({ psd: { absPath: id, mtimeMs, ctimeMs: 1, status: 'pending' } }) as JpgPsdPair
it('retries a failed thumbnail on the next visibility entry without looping while visible', async () => {
  const load=vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue('recovered')
  const service=new ThumbnailService(load),owner={}
  service.setVisible(owner,[pair('retry')])
  await vi.waitFor(()=>expect(service.state(pair('retry')).status).toBe('error'))
  service.setVisible(owner,[pair('retry')])
  expect(load).toHaveBeenCalledTimes(1)
  service.setVisible(owner,[])
  service.setVisible(owner,[pair('retry')])
  await vi.waitFor(()=>expect(service.state(pair('retry')).url).toBe('recovered'))
  expect(load).toHaveBeenCalledTimes(2)
})
it('deduplicates in-flight and completed requests across views; changed revisions reload', async () => {
  const load = vi.fn().mockResolvedValue('url')
  const service = new ThumbnailService(load)
  service.request(pair('a'))
  service.request(pair('a'))
  await vi.waitFor(() => expect(service.state(pair('a')).status).toBe('ready'))
  service.release({})
  service.request(pair('a'))
  expect(load).toHaveBeenCalledTimes(1)
  service.request(pair('a', 2))
  await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(2))
})
it('prioritizes newly visible files ahead of queued offscreen work', async () => {
  let finish!: (url: string) => void
  const order: string[] = []
  const service = new ThumbnailService((p) => {
    order.push(p.psd.absPath)
    return new Promise((resolve) => {
      finish = resolve
    })
  }, 1)
  service.request(pair('active'))
  service.request(pair('old'))
  service.request(pair('visible'))
  service.setVisible({}, [pair('visible')])
  await Promise.resolve()
  finish('url')
  await vi.waitFor(() => expect(order).toEqual(['active', 'visible']))
  finish('url')
  await vi.waitFor(() => expect(order).toEqual(['active', 'visible', 'old']))
  finish('url')
})
it('surfaces failure and retries only on explicit request', async () => {
  const load = vi.fn().mockRejectedValueOnce(new Error('bad PSD')).mockResolvedValue('url')
  const service = new ThumbnailService(load)
  service.request(pair('a'))
  await vi.waitFor(() => expect(service.state(pair('a')).error).toBe('bad PSD'))
  service.request(pair('a'))
  expect(load).toHaveBeenCalledTimes(1)
  service.request(pair('a'), true)
  await vi.waitFor(() => expect(service.state(pair('a')).url).toBe('url'))
})
it('pins visible thumbnails while evicting offscreen entries', async () => {
  const service = new ThumbnailService(async () => 'url', 1, 2)
  service.setVisible({}, [pair('a')])
  for (const id of ['a', 'b', 'c']) service.request(pair(id))
  await vi.waitFor(() => expect(service.state(pair('c')).status).toBe('ready'))
  expect(service.state(pair('a')).status).toBe('ready')
  expect(service.state(pair('b')).status).toBe('idle')
})
it('retires old chapter work, releases byte-budgeted URLs and ignores late results', async () => {
  const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  const owner = {}
  const completions = new Map<
    string,
    (value: { url: string; bytes: number; source: 'psd' }) => void
  >()
  const signals = new Map<string, AbortSignal | undefined>()
  const service = new ThumbnailService(
    (p, signal) => {
      signals.set(p.psd.absPath, signal)
      return new Promise((resolve) => completions.set(p.psd.absPath, resolve))
    },
    1,
    96,
    8
  )
  try {
    service.setVisible(owner, [pair('old')], [pair('never-started')])
    await Promise.resolve()
    service.setVisible(owner, [pair('new')])
    expect(signals.get('old')?.aborted).toBe(true)
    await vi.waitFor(() => expect(completions.has('new')).toBe(true))
    expect(completions.has('never-started')).toBe(false)
    completions.get('old')!({ url: 'blob:old', bytes: 8, source: 'psd' })
    completions.get('new')!({ url: 'blob:new', bytes: 12, source: 'psd' })
    await vi.waitFor(() => expect(service.state(pair('new')).status).toBe('ready'))
    expect(service.state(pair('old')).status).toBe('idle')
    expect(revoke).toHaveBeenCalledWith('blob:old')
    service.release(owner)
    expect(service.state(pair('new')).status).toBe('idle')
    expect(revoke).toHaveBeenCalledWith('blob:new')
  } finally {
    service.destroy()
    revoke.mockRestore()
  }
})
