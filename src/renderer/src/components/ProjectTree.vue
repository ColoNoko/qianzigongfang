<script setup lang="ts">
// ProjectTree — presentational parent/child tree (漫画 → 集).
// Mirrors oldcode/ui/widgets/tree_preview.py: setIndentation(20), parent rows
// bold + accent, children regular + text_primary. No fs, no business logic —
// parents come from the store; this component only renders and emits.
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { ParentProject, ChildProject, WorkMode } from '@shared/types'
import {
  compareChapterNumbersByOrder,
  formatChapterNumber,
  type ChildSortOrder
} from '@shared/chapter'
import { childModeProgress } from '@shared/status'
import { WORK_MODE_LABELS, WORK_MODE_SHORT_LABELS, WORK_MODES } from '@shared/modes'
import { MAX_PARENT_DUTIES, normalizeDuties, toggleDuty } from '@shared/duties'

const props = withDefaults(
  defineProps<{
    parents: ParentProject[]
    activeChildId?: string | null
    multiSelect?: boolean
    markedChildIds?: string[]
    childSortOrder?: ChildSortOrder
    /** Selects which mode the per-row progress figure describes. */
    mode?: WorkMode
    /**
     * Renders the per-parent 刷新并检测新章节 button. Only the workbench
     * sidebar can act on it (its host owns the self-check flow), so the 项目
     * picker host turns it off rather than leaving a button that does nothing.
     */
    showSelfCheck?: boolean
    /**
     * 进入某一话时，自动展开它所属的父级，并把那一行滚进视野。
     *
     * 默认 false：「项目」列表页必须保持"全部收起"（交接文档 §4.4，
     * `ProjectIndex.spec` 锁着这件事），所以这个行为只能由工作台侧栏显式打开。
     * 用户手动折叠之后不会被重新展开 —— 这里只监听 activeChildId 的变化。
     */
    revealActiveChild?: boolean
    /**
     * 展开的父级在滚动时吸顶：钉在侧栏工具栏正下方那一行。
     *
     * 默认 false：「项目」列表页的树在一个 `overflow-hidden` 卡片里、由整页滚动，
     * 吸顶只会把父级行糊到页面标题上。只有工作台侧栏显式打开它。
     *
     * 位置为什么刚好是工具栏下方：工具栏在滚动口外面，所以树里 `top: 0`
     * 就是"工具栏正下方那一行"，不需要减工具栏高度。详见
     * `docs/侧栏父级吸顶-优化方案.md` §2。
     */
    stickyParentHeader?: boolean
    /**
     * 每本漫画的「职责」（这一本归我干哪几道工序，1~2 个模式），键是父级 id。
     *
     * 由宿主算好传进来（`useParentDuties()`：声明过的优先，没声明过按已有标记推断）——
     * 组件不认识"推断"，只负责画。缺省 / 空数组 = 只占位、不画标签。
     */
    parentDuties?: Record<string, WorkMode[]>
  }>(),
  {
    mode: 'typeset',
    showSelfCheck: true,
    revealActiveChild: false,
    stickyParentHeader: false,
    parentDuties: undefined
  }
)

const emit = defineEmits<{
  (e: 'select', parentId: string, childId: string): void
  (e: 'expand', id: string, expanded: boolean): void
  (e: 'renameParent', parentId: string, title: string): void
  (e: 'toggleChildMark', childId: string): void
  (e: 'toggleParentMark', parentId: string, childIds: string[]): void
  (e: 'reorderParent', sourceParentId: string, targetParentId: string): void
  (e: 'selfCheck', parentId: string): void
  (e: 'setDuties', parentId: string, duties: WorkMode[]): void
}>()

// --- 职责标签（2026-10-03）---------------------------------------------------
/** 当前打开了哪个父级的职责菜单（同一时刻只开一个）。 */
const dutyMenuParentId = ref<string | null>(null)

function dutiesOf(parentId: string): WorkMode[] {
  // 过一遍规范顺序（嵌 → 翻 → 校 → 监）：显示顺序不许由"调用方给什么顺序"决定，
  // 否则同一份数据在两个宿主里可能长得不一样。
  return normalizeDuties(props.parentDuties?.[parentId] ?? [])
}

function dutyLabel(parent: ParentProject): string {
  const duties = dutiesOf(parent.id)
  const text = duties.length
    ? duties.map((mode) => WORK_MODE_LABELS[mode]).join(' + ')
    : '未设置'
  return `职责：${text}（点击设置，最多 ${MAX_PARENT_DUTIES} 个）`
}

function toggleDutyMenu(parentId: string): void {
  dutyMenuParentId.value = dutyMenuParentId.value === parentId ? null : parentId
}

function closeDutyMenu(): void {
  dutyMenuParentId.value = null
}

/** 某个模式在菜单里是否被禁用：已经选满两个、而这个没被选中。 */
function isDutyOptionDisabled(parentId: string, mode: WorkMode): boolean {
  const duties = dutiesOf(parentId)
  return duties.length >= MAX_PARENT_DUTIES && !duties.includes(mode)
}

function onDutyOption(parentId: string, mode: WorkMode): void {
  if (isDutyOptionDisabled(parentId, mode)) return
  emit('setDuties', parentId, toggleDuty(dutiesOf(parentId), mode))
}

/**
 * 点菜单**外面**才关掉它。
 *
 * ⚠️ 这里**不许用模板 ref 判断"点在不在菜单里"**（2026-10-03 审查修复）：
 * 这个组件是 v-for 渲染父级行的，而 **v-for 内部的模板 ref 在 Vue 3 里是元素数组**，
 * 数组没有 `contains` ⇒ 每次 pointerdown 都抛
 * `TypeError: dutyMenuRoot.value?.contains is not a function`，`closeDutyMenu()`
 * 根本不执行 —— 于是"点外面关闭"永久失效、控制台每次点击都多一条未捕获错误。
 *
 * ⚠️ 范围是**整个槽**（胶囊 + 菜单），不是"只有菜单"（2026-10-03 二次修正）：
 * 只排除菜单的话，点胶囊时 pointerdown 会先把菜单关掉、紧接着 click 的 toggle
 * 又把它打开 ⇒ **再点胶囊永远关不掉**（用户实测报回来的就是这一条）。
 * 槽内一律不动，让 click 的 toggle 说了算。
 */
function onDutyDocumentPointerDown(event: PointerEvent): void {
  const target = event.target
  if (target instanceof Element && target.closest('[data-testid="parent-duty-slot"]')) return
  closeDutyMenu()
}

function onDutyKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') closeDutyMenu()
}

onMounted(() => document.addEventListener('pointerdown', onDutyDocumentPointerDown))
onBeforeUnmount(() => document.removeEventListener('pointerdown', onDutyDocumentPointerDown))

// Expanded parent IDs — internal UI state, not persisted.
//
// Every parent starts collapsed and only a deliberate click on a row / chevron
// opens one. There is intentionally no "auto-expand the active child's parent"
// watcher: opening the workbench (or arriving from the project list) must not
// silently unfold a project the user never opened. `activeChildId` is still
// used to highlight the row once its parent is open — see the row classes.
const rootEl = ref<HTMLElement | null>(null)
const expandedIds = ref<Set<string>>(new Set())
const editingParentId = ref<string | null>(null)
const editingTitle = ref('')
const draggingParentId = ref<string | null>(null)
const dragOverParentId = ref<string | null>(null)

// Numeric chapters first, custom/Chinese chapter labels afterwards.
function sortedChildren(parent: ParentProject): ChildProject[] {
  return [...parent.children].sort((a, b) =>
    compareChapterNumbersByOrder(
      a.chapterNumber,
      b.chapterNumber,
      props.childSortOrder ?? 'ascending'
    )
  )
}

function isExpanded(id: string): boolean {
  return expandedIds.value.has(id)
}

function toggleExpandOnly(parent: ParentProject): void {
  const next = !isExpanded(parent.id)
  if (next) expandedIds.value.add(parent.id)
  else expandedIds.value.delete(parent.id)
  expandedIds.value = new Set(expandedIds.value)
  emit('expand', parent.id, next)
}

function onParentClick(parent: ParentProject): void {
  if (props.multiSelect) {
    emit(
      'toggleParentMark',
      parent.id,
      parent.children.map((child) => child.id)
    )
    return
  }
  toggleExpandOnly(parent)
}

function selectChild(parent: ParentProject, child: ChildProject): void {
  if (props.multiSelect) {
    emit('toggleChildMark', child.id)
    return
  }
  emit('select', parent.id, child.id)
}

function isChildMarked(childId: string): boolean {
  return props.markedChildIds?.includes(childId) ?? false
}

function isParentMarked(parent: ParentProject): boolean {
  return parent.children.length > 0 && parent.children.every((child) => isChildMarked(child.id))
}

/**
 * 父级行的状态类（吸顶相关）。三条都有实测依据（本机 Edge 无头 + 真实编译 CSS）：
 *
 * ① `sticky top-0 z-10` —— 相对最近的滚动口（树容器）定位，而工具栏在滚动口外面，
 *    所以吸顶位置正好落在"工具栏正下方那一行"。收起的父级不必特判：它的容器只有
 *    一行高，sticky 自然没有活动空间。
 * ② 底色必须不透明：吸顶行是盖在滚动内容上的（实测滚到 600px 时，第 14 话整行落在
 *    表头 0..41px 这一段里）。它与"多选标记"写成互斥，而不是两个类都挂、靠 CSS 顺序
 *    决胜负 —— 编译产物里 `.bg-card-bg` 恰好排在 `.bg-selected-bg` 之前（后者赢），
 *    但那是 Tailwind 的输出顺序、不是契约，换一次构建就可能翻过来。
 * ③ 吸顶 + 展开时补 1px 细线：吸顶那一刻它是"表头 / 正文"的唯一分界；没有它，
 *    被压在下面的半行文字看起来像渲染错位。收起时不加（外层已经有 `border-b`，
 *    再加一条就是 1px 挨 1px 的双线）。
 *    **这条也必须跟着 `stickyParentHeader` 走**：它存在的唯一理由是吸顶，而
 *    「项目」列表页（sticky 关闭）本来是"父级行 + 子行列表"的连续白底；在那里补一条
 *    线等于把只属于侧栏的样式漏到另一个页面（`ProjectIndex.spec` 有守卫用例盯着）。
 */
function parentRowClasses(parent: ParentProject): Array<string | false> {
  return [
    props.stickyParentHeader && 'sticky top-0 z-10',
    // 职责菜单打开时，这一行必须**压过后面那些粘顶的行**（它们同样是 z-10 的
    // 层叠上下文，晚出现的会盖住先出现的）—— 现场：菜单被下面的项目挡住。
    dutyMenuParentId.value === parent.id && 'z-30',
    isParentMarked(parent)
      ? 'bg-selected-bg ring-1 ring-inset ring-selected-border'
      : props.stickyParentHeader && 'bg-card-bg',
    props.stickyParentHeader && isExpanded(parent.id) && 'border-b border-hairline'
  ]
}

function progressText(child: ChildProject): string {
  const progress = childModeProgress(child, props.mode)
  return `${WORK_MODE_LABELS[props.mode]}进度${progress.done}/${progress.total}`
}

/**
 * Width of the micro progress bar next to the per-row figure.
 *
 * The bare "嵌字进度0/24" string was the only status a row carried, and a column
 * of them reads as a wall of grey text — you cannot see at a glance which
 * chapters are actually finished. The label itself must stay byte-identical
 * (ProjectTree.spec matches on `嵌字进度1/2`), so the bar is added *next to* it
 * and carries no text of its own.
 */
function progressWidth(child: ChildProject): string {
  const { pct } = childModeProgress(child, props.mode)
  if (pct === null || !Number.isFinite(pct)) return '0%'
  return `${Math.max(0, Math.min(100, pct))}%`
}

function startParentEdit(parent: ParentProject): void {
  editingParentId.value = parent.id
  editingTitle.value = parent.title
  void nextTick(() => {
    const input = document.querySelector<HTMLInputElement>(`[data-parent-edit-id="${parent.id}"]`)
    input?.focus()
    input?.select()
  })
}

function commitParentEdit(parent: ParentProject): void {
  if (editingParentId.value !== parent.id) return
  const nextTitle = editingTitle.value.trim()
  editingParentId.value = null
  editingTitle.value = ''
  if (!nextTitle || nextTitle === parent.title) return
  emit('renameParent', parent.id, nextTitle)
}

function cancelParentEdit(): void {
  editingParentId.value = null
  editingTitle.value = ''
}

function onParentDragStart(event: DragEvent, parentId: string): void {
  if (!props.multiSelect) {
    event.preventDefault()
    return
  }
  draggingParentId.value = parentId
  dragOverParentId.value = parentId
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', parentId)
  }
}

function onParentDragOver(event: DragEvent, parentId: string): void {
  if (!props.multiSelect || !draggingParentId.value) return
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
  dragOverParentId.value = parentId
}

function onParentDrop(event: DragEvent, targetParentId: string): void {
  if (!props.multiSelect) return
  event.preventDefault()
  const sourceParentId = draggingParentId.value || event.dataTransfer?.getData('text/plain') || null
  if (sourceParentId && sourceParentId !== targetParentId) {
    emit('reorderParent', sourceParentId, targetParentId)
  }
  draggingParentId.value = null
  dragOverParentId.value = null
}

function clearParentDrag(): void {
  draggingParentId.value = null
  dragOverParentId.value = null
}

watch(
  () => props.multiSelect,
  (enabled) => {
    if (!enabled) cancelParentEdit()
  }
)

/**
 * 工作台侧栏专用：跟着 activeChildId 展开父级 + 滚动定位。
 *
 * 用户报的痛点：从列表点进某一话后，左侧树全是收起的，"我在哪"完全看不见。
 * §4.4 删掉的是"任何进入工作台的路径都自动展开"（列表页会因此看起来像全展开），
 * 所以这里做成显式开关，只由工作台侧栏打开。
 *
 * `scrollIntoView` 在 jsdom 里不存在（未实现），必须可选调用，否则单测全红。
 */
watch(
  () => [props.activeChildId, props.revealActiveChild] as const,
  async ([childId, reveal]) => {
    if (!reveal || !childId) return
    const parent = props.parents.find((item) =>
      item.children.some((child) => child.id === childId)
    )
    if (!parent) return
    if (!expandedIds.value.has(parent.id)) {
      expandedIds.value.add(parent.id)
      expandedIds.value = new Set(expandedIds.value)
    }
    await nextTick()
    rootEl.value
      ?.querySelector<HTMLElement>(`[data-child-id="${childId}"]`)
      ?.scrollIntoView?.({ block: 'nearest' })
  },
  { immediate: true }
)
</script>

<template>
  <div ref="rootEl" class="select-none text-text-primary">
    <div
      v-for="parent in parents"
      :key="parent.id"
      class="border-b border-border transition-colors"
      :class="dragOverParentId === parent.id ? 'border-t-2 border-t-accent bg-selected-bg/50' : ''"
      :draggable="Boolean(multiSelect)"
      :data-parent-id="parent.id"
      @dragstart="onParentDragStart($event, parent.id)"
      @dragover="onParentDragOver($event, parent.id)"
      @drop="onParentDrop($event, parent.id)"
      @dragend="clearParentDrag"
    >
      <!-- Parent row: bold + whole row toggles expand (chevron is visual).
           标题用中性色而不是 accent：旧版每个父级都是"紫色加粗标题"，
           一屏五个父级就有五个视觉焦点，反而看不出"我现在在哪一话"。
           强调色留给下面的当前话（左侧竖条 + 紫字）。`font-bold` 类名被
           ProjectTree.spec 锁着，只能改颜色不能去掉字重。
           吸顶 / 底色 / 细线由 parentRowClasses() 给 —— 三条为什么不能拆开，见那个函数的注释。 -->
      <div
        class="group flex cursor-pointer items-center gap-1.5 px-2 py-2 text-[13px] font-bold text-text-primary transition-colors hover:bg-card-bg-hover"
        :class="parentRowClasses(parent)"
        @click="onParentClick(parent)"
        @dblclick.stop="toggleExpandOnly(parent)"
      >
        <button
          class="flex h-4 w-4 shrink-0 items-center justify-center text-text-tertiary transition-colors group-hover:text-text-primary"
          :aria-label="isExpanded(parent.id) ? '折叠子项目' : '展开子项目'"
          @click.stop="toggleExpandOnly(parent)"
          @dblclick.stop
        >
          <svg
            class="h-3 w-3 transition-transform"
            :class="isExpanded(parent.id) ? 'rotate-90' : ''"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.5"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
        <!-- 职责槽（2026-10-03）：取代原来那个"展开状态"小圆点 —— 那件事左边箭头
             已经在说，位置让给"这一本归我干哪几道工序"。
             ⚠️ 槽宽**固定**（`w-[30px]`，触发区本身），没职责也占位：这样名字永远
             落在同一条竖线上（图②暴露过"名字起点漂"）。改宽度前先看那批对照图。 -->
        <div class="relative shrink-0" data-testid="parent-duty-slot">
          <!-- 触发区 30×24（与行内刷新按钮同族）；视觉胶囊 18px 高、居中，
               多出来的 3px 上下只是"好点"，行高 41px 不受影响。 -->
          <button
            type="button"
            class="flex h-6 w-[30px] items-center justify-start rounded-badge transition-colors hover:bg-card-bg-pressed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            :aria-label="dutyLabel(parent)"
            :title="dutyLabel(parent)"
            data-testid="parent-duty-chip"
            :data-duty-count="dutiesOf(parent.id).length"
            @click.stop="toggleDutyMenu(parent.id)"
            @dblclick.stop
          >
            <!-- 一枚胶囊装 1~2 个字（原语 = styles/index.css 的 .duty-chip）：
                 单职责 15px、双职责 30px；两段都"未选"时中间留一道 1px 缝，
                 否则「校监」会粘成一个词。没职责时整枚胶囊不渲染（只剩触发区占位）。 -->
            <span
              v-if="dutiesOf(parent.id).length > 0"
              class="duty-chip"
              :class="dutiesOf(parent.id).length > 1 ? 'duty-chip--pair' : 'duty-chip--single'"
              data-testid="parent-duty-pill"
            >
              <span
                v-for="(dutyMode, index) in dutiesOf(parent.id)"
                :key="dutyMode"
                class="duty-chip__seg"
                :class="
                  index === 0 && dutiesOf(parent.id).length > 1 ? 'duty-chip__seg--divide' : ''
                "
                :data-testid="`parent-duty-${dutyMode}`"
              >{{ WORK_MODE_SHORT_LABELS[dutyMode] }}</span>
            </span>
          </button>

          <div
            v-if="dutyMenuParentId === parent.id"
            class="absolute left-0 top-full z-[80] mt-1 w-32 rounded-lg border border-border bg-card-bg p-1 shadow-[var(--shadow-2)]"
            role="menu"
            data-testid="parent-duty-menu"
            @keydown="onDutyKeydown"
          >
            <button
              v-for="option in WORK_MODES"
              :key="option"
              type="button"
              role="menuitemcheckbox"
              class="flex w-full items-center gap-2 whitespace-nowrap rounded-badge px-2 py-1.5 text-left text-[12px] transition-colors"
              :class="[
                dutiesOf(parent.id).includes(option)
                  ? 'bg-selected-bg font-medium text-accent'
                  : 'text-text-primary hover:bg-selected-bg',
                // 禁用必须**看得出来**：点了没反应会被当成程序坏了（本仓库的既有教训）
                isDutyOptionDisabled(parent.id, option)
                  ? 'cursor-not-allowed opacity-40'
                  : ''
              ]"
              :disabled="isDutyOptionDisabled(parent.id, option)"
              :aria-checked="dutiesOf(parent.id).includes(option)"
              :data-testid="`parent-duty-option-${option}`"
              @click.stop="onDutyOption(parent.id, option)"
            >
              {{ WORK_MODE_LABELS[option] }}
              <span v-if="dutiesOf(parent.id).includes(option)" class="ml-auto text-[11px]">✓</span>
            </button>
            <p class="px-2 pt-1 pb-0.5 text-[10px] leading-4 text-text-tertiary">
              最多 {{ MAX_PARENT_DUTIES }} 个
            </p>
          </div>
        </div>
        <input
          v-if="editingParentId === parent.id"
          v-model="editingTitle"
          :data-parent-edit-id="parent.id"
          class="min-w-0 flex-1 rounded-badge border border-border bg-app-bg px-2 py-0.5 text-sm font-normal text-text-primary outline-none focus:border-accent"
          @click.stop
          @keydown.enter.stop.prevent="commitParentEdit(parent)"
          @keydown.esc.stop.prevent="cancelParentEdit"
          @blur="commitParentEdit(parent)"
        />
        <span v-else class="min-w-0 flex-1 truncate">{{ parent.title }}</span>
        <!-- Icon-only: the labelled version ate half a narrow sidebar row while
             still reading as too quiet to notice. `title` keeps it discoverable. -->
        <button
          v-if="editingParentId !== parent.id && !multiSelect && showSelfCheck"
          class="ml-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-badge text-text-tertiary transition-colors hover:bg-card-bg-pressed hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent group-hover:text-text-secondary"
          title="刷新并检测新章节"
          aria-label="刷新并检测新章节"
          data-testid="self-check-button"
          @click.stop="emit('selfCheck', parent.id)"
        >
          <svg
            class="h-3.5 w-3.5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <polyline points="23 4 23 10 17 10" />
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
          </svg>
        </button>
        <button
          v-if="editingParentId !== parent.id && multiSelect"
          class="shrink-0 rounded-badge px-2 py-0.5 text-xs font-normal text-text-tertiary opacity-40 hover:bg-card-bg-pressed"
          @click.stop="startParentEdit(parent)"
        >
          重命名
        </button>
        <span
          v-if="multiSelect"
          class="ml-1 shrink-0 cursor-grab text-xs font-normal text-text-tertiary"
          title="拖动调整父级顺序"
          data-testid="parent-drag-handle"
          aria-hidden="true"
        >
          ⋮⋮
        </span>
      </div>

      <!-- Children: indented 24px (was 20px — one more step so the parent/child
           relationship survives the added row padding).
           `data-testid="child-list"` 是结构契约：此前 spec 用 `.bg-card-bg`
           找这个容器，而父级行现在也带 `bg-card-bg`（吸顶底色，见 parentRowClasses），
           于是它会变成文档顺序里的第一个命中 → 6 处断言会碎。颜色类本来也不该当锚点。 -->
      <div v-if="isExpanded(parent.id)" class="bg-card-bg" data-testid="child-list">
        <div
          v-for="child in sortedChildren(parent)"
          :key="child.id"
          :data-child-id="child.id"
          class="flex cursor-pointer items-center gap-2 py-2 pl-6 pr-2 text-[13px] text-text-primary transition-colors"
          :class="[
            // 吸顶时给「滚进视野」留出表头高度：revealActiveChild 走
            // scrollIntoView({block:'nearest'})，目标行在视口上方时会被对齐到
            // 滚动口顶部 = 正好藏在吸顶表头背后（实测 relTop=0；补上余量后 41）。
            // 41px = 8+8(py-2) + 24(h-6 刷新按钮) + 1px 细线，是本机实测的最高一档行高。
            // 注意：这里的注释不能用 ASCII 双引号 —— 表达式外层的属性就是双引号。
            stickyParentHeader ? 'scroll-mt-[41px]' : '',
            isChildMarked(child.id)
              ? 'bg-selected-bg font-medium ring-1 ring-inset ring-selected-border'
              : child.id === activeChildId
                ? 'bg-card-bg-hover font-medium text-accent shadow-[inset_3px_0_0_var(--accent)]'
                : 'hover:bg-card-bg-hover'
          ]"
          @click="selectChild(parent, child)"
        >
          <span class="min-w-0 flex-1 truncate">
            {{ formatChapterNumber(child.chapterNumber) }} · {{ child.projectTitle }}
          </span>
          <!-- 微型进度条 + 原样的进度文案（文案被 spec 锁着，一个字都不能改）。
               条本身不带文字，所以 wrapper.text() 不受影响。 -->
          <span class="ml-auto flex shrink-0 items-center gap-1.5">
            <span class="h-1 w-10 overflow-hidden rounded-full bg-media-bg" aria-hidden="true">
              <span
                class="block h-full rounded-full bg-done transition-[width] duration-300 ease-out"
                :style="{ width: progressWidth(child) }"
              />
            </span>
            <span class="text-[12px] font-normal tabular-nums text-text-tertiary">
              {{ progressText(child) }}
            </span>
          </span>
        </div>
      </div>
    </div>
  </div>
</template>
