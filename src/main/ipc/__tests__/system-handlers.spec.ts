import { expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => Promise<unknown>>(),
  openPath: vi.fn()
}))
vi.mock('electron', () => ({
  ipcMain: {
    handle: (name: string, handler: (...args: unknown[]) => Promise<unknown>) =>
      state.handlers.set(name, handler)
  },
  shell: { openPath: state.openPath },
  BrowserWindow: {},
  dialog: {},
  net: {},
  app: {}
}))
vi.mock('../../services/diagnostics', () => ({ collectDiagnostics: vi.fn() }))
vi.mock('../../services/logger', () => ({
  writeLog: vi.fn(),
  getLogPath: vi.fn(),
  readLogTail: vi.fn()
}))
import { registerSystemHandlers } from '../system-handlers'
it('系统打开路径拒绝时仍返回约定的错误结果', async () => {
  registerSystemHandlers()
  state.openPath.mockRejectedValue(new Error('系统打开失败'))
  await expect(state.handlers.get('comicType:openPath')!({}, 'file.psd')).resolves.toEqual({
    ok: false,
    code: 'E_OPEN_FAILED',
    message: '系统打开失败'
  })
})
