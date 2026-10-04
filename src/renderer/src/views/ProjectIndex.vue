<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import EmptyState from '@renderer/components/EmptyState.vue'
import ProjectFormModal from '@renderer/components/ProjectFormModal.vue'
import ProjectTree from '@renderer/components/ProjectTree.vue'
import { useProjectWorkspace } from '@renderer/stores/projectWorkspace'
import { useToastStore } from '@renderer/stores/toast'
import { useSettingsStore } from '@renderer/stores/settings'
import { childWorkbenchPath } from '@renderer/features/project/project-route'
import { useParentDuties } from '@renderer/features/project/useParentDuties'
import type { ChildProject, ParentProject, WorkMode } from '@shared/types'

const route = useRoute()
const router = useRouter()
const workspace = useProjectWorkspace()
const toast = useToastStore()
const settings = useSettingsStore()
const modalVisible = ref(false)
// 职责表：声明过的优先、没声明过按标记推断；改动直接落 store（这一页自己就是宿主）。
const { dutyMap } = useParentDuties()

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

function openAddModal(): void {
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

async function onModalSave(payload: {
  parentTitle: string
  chapterNumber: string
  projectTitle: string
  folderPath: string
}): Promise<void> {
  const result = await workspace.saveChild(payload)
  toast.addToast({
    type: 'success',
    message:
      result.skipped > 0 && result.added === 0
        ? '项目已存在，已跳过导入'
        : result.skipped > 0
          ? `新增 ${result.added} 个项目，跳过 ${result.skipped} 个已有项目`
          : `项目添加成功（${result.added} 个）`
  })
  modalVisible.value = false
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

function sortedParents(): ParentProject[] {
  return [...workspace.parents].sort((a, b) => b.lastMtimeMs - a.lastMtimeMs)
}
</script>

<template>
  <div class="page-in min-h-full bg-app-bg p-6 text-text-primary">
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
      <div class="flex items-center justify-between">
        <h1 class="text-xl font-semibold tracking-tight text-text-primary">项目</h1>
        <button
          class="rounded-badge bg-accent px-4 py-2 text-sm text-text-on-accent transition-colors hover:bg-primary-hover active:bg-primary-active"
          @click="openAddModal"
        >
          添加
        </button>
      </div>
      <!-- Same tree as the workbench sidebar: every project starts collapsed and
           only a click opens one. It used to render every chapter of every
           project unconditionally, which read as "everything already expanded".
           Reusing the component keeps the collapse rule in exactly one place. -->
      <div
        class="overflow-hidden rounded-lg border border-border bg-card-bg shadow-[var(--shadow-1)]"
        data-testid="project-index-tree"
      >
        <ProjectTree
          :parents="sortedParents()"
          :child-sort-order="settings.childSortOrder"
          :show-self-check="false"
          :parent-duties="dutyMap"
          @select="onTreeSelect"
          @set-duties="onSetDuties"
        />
      </div>
    </div>

    <ProjectFormModal
      v-if="modalVisible"
      mode="add"
      :existing-parent-titles="workspace.parents.map((parent) => parent.title)"
      @save="onModalSave"
      @cancel="modalVisible = false"
      @delete="modalVisible = false"
    />
  </div>
</template>
