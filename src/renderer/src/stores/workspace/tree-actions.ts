import type { WorkMode } from '@shared/types'
import { useAchievementsStore } from '../achievements'
import { useToastStore } from '../toast'
import { normalizeDuties } from '@shared/duties'
import {
  syncDashboardStore,
  recomputeParentMtimes,
  snapshotParents,
  hydrateParents
} from './helpers'
import type { WorkspaceContext } from './context'

export const treeActions = {
  async loadParents(this: WorkspaceContext): Promise<void> {
    const tree = await window.comicType.projectGetTree()
    this.parents = hydrateParents(tree)
  },
  async deleteChild(this: WorkspaceContext, _parentId: string, childId: string): Promise<void> {
    await this.deleteChildren([childId])
  },
  async deleteChildren(this: WorkspaceContext, childIds: string[]): Promise<void> {
    const ids = new Set(childIds)
    if (ids.size === 0) return

    await window.comicType.projectDeleteChildren([...ids])

    let parents = this.parents
      .map((parent) => ({
        ...parent,
        children: parent.children.filter((child) => !ids.has(child.id))
      }))
      .filter((parent) => parent.children.length > 0)
    parents = recomputeParentMtimes(parents)

    this.parents = parents

    if (this.activeChild && ids.has(this.activeChild.id)) {
      this.clearActiveChild()
    }

    syncDashboardStore(parents)
    // 记录随话一起删掉了 → 重算一次成就（数字自然跟着掉）
    await useAchievementsStore().refresh()
  },
  async setParentDuties(
    this: WorkspaceContext,
    parentId: string,
    duties: WorkMode[]
  ): Promise<void> {
    const clean = normalizeDuties(duties)
    try {
      await window.comicType.projectSetParentDuties(parentId, clean)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      useToastStore().addToast({ type: 'error', message: `设置职责失败：${message}` })
      return
    }
    this.parents = this.parents.map((parent) => {
      if (parent.id !== parentId) return parent
      return { ...parent, duties: clean }
    })
    syncDashboardStore(this.parents)
  },
  async renameParent(this: WorkspaceContext, parentId: string, nextTitle: string): Promise<void> {
    const title = nextTitle.trim()
    if (!title) return

    await window.comicType.projectRenameParent(parentId, title)

    let parents = this.parents.map((parent) => {
      if (parent.id !== parentId) return parent
      return {
        ...parent,
        title,
        children: parent.children.map((child) => ({
          ...child,
          parentTitle: title
        }))
      }
    })
    parents = recomputeParentMtimes(parents)

    this.parents = parents

    if (
      this.activeChild &&
      parents.some((parent) => parent.children.some((child) => child.id === this.activeChild?.id))
    ) {
      const updated = this.findChild(this.activeChild.id)
      if (updated) {
        this.activeChild = updated
      }
    }

    syncDashboardStore(parents)
  },
  async reorderParent(
    this: WorkspaceContext,
    sourceParentId: string,
    targetParentId: string
  ): Promise<void> {
    const sourceIndex = this.parents.findIndex((parent) => parent.id === sourceParentId)
    const targetIndex = this.parents.findIndex((parent) => parent.id === targetParentId)
    if (sourceIndex === -1 || targetIndex === -1 || sourceIndex === targetIndex) return

    await window.comicType.projectReorderParents(sourceParentId, targetParentId)

    const parents = snapshotParents(this.parents)
    const [moved] = parents.splice(sourceIndex, 1)
    parents.splice(targetIndex, 0, moved)
    this.parents = parents
    syncDashboardStore(parents)
  }
}
