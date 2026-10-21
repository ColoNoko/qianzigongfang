<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import EmptyState from '@renderer/components/EmptyState.vue'
import ProjectFormModal from '@renderer/components/ProjectFormModal.vue'
import ProjectSidebar from '@renderer/components/ProjectSidebar.vue'
import { useProjectSelfCheck } from '@renderer/features/project/useProjectSelfCheck'
import SelfCheckDialog from '@renderer/features/project/SelfCheckDialog.vue'
import { useSourceRootEditor } from '@renderer/features/project/useSourceRootEditor'
import SourceRootDialog from '@renderer/features/project/SourceRootDialog.vue'
import { useProjectWorkspace } from '@renderer/stores/projectWorkspace'
import { useToastStore } from '@renderer/stores/toast'
import { useSettingsStore } from '@renderer/stores/settings'
import { childWorkbenchPath } from '@renderer/features/project/project-route'
import { useParentDuties } from '@renderer/features/project/useParentDuties'
import type { ChildProject, WorkMode } from '@shared/types'

const route = useRoute()
const router = useRouter()
const workspace = useProjectWorkspace()
const toast = useToastStore()
const settings = useSettingsStore()
const modalVisible = ref(false)
const modalMode = ref<'add' | 'manage'>('add')
const modalData = ref<
  | {
      parentTitle: string
      chapterNumber: string
      projectTitle: string
      folderPath: string
    }
  | undefined
>(undefined)
const managedChildId = ref<string | null>(null)

const {
  selfCheckVisible,
  selfCheckSourceRoot,
  selfCheckPreview,
  selfCheckBusy,
  selfCheckNeverAsk,
  selfCheckConflictActions,
  selfCheckRunning,
  closeSelfCheck,
  setSelfCheckConflictAction,
  runSelfCheckWithSource,
  pickSelfCheckDirectory,
  startSelfCheck,
  confirmSelfCheckImport,
  reclaimCandidate,
  selfCheckRenameHints,
  detectSelfCheckRenames
} = useProjectSelfCheck({
  refreshAfterSelfCheck: async () => {
    await workspace.loadParents()
  }
})

/**
 * 「修改扫描目录」（2026-10-05，需求二）。
 *
 * 传进去的是 `projects` 取函数而不是快照：弹窗开着的时候树可能被别处改（另一次导入 /
 * 删除），冲突判定必须看**当下**的树，不能拿打开那一刻的旧副本。
 */
const {
  visible: sourceRootVisible,
  busy: sourceRootBusy,
  parentTitle: sourceRootParentTitle,
  mode: sourceRootMode,
  directory: sourceRootDirectory,
  layers: sourceRootLayers,
  layerError: sourceRootLayerError,
  selectedLayerPaths: sourceRootSelectedLayerPaths,
  acknowledged: sourceRootAcknowledged,
  currentRoots: sourceRootCurrentRoots,
  currentIsRemembered: sourceRootCurrentIsRemembered,
  currentCandidateCount: sourceRootCurrentCandidateCount,
  currentMessage: sourceRootCurrentMessage,
  conflicts: sourceRootConflicts,
  canSave: sourceRootCanSave,
  plan: sourceRootPlan,
  open: openSourceRootEditor,
  close: closeSourceRootEditor,
  pickDirectory: pickSourceRootDirectory,
  setDirectory: setSourceRootDirectory,
  loadLayers: loadSourceRootLayers,
  toggleLayer: toggleSourceRootLayer,
  resetToAuto: resetSourceRootToAuto,
  save: saveSourceRoot
} = useSourceRootEditor({
  projects: () => workspace.parents,
  refreshAfterSave: () => workspace.loadParents()
})

/**
 * "我知道"这个开关的写入走一个显式函数，而不是模板里写赋值表达式 ——
 * `<script setup>` 里的 ref 在模板中直接赋值要靠编译器的自动解包，容易看错；
 * 显式函数一眼能看出改的是哪一份状态（这个仓库对"看不清的隐式行为"一向谨慎）。
 */
function onSourceRootAcknowledged(value: boolean): void {
  sourceRootAcknowledged.value = value
}


// 职责表：声明过的优先、没声明过按标记推断；改动直接落 store（这一页自己就是宿主）。
const { dutyMap, modeMap } = useParentDuties()

const hasProjects = computed(() => workspace.parents.some((parent) => parent.children.length > 0))

/**
 * 树是否仍在加载。`parents` 为空时不能立刻说"还没有项目"—— 第一帧的空状态
 * 会在数据到达后跳成列表，看起来就是闪一下。
 */
const treeLoading = ref(workspace.parents.length === 0)

function goToChild(child: ChildProject): void {
  router.replace(childWorkbenchPath(child.parentTitle, child.id))
}

/**
 * The page renders the same tree as the workbench sidebar, so a chapter click
 * arrives as the tree's `select` event (parent id + child id) rather than as a
 * direct reference to the child.
 */
function onSetDuties(parentId: string, duties: WorkMode[]): void {
  void workspace.setParentDuties(parentId, duties)
}

function onTreeSelect(parentId: string, childId: string): void {
  const parent = workspace.parents.find((item) => item.id === parentId)
  const child = parent?.children.find((item) => item.id === childId)
  if (!child) return
  goToChild(child)
}

async function onBatchMark(childIds: string[], status: 'done' | 'pending', mode = settings.activeWorkMode): Promise<void> {
  try {
    const result = await workspace.markChildProjects(childIds, status, mode)
    if (result.cancelled) return
    toast.addToast({ type: result.marked ? 'success' : 'warning', message: result.marked ? `已更新 ${result.marked} 个文件的标记` : '没有可标记的文件或目录不可读' })
  } catch (error) { toast.addToast({ type: 'error', message: String(error) }) }
}
async function onBatchDelete(ids: string[]): Promise<void> {
  try {
    await workspace.deleteChildren(ids)
    toast.addToast({ type: 'success', message: `已移除 ${ids.length} 个章节记录` })
  } catch (error) { toast.addToast({ type: 'error', message: String(error) }) }
}
function onManage(childId: string): void {
  const child = workspace.findChild(childId)
  if (!child) return
  modalMode.value = 'manage'
  managedChildId.value = childId
  modalData.value = { parentTitle: child.parentTitle, chapterNumber: child.chapterNumber, projectTitle: child.projectTitle, folderPath: child.folderPath }
  modalVisible.value = true
}
function onEditSourceRoot(parentId: string): void {
  const parent = workspace.parents.find(p => p.id === parentId)
  if (parent) void openSourceRootEditor(parent)
}
async function onModalDelete(): Promise<void> {
  if (!managedChildId.value) return
  await onBatchDelete([managedChildId.value])
  modalVisible.value = false
}

function openAddModal(): void {
  modalMode.value = 'add'
  modalData.value = undefined
  managedChildId.value = null
  modalVisible.value = true
}

function findSavedChild(payload: {
  parentTitle: string
  chapterNumber: string
  projectTitle: string
  folderPath: string
}): ChildProject | null {
  for (const parent of workspace.parents) {
    for (const child of parent.children) {
      if (
        child.folderPath.replace(/\\/g, '/').toLocaleLowerCase() ===
        payload.folderPath.replace(/\\/g, '/').toLocaleLowerCase()
      ) {
        return child
      }
    }
  }
  return null
}

const savingProject = ref(false)

async function onModalSave(payload: {
  parentTitle: string
  chapterNumber: string
  projectTitle: string
  folderPath: string
}): Promise<void> {
  if (savingProject.value) return
  savingProject.value = true
  const progressId = toast.addToast({ type: 'loading', message: '正在准备项目…', duration: 0 })
  try {
    const result = await workspace.saveChild(payload, managedChildId.value ?? undefined, (message) => toast.updateToast(progressId, message))
    toast.removeToast(progressId)
    toast.addToast({
      type: 'success',
      message:
        modalMode.value === 'manage' ? '章节已更新' : result.skipped > 0 && result.added === 0
          ? '项目已存在，已跳过导入'
          : result.skipped > 0
            ? `新增 ${result.added} 个项目，跳过 ${result.skipped} 个已有项目`
            : `项目添加成功（${result.added} 个）`
    })
    modalVisible.value = false
  } catch (error) {
    toast.addToast({
      type: 'error',
      message: `项目保存失败：${error instanceof Error ? error.message : String(error)}`
    })
    return
  } finally {
    savingProject.value = false
    toast.removeToast(progressId)
  }
  // Land on the chapter the user just added — but only when we can name it
  // exactly. A folder import can create many chapters at once (one per
  // subfolder), and there is no "the" project to open in that case, so stay on
  // the list rather than guessing the newest by file time.
  const saved = findSavedChild(payload)
  if (saved) {
    goToChild(saved)
  }
}

onMounted(async () => {
  if (workspace.parents.length === 0) {
    treeLoading.value = true
    try {
      await workspace.loadParents()
    } finally {
      treeLoading.value = false
    }
  }
  if (route.query.add === '1') {
    openAddModal()
  }
  // Opening 项目 deliberately stays on the list. It used to auto-replace the
  // route with the most recently modified chapter, which meant the app "opened
  // a project by default" before the user picked one.
})

</script>

<template>
  <div class="page-in page-layout min-h-full bg-app-bg text-text-primary">
    <div
      v-if="!hasProjects && treeLoading"
      class="flex min-h-[40vh] items-center justify-center text-text-secondary"
      data-testid="project-index-loading"
    >
      加载中…
    </div>
    <EmptyState
      v-else-if="!hasProjects"
      headline="还没有项目"
      cta-text="添加项目"
      :cta-action="openAddModal"
    />

    <div v-else class="flex flex-col gap-4">

      <!-- Same tree as the workbench sidebar: every project starts collapsed and
           only a click opens one. It used to render every chapter of every
           project unconditionally, which read as "everything already expanded".
           Reusing the component keeps the collapse rule in exactly one place. -->
      <div
        class="overflow-hidden rounded-lg border border-border bg-card-bg shadow-[var(--shadow-1)]"
        data-testid="project-index-tree"
      >
        <ProjectSidebar list-page
          :parents="workspace.parents" :loading="treeLoading" :sticky-parent-header="false"
          :mode="settings.activeWorkMode" :child-sort-order="settings.childSortOrder"
          :parent-duties="dutyMap" :parent-modes="modeMap"
          :duty-mode-priority="settings.dutyModePriority" :enabled-modes="settings.enabledWorkModes"
          @select="onTreeSelect" @add="openAddModal" @manage="onManage"
          @delete="(_parentId, childId) => onBatchDelete([childId])"
          @batch-mark="onBatchMark" @batch-delete="onBatchDelete"
          @rename-parent="workspace.renameParent" @reorder-parent="workspace.reorderParent"
          @set-duties="onSetDuties" @switch-mode="settings.setProjectWorkMode"
          @self-check-parent="startSelfCheck" @edit-source-root="onEditSourceRoot"
        />
      </div>
    </div>

    <ProjectFormModal
    :saving="savingProject"
      v-if="modalVisible"
      :mode="modalMode"
      :initial-data="modalData"
      :existing-parent-titles="workspace.parents.map((parent) => parent.title)"
      @save="onModalSave"
      @cancel="modalVisible = false"
      @delete="onModalDelete"
    />
  <SelfCheckDialog
    :visible="selfCheckVisible"
    :busy="selfCheckBusy"
    :running="selfCheckRunning"
    :preview="selfCheckPreview"
    :source-root="selfCheckSourceRoot"
    :conflict-actions="selfCheckConflictActions"
    :never-ask="selfCheckNeverAsk"
    :silent-self-check="settings.silentSelfCheck"
    :rename-hints="selfCheckRenameHints"
    @close="closeSelfCheck"
    @pick-directory="pickSelfCheckDirectory"
    @run-with-source="runSelfCheckWithSource"
    @set-conflict-action="setSelfCheckConflictAction"
    @update:never-ask="selfCheckNeverAsk = $event"
    @confirm="confirmSelfCheckImport"
    @reclaim="reclaimCandidate"
    @detect-renames="detectSelfCheckRenames"
  />

  <!-- 「修改扫描目录」：只改父级的"检测新章节去哪找"，不动任何话自己的路径。 -->
  <SourceRootDialog
    :visible="sourceRootVisible"
    :busy="sourceRootBusy"
    :parent-title="sourceRootParentTitle"
    :mode="sourceRootMode"
    :directory="sourceRootDirectory"
    :layers="sourceRootLayers"
    :layer-error="sourceRootLayerError"
    :selected-layer-paths="sourceRootSelectedLayerPaths"
    :acknowledged="sourceRootAcknowledged"
    :current-roots="sourceRootCurrentRoots"
    :current-is-remembered="sourceRootCurrentIsRemembered"
    :current-candidate-count="sourceRootCurrentCandidateCount"
    :current-message="sourceRootCurrentMessage"
    :conflicts="sourceRootConflicts"
    :plan="sourceRootPlan"
    :can-save="sourceRootCanSave"
    @close="closeSourceRootEditor"
    @pick-directory="pickSourceRootDirectory"
    @update:directory="setSourceRootDirectory"
    @load-layers="loadSourceRootLayers"
    @toggle-layer="toggleSourceRootLayer"
    @reset-to-auto="resetSourceRootToAuto"
    @update:acknowledged="onSourceRootAcknowledged"
    @save="saveSourceRoot"
  />

  </div>
</template>
