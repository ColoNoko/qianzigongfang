import { beforeEach, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => Promise<unknown>>(),
  undo: vi.fn(),
  backup: vi.fn(),
  restore: vi.fn(),
  log: vi.fn()
}))
vi.mock('electron', () => ({
  ipcMain: {
    handle: (name: string, handler: (...args: unknown[]) => Promise<unknown>) =>
      state.handlers.set(name, handler)
  }
}))
vi.mock('../../services/db/statistics-time-store', () => ({
  getStatisticsTime: vi.fn(),
  setStatisticsTime: vi.fn(),
  statisticsTimeOperations: vi.fn().mockResolvedValue([]),
  undoStatisticsTime: vi.fn(),
  restoreStatisticsTimes: vi.fn().mockResolvedValue(0)
}))
vi.mock('../../services/logger', () => ({ writeLog: state.log }))
vi.mock('../../services/project-memory', () => ({
  getProjectMemory: vi.fn(),
  removeProjectMemory: vi.fn(),
  setProjectMemoryStatuses: vi.fn()
}))
vi.mock('../../services/database', () => ({
  undoMarkOperation: state.undo,
  applyMarkRestore: state.restore,
  currentMarkSnapshot: vi.fn().mockResolvedValue({ children: {} }),
  readMarkSnapshotFromFile: vi.fn().mockReturnValue({ children: {} }),
  findUndoableMarkOperation: vi.fn(),
  listMarkAuditOperations: vi.fn()
}))
vi.mock('../../services/db-backup', () => ({
  createDatabaseBackup: state.backup,
  withPinnedDatabaseBackup: (_file: string, action: () => Promise<unknown>) => action(),
  listDatabaseBackups: vi.fn(),
  previewMarkRestore: vi.fn().mockResolvedValue({ changingFiles: 1 })
}))
import { registerMarksHandlers } from '../marks-handlers'
beforeEach(() => {
  state.log.mockRejectedValue(new Error('日志目录只读'))
  state.undo.mockResolvedValue({ revertedFiles: 1, childIds: ['c'] })
  state.restore.mockResolvedValue({ revertedFiles: 1 })
  state.backup.mockResolvedValue({ file: 'backup.sqlite', bytes: 100, reason: 'manual' })
  registerMarksHandlers()
})
it.each(['memoryUndoMark', 'dbBackupCreate', 'dbBackupRestoreApply'])(
  '%s 成功后日志失败不能改变操作结果',
  async (method) => {
    const result = await state.handlers.get(`comicType:${method}`)!({}, 'input')
    expect(result).toBeTruthy()
    expect(state.log).toHaveBeenCalled()
  }
)
