import type { ChildProject, ParentProject } from '@shared/types'
import { compareChapterNumbersByOrder, type ChildSortOrder } from '@shared/chapter'

function orderedChildren(parent: ParentProject, sortOrder: ChildSortOrder): ChildProject[] {
  return [...parent.children].sort((left, right) =>
    compareChapterNumbersByOrder(left.chapterNumber, right.chapterNumber, sortOrder)
  )
}

/**
 * Pick a deterministic destination before deleting the active child.
 *
 * Prefer the next visible chapter in the same comic, then the previous
 * chapter. Only when that comic has no remaining chapters do we cross into
 * the next/previous comic in the user's saved parent order.
 */
export function findChildAfterDeletion(
  parents: ParentProject[],
  activeChildId: string,
  childIdsToDelete: Iterable<string>,
  sortOrder: ChildSortOrder = 'ascending'
): ChildProject | null {
  const deletedIds = new Set(childIdsToDelete)
  const activeParentIndex = parents.findIndex((parent) =>
    parent.children.some((child) => child.id === activeChildId)
  )
  if (activeParentIndex < 0) return null

  const activeParent = parents[activeParentIndex]
  const activeSiblings = orderedChildren(activeParent, sortOrder)
  const activeIndex = activeSiblings.findIndex((child) => child.id === activeChildId)

  for (let index = activeIndex + 1; index < activeSiblings.length; index += 1) {
    if (!deletedIds.has(activeSiblings[index].id)) return activeSiblings[index]
  }
  for (let index = activeIndex - 1; index >= 0; index -= 1) {
    if (!deletedIds.has(activeSiblings[index].id)) return activeSiblings[index]
  }

  for (let parentIndex = activeParentIndex + 1; parentIndex < parents.length; parentIndex += 1) {
    const child = orderedChildren(parents[parentIndex], sortOrder).find(
      (item) => !deletedIds.has(item.id)
    )
    if (child) return child
  }
  for (let parentIndex = activeParentIndex - 1; parentIndex >= 0; parentIndex -= 1) {
    const children = orderedChildren(parents[parentIndex], sortOrder).filter(
      (item) => !deletedIds.has(item.id)
    )
    if (children.length > 0) return children.at(-1) ?? null
  }

  return null
}
