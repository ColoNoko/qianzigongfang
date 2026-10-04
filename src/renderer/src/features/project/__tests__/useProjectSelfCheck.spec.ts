// @vitest-environment jsdom
/**
 * 自检导入的 IPC 载荷必须能被**结构化克隆**。
 *
 * Electron 的 `ipcRenderer.invoke` 用结构化克隆序列化参数，遇到 Vue 响应式代理
 * 会直接抛 `An object could not be cloned`（交接文档 §13.2 就是这条约定）。
 * 2026-09-23 真实事故：`sourceRoots: preview.sourceRoots` 把 `ref` 里的**代理数组**
 * 直接塞进载荷，扫描根修好了、点「导入」却报上面那个错。
 *
 * 这里的断言用平台自己的 `structuredClone` —— 和 Electron 做的是同一件事，
 * 所以它能在单测里红、也能在单测里绿。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { SelfCheckPreviewResult } from '@shared/ipc-api'
import { useProjectSelfCheck } from '../useProjectSelfCheck'

function makePreview(roots: string[]): SelfCheckPreviewResult {
  return {
    canDetect: true,
    sourceRoot: roots[0] ?? null,
    sourceRoots: roots,
    candidates: [
      {
        folderName: '完',
        folderPath: 'E:\\示例素材\\搬砖\\有\\完',
        chapterNumber: '',
        projectTitle: '完',
        conflict: 'none'
      }
    ],
    duplicatePaths: 0
  }
}

function setupComicType(): { importSpy: ReturnType<typeof vi.fn> } {
  const importSpy = vi.fn().mockResolvedValue({ added: 1, skipped: 0, failed: 0 })
  window.comicType = {
    selfCheckPreview: vi
      .fn()
      .mockResolvedValue(makePreview(['E:\\示例素材\\搬砖\\有', 'E:\\示例素材\\搬砖\\无'])),
    selfCheckImport: importSpy,
    projectSetSourceRoot: vi.fn().mockResolvedValue(undefined),
    pickDirectory: vi.fn().mockResolvedValue(null)
  } as unknown as typeof window.comicType
  return { importSpy }
}

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('useProjectSelfCheck — 发往主进程的导入请求', () => {
  it('载荷可被结构化克隆（响应式代理会炸成 "An object could not be cloned"）', async () => {
    const { importSpy } = setupComicType()
    const selfCheck = useProjectSelfCheck({ refreshAfterSelfCheck: async () => undefined })

    await selfCheck.startSelfCheck('parent-1')
    await selfCheck.confirmSelfCheckImport()

    expect(importSpy).toHaveBeenCalledTimes(1)
    const request = importSpy.mock.calls[0][0] as Record<string, unknown>

    // 逐字段断言：失败时直接指出是哪个字段不可克隆，不用再去二分。
    for (const [key, value] of Object.entries(request)) {
      expect(() => structuredClone(value), `字段 \`${key}\` 不可结构化克隆`).not.toThrow()
    }
    expect(() => structuredClone(request)).not.toThrow()
  })

  it('多个扫描根照常传给主进程（修克隆不能顺手把这个字段删掉）', async () => {
    const { importSpy } = setupComicType()
    const selfCheck = useProjectSelfCheck({ refreshAfterSelfCheck: async () => undefined })

    await selfCheck.startSelfCheck('parent-1')
    await selfCheck.confirmSelfCheckImport()

    const request = importSpy.mock.calls[0][0] as Record<string, unknown>
    expect(request.sourceRoots).toEqual(['E:\\示例素材\\搬砖\\有', 'E:\\示例素材\\搬砖\\无'])
    expect(request.sourceRoot).toBe('E:\\示例素材\\搬砖\\有')
    expect(Array.isArray(request.sourceRoots)).toBe(true)
    // 快照式断言：必须是普通数组，不能还是响应式代理
    expect(String(request.sourceRoots)).toBe('E:\\示例素材\\搬砖\\有,E:\\示例素材\\搬砖\\无')
  })
})
