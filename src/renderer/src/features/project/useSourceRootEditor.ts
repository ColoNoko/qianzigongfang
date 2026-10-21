import { computed, ref, type ComputedRef, type Ref } from 'vue'
import type { DirEntry } from '@shared/ipc-api'
import type { ParentProject } from '@shared/types'
import { findOtherParentInside, readRememberedRoots } from '@shared/source-roots'
import { useToastStore } from '@renderer/stores/toast'

/**
 * 「修改扫描目录」（2026-10-05，需求二）—— 逻辑与状态机。
 *
 * 分工照 `useProjectSelfCheck` 那一套：**这个文件认识 IPC 与规则，弹窗只画 + emit**。
 * 于是所有判定都能脱离 DOM 单测（`useSourceRootEditor.spec.ts`）。
 *
 * 三条设计取舍，都有理由：
 *
 * ① **默认状态是"手动但还没选目录"**，不是"恢复自动推导"。
 *    后者会让"打开弹窗 → 随手点保存"把用户记住过的目录**清掉**（真数据丢失）。
 *    现在的口径：没选目录 ⇒ 保存按钮是灰的，什么都写不了。
 *
 * ② **勾了层就用那些层；一层都没勾就用所选目录本身。**
 *    两种真实布局都覆盖：`搬砖\{无,有}\<话>`（勾 `无`/`有`）与
 *    `作品\<话>`（一层都不勾，直接用作品目录）。
 *
 * ③ **冲突默认拦住、但给显式出口。**
 *    判据与主进程 B1 是**同一处实现**（`findOtherParentInside`）：
 *    "我选的这个目录里住着**别的作品**的话" ⇒ 红字点名那一部 + 默认不许存；
 *    用户看懂后勾"我知道"才放行（两个作品真的共用目录时，这是他自己的决定）。
 *    ⚠️ **自己的话在目录里不算冲突** —— 扫描根本来就是各话的上一层，算进去就什么都不让设了。
 */

/** 弹窗里"改成什么"。 */
export type SourceRootMode = 'manual' | 'auto'

export type SourceRootEdit =
  | { kind: 'auto' }
  | { kind: 'roots'; roots: string[] }
  | { kind: 'invalid'; reason: 'no-directory' }

export interface SourceRootEditInput {
  mode: SourceRootMode
  /** 用户选或填的目录（手动模式必填）。 */
  directory: string
  /** 用户勾选的"各话所在的那一层"（可多选）；**空 = 就用 directory 本身**。 */
  layers: readonly string[]
}

/** 把弹窗里的输入折算成"要改成什么"（纯函数，无副作用）。 */
export function planSourceRootEdit(input: SourceRootEditInput): SourceRootEdit {
  if (input.mode === 'auto') return { kind: 'auto' }
  if (input.layers.length > 0) return { kind: 'roots', roots: [...input.layers] }
  const directory = input.directory.trim()
  if (!directory) return { kind: 'invalid', reason: 'no-directory' }
  return { kind: 'roots', roots: [directory] }
}

/**
 * 要写库的载荷：`null` = **恢复自动推导**（主进程会把两个字段都删掉）。
 *
 * ⚠️ 参数类型刻意收窄成"已经有效的两种" —— 还没选目录（`invalid`）根本传不进来，
 * 免得有人把"无效"顺手当成"清空"写下去（那是真数据丢失）。
 */
export function toWritePayload(
  edit: Extract<SourceRootEdit, { kind: 'auto' | 'roots' }>
): string[] | null {
  return edit.kind === 'auto' ? null : [...edit.roots]
}

export interface SourceRootConflict {
  root: string
  parentId: string
  parentTitle: string
}

/**
 * 这批根里，哪些"下面住着别的作品的话"。
 * 与主进程 B1 同一处实现（`findOtherParentInside`），所以两边的判断永远不会分叉。
 */
export function findRootConflicts(
  roots: readonly string[],
  parentId: string,
  projects: readonly ParentProject[]
): SourceRootConflict[] {
  const conflicts: SourceRootConflict[] = []
  for (const root of roots) {
    const other = findOtherParentInside(root, parentId, projects)
    if (other) conflicts.push({ root, parentId: other.id, parentTitle: other.title })
  }
  return conflicts
}

export interface UseSourceRootEditorOptions {
  /** 当前整棵树（算"这个目录里有没有别的作品的话"用）。取函数而不是快照：弹窗开着时树可能变。 */
  projects: () => readonly ParentProject[]
  /** 保存成功后刷新界面（宿主负责，通常是 workspace.loadParents()）。 */
  refreshAfterSave: () => Promise<void>
}

export interface UseSourceRootEditorResult {
  visible: Ref<boolean>
  busy: Ref<boolean>
  parentTitle: Ref<string>
  mode: Ref<SourceRootMode>
  directory: Ref<string>
  /** 所选目录的一级子目录（候选层）；只列目录，文件不算。 */
  layers: Ref<DirEntry[]>
  /** 读目录失败时的提示（仍然允许"就用这个目录本身"）。 */
  layerError: Ref<string>
  /** 已勾选的层（弹窗画勾选用；`isLayerSelected` 是读单个的便捷版）。 */
  selectedLayerPaths: Ref<string[]>
  acknowledged: Ref<boolean>
  currentRoots: Ref<string[]>
  currentIsRemembered: Ref<boolean>
  currentCandidateCount: Ref<number>
  currentMessage: Ref<string>
  plan: ComputedRef<SourceRootEdit>
  conflicts: ComputedRef<SourceRootConflict[]>
  canSave: ComputedRef<boolean>
  isLayerSelected: (layerPath: string) => boolean
  open: (parent: ParentProject) => Promise<void>
  close: () => void
  pickDirectory: () => Promise<void>
  setDirectory: (next: string) => void
  loadLayers: () => Promise<void>
  toggleLayer: (layerPath: string) => void
  resetToAuto: () => Promise<void>
  save: () => Promise<void>
}

export function useSourceRootEditor(
  options: UseSourceRootEditorOptions
): UseSourceRootEditorResult {
  const toast = useToastStore()

  const visible = ref(false)
  const busy = ref(false)
  const parentId = ref('')
  const parentTitle = ref('')
  const mode = ref<SourceRootMode>('manual')
  const directory = ref('')
  const layers = ref<DirEntry[]>([])
  const layerError = ref('')
  const selectedLayerPaths = ref<string[]>([])
  const acknowledged = ref(false)
  let layerRequest = 0

  const currentRoots = ref<string[]>([])
  const currentIsRemembered = ref(false)
  const currentCandidateCount = ref(0)
  const currentMessage = ref('')

  const plan = computed<SourceRootEdit>(() =>
    planSourceRootEdit({
      mode: mode.value,
      directory: directory.value,
      layers: selectedLayerPaths.value
    })
  )

  const conflicts = computed<SourceRootConflict[]>(() =>
    plan.value.kind === 'roots'
      ? findRootConflicts(plan.value.roots, parentId.value, options.projects())
      : []
  )

  /**
   * 能不能保存。三条：
   *   · 折算结果必须有效（选了目录或选了"恢复自动推导"）；
   *   · 有冲突时必须**显式确认**（`acknowledged`）—— 默认不替用户做决定，也不放它过去；
   *   · 正在忙的时候不许重复点。
   */
  const canSave = computed(() => {
    if (busy.value) return false
    if (plan.value.kind === 'invalid') return false
    return conflicts.value.length === 0 || acknowledged.value
  })

  function resetEditState(): void {
    layerRequest++
    mode.value = 'manual'
    directory.value = ''
    layers.value = []
    layerError.value = ''
    selectedLayerPaths.value = []
    acknowledged.value = false
  }

  function isLayerSelected(layerPath: string): boolean {
    return selectedLayerPaths.value.includes(layerPath)
  }

  /**
   * 改目录 ⇒ 回手动模式、清掉旧目录勾过的层与"我知道"。
   * ⚠️ 换目录后还留着上一批勾选，会写出**跨两个目录**的根 —— 那不是用户此刻的意思。
   */
  function setDirectory(next: string): void {
    layerRequest++
    mode.value = 'manual'
    directory.value = next
    layers.value = []
    layerError.value = ''
    selectedLayerPaths.value = []
    acknowledged.value = false
  }

  async function loadLayers(): Promise<void> {
    const request = ++layerRequest
    const target = directory.value.trim()
    layers.value = []
    layerError.value = ''
    if (!target) return
    try {
      const entries = await window.comicType.listDir(target)
      if (request !== layerRequest) return
      // 只列**目录**：文件（封面.jpg 之类）不可能是"各话所在的那一层"。
      layers.value = entries.filter((entry) => entry.isDirectory)
    } catch {
      if (request !== layerRequest) return
      // 读不到（路径打错 / 权限 / 网络盘掉线）不是致命错误：
      // 仍然允许"就用这个目录本身"，只是没法列出候选层。
      layerError.value = '读不到这个目录，无法列出下一层（仍可直接保存这个目录）'
    }
  }

  async function pickDirectory(): Promise<void> {
    const picked = await window.comicType.pickDirectory()
    if (!picked) return
    setDirectory(picked)
    await loadLayers()
  }

  function toggleLayer(layerPath: string): void {
    const next = new Set(selectedLayerPaths.value)
    if (next.has(layerPath)) next.delete(layerPath)
    else next.add(layerPath)
    selectedLayerPaths.value = [...next]
    // 换了勾选就是换了最终根 ⇒ 之前的"我知道"不再算数（必须重新看懂一次）。
    acknowledged.value = false
  }

  async function resetToAuto(): Promise<void> {
    layerRequest++
    mode.value = 'auto'
    acknowledged.value = false
  }

  async function open(parent: ParentProject): Promise<void> {
    parentId.value = parent.id
    parentTitle.value = parent.title
    visible.value = true
    busy.value = true
    resetEditState()
    currentRoots.value = []
    currentIsRemembered.value = false
    currentCandidateCount.value = 0
    currentMessage.value = ''

    // "来源"从**库里那个父级对象**读（记住过就是记住过），
    // "当前实际会扫哪儿"则问主进程 —— 它才是权威（含容器层过滤等规则）。
    currentIsRemembered.value =
      readRememberedRoots(parent.sourceRoots).length > 0 ||
      (typeof parent.sourceRoot === 'string' && parent.sourceRoot.trim() !== '')

    try {
      const preview = await window.comicType.selfCheckPreview(parent.id)
      currentRoots.value = [...(preview.sourceRoots ?? [])]
      currentCandidateCount.value = preview.candidates.length
      currentMessage.value = preview.canDetect ? '' : preview.message || '当前无法自动确定'
    } catch {
      currentMessage.value = '读不到当前的扫描目录'
    } finally {
      busy.value = false
    }
  }

  function close(): void {
    if (busy.value) return
    visible.value = false
    parentId.value = ''
    resetEditState()
  }

  async function save(): Promise<void> {
    if (!canSave.value) return
    const edit = plan.value
    if (edit.kind === 'invalid') return

    busy.value = true
    try {
      const payload = toWritePayload(edit)
      /**
       * ⚠️ **"界面是新的、后台还是旧的"**（2026-10-05 现场撞到）：
       * 开发模式的渲染层由 Vite **现读源码**，而 preload / main 走 `out/` 里的编译产物。
       * 本机在 WSL 上（项目在 `/mnt/d`，跨文件系统），**文件监视不可靠** ——
       * 改了 preload 不会自动重编译，于是新弹窗能打开、一保存就报
       * `window.comicType.projectSetParentSourceRoots is not a function`。
       * 那句话用户看不懂，也想不到"要重启程序"，所以在这里翻译成人话并给出动作。
       */
      if (typeof window.comicType.projectSetParentSourceRoots !== 'function') {
        throw new Error(
          '程序后台还是旧版本，请完全关闭程序后再重新启动一次（界面已更新，后台没有）'
        )
      }
      await window.comicType.projectSetParentSourceRoots(parentId.value, payload)
      await options.refreshAfterSave()
      toast.addToast({
        type: 'success',
        message:
          payload === null
            ? `已恢复自动推导（《${parentTitle.value}》下次检测按各话路径重新推算）`
            : `已更新《${parentTitle.value}》的扫描目录（${payload.length} 处）`
      })
      visible.value = false
    } catch (error) {
      toast.addToast({
        type: 'error',
        message: `扫描目录没保存成功：${error instanceof Error ? error.message : String(error)}`
      })
    } finally {
      busy.value = false
    }
  }

  return {
    visible,
    busy,
    parentTitle,
    mode,
    directory,
    layers,
    layerError,
    selectedLayerPaths,
    acknowledged,
    currentRoots,
    currentIsRemembered,
    currentCandidateCount,
    currentMessage,
    plan,
    conflicts,
    canSave,
    isLayerSelected,
    open,
    close,
    pickDirectory,
    setDirectory,
    loadLayers,
    toggleLayer,
    resetToAuto,
    save
  }
}
