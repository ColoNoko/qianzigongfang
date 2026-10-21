import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, existsSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const state = vi.hoisted(() => ({
  root: '',
  handlers: new Map<string, (...args: any[]) => Promise<any>>()
}))
vi.mock('electron', () => ({
  app: { getPath: () => state.root },
  ipcMain: {
    handle: (name: string, callback: (...args: any[]) => Promise<any>) =>
      state.handlers.set(name, callback)
  }
}))
vi.mock('../../services/logger', () => ({ writeLog: vi.fn().mockResolvedValue(undefined) }))
import {
  closeDatabase,
  getDatabase,
  getStoredProjectMemory,
  setStoredProjectMemoryStatuses
} from '../../services/database'
import {
  createDatabaseBackup,
  KEEP_BACKUPS,
  listDatabaseBackups,
  withPinnedDatabaseBackup
} from '../../services/db-backup'
import { registerMarksHandlers } from '../marks-handlers'
beforeEach(() => {
  state.root = mkdtempSync(join(tmpdir(), 'restore-retention-'))
  registerMarksHandlers()
})
afterEach(async () => {
  await closeDatabase()
  rmSync(state.root, { recursive: true, force: true })
})
async function mark(done: boolean) {
  await setStoredProjectMemoryStatuses('c', '/book', [
    {
      pathKey: '/book/1.psd',
      path: '/book/1.psd',
      status: done ? 'done' : 'pending',
      mtimeMs: 10,
      modes: { typeset: done },
      modeTimestamps: { typeset: 123 }
    }
  ])
}
it('restores the oldest of 20 backups while retaining both selected source and safety backup', async () => {
  await mark(true)
  const db = await getDatabase()
  db.prepare('INSERT OR REPLACE INTO statistics_time_pages VALUES (?, ?, ?, ?, ?, ?)').run(
    'c',
    '/book/1.psd',
    'typeset',
    'manual',
    456,
    123
  )
  const selected = await createDatabaseBackup('manual')
  utimesSync(selected.path, 1, 1)
  for (let i = 1; i < KEEP_BACKUPS; i++) await createDatabaseBackup('manual')
  await mark(false)
  db.prepare('DELETE FROM statistics_time_pages').run()
  const result = await state.handlers.get('comicType:dbBackupRestoreApply')!({}, selected.path)
  expect(result.revertedFiles).toBe(1)
  expect(db.prepare('SELECT source, at FROM statistics_time_pages').get()).toMatchObject({
    source: 'manual',
    at: 456
  })
  expect((await getStoredProjectMemory('c'))?.files['/book/1.psd'].modes?.typeset).toBe(true)
  expect(existsSync(selected.path)).toBe(true)
  expect(existsSync(`${selected.path}.json`)).toBe(true)
  expect(existsSync(result.safetyBackup.path)).toBe(true)
  expect((await listDatabaseBackups()).length).toBe(KEEP_BACKUPS)
})
it('releases a pin after failure so ordinary future retention still works', async () => {
  await mark(true)
  const selected = await createDatabaseBackup('manual')
  utimesSync(selected.path, 1, 1)
  await expect(
    withPinnedDatabaseBackup(selected.path, async () => {
      throw new Error('restore failed')
    })
  ).rejects.toThrow('restore failed')
  for (let i = 0; i < KEEP_BACKUPS; i++) await createDatabaseBackup('manual')
  expect(existsSync(selected.path)).toBe(false)
})
