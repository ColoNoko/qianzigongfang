import { computed, ref } from 'vue'
import type {
  SelfCheckCandidate,
  SelfCheckImportRequest,
  SelfCheckPreviewResult,
  SelfCheckRenameHint
} from '@shared/ipc-api'
import { useSettingsStore } from '@renderer/stores/settings'
import { useToastStore } from '@renderer/stores/toast'

export interface UseProjectSelfCheckOptions {
  /** 自检导入成功后刷新项目页数据。 */
  refreshAfterSelfCheck: () => Promise<void>
}

export function useProjectSelfCheck(options: UseProjectSelfCheckOptions) {
  const settings = useSettingsStore()
  const toast = useToastStore()

  const selfCheckVisible = ref(false)
  const selfCheckParentId = ref('')
  const selfCheckSourceRoot = ref('')
  const selfCheckRememberRoot = ref(false)
  const selfCheckPreview = ref<SelfCheckPreviewResult | null>(null)
  const selfCheckBusy = ref(false)
  const selfCheckNeverAsk = ref(false)
  const selfCheckConflictActions = ref<Record<string, 'skip' | 'second-version'>>({})
  const selfCheckRunning = ref(false)
  /**
   * 「疑似改名」提示（2026-10-05，R1）：候选路径 → 疑似就是那一话。
   * 只在用户点「检查是不是改名」时算（要逐个候选扫一遍指纹）；**只是提示**，
   * 认领仍要用户另外确认。
   */
  const selfCheckRenameHints = ref<Record<string, SelfCheckRenameHint>>({})

  const selfCheckCandidates = computed<SelfCheckCandidate[]>(
    () => selfCheckPreview.value?.candidates ?? []
  )
  const selfCheckHasConflict = computed(() =>
    selfCheckCandidates.value.some((candidate) => candidate.conflict === 'same-chapter')
  )
  const selfCheckHasUnresolvedConflict = computed(() =>
    selfCheckCandidates.value.some(
      (candidate) =>
        candidate.conflict === 'same-chapter' &&
        !selfCheckConflictActions.value[candidate.folderPath]
    )
  )

  function closeSelfCheck(): void {
    if (selfCheckBusy.value) return
    selfCheckVisible.value = false
    selfCheckParentId.value = ''
    selfCheckSourceRoot.value = ''
    selfCheckRememberRoot.value = false
    selfCheckPreview.value = null
    selfCheckConflictActions.value = {}
    selfCheckNeverAsk.value = false
    selfCheckRenameHints.value = {}
  }

  function resetSelfCheckChoices(): void {
    selfCheckConflictActions.value = {}
    selfCheckNeverAsk.value = false
  }

  function setSelfCheckConflictAction(folderPath: string, action: 'skip' | 'second-version'): void {
    selfCheckConflictActions.value[folderPath] = action
  }

  async function executeSelfCheck(
    parentId: string,
    preview: SelfCheckPreviewResult,
    rememberRoot: boolean
  ): Promise<void> {
    const items: SelfCheckImportRequest['items'] = preview.candidates.map((candidate) => ({
      folderName: candidate.folderName,
      folderPath: candidate.folderPath,
      chapterNumber: candidate.chapterNumber,
      projectTitle: candidate.projectTitle,
      conflictAction:
        candidate.conflict === 'same-chapter'
          ? selfCheckConflictActions.value[candidate.folderPath]
          : undefined
    }))

    if (
      preview.candidates.some((candidate) => candidate.conflict === 'same-chapter') &&
      preview.candidates.some(
        (candidate) =>
          candidate.conflict === 'same-chapter' &&
          !selfCheckConflictActions.value[candidate.folderPath]
      )
    ) {
      return
    }

    selfCheckBusy.value = true
    try {
      // ⚠️ 不能把 `ref` 里的数组直接塞进 IPC 载荷：Vue 的响应式代理过不了
      // Electron 的结构化克隆，会报 "An object could not be cloned"
      // （交接文档 §13.2 就是这条约定）。这里显式摊平成普通数组。
      const request: SelfCheckImportRequest = {
        parentId,
        sourceRoot: preview.sourceRoot || selfCheckSourceRoot.value,
        // 这一批根全部带上：这一话的子项目分散在多个目录时，"记住"要记住的是
        // 整批（主进程会去重并同步 sourceRoot = sourceRoots[0]）。
        sourceRoots: [...(preview.sourceRoots ?? [])],
        rememberSourceRoot: rememberRoot,
        items
      }
      const result = await window.comicType.selfCheckImport(request)
      if (result.added > 0 || result.skipped > 0 || result.failed > 0) {
        toast.addToast({
          type: result.failed > 0 ? 'warning' : 'success',
          message: `自检完成：新增 ${result.added} 个章节，跳过 ${result.skipped} 个，失败 ${result.failed} 个`
        })
      } else {
        toast.addToast({ type: 'success', message: '自检完成：未导入新章节' })
      }
      await options.refreshAfterSelfCheck()
      selfCheckBusy.value = false
      closeSelfCheck()
    } catch (error) {
      toast.addToast({
        type: 'error',
        message: `自检导入失败：${error instanceof Error ? error.message : String(error)}`
      })
    } finally {
      selfCheckBusy.value = false
    }
  }

  /**
   * 「认领」（2026-10-05，R2）：候选不是新章节，它是本父级已有的某一话（本地文件夹改过名）。
   *
   * 只把那一话的 `folderPath` 换成候选路径 —— **childId / 集数 / 标记历史 / 进度都不动**
   * （标记是按 childId 存的，所以"换门牌"不会丢标记；这也是**不能**用"删旧建新"的原因）。
   */
  async function reclaimCandidate(folderPath: string, childId: string): Promise<void> {
    selfCheckBusy.value = true
    try {
      await window.comicType.projectReclaimChildPath(selfCheckParentId.value, childId, folderPath)
      const preview = selfCheckPreview.value
      if (preview) {
        // 它不再是"新章节"：当场从候选里摘掉（下次预览也会把它算作"已登记"）。
        selfCheckPreview.value = {
          ...preview,
          candidates: preview.candidates.filter((candidate) => candidate.folderPath !== folderPath)
        }
      }
      delete selfCheckConflictActions.value[folderPath]
      delete selfCheckRenameHints.value[folderPath]
      toast.addToast({
        type: 'success',
        message: '已认领：那一话的门牌号换成了这个文件夹（标记与进度都保留）'
      })
      await options.refreshAfterSelfCheck()
    } catch (error) {
      toast.addToast({
        type: 'error',
        message: `认领失败：${error instanceof Error ? error.message : String(error)}`
      })
    } finally {
      selfCheckBusy.value = false
    }
  }

  async function runSelfCheckWithSource(rememberRoot: boolean): Promise<void> {
    const sourceRoot = selfCheckSourceRoot.value.trim()
    if (!sourceRoot) return
    selfCheckRememberRoot.value = rememberRoot
    selfCheckBusy.value = true
    try {
      // ⚠️ **先预览、通过才记住**（2026-10-05）：反过来的话，"选到了某一话自己的文件夹"
      // 这类被守卫拒用的目录会**先被写进库**，于是下次自动检测还要再撞一次同一个坑
      // （用户看到的是"改也改不掉"）。记住的语义是"以后就扫这个目录"，那它必须先是可用的。
      const preview = await window.comicType.selfCheckPreview(selfCheckParentId.value, sourceRoot)
      selfCheckPreview.value = preview

      if (!preview.canDetect) {
        toast.addToast({ type: 'warning', message: preview.message || '无法读取所选目录' })
        return
      }
      if (rememberRoot) {
        await window.comicType.projectSetSourceRoot(selfCheckParentId.value, sourceRoot)
      }
      if (preview.candidates.length === 0) {
        toast.addToast({ type: 'success', message: '自检完成：未发现新增章节' })
        selfCheckBusy.value = false
        closeSelfCheck()
        return
      }
      if (
        settings.silentSelfCheck &&
        !preview.candidates.some((candidate) => candidate.conflict === 'same-chapter')
      ) {
        await executeSelfCheck(selfCheckParentId.value, preview, rememberRoot)
        return
      }
      resetSelfCheckChoices()
    } catch (error) {
      toast.addToast({
        type: 'error',
        message: `自检检测失败：${error instanceof Error ? error.message : String(error)}`
      })
    } finally {
      selfCheckBusy.value = false
    }
  }

  /**
   * 「检查是不是改名」（R1）：把候选的内容指纹与"目录已不在"的旧话比对。
   * 只报事实（指纹完全相同），不猜名字，也**不改任何数据**。
   */
  async function detectSelfCheckRenames(): Promise<void> {
    const preview = selfCheckPreview.value
    if (!preview || preview.candidates.length === 0) return
    selfCheckBusy.value = true
    try {
      const hints = await window.comicType.selfCheckDetectRenames(
        selfCheckParentId.value,
        preview.candidates.map((candidate) => candidate.folderPath)
      )
      selfCheckRenameHints.value = Object.fromEntries(hints.map((hint) => [hint.folderPath, hint]))
      toast.addToast({
        type: 'success',
        message:
          hints.length > 0
            ? `发现 ${hints.length} 条疑似改名（内容与"目录不在"的那一话完全相同）`
            : '没有发现疑似改名（要么内容不同，要么这一话没留下指纹）'
      })
    } catch (error) {
      toast.addToast({
        type: 'error',
        message: `检查改名失败：${error instanceof Error ? error.message : String(error)}`
      })
    } finally {
      selfCheckBusy.value = false
    }
  }

  async function pickSelfCheckDirectory(): Promise<void> {
    const selected = await window.comicType.pickDirectory()
    if (selected) {
      selfCheckSourceRoot.value = selected
      selfCheckPreview.value = null
    }
  }

  async function startSelfCheck(parentId: string): Promise<void> {
    if (selfCheckRunning.value || selfCheckBusy.value) return
    selfCheckRunning.value = true
    selfCheckVisible.value = true
    selfCheckParentId.value = parentId
    selfCheckSourceRoot.value = ''
    selfCheckRememberRoot.value = false
    selfCheckPreview.value = null
    selfCheckConflictActions.value = {}
    selfCheckNeverAsk.value = false
    selfCheckBusy.value = true
    try {
      const preview = await window.comicType.selfCheckPreview(parentId)
      selfCheckPreview.value = preview
      if (!preview.canDetect) return
      if (preview.candidates.length === 0) {
        toast.addToast({ type: 'success', message: '自检完成：未发现新增章节' })
        selfCheckBusy.value = false
        closeSelfCheck()
        return
      }
      if (
        settings.silentSelfCheck &&
        !preview.candidates.some((candidate) => candidate.conflict === 'same-chapter')
      ) {
        await executeSelfCheck(parentId, preview, false)
        return
      }
      resetSelfCheckChoices()
    } catch (error) {
      toast.addToast({
        type: 'error',
        message: `自检检测失败：${error instanceof Error ? error.message : String(error)}`
      })
      selfCheckBusy.value = false
      closeSelfCheck()
    } finally {
      selfCheckBusy.value = false
      selfCheckRunning.value = false
    }
  }

  async function confirmSelfCheckImport(): Promise<void> {
    if (!selfCheckPreview.value || selfCheckHasUnresolvedConflict.value) return
    if (selfCheckNeverAsk.value) {
      settings.setSilentSelfCheck(true)
    }
    await executeSelfCheck(
      selfCheckParentId.value,
      selfCheckPreview.value,
      selfCheckRememberRoot.value
    )
  }

  return {
    selfCheckVisible,
    selfCheckParentId,
    selfCheckSourceRoot,
    selfCheckRememberRoot,
    selfCheckPreview,
    selfCheckBusy,
    selfCheckNeverAsk,
    selfCheckConflictActions,
    selfCheckRunning,
    selfCheckRenameHints,
    selfCheckCandidates,
    selfCheckHasConflict,
    selfCheckHasUnresolvedConflict,
    closeSelfCheck,
    setSelfCheckConflictAction,
    runSelfCheckWithSource,
    pickSelfCheckDirectory,
    startSelfCheck,
    confirmSelfCheckImport,
    reclaimCandidate,
    detectSelfCheckRenames
  }
}
