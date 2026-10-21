/**
 * 译文改动的**草稿**（P2-b）—— 改了什么、能不能撤销、要不要保存、撞上冲突怎么办。
 *
 * ## 三条用户拍板的语义，都落在这里
 *
 * 1. **攒着 + 显式保存**：改动只进内存，点「保存」才落盘；所以必须有一个明确的
 *    "未保存"状态（`dirty`）与"改了几条"（`changedCount`）。
 * 2. **与原文一致 = 不算改动**：改回原值就从改动集里消失 —— 否则"未保存"会赖着不走，
 *    而主进程那边本来也会跳过内容相同的写入（两边口径一致）。
 * 3. **Ctrl+Z 归译文**（有未保存改动时）：`undo()` 在**没有**未保存改动时返回 `false`，
 *    把按键还给"撤销标记"那条老逻辑 —— 这样这个键在两种情况下都是"撤销"，
 *    **永远不会跨到第三种东西上**（详见 `views/Project.vue` 的 onUndoHotkey）。
 *
 * ## 冲突时不丢用户的改动
 *
 * 撞上冲突（txt 被别处改过）时**只弹决定、不清草稿**：用户选「重新读取」才丢弃，
 * 选「强制覆盖」就把草稿原样发出去。清空草稿等于把用户刚打的字吃掉。
 *
 * ## 它还管"回退已经落盘的保存"（2026-10-07）
 *
 * 除了上面那个撤**草稿**的 `undo()`，这里还有一对 `canUndoSaved` / `undoSaved()`：
 * 撤的是**已经写进 txt** 的那几次保存（"每按一次 Ctrl+Z 退一步，退到本会话开始为止"）。
 * 真值在主进程的会话堆栈里，这里只留一份**镜像**供热键同步判断。两者分工见各自的注释。
 */
import type { Ref } from 'vue'
import { computed, effectScope, onScopeDispose, ref, shallowRef, watch } from 'vue'
import type {
  ChapterTranslationEdit,
  ChapterTranslationFingerprint,
  ChapterTranslationSaveResult,
  ChapterTranslationUndoResult
} from '@shared/chapter-translation'
import type { LabelPlusDocument, LabelPlusLabel } from '@shared/labelplus-import'
import { deleteChapterTranslation, saveChapterTranslation, undoChapterTranslation } from './translationBridge'

/** 坐标比较用的容差：小于它就算"没动过"（拖拽会抖出 1e-12 量级的差）。 */
const POSITION_EPSILON = 1e-9

export function draftKey(imageName: string, labelIndex: number): string {
  return `${String(imageName).trim().toLocaleLowerCase()}\u0000${labelIndex}`
}

/**
 * 发出去之前把每条**摊平成普通对象**（顺带收白名单 —— 显式列出允许的字段）。
 *
 * ⚠️ **为什么非摊不可**：`edits` 是 `ref(new Map())`，Vue 会把里面的对象包成**响应式代理**，
 * 而代理**不是结构化可克隆的** —— 直接送进 `ipcRenderer.invoke` 就是
 * `An object could not be cloned.`（2026-10-06 真机现场，本仓库**第四次**踩这个坑）。
 *
 * ⚠️ 也**不能只靠用例拦住**：那条桥在用例里是桩，什么东西都收得下 ——
 * 所以另配一条"载荷必须能被 `structuredClone()`"的锁（见 spec）。
 *
 * 白名单是顺手的好处：以后往 `ChapterTranslationEdit` 上加字段，忘记同步这里会当场露馅
 * （发不出去），而不是悄悄把一个渲染层的对象塞进 IPC。
 */
export function toPlainEdit(edit: ChapterTranslationEdit): ChapterTranslationEdit {
  return {
    imageName: String(edit.imageName),
    labelIndex: Number(edit.labelIndex),
    ...(edit.text !== undefined ? { text: String(edit.text) } : {}),
    ...(edit.position
      ? { position: { x: Number(edit.position.x), y: Number(edit.position.y) } }
      : {}),
    ...(edit.groupName !== undefined ? { groupName: String(edit.groupName) } : {})
  }
}

export function toPlainEdits(edits: Iterable<ChapterTranslationEdit>): ChapterTranslationEdit[] {
  const result: ChapterTranslationEdit[] = []
  for (const edit of edits) result.push(toPlainEdit(edit))
  return result
}

export interface ChapterTranslationDraftInput {
  /** 当前读到的文档（用来判断"改回原值了没有"）。 */
  document: () => LabelPlusDocument | null
  /** 当前采用的那份 txt；没读到就是 null。 */
  filePath: () => string | null
  /**
   * **这一话的目录** —— "换话"的判据（`filePath` 不够用，见下面那段注释）。
   *
   * ⚠️ 为什么不用 `filePath` 当换话判据（2026-10-07 真机 bug 的第三层根因）：
   * 一次**普通重读**（保存成功 / 新增框成功 / 回退成功之后都会重读）会让 `filePath`
   * 短暂回落到 `null` 再回来 ⇒ 用路径当判据会把"可退历史"**误清**，
   * 症状正是真机上那句"提示写着能撤、按下去没反应"。
   */
  chapterKey: () => string | null
  /** 读进来时的基指纹；保存时原样回传（主进程据此判断有没有被别处改过）。 */
  base: () => ChapterTranslationFingerprint | null
  /** 保存成功后通知外面重读（父层借此刷新文档与基指纹）。 */
  onSaved: () => void | Promise<void>
}

export interface ChapterTranslationConflict {
  message: string
  /** 盘上当前那份的指纹（可能缺）。 */
  current: ChapterTranslationFingerprint | null
}

/** Retain independent drafts for every chapter/file, including conflicts and undo history.
 * Reloading temporarily clears the path; it must not transfer a draft to another file. */
export function useChapterTranslationDraft(input: ChapterTranslationDraftInput) {
  let disposed = false
  const sessions = new Map<string, ReturnType<typeof createDraftSession>>()
  const scopes: ReturnType<typeof effectScope>[] = []
  const retainedPaths = new Map<string, string>()
  const undoDepths = new Map<string, Ref<Map<string, number>>>()
  function session() {
    const chapter = input.chapterKey() ?? ''
    const path = input.filePath()
    if (path) retainedPaths.set(chapter, path)
    const ownedPath = path ?? retainedPaths.get(chapter) ?? null
    const key = JSON.stringify([chapter, ownedPath])
    let current = sessions.get(key)
    if (!current) {
      const depths = undoDepths.get(chapter) ?? ref(new Map<string, number>())
      undoDepths.set(chapter, depths)
      const scope = effectScope()
      scopes.push(scope)
      current = scope.run(() => createDraftSession({
        chapterKey: () => chapter,
        filePath: () => ownedPath,
        document: () => input.chapterKey() === chapter && input.filePath() === ownedPath ? input.document() : null,
        base: () => input.chapterKey() === chapter && input.filePath() === ownedPath ? input.base() : null,
        onSaved: async () => {
          if (!disposed && input.chapterKey() === chapter && input.filePath() === ownedPath) await input.onSaved()
        }
      }, depths))!
      sessions.set(key, current)
    }
    current.syncSource()
    return current
  }
  onScopeDispose(() => { disposed = true; scopes.forEach(scope => scope.stop()) })
  const fields = ['edits', 'dirty', 'dirtyVisible', 'changedCount', 'saving', 'notice', 'conflict', 'canUndoSaved'] as const
  const methods = ['setText', 'setGroup', 'setPosition', 'isChanged', 'positionOverridesFor',
    'groupOverridesFor', 'undo', 'undoSaved', 'noteSavedWrite', 'migrateSavedUndo', 'dropEntry',
    'remapEntryKeys', 'discard', 'discardEntry', 'save', 'commit', 'resolveConflict', 'deleteEntry'] as const
  const api = {} as Omit<ReturnType<typeof createDraftSession>, 'syncSource'>
  for (const field of fields) {
    Object.assign(api, { [field]: computed({
      get: () => session()[field].value,
      set: value => { (session()[field] as { value: unknown }).value = value }
    }) })
  }
  for (const method of methods) Object.assign(api, {
    [method]: (...args: unknown[]) => (session()[method] as (...args: unknown[]) => unknown)(...args)
  })
  return api
}

function createDraftSession(input: ChapterTranslationDraftInput, savedUndoDepth: Ref<Map<string, number>> = ref(new Map<string, number>())) {
  const sourceDocument = shallowRef<LabelPlusDocument | null>(null)
  let sourceBase: ChapterTranslationFingerprint | null = null
  let queue: Promise<unknown> = Promise.resolve()
  let pending = 0
  let structural = false
  let inFlight: ChapterTranslationEdit[] = []
  function syncSource(): void {
    if (edits.value.size || pending) return
    const document = input.document()
    const base = input.base()
    if (document && base) {
      sourceDocument.value = JSON.parse(JSON.stringify(document))
      sourceBase = { ...base }
    }
  }
  function enqueue<T>(operation: () => Promise<T>): Promise<T> {
    pending += 1
    saving.value = true
    const task = pending === 1 ? operation() : queue.then(operation)
    queue = task.catch(() => undefined)
    return task.finally(() => {
      pending -= 1
      saving.value = pending > 0
    })
  }
  const edits = ref(new Map<string, ChapterTranslationEdit>())
  /** 撤销栈：每次改动**之前**的一份快照（改动很小，存全量最不容易错）。 */
  const past: Array<Array<[string, ChapterTranslationEdit]>> = []
  const saving = ref(false)
  /** 一行反馈（保存成功 / 失败原因 / 没什么可存）。 */
  const notice = ref('')
  const conflict = ref<ChapterTranslationConflict | null>(null)

  const dirty = computed(() => edits.value.size > 0)
  const changedCount = computed(() => edits.value.size)

  /**
   * **本会话内每份 txt 还剩几步可退** —— 渲染层的**镜像**（真值是主进程那个堆栈）。
   *
   * 为什么要镜像：Ctrl+Z 那一下必须**同步**决定"该不该拦下来"，不能等一次 IPC 往返。
   * 分歧时以主进程为准：它回一句"本会话还没有可回退的保存"，这里就把镜像对齐成 0。
   */
  /** 回退正在进行中（防止连按 Ctrl+Z 把同一层弹两次）。 */
  let undoing = false

  /**
   * 换话 ⇒ 可退历史归零（与主进程"会话历史只认当前这一话"同一条口径）。
   *
   * ⚠️ 判据是 {@link ChapterTranslationDraftInput.chapterKey}（**这一话的目录**），
   * **不是** `filePath` —— 一次普通重读会让路径抖一下，用路径判会误清（真机 bug）。
   */
  watch(
    () => input.chapterKey(),
    () => {
      savedUndoDepth.value = new Map()
    }
  )

  /** 这一话现在还有没有可退的保存。 */
  const canUndoSaved = computed(() => {
    const path = input.filePath()
    return path !== null && (savedUndoDepth.value.get(path) ?? 0) > 0
  })

  /** 镜像加减一步（减到 0 就把这一话从表里去掉）。 */
  function bumpSavedUndo(filePath: string, delta: number): void {
    const next = new Map(savedUndoDepth.value)
    const value = Math.max(0, (next.get(filePath) ?? 0) + delta)
    if (value === 0) next.delete(filePath)
    else next.set(filePath, value)
    savedUndoDepth.value = next
  }

  /**
   * **别处写了一次盘**（不是经这条草稿的 `save()`）⇒ 把可退层数 +1
   * （2026-10-07 真机 bug 的修法）。
   *
   * ## 为什么必须有这个入口
   *
   * 镜像原来只在 `save()` 里 `+1` —— 那条路管的是"**草稿**写盘"。
   * 而第 5 批的「新增框」走的是**另外两条写盘路**（`insertChapterTranslation` /
   * `createChapterTranslation`：主进程直接写，并把"写盘前原文"压进了**同一份会话堆栈**）。
   * 于是出现真机那一幕：**状态条写着「Ctrl+Z 可撤销」（这是真的，主进程有那一层），
   * 按下去却什么都不发生**（镜像还是 0 ⇒ `canUndoSaved` 为 false ⇒ 连通道都不发）。
   * 真机上它还能更坏一点：那个 0 与 1 来自**上一次别的编辑**，于是提示时有时无、看着像随机。
   *
   * ## 为什么不让调用方自己 `+1`
   *
   * `savedUndoDepth` 的键是 **`input.filePath()`**（这个模块自己知道的东西），
   * 调用方只知道"我新增了一条"。把 key 的算法留在**一处**，与 `canUndoSaved` 用的是同一份。
   */
  function noteSavedWrite(knownPath?: string | null): void {
    // ⚠️ **从零新建**那一趟必须把新路径**传进来**：那时界面手上还没有路径
    //（`input.filePath()` 是 `null`），照默认取就会"记了个空" ⇒ 状态条写着能撤却按不动。
    const filePath = knownPath ?? input.filePath()
    if (!filePath) return
    bumpSavedUndo(filePath, 1)
  }

  /**
   * 把"可退层数"从那**一份文件**搬到另一份（`from` 那一份被清掉）。
   *
   * 谁需要它：**从零新建**那条路 —— 在写出文件之前界面手上**没有路径**（`filePath()` 是 `null`），
   * 所以 {@link noteSavedWrite} 只能记在"当时那个路径"上；等重读回来，路径变成了
   * 新建出来的那一份 ⇒ 不搬的话层数挂在一个**已经不存在**的键上，
   * 表现就是"状态条写着能撤、按下去没反应"（真机 bug 的同一个症状）。
   */
  function migrateSavedUndo(from: string | null, to: string | null): void {
    if (!to || from === to) return
    const value = from === null ? 0 : savedUndoDepth.value.get(from)
    if (value === undefined) return
    if (value === 0 && from !== null) return
    const next = new Map(savedUndoDepth.value)
    if (from !== null) next.delete(from)
    next.set(to, (next.get(to) ?? 0) + value)
    savedUndoDepth.value = next
  }

  /**
   * **界面上的**"未保存态" —— 比 `dirty` 慢一拍（2026-10-06 真机反馈："还是会闪现"）。
   *
   * 为什么需要它：自动保存（失焦 / 选完分组 / 拖完松手）通常几十毫秒就完事，而 `dirty`
   * 一升一降会让界面**依次画四次**（未保存徽标 → 保存中… → 已保存 → 徽标消失）。
   * 上一步只治了"高度跳动"，这一步治的是"内容闪"。
   *
   * 规则：**成功静默、失败出声** —— 脏到超过 {@link DIRTY_VISIBLE_DELAY_MS} 还没落盘
   * （通常是保存失败 / 卡住），才把未保存态摆出来。
   */
  const DIRTY_VISIBLE_DELAY_MS = 400
  const dirtyVisible = ref(false)
  let dirtyTimer: ReturnType<typeof setTimeout> | undefined
  watch(
    dirty,
    (value) => {
      if (dirtyTimer !== undefined) {
        clearTimeout(dirtyTimer)
        dirtyTimer = undefined
      }
      if (!value) {
        dirtyVisible.value = false
        return
      }
      dirtyTimer = setTimeout(() => {
        dirtyTimer = undefined
        dirtyVisible.value = true
      }, DIRTY_VISIBLE_DELAY_MS)
    },
    { immediate: true }
  )
  onScopeDispose(() => {
    if (dirtyTimer !== undefined) clearTimeout(dirtyTimer)
  })

  function snapshot(): Array<[string, ChapterTranslationEdit]> {
    return [...edits.value.entries()].map(([key, value]) => [
      key,
      { ...value, ...(value.position ? { position: { ...value.position } } : {}) }
    ])
  }

  function findLabel(imageName: string, labelIndex: number): LabelPlusLabel | null {
    const document = sourceDocument.value
    if (!document) return null
    const wanted = String(imageName).trim().toLocaleLowerCase()
    const image = document.images.find(
      (entry) => String(entry.fileName).trim().toLocaleLowerCase() === wanted
    )
    return image?.labels.find((label) => label.index === labelIndex) ?? null
  }

  /**
   * 改一条的一个字段。与原文一致 ⇒ 把该字段**撤掉**；整条一个字段都不剩 ⇒ 从改动集里移除。
   * 与改动前完全一样 ⇒ 不记撤销步（免得 Ctrl+Z 要按好几次才动一下）。
   */
  function writeEdit(
    imageName: string,
    labelIndex: number,
    apply: (edit: ChapterTranslationEdit) => void
  ): void {
    const label = findLabel(imageName, labelIndex)
    if (!label) return

    const key = draftKey(imageName, labelIndex)
    const before = edits.value.get(key)
    const next: ChapterTranslationEdit = before
      ? { ...before, ...(before.position ? { position: { ...before.position } } : {}) }
      : { imageName, labelIndex }
    apply(next)

    // A pending write can change the disk baseline. Keep explicit reversions until it resolves.
    const pendingEdit = inFlight.find(edit => draftKey(edit.imageName, edit.labelIndex) === key)
    if (next.text !== undefined && next.text === label.text && !(pendingEdit?.text !== undefined && pendingEdit.text !== label.text)) delete next.text
    if (next.groupName !== undefined && next.groupName === label.group && !(pendingEdit?.groupName !== undefined && pendingEdit.groupName !== label.group)) delete next.groupName
    if (
      next.position &&
      Math.abs(next.position.x - label.position.x) < POSITION_EPSILON &&
      Math.abs(next.position.y - label.position.y) < POSITION_EPSILON &&
      !(pendingEdit?.position && (Math.abs(pendingEdit.position.x - label.position.x) >= POSITION_EPSILON || Math.abs(pendingEdit.position.y - label.position.y) >= POSITION_EPSILON))
    ) {
      delete next.position
    }

    const empty =
      next.text === undefined && next.groupName === undefined && next.position === undefined
    if (empty) {
      if (!before) return
      past.push(snapshot())
      edits.value.delete(key)
      return
    }
    if (before && JSON.stringify(before) === JSON.stringify(next)) return
    past.push(snapshot())
    edits.value.set(key, next)
  }

  function setText(imageName: string, labelIndex: number, text: string): void {
    writeEdit(imageName, labelIndex, (edit) => {
      edit.text = text
    })
  }

  function setGroup(imageName: string, labelIndex: number, groupName: string): void {
    writeEdit(imageName, labelIndex, (edit) => {
      edit.groupName = groupName
    })
  }

  function setPosition(imageName: string, labelIndex: number, x: number, y: number): void {
    writeEdit(imageName, labelIndex, (edit) => {
      edit.position = { x, y }
    })
  }

  /** 这一条改过没有（右栏据此打个记号）。 */
  function isChanged(imageName: string, labelIndex: number): boolean {
    return edits.value.has(draftKey(imageName, labelIndex))
  }

  /**
   * 这一页里**改过坐标**的那些（给锚点层用：有值就用它画，没有才用文本里的原坐标）。
   *
   * 键的拼法留在本模块里 —— 宿主不该知道"键 = 图名 + \\u0000 + 序号"这件事。
   */
  function positionOverridesFor(
    imageName: string,
    labels: readonly { index: number }[]
  ): Record<number, { x: number; y: number }> {
    const result: Record<number, { x: number; y: number }> = {}
    for (const label of labels) {
      const edit = edits.value.get(draftKey(imageName, label.index))
      if (edit?.position) result[label.index] = { ...edit.position }
    }
    return result
  }

  /**
   * 这一页里**改过分组**的那些 —— 与坐标同构，理由也一样。
   *
   * ⚠️ 少了它就会出现"**选了分组没反应**"：面板显示的是**文档里**的 `label.group`，
   * 而文档在保存前不会变 ⇒ 用户一选就弹回旧值。（2026-10-06 真机现场。）
   */
  function groupOverridesFor(
    imageName: string,
    labels: readonly { index: number }[]
  ): Record<number, string> {
    const result: Record<number, string> = {}
    for (const label of labels) {
      const edit = edits.value.get(draftKey(imageName, label.index))
      if (edit?.groupName) result[label.index] = edit.groupName
    }
    return result
  }

  /**
   * "**一次编辑动作结束了**"——失焦 / 选完分组 / 拖完松手 / 按 Ctrl+S 都走这里。
   *
   * 用户 2026-10-06 改口径：**失焦即写盘**（推翻了先前"攒着 + 显式保存"那条）。
   * 没有改动时**一个通道都不发**（切来切去不该反复写用户的文件）。
   *
   * 返回保存结果，是为了让上层能判断"**这一次真的写进盘了吗**"——
   * 校对记录只在这时候才留（见 `views/Project.vue` 的 `onTranslationEditText`）。
   */
  async function commit(afterSaved?: (result: ChapterTranslationSaveResult) => Promise<void>): Promise<ChapterTranslationSaveResult | null> {
    if (!dirty.value) return null
    return await save({}, afterSaved)
  }

  /**
   * 撤销最近一条译文改动。**没有未保存改动时返回 `false`**（见文件头第 3 条）——
   * 调用方据此决定要不要把 Ctrl+Z 让给"撤销标记"。
   */
  function undo(): boolean {
    if (saving.value) { notice.value = '正在保存，请稍后撤销。'; return true }
    if (!dirty.value) return false
    const previous = past.pop()
    if (!previous) return false
    edits.value = new Map(previous)
    notice.value = ''
    return true
  }

  /**
   * **回退最近一次保存**（2026-10-07）—— 每调一次退一步，退到本会话开始（栈空）为止。
   *
   * 与草稿那个 `undo()` 分工很清：`undo()` 撤的是**还没落盘**的改动，这里撤的是**已经写进 txt** 的。
   * 上层（`views/Project.vue` 的热键）按"有草稿先撤草稿、没草稿才退保存"的顺序调它们。
   *
   * **没有可退的**（这一话没保存过 / 已经退到底 / 主进程说没有）⇒ 返回 `null` 且**一个通道都不发**，
   * 让上层直接落到原有行为。冲突（txt 被别处改过）⇒ **历史照旧留着**（没退成不该消耗），
   * 只把服务层那句人话摆到状态条上。
   */
  function undoSaved(): Promise<ChapterTranslationUndoResult | null> {
    if (undoing || saving.value || dirty.value) return Promise.resolve(null)
    return enqueue(performUndoSaved)
  }

  async function performUndoSaved(): Promise<ChapterTranslationUndoResult | null> {
    const filePath = input.filePath()
    const base = sourceBase
    if (!filePath || !base) {
      notice.value = '还没读到这一话的译文，没有可回退的保存。'
      return null
    }
    if (!canUndoSaved.value || undoing) return null

    undoing = true
    notice.value = ''
    let result: ChapterTranslationUndoResult
    try {
      result = await undoChapterTranslation({ filePath, base })
    } finally {
      undoing = false
    }

    if (result.ok) {
      bumpSavedUndo(filePath, -1)
      notice.value = ''
      // 盘上内容变了 ⇒ 必须重读：否则下一句保存会拿着**过期指纹**，白撞一次冲突
      sourceBase = { ...result.fingerprint }
      await input.onSaved()
      return result
    }
    if (result.kind === 'invalid') {
      // 主进程说"没有可回退的" ⇒ 镜像与它分歧了，以它为准对齐成 0
      savedUndoDepth.value = new Map()
    }
    notice.value = result.message
    return result
  }

  /**
   * 丢掉某一条的改动 —— 与 {@link discardEntry} 的区别只在**它叫什么**：
   * `discardEntry` 是"撤销校对时把这一条不要了"，`dropEntry` 是"这条译文被删了"。
   *
   * ⚠️ 两者算法完全一样，那为什么还要第二个名字：调用点的语义不同，将来任一边要变
   * （例如"删除时也清掉撤销栈里那一条"）时，改名比"看哪个调用点在用同一个函数"清楚。
   * 实现**共用同一段**（下面一行转发），不复制。
   */
  function dropEntry(imageName: string, labelIndex: number): void {
    discardEntry(imageName, labelIndex)
  }

  /**
   * **重映射键**（第 5 批 5e，2026-10-07）—— 删除一条译文之后，序号重排了，
   * 草稿里那些**按序号存的改动**必须跟着挪。
   *
   * 规则（与 txt 那一侧的重排**同一条**）：**同一张图**里，序号 **> deletedIndex** 的 -1；
   * 之下的一律不动；别的图、别的图的键一个都不碰。
   *
   * ⚠️ 不挪的后果是**静默改错数据**：删掉第 3 条之后，草稿里"第 4 条的改动"下一次保存时
   * 会写到**现在的第 4 条**上 —— 而那是**另一句话**。
   *
   * 键的形状由本模块自己拼（`draftKey`），宿主只报"哪张图、删了第几条"。
   */
  function remapEntryKeys(imageName: string, deletedIndex: number): void {
    const key = String(imageName).trim().toLocaleLowerCase()
    const removed = Math.trunc(Number(deletedIndex))
    if (!key || !Number.isFinite(removed) || removed <= 0) return

    const remap = (entries: Iterable<[string, ChapterTranslationEdit]>) => {
      const next = new Map<string, ChapterTranslationEdit>()
      for (const [identifier, edit] of entries) {
        if (String(edit.imageName).trim().toLocaleLowerCase() !== key) next.set(identifier, edit)
        else if (edit.labelIndex !== removed) {
          const index = edit.labelIndex > removed ? edit.labelIndex - 1 : edit.labelIndex
          next.set(draftKey(edit.imageName, index), { ...edit, labelIndex: index })
        }
      }
      return next
    }
    edits.value = remap(edits.value)
    for (let i = 0; i < past.length; i++) past[i] = [...remap(past[i])]

  }

  /**
   * 丢掉**某一条**还没落盘的改动（键由本模块自己拼，宿主不认识"图名 + \u0000 + 序号"）。
   *
   * 谁需要它：第 4 批的「撤销校对」—— 那一下要把原文写回 txt，
   * 而草稿里若还压着这一条没落盘的改动，下一次自动保存会把刚撤销掉的那句**又写回去**
   * （"撤销了自己回来"，最难查的一种）。
   * 与 `undo()` 的区别：这里**不记撤销步**（它不是"用户改了内容"，是"这一条不要了"）。
   */
  function discardEntry(imageName: string, labelIndex: number): void {
    const key = draftKey(imageName, labelIndex)
    if (!edits.value.has(key)) return
    edits.value.delete(key)
    notice.value = ''
  }

  /** 整份丢掉（用户点「放弃改动」，或冲突里选了「重新读取」）。 */
  function discard(): void {
    edits.value = new Map()
    past.length = 0
    notice.value = ''
    conflict.value = null
  }

  function save(options: { force?: boolean } = {}, afterSaved?: (result: ChapterTranslationSaveResult) => Promise<void>): Promise<ChapterTranslationSaveResult | null> {
    if (structural) return Promise.resolve(null)
    const requested = toPlainEdits(edits.value.values())
    return enqueue(async () => {
      const filePath = input.filePath()
      const base = sourceBase
      if (!filePath || !base) {
        notice.value = '还没读到这一话的译文，没有可保存的内容。'
        return null
      }
      const payload = requested.map(edit => {
        const label = sourceDocument.value?.images.find(image => draftKey(image.fileName, 0) === draftKey(edit.imageName, 0))?.labels.find(label => label.index === edit.labelIndex)
        const next = { ...edit }
        if (label?.text === next.text) delete next.text
        if (label?.group === next.groupName) delete next.groupName
        if (label && next.position && Math.abs(label.position.x - next.position.x) < POSITION_EPSILON && Math.abs(label.position.y - next.position.y) < POSITION_EPSILON) delete next.position
        return next
      }).filter(edit => edit.text !== undefined || edit.groupName !== undefined || edit.position)
      if (!payload.length) { notice.value = '没有要保存的改动。'; return null }
      notice.value = ''
      inFlight = payload
      try {
        const result = await saveChapterTranslation({ filePath, base, edits: payload, force: options.force === true })
        if (!result.ok) {
          if (result.kind === 'conflict') conflict.value = { message: result.message, current: result.current ?? null }
          else notice.value = result.message
          return result
        }
        sourceBase = { ...result.fingerprint }
        // Advance our own immutable document even when navigation suppresses the visible reload.
        const document = sourceDocument.value
        for (const edit of payload) {
          const label = document?.images.find(image => draftKey(image.fileName, 0) === draftKey(edit.imageName, 0))?.labels.find(label => label.index === edit.labelIndex)
          if (label) {
            if (edit.text !== undefined) label.text = edit.text
            if (edit.groupName !== undefined) label.group = edit.groupName
            if (edit.position) Object.assign(label.position, edit.position)
          }
          const key = draftKey(edit.imageName, edit.labelIndex)
          const acknowledge = (map: Map<string, ChapterTranslationEdit>) => {
            const current = map.get(key)
            if (!current) return
            const remaining = { ...current }
            for (const field of ['text', 'groupName', 'position'] as const) {
              if (JSON.stringify(remaining[field]) === JSON.stringify(edit[field])) delete remaining[field]
            }
            if (remaining.text === undefined && remaining.groupName === undefined && !remaining.position) map.delete(key)
            else map.set(key, remaining)
          }
          acknowledge(edits.value)
          for (let i = 0; i < past.length; i++) {
            const snapshot = new Map(past[i]); acknowledge(snapshot); past[i] = [...snapshot]
          }
        }
        if (!edits.value.size) past.length = 0
        conflict.value = null
        if (result.changed) bumpSavedUndo(filePath, 1)
        notice.value = result.changed ? '' : '没有需要写入的改动。'
        await input.onSaved()
        await afterSaved?.(result)
        return result
      } catch (error) {
        const result: ChapterTranslationSaveResult = { ok: false, kind: 'io', message: String(error) }
        notice.value = result.message
        return result
      } finally { inFlight = [] }
    })
  }

  function deleteEntry(imageName: string, labelIndex: number): Promise<Awaited<ReturnType<typeof deleteChapterTranslation>> | null> {
    if (pending) { notice.value = '正在保存，请稍后删除。'; return Promise.resolve(null) }
    return enqueue(async () => {
      const filePath = input.filePath()
      if (!filePath || !sourceBase) return null
      structural = true
      try {
        const result = await deleteChapterTranslation({ filePath, base: { ...sourceBase }, delete: { imageName, labelIndex } })
        if (!result.ok) { notice.value = result.message; return result }
        remapEntryKeys(imageName, labelIndex)
        sourceBase = { ...result.fingerprint }
        const image = sourceDocument.value?.images.find(image => draftKey(image.fileName, 0) === draftKey(imageName, 0))
        if (image) image.labels = image.labels.filter(label => label.index !== labelIndex).map(label => ({ ...label, index: label.index > labelIndex ? label.index - 1 : label.index }))
        bumpSavedUndo(filePath, 1)
        await input.onSaved()
        return result
      } finally { structural = false }
    })
  }

  /**
   * 冲突的两条路（用户拍板：只给这两条，不自动合并）。
   * · `reload` —— 丢掉我这边、按盘上最新那份重来；
   * · `force`  —— 明白写着会覆盖掉对方那次改动，照写。
   */
  function resolveConflict(action: 'reload' | 'force'): void {
    if (action === 'reload') {
      discard()
      notice.value = '已按盘上最新的一份重新读取。'
      input.onSaved()
      return
    }
    void save({ force: true })
  }

  return {
    syncSource,
    deleteEntry,
    edits,
    dirty,
    dirtyVisible,
    changedCount,
    saving,
    notice,
    conflict,
    setText,
    setGroup,
    setPosition,
    isChanged,
    positionOverridesFor,
    groupOverridesFor,
    undo,
    canUndoSaved,
    undoSaved,
    noteSavedWrite,
    migrateSavedUndo,
    dropEntry,
    remapEntryKeys,
    discard,
    discardEntry,
    save,
    commit,
    resolveConflict
  }
}
