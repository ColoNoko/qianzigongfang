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
import { useToastStore } from '@renderer/stores/toast'

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

function setupComicType(): {
  importSpy: ReturnType<typeof vi.fn>
  reclaimSpy: ReturnType<typeof vi.fn>
  detectSpy: ReturnType<typeof vi.fn>
  setRootSpy: ReturnType<typeof vi.fn>
} {
  const importSpy = vi.fn().mockResolvedValue({ added: 1, skipped: 0, failed: 0 })
  const reclaimSpy = vi.fn().mockResolvedValue(undefined)
  const detectSpy = vi.fn().mockResolvedValue([])
  const setRootSpy = vi.fn().mockResolvedValue(undefined)
  window.comicType = {
    selfCheckPreview: vi
      .fn()
      .mockResolvedValue(makePreview(['E:\\示例素材\\搬砖\\有', 'E:\\示例素材\\搬砖\\无'])),
    selfCheckImport: importSpy,
    projectSetSourceRoot: setRootSpy,
    projectReclaimChildPath: reclaimSpy,
    selfCheckDetectRenames: detectSpy,
    pickDirectory: vi.fn().mockResolvedValue(null)
  } as unknown as typeof window.comicType
  return { importSpy, reclaimSpy, detectSpy, setRootSpy }
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

/**
 * 认领（2026-10-05，R2）：候选其实是某一话改了名 —— 只把那话的 folderPath 换成新路径。
 * 这条通道存在的原因：**不能用"删旧建新"**（删除会连带清掉那一话的标记记录）。
 */
describe('useProjectSelfCheck — 认领', () => {
  const CANDIDATE_PATH = 'E:\\示例素材\\搬砖\\有\\完'

  it('调 IPC → 把这条候选从列表里摘掉 → 刷新界面', async () => {
    const { reclaimSpy } = setupComicType()
    const refresh = vi.fn().mockResolvedValue(undefined)
    const selfCheck = useProjectSelfCheck({ refreshAfterSelfCheck: refresh })

    await selfCheck.startSelfCheck('parent-1')
    expect(selfCheck.selfCheckPreview.value?.candidates).toHaveLength(1)

    await selfCheck.reclaimCandidate(CANDIDATE_PATH, 'c-old')

    expect(reclaimSpy).toHaveBeenCalledWith('parent-1', 'c-old', CANDIDATE_PATH)
    expect(selfCheck.selfCheckPreview.value?.candidates).toHaveLength(0)
    expect(refresh).toHaveBeenCalled()
  })

  it('认领失败 ⇒ 把原因说出来、候选留在原地（不许静默吞掉）', async () => {
    const { reclaimSpy } = setupComicType()
    reclaimSpy.mockRejectedValue(new Error('这个文件夹已经登记在别的话上了'))
    const toast = useToastStore()
    const selfCheck = useProjectSelfCheck({ refreshAfterSelfCheck: async () => undefined })

    await selfCheck.startSelfCheck('parent-1')
    await selfCheck.reclaimCandidate(CANDIDATE_PATH, 'c-old')

    expect(toast.toasts.at(-1)?.type).toBe('error')
    expect(toast.toasts.at(-1)?.message).toContain('已经登记在别的话上')
    expect(selfCheck.selfCheckPreview.value?.candidates).toHaveLength(1)
  })
})

/**
 * 「检查是不是改名」（2026-10-05，R1）：候选的内容指纹与"目录不在"的旧话完全相同 ⇒ 提示。
 * 只是提示 —— 认领仍要用户另外确认。
 */
describe('useProjectSelfCheck — 检查改名', () => {
  const CANDIDATE_PATH = 'E:\\示例素材\\搬砖\\有\\完'

  it('把候选路径发给主进程，并把结果存成提示', async () => {
    const { detectSpy } = setupComicType()
    detectSpy.mockResolvedValue([
      {
        folderPath: CANDIDATE_PATH,
        childId: 'c-old',
        chapterTitle: '旧名字 19',
        chapterNumber: '19'
      }
    ])
    const selfCheck = useProjectSelfCheck({ refreshAfterSelfCheck: async () => undefined })

    await selfCheck.startSelfCheck('parent-1')
    await selfCheck.detectSelfCheckRenames()

    expect(detectSpy).toHaveBeenCalledWith('parent-1', [CANDIDATE_PATH])
    expect(selfCheck.selfCheckRenameHints.value[CANDIDATE_PATH]?.childId).toBe('c-old')
  })

  it('一条都没有 ⇒ 提示为空（不假装检测到了什么）', async () => {
    const { detectSpy } = setupComicType()
    detectSpy.mockResolvedValue([])
    const selfCheck = useProjectSelfCheck({ refreshAfterSelfCheck: async () => undefined })

    await selfCheck.startSelfCheck('parent-1')
    await selfCheck.detectSelfCheckRenames()

    expect(selfCheck.selfCheckRenameHints.value).toEqual({})
  })
})

/**
 * 「记住此目录」的前置（2026-10-05）：**先预览、通过才记住**。
 *
 * 现场同族：目录可能是"某一话自己的文件夹"（被守卫拒用）—— 若先写库，
 * 库里就留下一个坏根，下次自动检测再撞一次同一个坑，用户看起来像"改也改不掉"。
 */
describe('useProjectSelfCheck — 不可用的目录不许记住', () => {
  it('预览说不可用 ⇒ 不写库，且把原因说出来', async () => {
    const { setRootSpy } = setupComicType()
    const previewSpy = window.comicType.selfCheckPreview as unknown as ReturnType<typeof vi.fn>
    previewSpy.mockResolvedValue({
      canDetect: false,
      sourceRoot: null,
      sourceRoots: [],
      message: '这个扫描目录是某一话自己的文件夹（不是"各话所在的那一层"）…',
      candidates: [],
      duplicatePaths: 0
    })
    const toast = useToastStore()
    const selfCheck = useProjectSelfCheck({ refreshAfterSelfCheck: async () => undefined })

    await selfCheck.startSelfCheck('parent-1')
    selfCheck.selfCheckSourceRoot.value = 'D:\\漫画库\\某一话'
    await selfCheck.runSelfCheckWithSource(true)

    expect(setRootSpy, '不可用的目录被写进库了 —— 下次自动检测还会再撞一次').not.toHaveBeenCalled()
    expect(toast.toasts.at(-1)?.type).toBe('warning')
    expect(toast.toasts.at(-1)?.message).toContain('某一话自己的文件夹')
  })

  it('预览通过的目录才写库', async () => {
    const { setRootSpy } = setupComicType()
    const selfCheck = useProjectSelfCheck({ refreshAfterSelfCheck: async () => undefined })

    await selfCheck.startSelfCheck('parent-1')
    selfCheck.selfCheckSourceRoot.value = 'E:\\示例素材\\搬砖\\有'
    await selfCheck.runSelfCheckWithSource(true)

    expect(setRootSpy).toHaveBeenCalledWith('parent-1', 'E:\\示例素材\\搬砖\\有')
  })
})
