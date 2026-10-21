import { expect, it } from 'vitest'
import { MediaScheduler } from '../media-scheduler'
it('enforces the shared memory budget, visible priority and queued cancellation', async () => {
  const scheduler = new MediaScheduler(100, 4)
  let release!: () => void
  const order: string[] = []
  const first = scheduler.run(
    80,
    0,
    undefined,
    () =>
      new Promise<void>((resolve) => {
        release = resolve
      })
  )
  const exportJob = scheduler.run(40, 1, undefined, async () => {
    order.push('export')
  })
  const abort = new AbortController()
  const old = scheduler
    .run(30, 2, abort.signal, async () => {
      order.push('old')
    })
    .catch(() => 'cancelled')
  const visible = scheduler.run(40, 0, undefined, async () => {
    order.push('visible')
  })
  abort.abort()
  expect(order).toEqual([])
  await Promise.resolve()
  release()
  await Promise.all([first, exportJob, visible])
  expect(await old).toBe('cancelled')
  expect(order).toEqual(['visible', 'export'])
})

it('returns budget after a synchronous task failure', async () => {
  const scheduler = new MediaScheduler(100, 1)
  await expect(
    scheduler.run(100, 0, undefined, () => {
      throw new Error('decode failed')
    })
  ).rejects.toThrow('decode failed')
  expect(await scheduler.run(100, 0, undefined, async () => 'next')).toBe('next')
})
