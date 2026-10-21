<script setup lang="ts">
import { confirmAction } from '@renderer/services/confirm'

import '@renderer/styles/project-management.css'
import { Search } from 'lucide-vue-next'
import UiInput from '@renderer/components/ui/ControlInput.vue'
import { Button as UiButton } from '@renderer/components/ui/button'
// ProjectSidebar — CRUD and multi-select status actions + ProjectTree.
// Owns the current normal selection and temporary marked-child selection;
// persistence and filesystem work are delegated via emits.
// Task 4.3 of the work plan. Does NOT touch Project.vue.
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { ParentProject, WorkMode } from '@shared/types'
import { compareChapterNumbersByOrder, type ChildSortOrder } from '@shared/chapter'
import { WORK_MODE_LABELS } from '@shared/modes'
import { useToastStore } from '@renderer/stores/toast'
import ProjectTree from './ProjectTree.vue'

const props = withDefaults(
  defineProps<{
    listPage?: boolean
    stickyParentHeader?: boolean
    parents: ParentProject[]
    loading: boolean
    activeChildId?: string | null
    childSortOrder?: ChildSortOrder
    /** Drives the batch-action wording only; the emit payload is unchanged. */
    mode?: WorkMode
    /**
     * 透传给 ProjectTree：进入某一话时自动展开它所属的父级并滚动定位。
     * 工作台侧栏传 true；「项目」列表页不传，保持全部收起。
     */
    revealActiveChild?: boolean
    /**
     * 每本漫画的职责（键是父级 id），由宿主算好传进来。
     *
     * ⚠️ 为什么不在这个组件里自己算：它渲染的 `parents` 是 **prop**，
     * 而职责表若从 store 里取，两者就可能不一致（截图工装当场抓到过：标签整片不渲染）。
     * 组件只画 + 发事件；`SetDuties` 也照样往上抛。
     */
    enabledModes?: WorkMode[]
    dutyModePriority?: 'slower' | 'faster'
    parentDuties?: Record<string, WorkMode[]>
    parentModes?: Record<string, WorkMode>
  }>(),
  { stickyParentHeader: true, mode: 'typeset', revealActiveChild: false, parentDuties: undefined }
)

// Batch actions follow the system work mode supplied by the host.
const batchDoneLabel = computed(() => `标记已${WORK_MODE_LABELS[props.mode]}`)
const batchPendingLabel = computed(() => '取消标记')

const emit = defineEmits<{
  (e: 'select', parentId: string, childId: string): void
  (e: 'renameParent', parentId: string, title: string): void
  (e: 'add'): void
  (e: 'manage', childId: string): void
  (e: 'delete', parentId: string, childId: string): void
  (e: 'batchMark', childIds: string[], status: 'done' | 'pending', mode?: WorkMode): void
  (e: 'batchDelete', childIds: string[]): void
  (e: 'reorderParent', sourceParentId: string, targetParentId: string): void
  (e: 'selfCheckParent', parentId: string): void
  (e: 'switchMode', parentId: string, mode: WorkMode): void
  (e: 'setDuties', parentId: string, duties: WorkMode[]): void
  /** 「修改扫描目录」：往宿主抛，宿主开弹窗（见 `useSourceRootEditor`）。 */
  (e: 'editSourceRoot', parentId: string): void
}>()

// Internal selection state — drives 管理/删除 enabled state.
const toast = useToastStore()
const selectedParentId = ref<string | null>(null)
const selectedChildId = ref<string | null>(null)
const multiSelect = ref(false)
const query = ref('')
const filteredParents = computed(() => {
  const text = query.value.trim().toLocaleLowerCase()
  return props.parents.filter(parent => !text || parent.title.toLocaleLowerCase().includes(text) || parent.children.some(child => `${child.chapterNumber} ${child.projectTitle}`.toLocaleLowerCase().includes(text)))
})
const sidebarRoot = ref<HTMLElement>()
const selectionAnchor = ref<string | null>(null)
const markedChildIds = ref<Set<string>>(new Set())

const markedIds = computed(() => [...markedChildIds.value])

function onTreeSelect(parentId: string, childId: string): void {
  selectedParentId.value = parentId
  selectedChildId.value = childId
  emit('select', parentId, childId)
}

function toggleMultiSelect(): void {
  if (multiSelect.value) {
    exitMultiSelect()
  } else {
    multiSelect.value = true
  }
}

function exitMultiSelect(): void {
  selectionAnchor.value = null
  multiSelect.value = false
  markedChildIds.value = new Set()
}

function toggleChildMark(childId: string, event?: MouseEvent): void {
  const parent = props.parents.find(p => p.children.some(c => c.id === childId))
  if (!parent) return
  selectedParentId.value = parent.id
  const sorted = [...parent.children].sort((a, b) => compareChapterNumbersByOrder(a.chapterNumber, b.chapterNumber, props.childSortOrder ?? 'ascending'))
  const anchor = sorted.findIndex(c => c.id === selectionAnchor.value)
  if (event?.shiftKey && anchor >= 0) {
    const end = sorted.findIndex(c => c.id === childId)
    const range = sorted.slice(Math.min(anchor, end), Math.max(anchor, end) + 1).map(c => c.id)
    markedChildIds.value = new Set(event.ctrlKey || event.metaKey ? [...markedIds.value, ...range] : range)
    return
  }
  selectionAnchor.value = childId
  const next = new Set(markedChildIds.value)
  if (next.has(childId)) next.delete(childId)
  else next.add(childId)
  markedChildIds.value = next
}

function toggleParentMark(parentId: string, childIds: string[]): void {
  selectedParentId.value = parentId
  selectionAnchor.value = null
  const next = new Set(markedChildIds.value)
  const allMarked = childIds.length > 0 && childIds.every((id) => next.has(id))
  for (const childId of childIds) {
    if (allMarked) next.delete(childId)
    else next.add(childId)
  }
  markedChildIds.value = next

  // 一次点击就勾选**整批**（几十话是常态）—— 明确说一句，别让它悄无声息。
  // 父级行和子项目行的点击在观感上本来没区别，不说的话，用户要点下批量按钮
  // 才会发现"刚才那一下勾选了 74 话"。
  // `childIds.length > 0`：空父级（一个子项目都没有）点下去什么也没勾到，
  // 不该报"已勾选…全部 0 话"。（正常流程里 `deleteChildren` 会把空父级一起剪掉，
  // 所以这是防御性的；但树是整包 JSON 落库的，别假设它永远不会为空。）
  if (!allMarked && childIds.length > 0) {
    const title = props.parents.find((parent) => parent.id === parentId)?.title ?? ''
    toast.addToast({
      type: 'warning',
      message: `已勾选「${title}」全部 ${childIds.length} 话（点批量按钮才会写入）`
    })
  }
}

function batchMark(status: 'done' | 'pending'): void {
  if (markedIds.value.length === 0) return
  emit('batchMark', markedIds.value, status)
  // Keep multi-select mode active, but release the completed selection.
  markedChildIds.value = new Set()
}

async function batchDelete(): Promise<void> {
  if (markedIds.value.length === 0) return
  const ids = [...markedIds.value]
  if (
    !(await confirmAction(
      `确定删除选中的 ${ids.length} 个项目吗？\n此操作会移除项目记录，但不会删除原文件。`
    ))
  ) {
    return
  }
  if (selectedChildId.value && markedChildIds.value.has(selectedChildId.value)) {
    selectedParentId.value = null
    selectedChildId.value = null
  }
  emit('batchDelete', ids)
  markedChildIds.value = new Set()
}

function onKeydown(event: KeyboardEvent): void {
  const target = event.target instanceof HTMLElement ? event.target : null
  if (target?.closest('input,textarea,select,[contenteditable=true],[role=dialog]')) return
  if (multiSelect.value && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a' &&
      (target === document.body || (target && sidebarRoot.value?.contains(target)))) {
    const parent = props.parents.find(p => p.id === selectedParentId.value) ?? props.parents.find(p => p.children.some(c => c.id === props.activeChildId))
    if (!parent) return
    event.preventDefault(); event.stopPropagation()
    markedChildIds.value = new Set(parent.children.map(c => c.id))
    return
  }
  if (event.key === 'Escape' && multiSelect.value) exitMultiSelect()
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))

function onRenameParent(parentId: string, title: string): void {
  emit('renameParent', parentId, title)
}

function onReorderParent(sourceParentId: string, targetParentId: string): void {
  emit('reorderParent', sourceParentId, targetParentId)
}

function onSetDuties(parentId: string, duties: WorkMode[]): void {
  emit('setDuties', parentId, duties)
}

function onSelfCheckParent(parentId: string): void {
  emit('selfCheckParent', parentId)
}

function onEditSourceRoot(parentId: string): void {
  emit('editSourceRoot', parentId)
}

function onAdd(): void {
  emit('add')
}

async function onDelete(parentId: string, childId: string): Promise<void> {
  if (!await confirmAction('确定移除该章节记录吗？原文件会保留。')) return
  emit('delete', parentId, childId)
}
</script>

<template>
  <div ref="sidebarRoot" class="project-management flex h-full min-h-0 min-w-0 flex-col bg-card-bg">
    <div class="new-controls" data-testid="sidebar-actions">
      <div class="new-heading">
        <div><h3>项目<span class="count">{{ parents.length }} 部</span></h3><p v-if="listPage">选择章节开始工作，或批量整理项目</p></div>
        <div class="buttons">
          <UiButton size="sm" @click="onAdd">添加</UiButton>
          <UiButton :variant="multiSelect ? 'secondary' : 'outline'" size="sm" data-testid="multi-select-button" @click="toggleMultiSelect">{{ multiSelect ? '退出管理' : '批量管理' }}</UiButton>
        </div>
      </div>
      <div v-if="!multiSelect" class="search-box"><Search aria-hidden="true"/><UiInput v-model="query" placeholder="搜索漫画或章节" aria-label="搜索漫画或章节" /></div>
      <div v-else class="batch-panel">
        <div class="selection-summary"><strong>已选 {{ markedIds.length }} 话</strong><UiButton variant="ghost" size="sm" :disabled="!markedIds.length" @click="markedChildIds = new Set(); selectionAnchor = null">清空</UiButton></div>
        <div class="batch-buttons">
          <UiButton size="sm" :disabled="!markedIds.length" data-testid="batch-done-button" @click="batchMark('done')">{{ batchDoneLabel }}</UiButton>
          <UiButton variant="outline" size="sm" :disabled="!markedIds.length" data-testid="batch-pending-button" @click="batchMark('pending')">{{ batchPendingLabel }}</UiButton>
          <UiButton variant="ghost" size="sm" class="text-destructive" :disabled="!markedIds.length" data-testid="batch-delete-button" @click="batchDelete">移除</UiButton>
        </div>
        <p class="scope-note">{{ markedIds.length ? `仅对选中的 ${markedIds.length} 话执行${WORK_MODE_LABELS[mode]}操作` : '勾选漫画可选择整本，展开箭头只负责展开' }}</p>
      </div>
    </div>

    <!-- Loading placeholder -->
    <div v-if="loading" class="flex flex-1 items-center justify-center text-text-secondary">
      加载中…
    </div>

    <!-- ProjectTree.
         这个 div 就是真正的滚动口（工具栏在它外面，所以树里 `top: 0`
         = 工具栏正下方那一行）。`data-testid="tree-scroll"` 给截图工装用：
         面板 HTML 被注入截图页之后，脚本要能直接拿到滚动口去设 scrollTop。 -->
    <div v-else class="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden" data-testid="tree-scroll">
      <p v-if="!filteredParents.length" class="p-4 text-sm text-text-secondary">没有匹配的漫画或章节</p>
      <ProjectTree
        :parents="filteredParents"
        :search-query="query"
        :active-child-id="activeChildId"
        :child-sort-order="childSortOrder"
        :multi-select="multiSelect"
        :marked-child-ids="markedIds"
        :mode="mode"
        :reveal-active-child="revealActiveChild"
        :sticky-parent-header="stickyParentHeader"
        :parent-duties="parentDuties"
        :parent-modes="parentModes"
        :duty-mode-priority="dutyModePriority"
        :enabled-modes="enabledModes"
        @switch-mode="(parentId, mode) => emit('switchMode', parentId, mode)"
        @select="onTreeSelect"
        @manage-child="childId => emit('manage', childId)"
        @delete-child="onDelete"
        @set-duties="onSetDuties"
        @rename-parent="onRenameParent"
        @toggle-child-mark="toggleChildMark"
        @mark-child-done="(childId, mode) => emit('batchMark', [childId], 'done', mode)"
        @toggle-parent-mark="toggleParentMark"
        @reorder-parent="onReorderParent"
        @self-check="onSelfCheckParent"
        @edit-source-root="onEditSourceRoot"
      />
    </div>
  </div>
</template>
