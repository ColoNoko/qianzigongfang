// @vitest-environment jsdom
/**
 * preload 桥接的护栏接线。
 *
 * 这个文件**没有导出**，只能从 `contextBridge.exposeInMainWorld` 拿它交出去的 api，
 * 所以测试就照这条路走：mock 掉 electron → 动态 import → 取暴露出来的对象。
 *
 * 为什么值得单独测：preload 不在任何单测的覆盖里（真跑要起 Electron），
 * 而"转发到底有没有真的打到 ipcRenderer.invoke"这种事一旦写错（比如护栏的
 * 包装函数自己调自己），只有真的点一下才能发现。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { reactive } from 'vue'

const electron = vi.hoisted(() => ({
  exposeInMainWorld: vi.fn(),
  invoke: vi.fn().mockResolvedValue('ok')
}))

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: electron.exposeInMainWorld },
  ipcRenderer: { invoke: electron.invoke },
  webUtils: { getPathForFile: vi.fn(() => 'C:\\tmp\\a.png') }
}))

const originalArgv = [...process.argv]

/** 以指定 argv 重新加载 preload，并取出它暴露给渲染进程的 api。 */
async function loadBridge(argv: string[]): Promise<Record<string, (...args: never[]) => unknown>> {
  vi.resetModules()
  electron.exposeInMainWorld.mockClear()
  process.argv = [...argv]
  ;(process as unknown as { contextIsolated: boolean }).contextIsolated = true
  await import('../index')
  expect(electron.exposeInMainWorld).toHaveBeenCalledTimes(1)
  return electron.exposeInMainWorld.mock.calls[0][1] as Record<string, (...args: never[]) => unknown>
}

beforeEach(() => {
  electron.invoke.mockClear()
})

afterEach(() => {
  process.argv = [...originalArgv]
})

describe('preload IPC 桥接', () => {
  it('转发真的打到 ipcRenderer.invoke（防止护栏包装写成自递归）', async () => {
    const api = await loadBridge(['electron', '--qianzi-ipc-guard'])

    await expect(Promise.resolve(api.pickDirectory())).resolves.toBe('ok')
    expect(electron.invoke).toHaveBeenCalledWith('comicType:pickDirectory')

    await api.projectSetSourceRoot('parent-1' as never, 'E:\\搬砖\\无' as never)
    expect(electron.invoke).toHaveBeenLastCalledWith(
      'comicType:projectSetSourceRoot',
      'parent-1',
      'E:\\搬砖\\无'
    )
  })

  it('带 flag（dev）时，响应式代理参数当场抛错并点名 channel', async () => {
    const api = await loadBridge(['electron', '--qianzi-ipc-guard'])
    const roots = reactive(['E:\\搬砖\\无', 'E:\\搬砖\\有'])

    expect(() => api.selfCheckImport({ sourceRoots: roots } as never)).toThrow(
      /comicType:selfCheckImport/
    )
    // 抛在转发之前：主进程不该收到半个请求。
    expect(electron.invoke).not.toHaveBeenCalled()
  })

  it('带 flag 时普通参数照常放行', async () => {
    const api = await loadBridge(['electron', '--qianzi-ipc-guard'])

    await api.selfCheckImport({ parentId: 'p1', sourceRoot: 'x', sourceRoots: ['x'], items: [] } as never)
    expect(electron.invoke).toHaveBeenCalledWith('comicType:selfCheckImport', {
      parentId: 'p1',
      sourceRoot: 'x',
      sourceRoots: ['x'],
      items: []
    })
  })

  it('没有 flag（打包环境）时护栏关掉：同一个响应式参数原样转发出去', async () => {
    const api = await loadBridge(['electron'])
    const roots = reactive(['E:\\搬砖\\无'])

    await api.selfCheckImport({ sourceRoots: roots } as never)
    expect(electron.invoke).toHaveBeenCalledTimes(1)
  })
})
