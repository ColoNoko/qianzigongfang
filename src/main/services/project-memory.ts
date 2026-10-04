import type { ProjectMemory, ProjectMemoryStatusUpdate } from '@shared/ipc-api'
import type { MarkAuditContext } from '@shared/mark-audit'
import {
  getProjectMemory as getProjectMemoryFromRepository,
  removeProjectMemory as removeProjectMemoryFromRepository,
  setProjectMemoryStatuses as setProjectMemoryStatusesFromRepository
} from './project-repository'

export function getProjectMemory(childId: string): Promise<ProjectMemory | null> {
  return getProjectMemoryFromRepository(childId)
}

export function setProjectMemoryStatuses(
  childId: string,
  folderPath: string,
  updates: ProjectMemoryStatusUpdate[],
  audit?: MarkAuditContext
): Promise<void> {
  return setProjectMemoryStatusesFromRepository(childId, folderPath, updates, audit)
}

export function removeProjectMemory(childId: string): Promise<void> {
  return removeProjectMemoryFromRepository(childId)
}
