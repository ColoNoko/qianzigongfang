import { ref, onMounted, onBeforeUnmount, watch, type ComputedRef, type Ref } from 'vue'
import type { ChildProject, JpgPsdPair, ParentProject } from '@shared/types'
import {
  ChildRootMissingError,
  psdStatsFromPairs,
  useProjectWorkspace
} from '@renderer/stores/projectWorkspace'
import { useAchievementsStore } from '@renderer/stores/achievements'
import { resyncPairSelection } from '@shared/status'
import { useToastStore } from '@renderer/stores/toast'
import { ghostPairsFromMemory } from './ghost-pairs'

export interface UseProjectScanOptions {
  pairs: Ref<JpgPsdPair[]>
  selectedPairs: Ref<JpgPsdPair[]>
  childId: ComputedRef<string>
  currentParent: ComputedRef<ParentProject | null>
}

export function useProjectScan(options: UseProjectScanOptions) {
  const workspace = useProjectWorkspace()
  const achievements = useAchievementsStore()
  const toast = useToastStore()

  const scanning = ref(false)
  const txtSummary = ref('')
  const thumbListKey = ref(0)
  /**
   * 这一话的目录**不在**（被删掉/改名）。
   *
   * 与"读不到"分开：用户经常整理本地文件，删掉某一话的文件夹是预期操作 —— 界面该
   * 安静地说明"本地目录已不在、进度仍按历史记录算"，而不是每次切回窗口都弹一次红字。
   * 真读不到（权限、网络盘掉线）仍走红色 toast。
   */
  const chapterMissing = ref(false)
  let scanSeq = 0
  let disposed = false
  let lastFocusScanAt = 0
  let unsubscribe: (() => void) | undefined
  function syncWatch(): void {
    void window.comicType.watchProject?.(workspace.activeChild?.folderPath ?? null,
      document.visibilityState !== 'hidden').catch(() => undefined)
  }
  onMounted(() => {
    syncWatch()
    unsubscribe = window.comicType.onProjectChanged?.(({ folderPath }) => {
      const normalize = (path: string) => path.replace(/\\/g, '/').toLowerCase().replace(/\/+$/, '')
      if (!disposed && workspace.activeChild && normalize(folderPath) === normalize(workspace.activeChild.folderPath))
        void scanActiveChild(true)
    })
  })
  watch(() => workspace.activeChild?.folderPath, syncWatch)
  onBeforeUnmount(() => {
    disposed = true
    scanSeq++
    unsubscribe?.()
    void window.comicType.watchProject?.(null).catch(() => undefined)
  })
  /** 上一次**装过数据**的那一话，用来区分"换了话"与"同一话重扫"。 */
  let loadedChildId: string | null = null

  function decodeTxtBuffer(buffer: ArrayBuffer): string {
    const encodings = ['utf-8', 'gb18030', 'gbk', 'utf-16le']
    for (const encoding of encodings) {
      try {
        const text = new TextDecoder(encoding).decode(buffer)
        if (text.includes('翻译') || text.includes('校对')) return text
      } catch {
        // Try the next likely encoding.
      }
    }
    return new TextDecoder().decode(buffer)
  }

  function findKeywordLine(content: string, keyword: '翻译' | '校对'): string {
    return (
      content
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find((line) => line.includes(keyword)) ?? ''
    )
  }

  async function buildTxtSummary(txtFiles: string[]): Promise<string> {
    let translationLine = ''
    let proofreadLine = ''

    for (const txtPath of txtFiles) {
      try {
        const buffer = await window.comicType.readFileBuffer(txtPath)
        const content = decodeTxtBuffer(buffer)
        if (!translationLine) translationLine = findKeywordLine(content, '翻译')
        if (!proofreadLine) proofreadLine = findKeywordLine(content, '校对')
        if (translationLine && proofreadLine) break
      } catch {
        // Ignore unreadable txt files; the scanner already records fs errors.
      }
    }

    return [translationLine, proofreadLine].filter(Boolean).join('  ')
  }

  async function refreshTxtSummary(txtFiles: string[], seq: number): Promise<void> {
    txtSummary.value = ''
    const summary = await buildTxtSummary(txtFiles)
    if (seq !== scanSeq || workspace.activeChild?.id !== options.childId.value) return
    txtSummary.value = summary
  }

  /**
   * 目录不在时，用台账里"最后已知"的逐文件记录合成这一话（只读）。
   *
   * 为什么走 IPC 而不是项目树缓存：`memoryGetProject` 读的是 `project_memory_files`
   * （逐文件路径 + 各模式状态），是文件被删/被挪之后**唯一还成立**的事实来源；
   * 侧栏那个 24/24 也是从同一张表来的，所以两边口径天然一致。
   *
   * 台账读不到就退回空列表：这一话仍有一条状态条说明情况，不该在这里再抛一次。
   */
  async function loadGhostPairs(child: ChildProject): Promise<JpgPsdPair[]> {
    try {
      const memory = await window.comicType.memoryGetProject(child.id)
      return ghostPairsFromMemory(memory)
    } catch {
      return []
    }
  }

  async function scanActiveChild(cached = false): Promise<void> {
    const newChild = workspace.activeChild
    if (!newChild) {
      scanSeq++
      options.pairs.value = []
      options.selectedPairs.value = []
      scanning.value = false
      txtSummary.value = ''
      chapterMissing.value = false
      loadedChildId = null
      return
    }
    // ⚠️ 换话的瞬间必须**立刻**清掉上一话的 pairs / 选中项（2026-09-30 审查 high）：
    // 下面那次扫描要几百毫秒到几秒（几十页 PSD 更久），这段窗口里缩略图列表还是上一话的、
    // 工具栏「标记X」因为 selectedPairs 非空而**仍然可点** —— 一点就会以"新话的 id +
    // 旧话的文件路径"写库（useProjectMarking 取的是 activeChild，targetPairs 却是旧的），
    // 同时把旧话的 psdStats 赋给新话落库，toast 还报"已标记成功"。
    // 只在**真的换了话**时清：同一话的重新扫描（窗口 focus / 手动刷新）不能清，
    // 否则用户勾好的选中项会白白丢掉（真机报过，见下面 resyncPairSelection 的注释）。
    if (loadedChildId !== newChild.id) {
      loadedChildId = newChild.id
      options.pairs.value = []
      options.selectedPairs.value = []
      thumbListKey.value += 1
      // 换话时把上一话的"目录不在"一起清掉，否则提示会挂在别的章节上。
      chapterMissing.value = false
    }
    const seq = ++scanSeq
    scanning.value = true
    try {
      const current = () => !disposed && seq === scanSeq && workspace.activeChild?.id === newChild.id
      const scanned = await workspace.scanChild(newChild, current, cached)
      if (seq !== scanSeq || workspace.activeChild?.id !== newChild.id) return
      options.pairs.value = scanned
      // 扫描成功 = 目录回来了（用户把文件夹放回来了），提示随之消失。
      chapterMissing.value = false
      // 只丢掉**真的没了**的选中项，不要一刀切清空。
      // 这个函数挂在 window 的 focus 上（Project.vue 的 refreshActiveChild），
      // 所以"从 Photoshop 切回来""点进一个没激活的窗口"都会跑一次 ——
      // 一刀切会让工具栏的「标记X」在每次回到窗口后无辜变灰（真机报过）。
      options.selectedPairs.value = resyncPairSelection(options.selectedPairs.value, scanned)
      workspace.setActiveChild(
        workspace.findChild(newChild.id) ?? newChild,
        psdStatsFromPairs(scanned)
      )
      void refreshTxtSummary(workspace.txtFiles, seq)
    } catch (error) {
      // scanChild 对"目录读不到"会抛错（见 2026-09-30 审查 high：取数失败不许记成 0 页）。
      // 这里必须接住 —— 调用方有 `void scanActiveChild()` 的写法，漏接就是未处理拒绝，
      // 而用户只会看到"这一话突然空白、没有任何解释"。
      if (seq === scanSeq && workspace.activeChild?.id === newChild.id) {
        // 2026-10-01 再分一层：「目录不在」（用户删/改了本地文件夹，预期状态）走安静
        // 的状态条；只有真读不到（权限不足、网络盘没挂载）才弹红色告警 ——
        // 两种都**不写库**（scanChild 抛错即中止），区别只在提示方式。
        if (error instanceof ChildRootMissingError) {
          chapterMissing.value = true
          // 目录不在：改用台账里的"最后已知的一话"，让这一话仍然看得见（只读）。
          // 缩略图靠持久缓存（thumbnail-cache.ts）还原，所以重启后也还在。
          // 注意仍然**不碰任何统计缓存** —— scanChild 已抛错，这次取数不落库。
          const ghosts = await loadGhostPairs(newChild)
          if (disposed || seq !== scanSeq || workspace.activeChild?.id !== newChild.id) return
          options.pairs.value = ghosts
          options.selectedPairs.value = []
          thumbListKey.value += 1
        } else {
          toast.addToast({
            type: 'error',
            message: `这一话读不到目录：${error instanceof Error ? error.message : String(error)}`
          })
        }
      }
    } finally {
      if (seq === scanSeq) {
        scanning.value = false
      }
    }
  }

  function refreshActiveChild(): void {
    syncWatch()
    if (document.visibilityState === 'hidden') return
    if (Date.now() - lastFocusScanAt < 1500) return
    lastFocusScanAt = Date.now()
    void scanActiveChild()
  }

  let autoRefreshTimer: ReturnType<typeof setInterval> | null = null

  /**
   * 工作台可见时的**轻轮询**（2026-10-05，配合主进程热缓存）。
   *
   * 分工：主进程侧的目录监听（`project-refresh-watch`）在文件一变时就把扫描缓存
   * 刷成最新；这里每隔 `intervalMs` 拉一次。于是"PS 存盘后界面最多 `intervalMs`
   * 自己更新"，不用切窗口、不用等焦点回来。`refreshActiveChild` 内部会跳过隐藏页。
   */
  function startAutoRefresh(intervalMs = 10_000): void {
    if (autoRefreshTimer) return
    autoRefreshTimer = setInterval(() => refreshActiveChild(), intervalMs)
  }

  function stopAutoRefresh(): void {
    if (autoRefreshTimer) {
      clearInterval(autoRefreshTimer)
      autoRefreshTimer = null
    }
  }

  async function refreshCurrentProject(): Promise<void> {
    thumbListKey.value++
    options.selectedPairs.value = []
    await scanActiveChild()
    const parent = options.currentParent.value
    const activeChild = workspace.activeChild
    if (parent && activeChild) {
      await achievements.refresh()
    }
  }

  function cancelScan(): void {
    scanSeq++
  }

  return {
    scanning,
    txtSummary,
    thumbListKey,
    chapterMissing,
    scanActiveChild,
    refreshActiveChild,
    refreshCurrentProject,
    cancelScan,
    startAutoRefresh,
    stopAutoRefresh
  }
}
