import type {
  ChildProject,
  ParentProject,
  JpgPsdPair,
  PsdStat,
  WorkMode,
  WorkModeStatus
} from '@shared/types'
import type { MarkWriteBackResult } from '@shared/ipc-api'
import { type MarkAuditContext, type MarkAuditOperation } from '@shared/mark-audit'
import {
  type PsdStatusOverride,
  type SaveChildPayload,
  type ImportResult,
  type ScannedChildProject
} from './helpers'

export interface WorkspaceContext {
  parents: ParentProject[]
  activeChild: ChildProject | null
  psdStats: PsdStat[]
  scannedImages: { childId: string; files: string[] }
  txtFiles: string[]
  thumbUrlCache: Map<string, string>
  psdStatusOverrides: Record<string, PsdStatusOverride>
  psdModeStatuses: Record<string, WorkModeStatus>
  psdModeTimestamps: Record<string, Partial<Record<WorkMode, number>>>
  psdStatusOverridesLoaded: boolean
  findChild(childId: string): ChildProject | null

  persistParentsProgress(current?: () => boolean): Promise<void>
  loadRememberedStatuses(
    child: ChildProject,
    pairs: JpgPsdPair[],
    current?: () => boolean
  ): Promise<void>
  rememberStatuses(
    child: ChildProject,
    pairs: JpgPsdPair[],
    status: PsdStatusOverride,
    modes?: Partial<Record<WorkMode, boolean>>,
    audit?: MarkAuditContext
  ): Promise<void>
  rememberModeStatuses(
    child: ChildProject,
    pairs: JpgPsdPair[],
    mode: WorkMode,
    value: boolean,
    audit?: MarkAuditContext
  ): Promise<void>
  setActiveChild(child: ChildProject | null, stats: PsdStat[]): void
  clearActiveChild(): void
  scanChild(
    child: ChildProject,
    callerCurrent?: () => boolean,
    cached?: unknown
  ): Promise<JpgPsdPair[]>
  ensurePsdStatusOverridesLoaded(): Promise<void>
  reloadPsdStatusOverrides(): Promise<void>
  applyPsdStatusOverrides(pairs: JpgPsdPair[]): JpgPsdPair[]
  markChildProjects(
    childIds: string[],
    status: PsdStatusOverride,
    mode?: WorkMode
  ): Promise<{ cancelled: boolean; marked: number; skipped: string[] }>
  listMarkAudit(limit?: unknown): Promise<MarkAuditOperation[]>
  findUndoableMark(): Promise<MarkAuditOperation | null>
  undoMarkOperation(opId: string): Promise<MarkWriteBackResult | null>
  debouncedScan(child: ChildProject | null): void
  cancelDebouncedScan(): void
  readThumbUrl(absPath: string): Promise<string>
  clearCaches(): void
  loadParents(): Promise<void>
  deleteChild(_parentId: string, childId: string): Promise<void>
  deleteChildren(childIds: string[]): Promise<void>
  setParentDuties(parentId: string, duties: WorkMode[]): Promise<void>
  renameParent(parentId: string, nextTitle: string): Promise<void>
  reorderParent(sourceParentId: string, targetParentId: string): Promise<void>
  saveChild(payload: SaveChildPayload, existingChildId?: string, onProgress?: (message: string) => void): Promise<ImportResult>
  scanForImport(payload: SaveChildPayload): Promise<ScannedChildProject>
}
