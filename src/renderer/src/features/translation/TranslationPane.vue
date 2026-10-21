<script setup lang="ts">
import { Popover, PopoverAnchor, PopoverContent } from '@renderer/components/ui/popover'
import TranslationEntryBadges from './TranslationEntryBadges.vue'
import { Textarea } from '@renderer/components/ui/textarea'
import { Button as UiButton } from '@renderer/components/ui/button'
/**
 * 右栏「译文」栏（P1 只读 → P2 可编辑 → **第 2 批：两档 + 校对记录**，2026-10-06）
 *
 * 翻译 / 校对模式下顶替 PSD 那一栏：把**当前这一页**的译文按条列出来
 * （编号 + 分组 + 文字），点一条 ↔ 左图对应锚点双向高亮。
 *
 * ## 第 2 批加的两样东西
 *
 * 1. **档位**（页头两段式 `[翻译｜校对]`）：翻译档 = 现状（单行 + 双击改）；
 *    校对档 = **只读的对照视图**，校对过的条目显示**上原下校**（不共用一个框，
 *    中间一条细分割线），**双击**才进编辑器。
 * 2. **校对记录**：校对过的条目**行首一枚铅笔**（只有它才有）——
 *    点一下写【校对理由】，**悬停才浮现**理由，平时不显示。
 *    理由**只进 App 数据库**，绝不写进 txt。
 *
 * ## 「翻」这一行是从哪来的（别看错）
 *
 * `LabelPlusLabel` 每条只有一个文本位，校对是**覆盖保存** ⇒ 覆盖之后"翻"在 txt 里
 * 已经不存在了，这里显示的是**库里那条记录**里的原文（`reviews[i].originalText`）。
 * 原文为空 = 翻译漏了这一处 ⇒ 照写「（无 —— 翻译漏了这处）」（与导出**同一句**，
 * 出处是 `@shared/translation-review` 的 `displayReviewOriginal`）。
 *
 * ## 三条不许动的既有保证
 *
 * - 编辑器**悬浮在当前条目旁，不占列表高度**（换了一条要编辑才重置文本，免得把正在打的字顶掉）；
 * - 底部状态条**永远在、高度固定**（"不闪不抖"的保证，有锁盯着）；
 * - 空态**只说事实**（四种"没有内容"分开说，见 `state`）。
 *
 * ⚠️ 一块截图盲区（第 1 批踩过）：`AppSelect` 的菜单是**原生 popover**，
 * 没调过 `showPopover()` 就是 `display: none`，`wrapper.html()` 拍不出来。
 * 所以这里的理由浮层与导出菜单都是**页面里的普通元素**（绝对定位 + `v-if`），
 * 能被序列化、也能被截图拍到。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { ChapterTranslationReadResult } from '@shared/chapter-translation'
import type { LabelPlusImageEntry, LabelPlusLabel } from '@shared/labelplus-import'
import type { TranslationPaneMode } from '@shared/translation-review'
import { displayReviewOriginal } from '@shared/translation-review'
import TranslationGroupToggle from './TranslationGroupToggle.vue'

const props = withDefaults(
  defineProps<{
    loading: boolean
    result: ChapterTranslationReadResult | null
    entry: LabelPlusImageEntry | null
    groups: string[]
    activeIndex?: number | null
    /** 有未保存的改动。 */
    dirty?: boolean
    /** 改动条数（清单每条最多算一条）。 */
    changedCount?: number
    /** 正在写盘。 */
    saving?: boolean
    /** 一行反馈（保存成功 / 失败原因）。 */
    notice?: string
    /** 这一页里哪几条被改过（用来打记号）。 */
    changedIndices?: number[]
    /**
     * **正在编辑**的那一条（由双击打开）。
     *
     * ⚠️ 与 `activeIndex` **必须分开**：`activeIndex` 是"悬停或选中"（鼠标一划过就变），
     * 用它驱动编辑器会得到两个真机现场问题 —— ① 鼠标划过就展开、来回闪；
     * ② **正在打的字会被下一条的原文顶掉**（编辑器被卸载 + 文本被重置）⇒ "改完还得再点一下才算保存"。
     */
    editorAnchor?: { getBoundingClientRect: () => DOMRect } | null
    editingIndex?: number | null
    /** 改过分组的那几条（显示要读它，否则一选就弹回旧值 ⇒ 看着像"没反应"）。 */
    groupOverrides?: Record<number, string>
    /** 档位：`translate` = 翻译档（现状）／`review` = 校对档（只读对照 + 铅笔 + 导出）。 */
    mode?: TranslationPaneMode
    /**
     * **这一页**里校对过的那些（按条目编号索引）。
     *
     * 只带"库里那条记录的原文与理由"：**校那一行显示的是文档里的当前值**
     * （覆盖保存之后两者相等；若之后又被改过，那就是"以现在 txt 里的为准"，
     * 与用户"被改过就以 txt 当前值为校"的口径一致）。
     */
    pageReviewed?: boolean
    reviews?: Record<number, { originalText: string; reason: string }>
    /** 整话已校条数（页头那枚「已校：N」按钮上的数字）。 */
    reviewCount?: number
    /**
     * 2026-10-07：**本会话在这份 txt 上还有可退的保存**（Ctrl+Z 每按一次退一步）。
     *
     * 状态条据此放一枚**只表示有/无**的小标 —— **不做步数显示、也不是按钮**（用户拍板）。
     */
    canUndoSaved?: boolean
    /**
     * 第 5 批 5d-2：页头那枚「新增框」开关开着没有（**默认关**）。
     *
     * 这一栏只负责**画**与**emit**；"开着意味着什么"（左键点图写数据）发生在原图那一栏，
     * 由父层把同一个 ref 接住再透传过去。
     */
    addFrameMode?: boolean
    /**
     * 第 5 批 5d-2：**刚新增**的那一条（瞬时的，父层持有）。
     *
     * ⚠️ 它**不是** `activeIndex` / `editingIndex`：固定选中 = 左缘 2px accent 竖条 + 选中底色；
     * 瞬时高亮 = 淡紫底 + accent 细描边 + 「刚新增」小标、**没有竖条** —— 两种状态刻意长得不一样。
     * 大约 2 秒（或用户一动）自己退掉，退掉由**父层**做（这里只读）。
     */
    justAddedIndex?: number | null
  }>(),
  {
    activeIndex: null,
    dirty: false,
    changedCount: 0,
    saving: false,
    notice: '',
    changedIndices: () => [],
    editingIndex: null,
    groupOverrides: () => ({}),
    mode: 'translate',
    reviews: () => ({}),
    reviewCount: 0,
    canUndoSaved: false,
    addFrameMode: false,
    justAddedIndex: null
  }
)

const emit = defineEmits<{
  (e: 'pick', index: number): void
  (e: 'hover', index: number | null): void
  /** 双击某一条 —— 打开它的编辑器（单击只固定选中，不展开）。 */
  (e: 'edit', index: number): void
  (e: 'editText', index: number, text: string, done?: (saved: boolean) => void): void
  (e: 'editGroup', index: number, groupName: string): void
  /** 档位被用户改了（父层据此"本会话内不再跟着四模式自动切"）。 */
  (e: 'update:mode', mode: TranslationPaneMode): void
  /** 写某一条的校对理由（理由**只进数据库**，不碰 txt）。 */
  (e: 'editReason', index: number, reason: string): void
  /** 点「导出校对记录…」—— 弹「另存为」那件事由父层做。 */
  (e: 'exportReviews'): void
  /**
   * 点行尾那枚 `✕`（或右键菜单第一项）—— **撤销校对**：把记录里的原文写回 txt，
   * 成功了再删掉这条记录（第 4 批）。组件层只报"用户点了哪一条"。
   */
  (e: 'unreview', index: number): void
  /** 右键菜单第二项 —— **只删记录**（保留现在 txt 里的译文）。 */
  (e: 'dropReview', index: number): void
  /**
   * "**该把展开着的编辑器收起来了**"（第 4 批修：以前点别处 / 切档位都收不掉）。
   *
   * ⚠️ 这个事件的**状态在父层**（`editingIndex` 是 prop）—— 组件层只报告"发生了一次
   * 应该收起的事"，收不收由持有状态的那一层决定。
   */
  (e: 'closeEditor'): void
  /**
   * 点「另存…」—— 把**当前翻译另存一份**到用户选的位置（第 3 批）。
   *
   * 与上面的 `save`（写回话目录那份原件）**是两件事**：组件层一样不落地，
   * 只把"点了"这件事报上去。
   */
  (e: 'saveAs'): void
  (e: 'undo'): void
  (e: 'discard'): void
  (e: 'save'): void
  /**
   * 第 5 批 5e：**删除这一条译文**（用户拍板：不加二次确认，靠 Ctrl+Z 兜底）。
   *
   * ⚠️ 组件层一样**不落地**：它只报"用户要删第几条"，写盘 / 挪记录 / 草稿键重映射全由宿主做
   * （与 `unreview` / `dropReview` 同一分工）。
   */
  (e: 'deleteEntry', index: number): void
  /**
   * 第 5 批 5d-2：页头「新增框」开关被点了（父层用**同一个 ref** 接住）。
   *
   * 组件不认识"开着之后图上的手势变成什么"，也不自己去改状态 —— 与 `update:mode` 同一条写法。
   */
  (e: 'update:addFrameMode', value: boolean): void
}>()

const labels = computed<LabelPlusLabel[]>(() => props.entry?.labels ?? [])

/** 这一栏现在该显示哪一种状态。 */
const state = computed<'loading' | 'error' | 'not-found' | 'empty-page' | 'list'>(() => {
  // 第一次读完之前只有"读取中"这一种说法（三态结果还没到）
  if (!props.result) return 'loading'
  if (props.result.status === 'error') return 'error'
  if (props.result.status === 'not-found') return 'not-found'
  return labels.value.length > 0 ? 'list' : 'empty-page'
})

/** 空态那一句话（事实，不劝、不猜）。 */
const emptyMessage = computed<string>(() => {
  if (state.value === 'loading') return '译文读取中…'
  if (state.value === 'error') return props.result?.message || '读不了这一话的译文'
  if (state.value === 'not-found') return props.result?.message || '未找到译文'
  return '本页无译文'
})

/** 用的是哪一份 txt —— 目录里有多份时这条是唯一能看出"取了哪份"的地方。 */
const sourceLabel = computed<string>(() => {
  const file = props.result?.file
  return props.result?.status === 'ok' && file ? `译文来源：${file.name}` : ''
})

function rowText(label: LabelPlusLabel | undefined): string {
  return String(label?.text ?? '').trim()
}

function labelAt(index: number): LabelPlusLabel | undefined {
  return labels.value.find((label) => label.index === index)
}

function isChanged(index: number): boolean {
  return props.changedIndices.includes(index)
}

const isReviewMode = computed(() => props.mode === 'review')

/** 这一条校对过没有（有记录才有铅笔 / 才有"上原下校"）。 */
function reviewFor(index: number): { originalText: string; reason: string } | undefined {
  return props.reviews[index]
}

function reasonFor(index: number): string {
  return String(props.reviews[index]?.reason ?? '').trim()
}

/** 「翻」那一行：原文为空就照写漏翻那句（与导出同一句）。 */
function originalLine(index: number): string {
  return displayReviewOriginal(props.reviews[index]?.originalText)
}

/**
 * 一行的提示语：校对档要说清"双击会**覆盖保存**"（那不是普通编辑框）。
 *
 * ⚠️ 校对过的条目还要多说一句"**右键可撤销校对**"：✕ 按钮删掉之后（用户 2026-10-07 拍板），
 * 右键菜单是撤销校对的**唯一入口** —— 不说这一句，用户根本不知道它在那儿。
 * 没校对过的行不提（它右键没菜单，提了就是骗人）。
 */
function rowHint(label: LabelPlusLabel): string {
  const head = `${label.group} · 第 ${label.index} 条`
  const undo = reviewFor(label.index) ? '；右键可撤销校对' : ''
  return isReviewMode.value
    ? `${head}（双击写新译文，改完自动覆盖保存${undo}）`
    : `${head}（双击编辑${undo}）`
}

function reasonHint(index: number): string {
  const reason = reasonFor(index)
  return reason ? `校对理由：${reason}（点一下改）` : '点一下写校对理由'
}

/**
 * 编辑框里的文本：**只在"正在编辑哪一条"变化时**从文档取一次，之后完全由用户输入驱动。
 *
 * ⚠️ 这里**故意不跟 `props.entry`**：保存成功会重读文档 ⇒ entry 换新 ⇒ 若跟着同步，
 * 就会把用户正在别条里打的字顶掉。真正的重置点只有"换了一条要编辑"这件事。
 */
const draftText = ref('')

watch(
  () => props.editingIndex,
  () => {
    const index = props.editingIndex
    draftText.value = index === null ? '' : rowText(labelAt(index))
  },
  { immediate: true }
)

/** 提交文本（失焦 / 改完点别处）。目标永远是**正在编辑的那一条**，不会串到别条。 */
function onEditorSave(event: KeyboardEvent): void {
  if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 's') return
  event.preventDefault()
  event.stopPropagation()
  // Commit the live textarea before the workspace save shortcut checks dirty state.
  if (event.target instanceof HTMLTextAreaElement) draftText.value = event.target.value
  commitText()
}

function commitText(): void {
  const index = props.editingIndex
  if (index === null) return
  emit('editText', index, draftText.value)
}

/**
 * 开关报上来的**是分组的名字**（不是编号）—— 名字交给草稿层，
 * 真正解析成"表里第几个"由写回服务拿**刚读到的**那份表去做。
 */
function onGroupChange(groupName: string): void {
  const index = props.editingIndex
  if (index === null) return
  emit('editGroup', index, groupName)
}

/** 外部点击先写盘；失败保留浮层和草稿，避免把未保存内容藏起来。 */
const editorSaving = ref(false)
function saveAndClose(): void {
  const index = props.editingIndex
  if (index === null || editorSaving.value) return
  editorSaving.value = true
  emit('editText', index, draftText.value, (saved) => {
    editorSaving.value = false
    if (saved && props.editingIndex === index) emit('closeEditor')
  })
}
function focusEditor(event: Event): void {
  event.preventDefault()
  void nextTick(() => document.querySelector<HTMLTextAreaElement>(
    '[data-testid="translation-textarea-' + props.editingIndex + '"]'
  )?.focus({ preventScroll: true }))
}

/** 文本框里按 Esc = 放弃这一条还没提交的输入，把内容退回文档里的值。 */
function revertText(): void {
  const index = props.editingIndex
  draftText.value = index === null ? '' : rowText(labelAt(index))
}

// ── 校对理由：编辑器（点铅笔打开）＋ 悬停浮现（平时不显示） ────────────────────
/**
 * 正在写理由的那一条。**留在组件里**（与文本编辑器不同）：
 * 外面没有任何东西需要知道"理由编辑器开着没有"，多一层 props 只会多一处能写错的地方。
 */
const reasonIndex = ref<number | null>(null)
const reasonDraft = ref('')
/** 悬停在哪一条的铅笔上（**只有它 > 0 时才画出理由**）。 */

watch(reasonIndex, (index) => {
  reasonDraft.value = index === null ? '' : reasonFor(index)
})

function toggleReasonEditor(index: number): void {
  if (reasonIndex.value === index) {
    // 再点一次 = 收起：**先提交再收**（收起是卸载，卸载不触发 blur ⇒ 不提交就丢字）
    commitReason()
    reasonIndex.value = null
  } else {
    reasonIndex.value = index
  }
  // 打开编辑器时把浮层收掉：两个东西同时浮在这一行上会互相压住
}

function commitReason(): void {
  const index = reasonIndex.value
  if (index === null) return
  // 与记录里那份一样就**不再发一次**：失焦（blur）通常已经提交过一遍了，
  // 收起编辑态时再发一次就是白写一遍库。
  if (reasonDraft.value.trim() === reasonFor(index)) return
  emit('editReason', index, reasonDraft.value)
}

/** Esc = 把理由退回记录里的值（还没提交的那份丢掉）。 */
function revertReason(): void {
  const index = reasonIndex.value
  reasonDraft.value = index === null ? '' : reasonFor(index)
}

// ── 导出入口（**仅校对档出现**）＋ 它的小菜单 ─────────────────────────────────
/**
 * 菜单用**页面里的普通元素**，不是原生 popover —— 理由见文件头那条截图盲区。
 * 关它的三条路：点菜单项、按 Esc、点到页头外面。
 */
const menuOpen = ref(false)
/** 页头那一行（同时是 `overflow-x: auto` 的**滚动容器**）。 */
const headerRef = ref<HTMLElement | null>(null)
/** 整栏的根（"点外面"要按它来找那几块浮层）。 */
const rootRef = ref<HTMLElement | null>(null)

/**
 * 页头那一行**放不下**时给一个看得见的提示（2026-10-07）。
 *
 * ## 为什么需要它
 *
 * 这一行在窄窗下是真的放不下：量过 **240px 面板**里各控件合计约 **285px**
 * （「译文」24 + 档位 64 + 开关 24 + 工具条 120 + 间距 ≈ 50），**溢出约 46px**。
 * `overflow-x: auto` 让它能滚，但**滚不动的时候它长得和"就这么宽"一模一样** ——
 * 右端那截（含「另存」）被裁掉，用户只会觉得"按钮不见了"。
 *
 * ⚠️ 为什么用 JS 量而不是 CSS 的 `scroll-driven` / `:has()` 那类办法：
 * 判据必须**可被用例断言**（本仓的规矩：图只能发现"哪里不对"，几何与状态要能读出来），
 * 于是落成 `data-overflowing` 属性 —— 视觉提示由它驱动，锁也盯它。
 *
 * ⚠️ 这是**两害相权**的选择，如实记：既想让右端的按钮不被裁、又要保住"行高固定 28px
 * 不换行"这条既有保证，就只能"允许横向滚 + 明示可以滚"。真要它彻底不裁，
 * 得减控件（用户要的东西都在），或把这一栏的第 3 批定稿（`[已校 ▾｜⤓另存]` 连体）拆掉。
 */
const headerOverflowing = ref(false)

function measureHeaderOverflow(): void {
  const el = headerRef.value
  if (!el) return
  // +1 容差：亚像素布局会让 scrollWidth/clientWidth 差个零点几
  headerOverflowing.value = el.scrollWidth - el.clientWidth > 1
}

function headerScrollStyle(): Record<string, string> {
  // 放不下时在右缘做一道**渐隐**（"后面还有东西"的通用语言），并让滚动容器自己不再
  // 叠一层原生的滚动条视觉重量
  return headerOverflowing.value
    ? {
        maskImage: 'linear-gradient(to right, #000 calc(100% - 16px), transparent)',
        WebkitMaskImage: 'linear-gradient(to right, #000 calc(100% - 16px), transparent)'
      }
    : {}
}

let headerResizeObserver: ResizeObserver | null = null

/**
 * **右键哪一行**弹着菜单（`null` = 没弹）。
 *
 * 位置是"贴着那一行的右下角"（绝对定位在 `li` 里）而不是跟着鼠标 ——
 * 跟着鼠标要拿 `clientX/clientY`，而 jsdom 里那套量全是 0（本仓踩过一次），
 * 贴边定位既能测、也能拍。
 */
const rowMenuIndex = ref<number | null>(null)

/** 这一栏里某个 testid 的元素**包不包含**事件目标（判断"点的是不是它自己身上"）。 */
function hits(selector: string, target: unknown): boolean {
  if (!(target instanceof Node)) return false
  const element = rootRef.value?.querySelector(selector)
  return Boolean(element?.contains(target))
}

/**
 * 第 4 批修：**点这一栏外面就该把编辑态收掉**。
 *
 * 以前只有两个收口点（再双击同一行 / 翻页）⇒ 点别处、切档位之后编辑器一直挂着挡着列表。
 * 现在四个：**点别处**（这里）、**点别的行**（父层 pick）、**切档位**（父层 watch）、**Esc**。
 *
 * ⚠️ 理由编辑器的提交要**先做**：收起 = 卸载，而**卸载不会触发 blur** ⇒
 * 不先提交的话，用户刚敲的理由会静默丢掉。
 */
function onDocumentPointerDown(event: Event): void {
  const target = event.target
  const inHeader = Boolean(
    headerRef.value && target instanceof Node && headerRef.value.contains(target)
  )
  // 导出菜单：点在页头里别的控件上不算"点外面"
  if (!inHeader) menuOpen.value = false

  if (rowMenuIndex.value !== null) {
    const index = rowMenuIndex.value
    // 点在菜单自己身上时不动（那两枚菜单项自己会关）
    if (!hits(`[data-testid="translation-review-row-menu-${index}"]`, target)) {
      rowMenuIndex.value = null
    }
  }

  if (reasonIndex.value !== null) {
    const index = reasonIndex.value
    const inside =
      hits(`[data-testid="translation-reason-editor-${index}"]`, target) ||
      hits(`[data-testid="translation-review-icon-${index}"]`, target)
    if (!inside) {
      commitReason()
      reasonIndex.value = null
    }
  }


}

/** Esc：按"最上面那层"逐层收（右键菜单 → 理由编辑器 → 文本编辑器）。 */
function onPaneEscape(): void {
  if (rowMenuIndex.value !== null) {
    rowMenuIndex.value = null
    return
  }
  if (reasonIndex.value !== null) {
    commitReason()
    reasonIndex.value = null
    return
  }
  if (props.editingIndex !== null) emit('closeEditor')
}

/**
 * 右键某一行 ⇒ 弹小菜单。
 *
 * 第 5 批 5e 改了口径（用户拍板）：**每行都弹**。
 * · 前两项（撤销校对 / 只删记录）只有**校对过的**那条才显示（模板里按 `reviewFor` 判）——
 *   它们本来就以"这条校过"为前提，给没校过的行看等于给两个点不动的选项；
 * · **「删除译文」每行都有**（删的是这条译文，与有没有校过无关）。
 *
 * ⚠️ 没可操作内容时**把原来那个菜单收掉**（别在别处留一个悬着的浮层）—— 这条老规矩照旧。
 */
function openRowMenu(index: number): void {
  rowMenuIndex.value = rowMenuIndex.value === index ? null : index
}

function runUnreview(index: number): void {
  rowMenuIndex.value = null
  emit('unreview', index)
}

function runDropReview(index: number): void {
  rowMenuIndex.value = null
  emit('dropReview', index)
}

/** 点「删除译文」⇒ 收菜单 + 报上去（写盘与后续由宿主做）。 */
function runDeleteEntry(index: number): void {
  rowMenuIndex.value = null
  emit('deleteEntry', index)
}

/**
 * ⚠️ 这个监听**常驻**（挂载即注册），不能像第 2 批那样"只在导出菜单打开时挂上"：
 * 它现在还负责收起**右键菜单 / 理由编辑器 / 文本编辑器**三件事 ——
 * 只挂在"菜单开着"那段时间里，那三件事就永远不会被触发（真机表现：点了没反应）。
 */
onMounted(() => {
  document.addEventListener('pointerdown', onDocumentPointerDown)
  // 页头溢出的第一量（挂载时），随后尺寸一变就重量：窗口缩放、分栏拖动、档位切换都算
  measureHeaderOverflow()
  if (typeof ResizeObserver !== 'undefined' && headerRef.value) {
    headerResizeObserver = new ResizeObserver(() => measureHeaderOverflow())
    headerResizeObserver.observe(headerRef.value)
  }
})
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocumentPointerDown)
  headerResizeObserver?.disconnect()
  headerResizeObserver = null
})

function runExport(): void {
  menuOpen.value = false
  emit('exportReviews')
}

// 点锚点 / 点条目 → 右栏滚到那一条（选中变化时把对应行滚进视野）
const rowRefs = ref<Record<number, HTMLElement | null>>({})
async function scrollRowIntoView(index: number | null): Promise<void> {
  if (index === null) return
  await nextTick()
  // jsdom 里没有 scrollIntoView，所以是可选的（与 ProjectTree 那条同样的处理）
  rowRefs.value[index]?.scrollIntoView?.({ block: 'nearest' })
}
// 双击进编辑 ⇒ 右栏也滚到那一条（2026-10-07 方案 A：滚动改由**编辑态**自己触发，
// 不再靠"误设固定选中"去触发 —— 见 CompareViewer 的方案 A 记录）
watch(
  () => props.editingIndex,
  (index) => void scrollRowIntoView(index)
)

/**
 * 第 5 批 5d-2：**宿主把某一行滚进视野**（"新增之后右侧滚过去"）。
 *
 * ⚠️ **复用**上面的 `scrollRowIntoView`，**不新写第二个滚动**（本仓栽过"同一件事两处各写一份"）。
 *
 * 为什么不用 `justAddedIndex` 的 watch 顺手滚（那看起来最省事）：**连续两次新增、
 * 序号恰好相同**时 prop 没有变化 ⇒ watch 不触发 ⇒ 第二次不滚，而用户明明又加了一条。
 * 宿主每次都显式调它就没有这个问题。
 */
function scrollToIndex(index: number | null): void {
  void scrollRowIntoView(index)
}

defineExpose({ scrollToIndex })

/**
 * 第 5 批 5d-2：**新增之后那一行要滚过来**。
 *
 * 走的还是上面**同一个** `scrollRowIntoView`（不新写第二个滚动）。
 * ⚠️ 为什么还要宿主显式调一次：**连续两次新增、序号恰好相同**时 prop 没有变化 ⇒
 * watch 不触发 ⇒ 第二次不滚，而用户明明又加了一条。所以这里是"顺手"，不是唯一入口。
 */
watch(
  () => props.justAddedIndex,
  (index) => void scrollRowIntoView(index)
)

/**
 * 第 5 批 5e（用户拍板 Q3=A）：**切页 / 换话时把行菜单关掉**。
 *
 * 为什么必须：菜单三项全部**以条目序号为参数**，而序号是"**这一页的**第几条"。
 * 翻页后同一个序号指向**另一句话** —— 菜单若悬在那儿，一点就作用在别的一条上
 * （第 5 批定稿里那条"加删除会把这个风险从'删错记录'升级成'删掉另一句话'"）。
 *
 * 判据用 `result`（整份读盘结果）：翻页、换话、重读之后契约上都会换一个新的结果对象。
 */
watch(
  () => props.result,
  () => {
    rowMenuIndex.value = null
  }
)
</script>

<template>
  <!--
    ⚠️ 面板底色是 `bg-card-bg`（白面板）而**不是**灰画布：日间本 app 的惯例是"灰画布 + 白面板"，
    而这一栏原来直接坐在灰画布上 —— 于是"悬停/选中"这两种**靠底色变浅变深**提示的状态
    全都只有 1.00:1（看不出差别）。换成白面板之后它们才回到设计值（详见 tokens.css 的说明）。
  -->
  <div
    ref="rootRef"
    class="flex h-full flex-col bg-card-bg"
    data-testid="translation-pane"
    tabindex="-1"
    @keydown.esc="onPaneEscape"
  >
    <!--
      页头：`译文` + 两段式档位（翻译 / 校对）+ 右端（第 5 批：新增框开关、校对档才有「已校：N」与未保存徽标）。
      ⚠️ **高度固定 `h-7`（28px）**，与底部状态条同高：这一行原来是被最高子元素撑的，
      而校对档多的那枚「已校：N」是 32px 的 `ui-button-sm` ⇒ 切一次档位整行从 29px 跳到 41px，
      下面的列表跟着上下跳。行固定之后，行内控件一律走 **24px 档**（`h-6`）来适配。
      ⚠️ **行高 28px / 控件 24px / 顺序一字不改**（第 5 批 5d-2）：`overflow-x: auto` 只在这一行
      极窄时兜底（页头需要约 302px、窄窗可用约 238px）—— 换行会破"不闪不抖"的固定行高，
      把开关塞进状态条会破"那一行只放状态"的规矩。
      ⚠️⚠️ **外层那个 `relative` 容器是必须的**：`overflow-x: auto` 会让这一行变成滚动容器，
      而滚动容器的 `overflow-y` 实际会被算成 `auto`（CSS 规范里 visible 与 auto 不能混用）
      ⇒ 绝对定位在里面的导出菜单（`top-full`，落在这一行的**下方**）会被**裁掉**。
      所以菜单挂在**外层**、与这一行做兄弟 —— 定位盒子同尺寸（外层没有 padding/border），
      `top-full` 指的仍是这一行的底，位置一分不差。
    -->
    <div class="relative shrink-0" data-testid="translation-pane-header-block">
      <div
        ref="headerRef"
        class="flex min-h-11 items-center gap-2 overflow-x-auto border-b border-border px-3 text-xs text-text-secondary"
        :style="headerScrollStyle()"
        data-testid="translation-pane-header"
        :data-overflowing="headerOverflowing ? 'true' : 'false'"
        @keydown.esc="menuOpen = false"
      >
        <!--
          ⚠️ **对齐：左端在上、右端靠 `ml-auto` 顶到最右**（这一段 2026-10-07 被改坏过一次，
          真机截图当场抓到：`justify-end` 把「译文 · 翻译｜校对」整组一起推到右边去了，
          而右端那组因为外面那个 `justify-end` 反而贴不到右缘 —— 两头都不对）。
          恢复成原本的写法：**左端自然排、右端那组自己 `ml-auto`**。
        -->
        <span class="shrink-0">译文</span>
        <!--
          窄窗时这一组的文字**可以缩**（`min-w-0` + 里面 `truncate`）：240px 面板里它让出约 38px，
          而它让出来的正是**右边那截按钮能不能看见**的差额。
          ⚠️ 只让文字缩，**不让整行换行** —— 行高固定 28px 是第 4 批定下的承重墙。
        -->

        <!--
          第 5 批：**新增框开关**（默认关）。图标化 24px，位置在页头右端那组之前 ——
          顺序：`译文` · 档位 · …（右端）`新增框` · `[已校 ②▾ ｜ ⤓另存]` · `未保存 N 条`。
        -->

        <span class="ml-auto flex shrink-0 items-center gap-1.5">
          <!--
            **连体工具条**（用户 2026-10-06 从示意图里选定「方案 C」）：
            两枚常驻按钮合成**一条胶囊**，内部用**发丝线**分隔 —— 少一圈边框、少一次"两个小方块飘着"。
            它同时解决了另一件事：状态条右端原来孤悬着一枚「另存…」（那一行只剩它一个按钮，
            看着没来由）；现在动作都收在这一处，状态条回归"纯状态"。
            ⚠️ 高度 24px 档（`h-6`）由外层给，两段 `items-stretch` 撑满 —— 不能再出现 32px 撑高行的情况。
          -->
          <span
            class="inline-flex shrink-0 items-stretch overflow-hidden rounded-full border border-border-strong bg-card-bg"
            data-testid="translation-header-tools"
          >
            <UiButton variant="ghost" size="sm"
              v-if="isReviewMode"
              type="button"
              class="inline-flex items-center gap-0.5 px-1.5 text-[11px] font-medium text-text-secondary transition-colors hover:bg-card-bg-hover hover:text-text-primary"
              :data-open="menuOpen ? 'true' : 'false'"
              :aria-expanded="menuOpen"
              data-testid="translation-review-export"
              title="导出这一话的校对记录"
              @click="menuOpen = !menuOpen"
            >
              修改记录
              <span
                class="inline-flex h-[14px] min-w-[14px] items-center justify-center rounded-full bg-primary-soft px-0.5 text-[9px] font-semibold text-accent"
                :data-testid="'translation-review-count'"
                >{{ reviewCount }}</span
              >
              <span class="text-[8px] leading-none" aria-hidden="true">▾</span>
            </UiButton>
            <UiButton variant="ghost" size="sm"
              type="button"
              class="inline-flex items-center gap-1 px-2.5 text-[11px] text-text-secondary transition-colors hover:bg-card-bg-hover hover:text-text-primary"
              :class="isReviewMode ? 'border-l border-hairline' : ''"
              data-testid="translation-save-as"
              title="把当前翻译另存一份（不动话目录里那份）"
              @click="emit('saveAs')"
            >
              <svg
                viewBox="0 0 12 12"
                class="h-3 w-3 shrink-0"
                aria-hidden="true"
                fill="none"
                stroke="currentColor"
                stroke-width="1.4"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="M6 1.5v6M3.2 5.4 6 8.2l2.8-2.8M1.8 10.6h8.4" />
              </svg>
              另存
            </UiButton>
          </span>
          <span
            v-if="dirty"
            class="rounded-badge bg-primary-soft px-1.5 py-0.5 text-[10px] font-medium text-accent"
            data-testid="translation-dirty-badge"
            >未保存 {{ changedCount }} 条</span
          >
        </span>
      </div>

      <!--
        ⚠️ 这个菜单**必须在 `overflow-x: auto` 那一行外面**（见上面那段注释）：
        在里面会被滚动容器的 `overflow-y` 裁掉。它挂在下面这块 `relative` 容器上，
        定位盒子与那一行同尺寸 ⇒ `top-full` 仍然是"那一行的底"。
      -->
      <div
        v-if="menuOpen"
        class="absolute right-2 top-full z-30 mt-0.5 min-w-[128px] rounded-md border border-border bg-card-bg py-1 shadow-lg"
        role="menu"
        data-testid="translation-review-menu"
      >
        <UiButton variant="ghost" size="sm"
          type="button"
          role="menuitem"
          class="block w-full px-3 py-1.5 text-left text-xs text-text-primary hover:bg-card-bg-hover"
          data-testid="translation-review-export-action"
          @click="runExport"
        >
          导出校对记录…
        </UiButton>
      </div>
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto" data-testid="translation-pane-body">
      <p
        v-if="state !== 'list'"
        class="px-3 py-6 text-center text-xs leading-6"
        :class="state === 'error' ? 'text-danger' : 'text-text-tertiary'"
        data-testid="translation-pane-empty"
      >
        {{ emptyMessage }}
      </p>

      <ul v-else class="py-1">
        <li v-for="label in labels" :key="label.index" class="group relative">
          <Popover :open="editingIndex === label.index" :modal="true">
          <PopoverAnchor as-child :reference="editingIndex === label.index ? editorAnchor ?? undefined : undefined">
          <!-- ⚠️ 这个 `relative` 是给下面两个浮层当定位祖先用的（它们的 `top-full` = **这一行的底**） -->
          <div class="relative flex items-start">
            <!--
              **瞬时高亮**（第 5 批 5d-2）：「刚新增」的那一条，约 2 秒自己退掉。

              ⚠️ 它与"固定选中"**刻意长得不一样**（用户拍板，别把两者并成一套）：
              · 固定选中 = **左缘 2px accent 竖条** + 选中底色 + 字重；
              · 瞬时高亮 = **淡紫底 + accent 细描边 + 「刚新增」小标**，**没有竖条**。
              理由：竖条是"我点住了它"的语言，而这一条只是"刚刚生成"——混用会让人以为自己的点击丢了。
              它是**只读**的父层状态（`justAddedIndex`），不碰 `useTranslationSelection` 的三态。
            -->
            <span
              v-if="justAddedIndex === label.index"
              class="pointer-events-none absolute inset-0 z-0 bg-primary-soft"
              :data-testid="`translation-just-added-${label.index}`"
              aria-hidden="true"
            />
            <UiButton variant="ghost" size="sm"
              type="button"
              class="relative z-10 h-auto min-h-12 whitespace-normal flex min-w-0 flex-1 justify-start items-start gap-2 border-l-2 py-1.5 pr-2 text-left text-xs leading-5 transition-colors"
              :class="
                activeIndex === label.index
                  ? 'border-accent bg-selected-bg font-medium'
                  : 'border-transparent hover:bg-card-bg-hover'
              "
              :data-testid="`translation-row-${label.index}`"
              :data-active="activeIndex === label.index ? 'true' : 'false'"
              :data-changed="isChanged(label.index) ? 'true' : 'false'"
              :data-reviewed="reviewFor(label.index) ? 'true' : 'false'"
              :data-readonly="isReviewMode ? 'true' : 'false'"
              :data-just-added="justAddedIndex === label.index ? 'true' : 'false'"
              :title="rowHint(label)"
              :ref="
                (el) => {
                  rowRefs[label.index] = ((el as any)?.$el ?? el) as HTMLElement | null
                }
              "
              @click="emit('pick', label.index)"
              @dblclick="emit('edit', label.index)"
              @contextmenu.prevent="openRowMenu(label.index)"
              @pointerenter="emit('hover', label.index)"
              @pointerleave="emit('hover', null)"
              @focus="emit('hover', label.index)"
              @blur="emit('hover', null)"
            >
              <TranslationEntryBadges
                :index="label.index" :group="label.group" :groups="groups"
              />

              <!--
                **校对档 + 校对过的条目** ⇒ 上原下校：两行、**不共用一个框**、
                中间只有一条细分割线（线以上弱化、线以下加重）。
              -->
              <span
                v-if="isReviewMode && reviewFor(label.index)"
                class="mt-1 flex min-w-0 flex-1 flex-col text-sm leading-5"
                :data-testid="`translation-review-compare-${label.index}`"
              >
                <span
                  class="whitespace-pre-wrap break-words text-text-tertiary"
                  :data-testid="`translation-review-original-${label.index}`"
                  >翻：{{ originalLine(label.index) }}</span
                >
                <span
                  class="my-0.5 block border-t border-hairline"
                  :data-testid="`translation-review-divider-${label.index}`"
                  aria-hidden="true"
                />
                <span
                  class="whitespace-pre-wrap break-words font-medium text-text-primary"
                  :data-testid="`translation-review-reviewed-${label.index}`"
                  >校：{{ rowText(label) || '（未填写）' }}</span
                >
              </span>
              <span
                v-else
                class="mt-1 min-h-10 min-w-0 flex-1 whitespace-pre-wrap break-words text-sm leading-5"
                :class="rowText(label) ? 'text-text-primary' : 'text-text-tertiary'"
                >{{ rowText(label) || '（未填写）' }}</span
              >
              <span
                v-if="isChanged(label.index)"
                class="mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full bg-accent"
                :data-testid="`translation-row-changed-${label.index}`"
                aria-hidden="true"
              />
              <!-- 「刚新增」小标：瞬时高亮的第二半（底色在行下面那层），与固定选中的竖条刻意不同 -->
              <span
                v-if="justAddedIndex === label.index"
                class="relative z-20 mt-[3px] shrink-0 rounded-badge border border-accent bg-card-bg px-1 py-px text-[9px] font-medium text-accent"
                :data-testid="`translation-just-added-badge-${label.index}`"
                >刚新增</span
              >
            </UiButton>

            <!--
              **行尾那一格 = 铅笔**（只有校对过的条目才有它；其余留等宽空档，免得整页文字左右跳）。

              ⚠️ 位置与对齐（两条真机反馈叠出来的，别退回）：
              · 落**「校」那一格的右侧**（不是"跟『翻』那一行齐平"）；
              · **`self-stretch` 是这条对齐的承重墙，别删**：父级是 `items-start` ⇒ 这一格默认
                只有内容那么高，里面的 `items-end` 就变成"对着空气对齐"（真机现场：class 变了、位置纹丝不动）。
              · 宽度 24px（一枚 20px 圆钮），**不吃正文的宽度**。

              ⚠️ **这里原来还有一枚 ✕（撤销校对）—— 用户 2026-10-07 拍板删掉了**：
              "有右键选择就不用按钮了"。撤销校对的入口现在**只有**右键那一行的菜单
              （两项：撤销校对 / 只删记录，见下面那个菜单块）。
              ⇒ **不要再把 ✕ 加回来**（本轮加了一条负向锁盯着）；行按钮上的 `@contextmenu` 是唯一入口。
            -->
            <span
              class="flex w-6 shrink-0 self-stretch items-end justify-center pb-1"
              :data-testid="`translation-review-gutter-${label.index}`"
            >
              <!--
                **铅笔三态**（2026-10-07 用户拍板，方案 G：让"已有理由"这个状态可见）
                ⚠️ 状态靠**图标本身的形状**（空心 ↔ 实心）说话，而不是把它升成强色，
                也不是在旁边再加一个图形 —— 理由见下面 `svg` 那段注释与用例里的表。
              -->
              <UiButton variant="ghost" size="sm"
                v-if="reviewFor(label.index)"
                type="button"
                class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full transition-colors"
                :class="
                  reasonIndex === label.index
                    ? 'bg-accent text-text-on-accent'
                    : reasonFor(label.index)
                      ? 'bg-primary-soft text-accent hover:bg-primary-soft-hover'
                      : 'bg-transparent text-text-tertiary hover:bg-card-bg-hover hover:text-text-secondary'
                "
                :data-testid="`translation-review-icon-${label.index}`"
                :data-editing="reasonIndex === label.index ? 'true' : 'false'"
                :aria-pressed="reasonIndex === label.index"
                :title="reasonHint(label.index)"
                @click.stop="toggleReasonEditor(label.index)"
              >
                <!--
                  **形状 = 状态**：有理由 ⇒ `fill-current`（铅笔实心）；没理由 ⇒ `fill-none`（只有线条）。
                  ⚠️ 为什么用"空↔满"而不是"换个颜色"：三级按钮语言里主色实心是最高级
                  （全栏只有「保存」一枚实心），把弱入口升成主色会跟保存抢重量。
                  "空↔满"是系统里已有的状态语言（`StatusDot` 就是实心点/空心圈），
                  而且**零尺寸变化**（24px 那一格与窄窗都不受影响）。
                -->
                <svg
                  viewBox="0 0 16 16"
                  class="h-3 w-3"
                  aria-hidden="true"
                  :class="reasonFor(label.index) ? 'fill-current' : 'fill-none'"
                >
                  <path
                    d="M11.2 1.9a1.5 1.5 0 0 1 2.1 0l.8.8a1.5 1.5 0 0 1 0 2.1l-8 8-3.4.9.9-3.4 8-8Z"
                    stroke="currentColor"
                    stroke-width="1.4"
                    stroke-linejoin="round"
                  />
                </svg>
              </UiButton>
            </span>

            <!--
              ⚠️ **这里原来有一个"悬停浮现理由"的浮层 —— 2026-10-07 用户拍板删掉了（方向 B）**：
              悬停铅笔时它和**铅笔自己的原生提示**（`title`）会**同时**弹出，同一句话画两遍
              （真机截图里一眼可见的视觉噪音）。留原生那一个就够：它**键盘 Tab 聚焦时也会弹**，
              键盘用户照样看得到全文；点开编辑器则是第三个出口。
              ⇒ **不要再把这个浮层加回来**（本轮加了一条负向锁盯着：
              整栏不许再出现 `translation-reason-popover-*`）。
            -->

            <!--
            右键这一行 ⇒ 小菜单两项。**它是页面里的普通元素**（不是原生 popover），
            与导出菜单同一套做法：点外面 / Esc 都能收，截图也拍得到。
          -->
            <div
              v-if="rowMenuIndex === label.index"
              class="absolute right-3 top-full z-30 -mt-1 min-w-[196px] rounded-md border border-border bg-card-bg py-1 shadow-lg"
              role="menu"
              :data-testid="`translation-review-row-menu-${label.index}`"
            >
              <!-- 前两项：只有**校对过的**那条才显示（它们以"这条校过"为前提） -->
              <UiButton variant="ghost" size="sm"
                v-if="reviewFor(label.index)"
                type="button"
                role="menuitem"
                class="block w-full px-3 py-1.5 text-left text-xs text-text-primary hover:bg-card-bg-hover"
                :data-testid="`translation-review-row-unreview-${label.index}`"
                @click="runUnreview(label.index)"
              >
                撤销校对（把原文写回 txt）
              </UiButton>
              <UiButton variant="ghost" size="sm"
                v-if="reviewFor(label.index)"
                type="button"
                role="menuitem"
                class="block w-full px-3 py-1.5 text-left text-xs text-text-secondary hover:bg-card-bg-hover"
                :data-testid="`translation-review-row-drop-${label.index}`"
                @click="runDropReview(label.index)"
              >
                只删记录（保留现在的译文）
              </UiButton>
              <!--
                **第三项：删除译文**（第 5 批 5e，用户拍板）。
                · **每行都有**（与有没有校过无关）；
                · 文案**短、不带括号**，完整解释放 `title`（用户追的那条要求）；
                · 危险动作用 danger 色，与上面两项的"弱/次"层级分开。
              -->
              <UiButton variant="ghost" size="sm"
                type="button"
                role="menuitem"
                class="block w-full px-3 py-1.5 text-left text-xs text-danger hover:bg-card-bg-hover"
                :data-testid="`translation-row-delete-${label.index}`"
                title="把这一条译文从 txt 里删掉（后续条目序号自动重排；删错了可以 Ctrl+Z 撤回）"
                @click="runDeleteEntry(label.index)"
              >
                删除译文
              </UiButton>
            </div>
          </div>

          </PopoverAnchor>
          <!-- 悬浮编辑器通过 Portal 脱离列表布局，并自动避让窗口边缘。 -->
          <PopoverContent
            v-if="editingIndex === label.index"
            class="w-[min(420px,calc(100vw-24px))] max-h-[var(--reka-popover-content-available-height)] overflow-auto p-3"
            :side="editorAnchor ? 'right' : 'bottom'" :align="editorAnchor ? 'start' : 'end'" :collision-padding="12"
            @open-auto-focus="focusEditor"
            @close-auto-focus.prevent
            @interact-outside.prevent="saveAndClose"
            @escape-key-down.prevent="revertText(); emit('closeEditor')"
            :data-testid="`translation-editor-${label.index}`"
          >
            <!--
              分组开关：滑块形态，就坐在原来那个下拉的位置（用户框选处）；
              **没有「分组」二字** —— 按钮上写着「框内 / 框外」，一看就懂。
              显示的是**草稿里的有效值**（`groupOverrides`），不是文档里的旧值。
            -->
            <div class="mb-1 flex items-center">
              <TranslationGroupToggle
                :index="label.index"
                :groups="groups"
                :value="groupOverrides[label.index] ?? label.group"
                @change="onGroupChange"
              />
            </div>
            <Textarea
              v-model="draftText"
              rows="3"
              class="w-full resize-y rounded-md border border-border bg-card-bg px-2 py-1 text-xs leading-5 text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              :data-testid="`translation-textarea-${label.index}`"
              placeholder="这一条的译文（可多行）"
              @keydown="onEditorSave"
              :disabled="editorSaving"
            />
            <p class="mt-2 text-xs text-muted-foreground" role="status">{{ editorSaving ? '保存中…' : notice || '点击框外保存并关闭 · Ctrl+S 保存' }}</p>
          </PopoverContent>
          </Popover>

          <!--
            理由编辑器（点行首那枚铅笔打开）。**与文本编辑器分开**：
            它写的东西**只进数据库**，永远不写进 txt —— 所以这里明说一句，
            免得用户以为理由也会跟着发出去。
          -->
          <div
            v-if="reasonIndex === label.index"
            class="border-b border-hairline bg-app-bg px-3 pb-2 pt-1"
            :data-testid="`translation-reason-editor-${label.index}`"
          >
            <Textarea
              v-model="reasonDraft"
              rows="2"
              class="w-full resize-y rounded-md border border-border bg-card-bg px-2 py-1 text-xs leading-5 text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              :data-testid="`translation-reason-textarea-${label.index}`"
              placeholder="校对理由 / 评价"
              @change="commitReason"
              @blur="commitReason"
              @keydown.esc.stop="revertReason"
            />
            <p class="pt-1 text-[10px] leading-4 text-text-tertiary">
              理由只存在本机记录里，不会写进 txt，也不会发给别人（导出文件里才有）。
            </p>
          </div>
        </li>
      </ul>
    </div>

    <!--
      底部状态条 —— **永远存在、高度固定**（2026-10-06 真机反馈："切换时会闪现保存流程
      让屏幕闪烁和抖动"）。
      ⚠️ 真因：草稿条 / 提示 / 来源原来是**三条各带 `v-if`**，它们进出文档流会让
      **列表区高度连跳三次**（点一下开关：+34px → -34px → +22px）。
      现在三条**共用这一行**：文字换、**高度不换**；按钮用 `v-if` 出现在 `mr-auto` 的右端，
      不会推动左边的字。谁再给这一行加 `v-if` 或条件高度，等于把抖动加回来。
    -->
    <div
      class="flex min-h-10 shrink-0 items-center gap-1.5 border-t border-border bg-muted px-2"
      data-testid="translation-status-bar"
    >
      <span
        class="mr-auto min-w-0 truncate text-[11px]"
        :class="notice ? 'text-text-secondary' : 'text-text-tertiary'"
        data-testid="translation-status-text"
      >
        {{ notice || (dirty ? `已改 ${changedCount} 条` : sourceLabel) }}
      </span>
      <!--
        2026-10-07：**本会话还有可退的保存**（Ctrl+Z 每按一次退一步，退到本会话开始为止）。
        ⚠️ 它只表示"有/无" —— **不做步数显示、也不是按钮**（用户拍板）。
        那一行的高与静是"不闪不抖"的保证，所以这里只是一枚 10px 的弱色小标。
      -->
      <span
        v-if="canUndoSaved"
        class="shrink-0 text-[10px] text-text-tertiary"
        data-testid="translation-undo-saved-hint"
        title="Ctrl+Z 可以回退本会话在这份 txt 上的保存（每按一次退一步）"
        >↶ 可退</span
      >
      <!--
        ⚠️ 这里原来有一枚常驻的「另存…」（第 3 批）。用户 2026-10-06 选定的方案把它
        **收进页头那条连体工具条**了 ⇒ 这一行回归"纯状态"（左边来源 / 右边只在有未保存
        改动时出现 撤销·放弃·保存）。别再往这一行加常驻按钮 —— 那一行的高与静是"不闪不抖"
        的保证，而"孤悬一枚按钮"正是这次要治的观感。
      -->
      <template v-if="dirty">
        <UiButton variant="ghost" size="sm"
          type="button"
          class="shrink-0"
          data-testid="translation-undo"
          @click="emit('undo')"
        >
          撤销
        </UiButton>
        <!--
          破坏性相邻的那一枚：**只有文字带色**（悬停才出浅 danger 底）——
          底仍然中性，免得把这一行唯一的实心主按钮「保存」压下去。
        -->
        <UiButton variant="ghost" size="sm"
          type="button"
          class="shrink-0"
          data-testid="translation-discard"
          @click="emit('discard')"
        >
          放弃
        </UiButton>
        <UiButton variant="default" size="sm"
          type="button"
          class="shrink-0"
          :disabled="saving"
          data-testid="translation-save"
          @click="emit('save')"
        >
          {{ saving ? '保存中…' : '保存' }}
        </UiButton>
      </template>
    </div>
  </div>
</template>
