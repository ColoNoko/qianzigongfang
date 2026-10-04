// psd-pool.ts — Worker pool for parsing PSD bytes → ImageBitmap
// ---------------------------------------------------------------------------

interface Job {
  id: string
  buffer: ArrayBuffer
  resolve: (bitmap: ImageBitmap) => void
  reject: (err: Error) => void
}

interface WorkerWrapper {
  worker: Worker
  busy: boolean
  currentJobId: string | null
}

export const MAX_WORKERS = 4

let idCounter = 0
function nextId(): string {
  return `psd-job-${++idCounter}-${Date.now()}`
}

export class PsdWorkerPool {
  private workers: WorkerWrapper[] = []
  private queue: Job[] = []
  private jobs = new Map<string, Job>()
  private destroyed = false
  private maxWorkers: number

  constructor(maxWorkers = MAX_WORKERS) {
    this.maxWorkers =
      Number.isFinite(maxWorkers) && maxWorkers > 0
        ? Math.max(1, Math.floor(maxWorkers))
        : MAX_WORKERS
  }

  /**
   * Parse a PSD buffer into an ImageBitmap using a pooled Web Worker.
   */
  parsePsd(buffer: ArrayBuffer): Promise<ImageBitmap> {
    if (this.destroyed) {
      return Promise.reject(new Error('Pool has been destroyed'))
    }

    const id = nextId()
    return new Promise<ImageBitmap>((resolve, reject) => {
      const job: Job = { id, buffer, resolve, reject }
      this.jobs.set(id, job)
      this.queue.push(job)
      this._processQueue()
    })
  }

  /**
   * Terminate all workers and reject any queued or in-flight jobs.
   */
  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true

    const error = new Error('Pool destroyed')
    for (const job of this.queue) this._rejectJob(job.id, error)
    this.queue = []

    for (const wrapper of this.workers) {
      if (wrapper.currentJobId) {
        this._rejectJob(wrapper.currentJobId, error)
      }
      wrapper.busy = false
      wrapper.currentJobId = null
      wrapper.worker.terminate()
    }
    this.workers = []

    // Defensive cleanup for a job that failed between registration and
    // assignment. Every returned promise must settle when the pool dies.
    for (const job of this.jobs.values()) job.reject(error)
    this.jobs.clear()
  }

  // -------------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------------

  private _createWorker(): WorkerWrapper {
    const worker = new Worker(new URL('./psd.worker.ts', import.meta.url), {
      type: 'module'
    })

    const wrapper: WorkerWrapper = { worker, busy: false, currentJobId: null }

    worker.onmessage = (event: MessageEvent) => {
      const msg = event.data
      if (!msg || typeof msg !== 'object' || typeof msg.id !== 'string') return
      if (wrapper.currentJobId !== msg.id) return

      const job = this.jobs.get(msg.id)
      if (!job) return

      wrapper.busy = false
      wrapper.currentJobId = null
      this.jobs.delete(msg.id)

      if (msg.type === 'result') {
        job.resolve(msg.imageBitmap as ImageBitmap)
      } else if (msg.type === 'error') {
        job.reject(new Error(typeof msg.message === 'string' ? msg.message : 'Worker error'))
      } else {
        job.reject(new Error(`Unknown worker response: ${String(msg.type)}`))
      }

      this._processQueue()
    }

    worker.onerror = (err) => {
      if (this.destroyed || !this.workers.includes(wrapper)) return
      const jobId = wrapper.currentJobId
      wrapper.busy = false
      wrapper.currentJobId = null
      this._removeWorker(wrapper)
      if (jobId) this._rejectJob(jobId, new Error(err.message || 'Worker error'))
      this._processQueue()
    }

    return wrapper
  }

  private _assign(wrapper: WorkerWrapper, job: Job): boolean {
    wrapper.busy = true
    wrapper.currentJobId = job.id
    try {
      wrapper.worker.postMessage({ type: 'parse', id: job.id, buffer: job.buffer }, [job.buffer])
      return true
    } catch (err) {
      wrapper.busy = false
      wrapper.currentJobId = null
      this._removeWorker(wrapper)
      this._rejectJob(job.id, err instanceof Error ? err : new Error(String(err)))
      return false
    }
  }

  private _processQueue(): void {
    if (this.destroyed) return

    while (this.queue.length > 0) {
      let worker = this.workers.find((item) => !item.busy)
      if (!worker) {
        if (this.workers.length >= this.maxWorkers) return
        try {
          worker = this._createWorker()
          this.workers.push(worker)
        } catch (err) {
          const error = err instanceof Error ? err : new Error(String(err))
          for (const queuedJob of this.queue) this._rejectJob(queuedJob.id, error)
          this.queue = []
          return
        }
      }

      const job = this.queue.shift()!
      this._assign(worker, job)
    }
  }

  private _rejectJob(jobId: string, error: Error): void {
    const job = this.jobs.get(jobId)
    if (!job) return
    this.jobs.delete(jobId)
    job.reject(error)
  }

  private _removeWorker(wrapper: WorkerWrapper): void {
    const index = this.workers.indexOf(wrapper)
    if (index !== -1) this.workers.splice(index, 1)
    wrapper.worker.terminate()
  }
}
