// @vitest-environment jsdom
/**
 * 切话的那一瞬间，界面上的 `pairs` / `selectedPairs` 必须立刻清掉
 * （2026-09-30 审查 high）。
 *
 * 现场逻辑：`Project.vue` 的 watcher 先 `syncActiveChild()`（把 `activeChild`
 * 换成新话），再 `void scanActiveChild()`；而 `pairs` 要等扫描回来（几百毫秒到几秒，
 * 几十页 PSD 更久）才替换。这段窗口里：
 *   · 缩略图列表照旧渲染**上一话**的卡片；
 *   · 工具栏「标记X」因为 `selectedPairs` 非空而**仍然可点**；
 *   一点就出事 —— `useProjectMarking.markPairs()` 取的是**新话** `activeChild`，
 *   而 `targetPairs` 还是上一话的 → 上一话的文件路径被写进新话的标记库，
 *   同时旧话的 psdStats 被赋给新话落库，toast 还报"已标记成功"。
 *
 * 这里锁：换了话就立刻清空（并 bump 缩略图 key）；但**同一话的重新扫描
 * （窗口 focus / 手动刷新）不能清** —— 那会把用户勾好的选中项白白丢掉
 * （这条以前真机报过，见 useProjectScan 里 resyncPairSelection 的注释）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, ref } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { useProjectScan } from '../useProjectScan'
import { useProjectWorkspace } from '@renderer/stores/projectWorkspace'
import { useToastStore } from '@renderer/stores/toast'
import type { ChildProject, JpgPsdPair, ParentProject } from '@shared/types'
import type { ProjectMemory } from '@shared/ipc-api'

const FOLDER_A = 'D:\\comic\\ch1'
const FOLDER_B = 'D:\\comic\\ch2'

function child(id: string, folderPath: string, title: string): ChildProject {
  return {
    id,
    parentTitle: '父级',
    folderPath,
    chapterNumber: id,
    projectTitle: title,
    lastMtimeMs: 0
  }
}

function pair(folderPath: string, index: number): JpgPsdPair {
  return {
    jpgPath: `${folderPath}\\0${index}.jpg`,
    psd: { absPath: `${folderPath}\\0${index}.psd`, mtimeMs: 1, ctimeMs: 1, status: 'pending' }
  }
}

let scanDeferred: { resolve: (value: unknown) => void; promise: Promise<unknown> } | null = null

function deferredScan(): Promise<unknown> {
  let resolve!: (value: unknown) => void
  const promise = new Promise((r) => {
    resolve = r
  })
  scanDeferred = { resolve, promise }
  return promise
}

beforeEach(() => {
  setActivePinia(createPinia())
  scanDeferred = null
  window.comicType = {
    scanChildProject: vi.fn(() => deferredScan()),
    listDir: vi.fn().mockResolvedValue([]),
    stat: vi.fn(),
    readFileDataURL: vi.fn(),
    pickDirectory: vi.fn(),
    pickToolFile: vi.fn(),
    readFileBuffer: vi.fn(),
    openPath: vi.fn(),
    storeGet: vi.fn().mockResolvedValue(undefined),
    storeSet: vi.fn().mockResolvedValue(undefined),
    memoryGetProject: vi.fn().mockResolvedValue(null),
    projectGetTree: vi.fn(),
    projectSaveTree: vi.fn().mockResolvedValue(undefined),
    projectSaveProgress: vi.fn().mockResolvedValue(undefined)
  } as unknown as typeof window.comicType
})

function mountScan(childId: string) {
  const workspace = useProjectWorkspace()
  const parent: ParentProject = { id: 'p1', title: '父级', lastMtimeMs: 0, children: [] }
  const pairs = ref<JpgPsdPair[]>([])
  const selectedPairs = ref<JpgPsdPair[]>([])
  const scan = useProjectScan({
    pairs,
    selectedPairs,
    childId: computed(() => childId),
    currentParent: computed(() => parent)
  })
  return { workspace, scan, pairs, selectedPairs }
}

describe('切话瞬间清掉上一话的 pairs 与选中项', () => {
  it('换到另一话：扫描还没回来时 pairs/选中项已经是空的', async () => {
    const { workspace, scan, pairs, selectedPairs } = mountScan('c2')
    const previous = [pair(FOLDER_A, 1), pair(FOLDER_A, 2)]
    pairs.value = [...previous]
    selectedPairs.value = [...previous]

    workspace.parents = [
      { id: 'p1', title: '父级', lastMtimeMs: 0, children: [child('c2', FOLDER_B, '第2集')] }
    ]
    workspace.setActiveChild(workspace.findChild('c2')!, [])

    const pending = scan.scanActiveChild()

    // ★ 扫描还在飞：这时上一话的东西必须已经不在界面上了
    expect(pairs.value).toEqual([])
    expect(selectedPairs.value).toEqual([])

    const next = [pair(FOLDER_B, 1)]
    scanDeferred?.resolve({ jpgPairs: next, txtFiles: [], errors: [] })
    await pending

    expect(pairs.value.map((item) => item.psd.absPath)).toEqual([`${FOLDER_B}\\01.psd`])
  })

  it('同一话重新扫描（窗口 focus）：不许清掉用户勾好的选中项', async () => {
    const { workspace, scan, pairs, selectedPairs } = mountScan('c2')
    const current = [pair(FOLDER_B, 1), pair(FOLDER_B, 2)]
    workspace.parents = [
      { id: 'p1', title: '父级', lastMtimeMs: 0, children: [child('c2', FOLDER_B, '第2集')] }
    ]
    workspace.setActiveChild(workspace.findChild('c2')!, [])

    // 第一次扫描：把当前话的数据装进去，并勾上其中一张
    const first = scan.scanActiveChild()
    scanDeferred?.resolve({ jpgPairs: current, txtFiles: [], errors: [] })
    await first
    selectedPairs.value = [pairs.value[0]]

    // 第二次：同一话（例如从 Photoshop 切回来触发的 focus 刷新）
    const second = scan.scanActiveChild()
    scanDeferred?.resolve({ jpgPairs: current, txtFiles: [], errors: [] })
    await second

    expect(pairs.value).toHaveLength(2)
    expect(selectedPairs.value.map((item) => item.psd.absPath)).toEqual([`${FOLDER_B}\\01.psd`])
  })
})

/**
 * 「目录不在」不再是红色告警（2026-10-01）。
 *
 * 用户的工作流就是反复删改本地图片。把某一话整个文件夹删掉/改名后，旧行为是
 * **每次切回窗口都弹一次** `这一话读不到目录：ENOENT...` —— 纯骚扰。
 *
 * 现在分两层：
 *   · 目录不在（rootMissing）→ 安静的状态条 `chapterMissing`，不弹 toast；
 *   · 真读不到（权限不足、网络盘没挂载）→ 照旧弹红色 toast。
 * 两者都**不写库**（见 projectWorkspace-scan-failure.spec），所以侧栏/首页的
 * 历史进度都不会缩水。
 */
describe('目录不在：安静状态条，不弹红字', () => {
  function activate(childId: string, folderPath: string) {
    const mounted = mountScan(childId)
    mounted.workspace.parents = [
      { id: 'p1', title: '父级', lastMtimeMs: 0, children: [child(childId, folderPath, '第2集')] }
    ]
    mounted.workspace.setActiveChild(mounted.workspace.findChild(childId)!, [])
    return mounted
  }

  it('rootMissing=true：chapterMissing 打开，且没有任何 toast', async () => {
    const { scan } = activate('c2', FOLDER_B)

    const pending = scan.scanActiveChild()
    scanDeferred?.resolve({
      jpgPairs: [],
      txtFiles: [],
      errors: [{ path: FOLDER_B, msg: 'ENOENT: no such file or directory, realpath' }],
      rootMissing: true
    })
    await pending

    expect(scan.chapterMissing.value).toBe(true)
    expect(useToastStore().toasts).toHaveLength(0)
  })

  it('rootMissing=true：列表改用台账里的最后已知记录（只读），仍不弹 toast', async () => {
    const memory: ProjectMemory = {
      childId: 'c2',
      folderPath: FOLDER_B,
      updatedAt: 1,
      files: {
        'k-1': {
          path: `${FOLDER_B}\\001.psd`,
          status: 'done',
          mtimeMs: 111,
          updatedAt: 1,
          modes: { typeset: true, translated: false, proofread: false, supervised: false }
        }
      }
    }
    ;(window.comicType.memoryGetProject as ReturnType<typeof vi.fn>).mockResolvedValue(memory)

    const { scan, pairs, selectedPairs } = activate('c2', FOLDER_B)
    // 假装界面上还留着上一轮的选中项：目录不在时它必须被清掉，
    // 否则工具栏的「标记X」会因为 selectedPairs 非空而重新可点。
    selectedPairs.value = [pair(FOLDER_B, 9)]

    const pending = scan.scanActiveChild()
    scanDeferred?.resolve({
      jpgPairs: [],
      txtFiles: [],
      errors: [{ path: FOLDER_B, msg: 'ENOENT: no such file or directory, realpath' }],
      rootMissing: true
    })
    await pending

    expect(scan.chapterMissing.value).toBe(true)
    expect(pairs.value.map((item) => item.psd.absPath)).toEqual([`${FOLDER_B}\\001.psd`])
    expect(pairs.value[0].psd.status).toBe('done')
    expect(selectedPairs.value).toEqual([])
    expect(useToastStore().toasts).toHaveLength(0)
  })

  it('真读不到（没有 rootMissing）：仍然弹一条 error toast', async () => {
    const { scan } = activate('c2', FOLDER_B)

    const pending = scan.scanActiveChild()
    scanDeferred?.resolve({
      jpgPairs: [],
      txtFiles: [],
      errors: [{ path: FOLDER_B, msg: 'EACCES: permission denied' }]
    })
    await pending

    expect(scan.chapterMissing.value).toBe(false)
    const toasts = useToastStore().toasts
    expect(toasts).toHaveLength(1)
    expect(toasts[0].type).toBe('error')
  })

  it('目录放回来（扫描成功）：chapterMissing 自动复位', async () => {
    const { scan } = activate('c2', FOLDER_B)

    const missing = scan.scanActiveChild()
    scanDeferred?.resolve({
      jpgPairs: [],
      txtFiles: [],
      errors: [{ path: FOLDER_B, msg: 'ENOENT: no such file or directory' }],
      rootMissing: true
    })
    await missing
    expect(scan.chapterMissing.value).toBe(true)

    const back = scan.scanActiveChild()
    scanDeferred?.resolve({ jpgPairs: [pair(FOLDER_B, 1)], txtFiles: [], errors: [] })
    await back

    expect(scan.chapterMissing.value).toBe(false)
  })
})

/**
 * 工作台可见时的轻轮询（2026-10-05，配合主进程热缓存）。
 * 主进程侧目录监听负责"文件一变就刷新缓存"，这里负责"到点去取"——
 * 合起来：PS 存盘后界面最多 intervalMs 自己更新，不用切窗口等焦点。
 */
describe('工作台轻轮询', () => {
  it('可见时到点自己扫；隐藏时不扫；stop 之后不再扫', async () => {
    vi.useFakeTimers()
    try {
      const { workspace, scan } = mountScan('c2')
      workspace.parents = [
        { id: 'p1', title: '父级', lastMtimeMs: 0, children: [child('c2', FOLDER_B, '第2集')] }
      ]
      workspace.setActiveChild(workspace.findChild('c2')!, [])

      scan.startAutoRefresh(1000)

      vi.advanceTimersByTime(1000)
      expect(window.comicType.scanChildProject).toHaveBeenCalledTimes(1)
      // 结束这次飞行，别留悬挂
      scanDeferred?.resolve({ jpgPairs: [], txtFiles: [], errors: [] })
      await vi.advanceTimersByTimeAsync(0)

      // 页面藏起来：到点不许再扫
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
      vi.advanceTimersByTime(5000)
      expect(window.comicType.scanChildProject).toHaveBeenCalledTimes(1)
      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })

      scan.stopAutoRefresh()
      vi.advanceTimersByTime(5000)
      expect(window.comicType.scanChildProject).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })
})
