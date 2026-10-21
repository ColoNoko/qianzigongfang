<script setup lang="ts">
import { ChevronRight, MoreHorizontal, ArrowUp, ArrowDown } from 'lucide-vue-next'
import StatisticsTimeMenu from '@renderer/features/project/StatisticsTimeMenu.vue'
import { ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem } from './ui/context-menu'
import { Checkbox } from './ui/checkbox'
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem } from './ui/dropdown-menu'
import { Progress } from './ui/progress'
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover"
import { Button as UiButton } from '@renderer/components/ui/button'
import UiInput from '@renderer/components/ui/ControlInput.vue'
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
import { WORK_MODE_LABELS, WORK_MODES } from '@shared/modes'
import { MAX_PARENT_DUTIES, normalizeDuties, toggleDuty } from '@shared/duties'

const props = withDefaults(
  defineProps<{
    searchQuery?: string
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
     * 每本漫画的「职责」（这一本归我干哪几道工序，0~2 个模式），键是父级 id。
     *
     * 由宿主算好传进来（`useParentDuties()`：声明过的优先，没声明过按已有标记推断）——
     * 组件不认识"推断"，只负责画。缺省 / 空数组 = 只占位、不画标签。
     */
    enabledModes?: WorkMode[]
    dutyModePriority?: 'slower' | 'faster'
    parentDuties?: Record<string, WorkMode[]>
    parentModes?: Record<string, WorkMode>
  }>(),
  {
    mode: 'typeset',
    enabledModes: () => [...WORK_MODES],
    showSelfCheck: true,
    revealActiveChild: false,
    stickyParentHeader: false,
    parentDuties: undefined
  }
)

const emit = defineEmits<{
  (e: 'manageChild', childId: string): void
  (e: 'deleteChild', parentId: string, childId: string): void
  (e: 'select', parentId: string, childId: string): void
  (e: 'expand', id: string, expanded: boolean): void
  (e: 'renameParent', parentId: string, title: string): void
  (e: 'toggleChildMark', childId: string, event?: MouseEvent): void
  (e: 'markChildDone', childId: string, mode: WorkMode): void
  (e: 'toggleParentMark', parentId: string, childIds: string[]): void
  (e: 'reorderParent', sourceParentId: string, targetParentId: string): void
  (e: 'selfCheck', parentId: string): void
  (e: 'switchMode', parentId: string, mode: WorkMode): void
  (e: 'setDuties', parentId: string, duties: WorkMode[]): void
  /**
   * 「修改扫描目录」（2026-10-05，需求二）：只改**父级**的"检测新章节去哪找"，
   * 与子项目那一层的「修改」（改某一话自己的文件夹路径）是两件事，别合并。
   */
  (e: 'editSourceRoot', parentId: string): void
}>()

// --- 职责标签（2026-10-03）---------------------------------------------------
/** 当前打开了哪个父级的职责菜单（同一时刻只开一个）。 */
const actionMenuParentId = ref<string | null>(null)
const dutyMenuParentId = ref<string | null>(null)

function dutiesOf(parentId: string): WorkMode[] {
  // 过一遍规范顺序（嵌 → 翻 → 校 → 监）：显示顺序不许由"调用方给什么顺序"决定，
  // 否则同一份数据在两个宿主里可能长得不一样。
  return normalizeDuties(props.parentDuties?.[parentId] ?? props.parents.find(parent => parent.id === parentId)?.duties ?? [])
}

function modeOf(parent: ParentProject): WorkMode {
  return props.parentModes?.[parent.id] ?? props.mode
}
function childMode(child: ChildProject): WorkMode {
  const parent = props.parents.find(parent => parent.children.some(item => item.id === child.id))
  return parent ? modeOf(parent) : props.mode
}

function dutyLabel(parent: ParentProject): string {
  const duties = dutiesOf(parent.id)
  const text = duties.length ? duties.map((mode) => WORK_MODE_LABELS[mode]).join(' + ') : '未设置'
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
  if (target instanceof Element && target.closest('[data-testid="parent-duty-slot"], [data-testid="parent-duty-menu"]')) return
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
  const query = props.searchQuery?.trim().toLocaleLowerCase() ?? ''
  const children = !query || parent.title.toLocaleLowerCase().includes(query) ? parent.children : parent.children.filter(child => `${child.chapterNumber} ${child.projectTitle}`.toLocaleLowerCase().includes(query))
  return [...children].sort((a, b) =>
    compareChapterNumbersByOrder(
      a.chapterNumber,
      b.chapterNumber,
      props.childSortOrder ?? 'ascending'
    )
  )
}

function isExpanded(id: string): boolean {
  return Boolean(props.searchQuery?.trim()) || expandedIds.value.has(id)
}

function toggleExpandOnly(parent: ParentProject): void {
  const next = !isExpanded(parent.id)
  // Expanding the tree only reveals chapters. Mode selection belongs to the
  // host's chapter-entry flow, not a presentational disclosure control.
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

function selectChild(parent: ParentProject, child: ChildProject, event?: MouseEvent): void {
  if (props.multiSelect) {
    emit('toggleChildMark', child.id, event)
    return
  }
  emit('select', parent.id, child.id)
}

function toggleChildFromCheckbox(childId: string, event: MouseEvent): void {
  emit('toggleChildMark', childId, event)
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
  const progress = childModeProgress(child, childMode(child))
  return `${WORK_MODE_LABELS[childMode(child)]}进度${progress.done}/${progress.total}`
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
  const { pct } = childModeProgress(child, childMode(child))
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
    const parent = props.parents.find((item) => item.children.some((child) => child.id === childId))
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
  <div ref="rootEl" class="project-management-tree select-none text-text-primary">
    <section v-for="parent in parents" :key="parent.id" class="comic-group"
      :class="dragOverParentId === parent.id ? 'border-t-2 border-t-accent bg-selected-bg/50' : ''"
      :data-parent-id="parent.id" :draggable="Boolean(multiSelect)"
      @dragstart="onParentDragStart($event, parent.id)" @dragover="onParentDragOver($event, parent.id)" @drop="onParentDrop($event, parent.id)" @dragend="clearParentDrag">
      <ContextMenu><ContextMenuTrigger as-child :disabled="multiSelect">
        <div class="comic-heading font-bold" :class="parentRowClasses(parent)" @click="onParentClick(parent)" @dblclick.stop="toggleExpandOnly(parent)">
          <Checkbox v-if="multiSelect" :model-value="isParentMarked(parent) ? true : parent.children.some(c => isChildMarked(c.id)) ? 'indeterminate' : false" :aria-label="'选择漫画 ' + parent.title" @click.stop @update:model-value="onParentClick(parent)" />
          <UiButton variant="ghost" size="icon-sm" :aria-label="isExpanded(parent.id) ? '折叠子项目' : '展开子项目'" :aria-expanded="isExpanded(parent.id)" @click.stop="toggleExpandOnly(parent)" @dblclick.stop><ChevronRight :class="isExpanded(parent.id) ? 'rotate-90' : ''" /></UiButton>
          <div class="comic-info">
            <UiInput v-if="editingParentId === parent.id" v-model="editingTitle" :data-parent-edit-id="parent.id" @click.stop @keydown.enter.stop.prevent="commitParentEdit(parent)" @keydown.esc.stop.prevent="cancelParentEdit" @blur="commitParentEdit(parent)" />
            <strong v-else :title="parent.title">{{ parent.title }}</strong>
            <div class="comic-meta"><span>{{ parent.children.length }} 话</span>
              <div data-testid="parent-duty-slot" @click.stop @dblclick.stop>
                <Popover :open="dutyMenuParentId === parent.id" @update:open="dutyMenuParentId = $event ? parent.id : null">
                  <PopoverTrigger as-child>
                    <UiButton v-if="dutiesOf(parent.id).length" variant="ghost" size="sm" class="role-labels" data-testid="parent-duty-pill" :data-duty-count="dutiesOf(parent.id).length" :aria-label="dutyLabel(parent)" :title="dutyLabel(parent)" @contextmenu.prevent.stop="toggleDutyMenu(parent.id)">
                      <span v-for="dutyMode in dutiesOf(parent.id)" :key="dutyMode" class="role-label" :data-duty-mode="dutyMode" :data-testid="'parent-duty-' + dutyMode">{{ WORK_MODE_LABELS[dutyMode] }}</span>
                    </UiButton>
                    <UiButton v-else variant="ghost" size="sm" class="empty-duty" data-testid="parent-duty-chip" :data-duty-count="0" :aria-label="dutyLabel(parent)" @contextmenu.prevent.stop="toggleDutyMenu(parent.id)">设置职责</UiButton>
                  </PopoverTrigger>
                  <PopoverContent align="start" class="w-44 p-1" :aria-label="parent.title + '的职责设置'" data-testid="parent-duty-menu" @keydown="onDutyKeydown">
                    <div role="group" aria-label="我负责的职责，最多选择两个">
                      <UiButton v-for="option in WORK_MODES" :key="option" variant="ghost" size="sm" class="flex w-full justify-start gap-2" :disabled="isDutyOptionDisabled(parent.id, option)" :aria-pressed="dutiesOf(parent.id).includes(option)" :data-testid="`parent-duty-option-${option}`" @click.stop="onDutyOption(parent.id, option)">{{ WORK_MODE_LABELS[option] }}<span v-if="dutiesOf(parent.id).includes(option)" aria-hidden="true" class="ml-auto">✓</span></UiButton>
                    </div>
                    <p class="px-2 py-1 text-[11px] text-text-tertiary">作品职责，最多 {{ MAX_PARENT_DUTIES }} 个；不会切换当前模式。</p>
                  </PopoverContent>
                </Popover>
              </div>
            </div>
          </div>
          <DropdownMenu :open="actionMenuParentId === parent.id" @update:open="actionMenuParentId = $event ? parent.id : null">
            <DropdownMenuTrigger as-child><UiButton variant="ghost" size="icon-sm" :aria-label="parent.title + '的更多操作'" data-testid="parent-actions" @click.stop @dblclick.stop><MoreHorizontal/></UiButton></DropdownMenuTrigger>
            <DropdownMenuContent align="end" :side-offset="4" @close-auto-focus="(editingParentId || dutyMenuParentId) && $event.preventDefault()" @click.stop>
              <DropdownMenuGroup>
                <DropdownMenuItem @select="startParentEdit(parent)">重命名漫画</DropdownMenuItem>
                <DropdownMenuItem @select="toggleDutyMenu(parent.id)">修改职责</DropdownMenuItem>
                <DropdownMenuItem data-testid="parent-source-root-button" @select="emit('editSourceRoot', parent.id)">扫描目录</DropdownMenuItem>
                <DropdownMenuItem v-if="showSelfCheck" data-testid="self-check-button" @select="emit('selfCheck', parent.id)">刷新章节</DropdownMenuItem>
                <DropdownMenuItem :disabled="parents.indexOf(parent) === 0" @select="emit('reorderParent', parent.id, parents[parents.indexOf(parent) - 1].id)"><ArrowUp class="mr-1 size-3.5"/>上移漫画</DropdownMenuItem>
                <DropdownMenuItem :disabled="parents.indexOf(parent) === parents.length - 1" @select="emit('reorderParent', parent.id, parents[parents.indexOf(parent) + 1].id)"><ArrowDown class="mr-1 size-3.5"/>下移漫画</DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <span v-if="multiSelect" class="drag-handle" title="长按拖动调整漫画顺序" data-testid="parent-drag-handle" @click.stop>⋮⋮</span>
        </div>
      </ContextMenuTrigger><ContextMenuContent v-if="!multiSelect"><ContextMenuItem @select="toggleDutyMenu(parent.id)">修改职责</ContextMenuItem><StatisticsTimeMenu :target="{ parentId: parent.id }" :mode="modeOf(parent)" /></ContextMenuContent></ContextMenu>
      <div v-if="isExpanded(parent.id)" class="chapters" data-testid="child-list">
        <ContextMenu v-for="child in sortedChildren(parent)" :key="child.id"><ContextMenuTrigger as-child :disabled="multiSelect">
          <div :data-child-id="child.id" :aria-current="child.id === activeChildId ? 'true' : undefined" class="chapter-row cursor-pointer" :class="[multiSelect ? 'is-multi-select' : '', stickyParentHeader ? 'scroll-mt-[80px]' : '', isChildMarked(child.id) ? 'selected bg-selected-bg' : child.id === activeChildId ? 'active' : '']" @click="selectChild(parent, child, $event)">
            <Checkbox v-if="multiSelect" :model-value="isChildMarked(child.id)" :aria-label="'选择章节 ' + child.projectTitle" @click.stop="toggleChildFromCheckbox(child.id, $event)" />
            <UiButton variant="ghost" class="chapter-main" :aria-label="formatChapterNumber(child.chapterNumber) + ' · ' + child.projectTitle + '，' + progressText(child)" @click.stop="selectChild(parent, child, $event)">
              <span :title="formatChapterNumber(child.chapterNumber) + ' · ' + child.projectTitle">{{ formatChapterNumber(child.chapterNumber) }} · {{ child.projectTitle }}</span>
            </UiButton>
            <span class="chapter-progress" :title="progressText(child)" aria-hidden="true"><small><span class="progress-mode">{{ WORK_MODE_LABELS[childMode(child)] }}进度</span><span class="progress-count">{{ childModeProgress(child, childMode(child)).done }}/{{ childModeProgress(child, childMode(child)).total }}</span></small><Progress :model-value="Number.parseFloat(progressWidth(child))" class="chapter-progress-bar" /></span>
            <DropdownMenu v-if="!multiSelect"><DropdownMenuTrigger as-child><UiButton variant="ghost" size="icon-sm" class="chapter-actions" :aria-label="child.projectTitle + '章节操作'" @click.stop><MoreHorizontal/></UiButton></DropdownMenuTrigger>
              <DropdownMenuContent align="end" :side-offset="4" @click.stop><DropdownMenuGroup>
                <DropdownMenuItem @select="emit('select', parent.id, child.id)">打开章节</DropdownMenuItem>
                <DropdownMenuItem @select="emit('manageChild', child.id)">修改章节</DropdownMenuItem>
                <DropdownMenuItem @select="emit('markChildDone', child.id, modeOf(parent))">标记已{{ WORK_MODE_LABELS[modeOf(parent)] }}</DropdownMenuItem>
                <DropdownMenuItem class="text-destructive" @select="emit('deleteChild', parent.id, child.id)">移除章节</DropdownMenuItem>
              </DropdownMenuGroup></DropdownMenuContent>
            </DropdownMenu>
          </div>
        </ContextMenuTrigger><ContextMenuContent v-if="!multiSelect"><ContextMenuItem @select="emit('manageChild', child.id)">修改章节</ContextMenuItem><ContextMenuItem @select="emit('deleteChild', parent.id, child.id)">移除章节</ContextMenuItem><ContextMenuItem @select="emit('markChildDone', child.id, modeOf(parent))">标记为已{{ WORK_MODE_LABELS[modeOf(parent)] }}</ContextMenuItem><StatisticsTimeMenu :target="{ childId: child.id }" :mode="modeOf(parent)" /></ContextMenuContent></ContextMenu>
      </div>
    </section>
  </div>
</template>
