import { defineStore } from 'pinia'

/**
 * Toast store — transient notification queue for success/warning/error
 * messages. Each toast auto-removes after its `duration` (default 3 s).
 *
 * The store owns the timer lifecycle: `addToast` schedules a `removeToast`
 * via `setTimeout`, and the timer id is tracked so a manual `removeToast`
 * can cancel a pending auto-dismiss (preventing a double-remove race).
 */

export type ToastType = 'success' | 'warning' | 'error'

export interface ToastItem {
  id: string
  type: ToastType
  message: string
}

/** Module-scoped map of toast id → timer, so timers survive across
 *  component unmounts and are cleaned up on explicit removal. */
const timers = new Map<string, ReturnType<typeof setTimeout>>()

let idCounter = 0
function genId(): string {
  idCounter += 1
  return `toast-${idCounter}`
}

export const useToastStore = defineStore('toast', {
  state: () => ({
    toasts: [] as ToastItem[]
  }),

  actions: {
    /**
     * Push a toast and schedule auto-removal after `duration` ms.
     * If `duration` is 0 the toast persists until manually dismissed.
     */
    addToast(payload: { type: ToastType; message: string; duration?: number }): string {
      const duration = payload.duration ?? 3000
      const id = genId()
      this.toasts.push({ id, type: payload.type, message: payload.message })
      if (duration > 0) {
        const timer = setTimeout(() => {
          timers.delete(id)
          this.removeToast(id)
        }, duration)
        timers.set(id, timer)
      }
      return id
    },

    /**
     * Remove a toast by id and cancel any pending auto-dismiss timer.
     * Safe to call with an id that no longer exists (no-op).
     */
    removeToast(id: string): void {
      const timer = timers.get(id)
      if (timer) {
        clearTimeout(timer)
        timers.delete(id)
      }
      const idx = this.toasts.findIndex((t) => t.id === id)
      if (idx !== -1) {
        this.toasts.splice(idx, 1)
      }
    }
  }
})