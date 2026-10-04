<script setup lang="ts">
// ProjectSidebar — CRUD and multi-select status actions + ProjectTree.
// Owns the current normal selection and temporary marked-child selection;
// persistence and filesystem work are delegated via emits.
// Task 4.3 of the work plan. Does NOT touch Project.vue.
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { ParentProject, WorkMode } from '@shared/types'
import type { ChildSortOrder } from '@shared/chapter'
import { WORK_MODE_SHORT_LABELS } from '@shared/modes'
import { useToastStore } from '@renderer/stores/toast'
import ProjectTree from './ProjectTree.vue'

const props = withDefaults(
  defineProps<{
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
    parentDuties?: Record<string, WorkMode[]>
  }>(),
  { mode: 'typeset', revealActiveChild: false, parentDuties: undefined }
)

// Batch buttons read 已嵌全部 / 未嵌全部 — the full label would produce the
// awkward 已嵌字全部 / 已翻译全部, hence the single-character form.
const batchDoneLabel = computed(() => `已${WORK_MODE_SHORT_LABELS[props.mode]}全部`)
const batchPendingLabel = computed(() => `未${WORK_MODE_SHORT_LABELS[props.mode]}全部`)

const emit = defineEmits<{
  (e: 'select', parentId: string, childId: string): void
  (e: 'renameParent', parentId: string, title: string): void
  (e: 'add'): void
  (e: 'manage', childId: string): void
  (e: 'delete', parentId: string, childId: string): void
  (e: 'batchMark', childIds: string[], status: 'done' | 'pending'): void
  (e: 'batchDelete', childIds: string[]): void
  (e: 'reorderParent', sourceParentId: string, targetParentId: string): void
  (e: 'selfCheckParent', parentId: string): void
  (e: 'setDuties', parentId: string, duties: WorkMode[]): void
}>()

// Internal selection state — drives 管理/删除 enabled state.
const toast = useToastStore()
const selectedParentId = ref<string | null>(null)
const selectedChildId = ref<string | null>(null)
const multiSelect = ref(false)
const markedChildIds = ref<Set<string>>(new Set())

const markedIds = computed(() => [...markedChildIds.value])

const hasSelection = (): boolean =>
  selectedParentId.value !== null && selectedChildId.value !== null

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
  multiSelect.value = false
  markedChildIds.value = new Set()
}

function toggleChildMark(childId: string): void {
  const next = new Set(markedChildIds.value)
  if (next.has(childId)) next.delete(childId)
  else next.add(childId)
  markedChildIds.value = next
}

function toggleParentMark(parentId: string, childIds: string[]): void {
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

function batchDelete(): void {
  if (markedIds.value.length === 0) return
  if (
    !window.confirm(
      `确定删除选中的 ${markedIds.value.length} 个项目吗？\n此操作会移除项目记录，但不会删除原文件。`
    )
  ) {
    return
  }
  if (selectedChildId.value && markedChildIds.value.has(selectedChildId.value)) {
    selectedParentId.value = null
    selectedChildId.value = null
  }
  emit('batchDelete', markedIds.value)
  markedChildIds.value = new Set()
}

function onKeydown(event: KeyboardEvent): void {
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

function onAdd(): void {
  emit('add')
}

function onManage(): void {
  if (!hasSelection()) return
  emit('manage', selectedChildId.value as string)
}

function onDelete(): void {
  if (!hasSelection()) return
  // Native confirm dialog — matches oldcode QMessageBox.warning pattern.
  if (!window.confirm('确定要删除该项目吗？')) return
  emit('delete', selectedParentId.value as string, selectedChildId.value as string)
}
</script>

<template>
  <div class="flex h-full flex-col bg-card-bg">
    <!-- Normal actions, or batch-management actions.
         Each mode owns its own row so normal mode can never wrap: the CRUD group
         absorbs the slack (flex-1 min-w-0) and 管理 stays shrink-0 on the same line.
         The old `flex-wrap` container pushed 管理 onto a second line whenever the
         four buttons overflowed the sidebar by even a pixel.

         两个模式的「进出开关」都固定在**右端**：正常模式是「管理」，
         多选模式是「取消」。同一个开关不该在两个角落之间跳。 -->
    <div class="border-b border-border p-2.5" data-testid="sidebar-actions">
      <div v-if="!multiSelect" class="flex flex-nowrap items-center gap-2">
        <div class="flex min-w-0 flex-1 items-center gap-2">
          <button
            type="button"
            class="h-8 min-w-0 flex-1 truncate rounded-badge bg-accent px-2 text-[13px] font-medium text-text-on-accent transition-colors hover:bg-primary-hover active:bg-primary-active focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            @click="onAdd"
          >
            添加
          </button>
          <button
            type="button"
            class="h-8 min-w-0 flex-1 truncate rounded-badge border bg-transparent px-2 text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            :class="
              hasSelection()
                ? 'border-border text-text-secondary hover:border-selected-border hover:bg-card-bg-hover hover:text-text-primary active:bg-card-bg-pressed'
                : 'cursor-not-allowed border-border text-text-tertiary'
            "
            :disabled="!hasSelection()"
            @click="onManage"
          >
            修改
          </button>
          <button
            type="button"
            class="h-8 min-w-0 flex-1 truncate rounded-badge border bg-transparent px-2 text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            :class="
              hasSelection()
                ? 'border-danger text-danger hover:bg-danger-soft active:bg-danger-soft'
                : 'cursor-not-allowed border-border text-text-tertiary'
            "
            :disabled="!hasSelection()"
            @click="onDelete"
          >
            删除
          </button>
        </div>
        <button
          type="button"
          class="flex h-8 shrink-0 items-center gap-1 rounded-badge px-2 text-[13px] text-text-secondary transition-colors hover:bg-card-bg-hover hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          title="批量管理（多选标记 / 批量删除）"
          data-testid="multi-select-button"
          @click="toggleMultiSelect"
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
            <path d="M9 11l3 3L22 4" />
            <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
          </svg>
          <span class="whitespace-nowrap">管理</span>
        </button>
      </div>
      <!-- 多选模式：批量动作在左，「取消」顶到右端。
           「管理」本来就在右端，退出按钮也放右端 —— 同一个"进出"开关始终在同一个角落，
           不用每次进/出都重新找它在哪。ml-auto 而不是 flex-1 排布：宽度不够换行时，
           它仍然会靠到自己那一行的右端。 -->
      <div v-else class="flex flex-wrap items-center gap-2">
        <button
          type="button"
          class="h-8 rounded-badge px-2 text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          :class="
            markedIds.length > 0
              ? 'bg-accent font-medium text-text-on-accent hover:bg-primary-hover active:bg-primary-active'
              : 'cursor-not-allowed bg-transparent text-text-tertiary ring-1 ring-inset ring-border'
          "
          :disabled="markedIds.length === 0"
          data-testid="batch-done-button"
          @click="batchMark('done')"
        >
          {{ batchDoneLabel }}
        </button>
        <button
          type="button"
          class="h-8 rounded-badge border bg-transparent px-2 text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          :class="
            markedIds.length > 0
              ? 'border-border text-text-secondary hover:border-selected-border hover:bg-card-bg-hover hover:text-text-primary active:bg-card-bg-pressed'
              : 'cursor-not-allowed border-border text-text-tertiary'
          "
          :disabled="markedIds.length === 0"
          data-testid="batch-pending-button"
          @click="batchMark('pending')"
        >
          {{ batchPendingLabel }}
        </button>
        <button
          type="button"
          class="h-8 rounded-badge border bg-transparent px-2 text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          :class="
            markedIds.length > 0
              ? 'border-danger text-danger hover:bg-danger-soft active:bg-danger-soft'
              : 'cursor-not-allowed border-border text-text-tertiary'
          "
          :disabled="markedIds.length === 0"
          data-testid="batch-delete-button"
          @click="batchDelete"
        >
          删除选中
        </button>
        <button
          type="button"
          class="ml-auto flex h-8 shrink-0 items-center rounded-badge px-2 text-[13px] text-text-secondary transition-colors hover:bg-card-bg-hover hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          data-testid="multi-select-button"
          @click="toggleMultiSelect"
        >
          取消
        </button>
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
    <div v-else class="flex-1 overflow-auto" data-testid="tree-scroll">
      <ProjectTree
        :parents="parents"
        :active-child-id="activeChildId"
        :child-sort-order="childSortOrder"
        :multi-select="multiSelect"
        :marked-child-ids="markedIds"
        :mode="mode"
        :reveal-active-child="revealActiveChild"
        :sticky-parent-header="true"
        :parent-duties="parentDuties"
        @select="onTreeSelect"
        @set-duties="onSetDuties"
        @rename-parent="onRenameParent"
        @toggle-child-mark="toggleChildMark"
        @toggle-parent-mark="toggleParentMark"
        @reorder-parent="onReorderParent"
        @self-check="onSelfCheckParent"
      />
    </div>
  </div>
</template>
