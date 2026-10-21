// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { PsdWorkerPool, MAX_WORKERS } from '../psd-pool'

// ---------------------------------------------------------------------------
// Mock Worker
// ---------------------------------------------------------------------------

let pendingResponses: Array<() => void> = []

function flushResponses(): void {
  const copy = pendingResponses
  pendingResponses = []
  for (const fn of copy) fn()
}

class MockWorker {
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  terminated = false

  postMessage(data: any, _transfer?: any[]): void {
    pendingResponses.push(() => {
      if (this.terminated) return
      if (data.type === 'parse') {
        const mockBitmap = { width: 100, height: 100, close: vi.fn() } as unknown as ImageBitmap
        if (this.onmessage) {
          this.onmessage({
            data: { type: 'result', id: data.id, imageBitmap: mockBitmap }
          } as MessageEvent)
        }
      }
    })
  }

  terminate(): void {
    this.terminated = true
  }
}

let WorkerSpy: ReturnType<typeof vi.fn>
let createdWorkers: MockWorker[] = []

beforeEach(() => {
  pendingResponses = []
  createdWorkers = []
  WorkerSpy = vi.fn(function (this: any, _url: string | URL, _options?: WorkerOptions) {
    const worker = new MockWorker()
    createdWorkers.push(worker)
    return worker
  })
  global.Worker = WorkerSpy as unknown as typeof Worker
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PsdWorkerPool', () => {
  it('Test 1: pool with 1 worker, 1 job → resolves with ImageBitmap', async () => {
    const pool = new PsdWorkerPool(1)
    const buffer = new ArrayBuffer(8)

    const promise = pool.parsePsd(buffer)
    flushResponses()

    const result = await promise
    expect(result).toBeDefined()
    expect(WorkerSpy).toHaveBeenCalledTimes(1)

    pool.destroy()
  })

  it('Test 2: pool with 1 worker, 2 jobs → second job queued, then resolved', async () => {
    const pool = new PsdWorkerPool(1)
    const buffer = new ArrayBuffer(8)

    const p1 = pool.parsePsd(buffer)
    const p2 = pool.parsePsd(buffer)

    // Only 1 worker should have been created
    expect(WorkerSpy).toHaveBeenCalledTimes(1)

    // Flush the first response
    flushResponses()
    await p1

    // Now the second job should be assigned and resolved
    flushResponses()
    await p2

    pool.destroy()
  })

  it('Test 3: pool with MAX_WORKERS=4, 6 jobs → exactly 4 workers created, 2 jobs queued', async () => {
    const pool = new PsdWorkerPool(MAX_WORKERS)
    const buffer = new ArrayBuffer(8)

    const promises: Promise<ImageBitmap>[] = []
    for (let i = 0; i < 6; i++) {
      promises.push(pool.parsePsd(buffer))
    }

    // Exactly 4 workers created (max), 2 jobs queued
    expect(WorkerSpy).toHaveBeenCalledTimes(4)

    // Flush initial 4 responses; this frees workers and assigns the 2 queued jobs.
    flushResponses()
    // Flush the 2 follow-up responses from the queued jobs.
    flushResponses()
    await Promise.all(promises)

    pool.destroy()
  })

  it('Test 4: worker error → Promise rejects with error message', async () => {
    // Override Worker mock to simulate an error response
    WorkerSpy = vi.fn(function (this: any, _url: string | URL, _options?: WorkerOptions) {
      const worker = new MockWorker()
      worker.postMessage = (data: any, _transfer?: any[]) => {
        pendingResponses.push(() => {
          if (worker.terminated) return
          if (data.type === 'parse') {
            if (worker.onmessage) {
              worker.onmessage({
                data: { type: 'error', id: data.id, message: 'parse failed' }
              } as MessageEvent)
            }
          }
        })
      }
      return worker
    })
    global.Worker = WorkerSpy as unknown as typeof Worker

    const pool = new PsdWorkerPool(1)
    const buffer = new ArrayBuffer(8)

    const promise = pool.parsePsd(buffer)
    flushResponses()

    await expect(promise).rejects.toThrow('parse failed')

    pool.destroy()
  })

  it('replaces a crashed worker and continues queued jobs', async () => {
    const pool = new PsdWorkerPool(1)
    const first = pool.parsePsd(new ArrayBuffer(8))
    const second = pool.parsePsd(new ArrayBuffer(8))

    expect(createdWorkers).toHaveLength(1)
    createdWorkers[0].onerror?.({ message: 'worker crashed' } as ErrorEvent)

    await expect(first).rejects.toThrow('worker crashed')
    expect(WorkerSpy).toHaveBeenCalledTimes(2)

    flushResponses()
    await expect(second).resolves.toBeDefined()

    pool.destroy()
  })

  it('rejects a synchronous postMessage failure and recovers on the next job', async () => {
    let workerCount = 0
    WorkerSpy = vi.fn(function (this: any, _url: string | URL, _options?: WorkerOptions) {
      workerCount++
      const worker = new MockWorker()
      if (workerCount === 1) {
        worker.postMessage = () => {
          throw new Error('transfer failed')
        }
      }
      return worker
    })
    global.Worker = WorkerSpy as unknown as typeof Worker

    const pool = new PsdWorkerPool(1)
    await expect(pool.parsePsd(new ArrayBuffer(8))).rejects.toThrow('transfer failed')

    const next = pool.parsePsd(new ArrayBuffer(8))
    expect(WorkerSpy).toHaveBeenCalledTimes(2)
    flushResponses()
    await expect(next).resolves.toBeDefined()

    pool.destroy()
  })

  it('rejects an unknown worker response instead of leaving the job pending', async () => {
    WorkerSpy = vi.fn(function (this: any, _url: string | URL, _options?: WorkerOptions) {
      const worker = new MockWorker()
      worker.postMessage = (data: any) => {
        pendingResponses.push(() => {
          worker.onmessage?.({ data: { type: 'unexpected', id: data.id } } as MessageEvent)
        })
      }
      return worker
    })
    global.Worker = WorkerSpy as unknown as typeof Worker

    const pool = new PsdWorkerPool(1)
    const promise = pool.parsePsd(new ArrayBuffer(8))
    flushResponses()

    await expect(promise).rejects.toThrow('Unknown worker response: unexpected')
    pool.destroy()
  })

  it('normalizes a fractional worker limit to at least one worker', async () => {
    const pool = new PsdWorkerPool(0.5)
    const promise = pool.parsePsd(new ArrayBuffer(8))

    expect(WorkerSpy).toHaveBeenCalledTimes(1)
    flushResponses()
    await expect(promise).resolves.toBeDefined()

    pool.destroy()
  })
})

it('cancels active work, releases its worker and allows subsequent jobs', async () => {
  const pool = new PsdWorkerPool(1)
  const controller = new AbortController()
  const cancelled = pool
    .encode(new ArrayBuffer(8), { maxEdge: 480 }, controller.signal)
    .catch((e) => e.name)
  controller.abort()
  expect(await cancelled).toBe('AbortError')
  expect(createdWorkers[0].terminated).toBe(true)
  const next = pool.parsePsd(new ArrayBuffer(8))
  flushResponses()
  expect((await next).width).toBe(100)
  pool.destroy()
})
it('times out a stalled worker without leaving subsequent jobs blocked', async () => {
  vi.useFakeTimers()
  const pool = new PsdWorkerPool(1, 50)
  try {
    const failed = pool.parsePsd(new ArrayBuffer(8)).catch((e) => e.message)
    await vi.advanceTimersByTimeAsync(50)
    expect(await failed).toContain('timed out')
    expect(createdWorkers[0].terminated).toBe(true)
    const next = pool.parsePsd(new ArrayBuffer(8))
    flushResponses()
    expect((await next).width).toBe(100)
  } finally {
    pool.destroy()
    vi.useRealTimers()
  }
})
