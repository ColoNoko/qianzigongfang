import { resolve } from 'node:path'
import type { FontListResult } from '@shared/ipc-api'
import * as windows from './windows'
import { readSnapshot, writeSnapshot, clearSnapshot } from './repository'
import { setStoredValue } from '../services/database'

let current: FontListResult | undefined
let snapshotInvalidated = false
let flight: Promise<FontListResult> | undefined
let mutationTail: Promise<unknown> = Promise.resolve()
let changed: (result: FontListResult) => void = () => {}
export function onCatalogChanged(listener: (result: FontListResult) => void): void {
  changed = listener
}
function scan(): Promise<FontListResult> {
  if (flight) return flight
  flight = windows
    .listSystemFonts()
    .then((result) => {
      current = result
      snapshotInvalidated = false
      try {
        writeSnapshot('system', result)
      } catch {
        /* Cache is optional. */
      }
      changed(result)
      return result
    })
    .finally(() => {
      flight = undefined
    })
  return flight
}
export async function listSystemFonts(options?: { refresh?: boolean }): Promise<FontListResult> {
  await mutationTail.catch(() => {})
  try {
    if (!snapshotInvalidated) current ??= readSnapshot('system')
  } catch {
    /* Rebuild an unavailable cache. */
  }
  if (options?.refresh || !current) return scan()
  if (Date.now() - current.scannedAt > 30_000) {
    void scan().catch(() => {})
    return { ...current, stale: true }
  }
  return current
}
const folders = new Map<string, ReturnType<typeof windows.listFontsInFolder>>()
export function listFontsInFolder(path: string): ReturnType<typeof windows.listFontsInFolder> {
  const key = resolve(path).toLowerCase()
  const pending = folders.get(key)
  if (pending) return pending
  const task = windows.listFontsInFolder(path).finally(() => folders.delete(key))
  folders.set(key, task)
  return task
}
function mutate<T>(kind: string, items: string[], operation: () => Promise<T>): Promise<T> {
  const task = mutationTail.then(async () => {
    // A complete operation is serialized, including files, registry and metadata writes.
    await flight?.catch(() => {})
    const record = { kind, items, startedAt: Date.now() }
    await setStoredValue('fontOperation', { ...record, status: 'running' })
    try {
      const result = await operation()
      await setStoredValue('fontOperation', { ...record, status: 'finished', result })
      return result
    } catch (error) {
      await setStoredValue('fontOperation', {
        ...record,
        status: 'failed',
        error: String(error)
      }).catch(() => {})
      throw error
    } finally {
      current = undefined
      snapshotInvalidated = true
      clearSnapshot()
      // Always refresh after partial failures, so installed faces and the editor agree.
      await scan().catch(() => {})
    }
  })
  mutationTail = task.catch(() => {})
  return task
}
export const installUserFonts: typeof windows.installUserFonts = (paths) =>
  mutate('install', paths, () => windows.installUserFonts(paths))
export const uninstallUserFont: typeof windows.uninstallUserFont = (id) =>
  mutate('uninstall', [id], () => windows.uninstallUserFont(id))
export const uninstallUserFonts: typeof windows.uninstallUserFonts = (ids) =>
  mutate('uninstall', ids, () => windows.uninstallUserFonts(ids))

export function resetFontManagerMemory(): void {
  current = undefined
  snapshotInvalidated = true
  clearSnapshot()
  windows.resetFontManagerMemory()
}
