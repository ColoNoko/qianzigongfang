import { DatabaseSync } from 'node:sqlite'
import type { ProjectMemory } from '@shared/ipc-api'
import { storedModeStatus, normalizeModeTimestamps, modeStatusToLegacyStatus } from '@shared/modes'
import { readValueFromDatabase, writeValueToDatabase } from './values'

/**
 * 连接层（2026-10-01 P4 第一步：从 1318 行的 database.ts 里切出来的第一块）。
 *
 * 这里管**"库怎么打开"**这一件事：库文件在哪、建表、把旧数据搬进来、拿到连接、关掉它。
 * 不在这里做的事：**问领域问题**（单话标记、统计、台账、撤销/还原、快照）—— 那些留在
 * `./database`，它们通过 `getDatabase()` 拿连接。
 *
 * ⚠️ 为什么"旧数据导入"（`importLegacyJsonFiles`）也跟着来了这边：它与迁移块**共用同一批
 * 帮手**（`readJsonFile` / `readValueFromDatabase` / `writeValueToDatabase` /
 * `mergeLegacyProjects`）。若把它留在 database.ts，两边就得互相 import —— 直接成环。
 *
 * 对外的 import 路径没变：`./database` 仍然把这些名字 re-export 出去。
 */

export interface LegacyMemoryFile {
  projects?: Record<string, ProjectMemory>
}

export function importProjectMemory(
  database: DatabaseSync,
  memory: LegacyMemoryFile,
  preserveExisting = false
): number {
  const projectStatement = database.prepare(
    preserveExisting
      ? `
    INSERT INTO project_memory (child_id, folder_path, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(child_id) DO NOTHING
  `
      : `
    INSERT INTO project_memory (child_id, folder_path, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(child_id) DO UPDATE SET
      folder_path = excluded.folder_path,
      updated_at = excluded.updated_at
  `
  )
  const fileStatement = database.prepare(
    preserveExisting
      ? `
    INSERT INTO project_memory_files
      (child_id, path_key, path, status, mtime_ms, updated_at, mode_statuses_json, mode_timestamps_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(child_id, path_key) DO NOTHING
  `
      : `
    INSERT INTO project_memory_files
      (child_id, path_key, path, status, mtime_ms, updated_at, mode_statuses_json, mode_timestamps_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(child_id, path_key) DO UPDATE SET
      path = excluded.path,
      status = excluded.status,
      mode_statuses_json = excluded.mode_statuses_json,
      mode_timestamps_json = excluded.mode_timestamps_json,
      mtime_ms = excluded.mtime_ms,
      updated_at = excluded.updated_at
  `
  )

  let imported = 0
  for (const project of Object.values(memory.projects ?? {})) {
    if (!project || typeof project.childId !== 'string' || !project.childId) continue
    let changed =
      Number(
        projectStatement.run(
          project.childId,
          typeof project.folderPath === 'string' ? project.folderPath : '',
          Number.isFinite(project.updatedAt) ? project.updatedAt : Date.now()
        ).changes
      ) > 0
    const files =
      project.files && typeof project.files === 'object' && !Array.isArray(project.files)
        ? project.files
        : {}
    for (const [pathKey, file] of Object.entries(files)) {
      if (
        !file ||
        typeof file.path !== 'string' ||
        (file.status !== 'done' && file.status !== 'pending')
      ) {
        continue
      }
      const modes = storedModeStatus(JSON.stringify(file.modes), file.status)
      const fileResult = fileStatement.run(
        project.childId,
        pathKey,
        file.path,
        modeStatusToLegacyStatus(modes),
        Number.isFinite(file.mtimeMs) ? file.mtimeMs : 0,
        Number.isFinite(file.updatedAt) ? file.updatedAt : Date.now(),
        JSON.stringify(modes),
        JSON.stringify(normalizeModeTimestamps(file.modeTimestamps))
      )
      changed ||= Number(fileResult.changes) > 0
    }
    if (changed) imported += 1
  }
  return imported
}

export function normalizeImportedPath(path: unknown): string {
  return typeof path === 'string'
    ? path.replace(/\\/g, '/').replace(/\/+$/, '').normalize('NFC').toLocaleLowerCase()
    : ''
}

export function mergeLegacyProjects(
  currentValue: unknown,
  importedValue: unknown
): { projects: unknown[]; added: number; childIdMap: Map<string, string> } {
  const current = Array.isArray(currentValue)
    ? (structuredClone(currentValue) as Array<Record<string, unknown>>)
    : []
  const imported = Array.isArray(importedValue)
    ? (importedValue as Array<Record<string, unknown>>)
    : []
  const existingChildrenByPath = new Map<string, string>()
  const existingChildIds = new Set<string>()
  for (const parent of current) {
    if (!Array.isArray(parent.children)) continue
    for (const child of parent.children as Array<Record<string, unknown>>) {
      const path = normalizeImportedPath(child.folderPath)
      if (typeof child.id !== 'string') continue
      existingChildIds.add(child.id)
      if (path) existingChildrenByPath.set(path, child.id)
    }
  }

  let added = 0
  const childIdMap = new Map<string, string>()
  for (const importedParent of imported) {
    if (!Array.isArray(importedParent.children)) continue
    const missingChildren = (importedParent.children as Array<Record<string, unknown>>).filter(
      (child) => {
        const path = normalizeImportedPath(child.folderPath)
        const importedId = typeof child.id === 'string' ? child.id : ''
        const existingId = existingChildrenByPath.get(path)
        if (!path || !importedId || existingId || existingChildIds.has(importedId)) {
          if (importedId && existingId) childIdMap.set(importedId, existingId)
          else if (importedId && existingChildIds.has(importedId)) {
            childIdMap.set(importedId, importedId)
          }
          return false
        }
        if (importedId) {
          existingChildrenByPath.set(path, importedId)
          existingChildIds.add(importedId)
          childIdMap.set(importedId, importedId)
        }
        return true
      }
    )
    if (missingChildren.length === 0) continue

    const target = current.find(
      (parent) =>
        parent.id === importedParent.id ||
        (typeof parent.title === 'string' && parent.title === importedParent.title)
    )
    if (target && Array.isArray(target.children)) {
      const targetChildren = target.children as unknown[]
      const targetTitle =
        typeof target.title === 'string' ? target.title : String(importedParent.title ?? '')
      targetChildren.push(
        ...structuredClone(missingChildren).map((child) => ({
          ...child,
          parentTitle: targetTitle
        }))
      )
      target.lastMtimeMs = (target.children as Array<Record<string, unknown>>).reduce(
        (latest, child) =>
          Math.max(latest, typeof child.lastMtimeMs === 'number' ? child.lastMtimeMs : 0),
        0
      )
    } else {
      const clonedChildren = structuredClone(missingChildren)
      current.push({
        ...structuredClone(importedParent),
        children: clonedChildren,
        lastMtimeMs: clonedChildren.reduce(
          (latest, child) =>
            Math.max(latest, typeof child.lastMtimeMs === 'number' ? child.lastMtimeMs : 0),
          0
        )
      })
    }
    added += missingChildren.length
  }
  return { projects: current, added, childIdMap }
}

export function mergeFontManager(database: DatabaseSync, importedValue: unknown): number {
  if (!importedValue || typeof importedValue !== 'object' || Array.isArray(importedValue)) return 0
  const imported = importedValue as { installed?: Record<string, unknown> }
  if (!imported.installed || typeof imported.installed !== 'object') return 0
  const current = readValueFromDatabase(database, 'fontManager') as
    { installed?: Record<string, unknown> } | undefined
  const currentInstalled = current?.installed ?? {}
  const importedIds = Object.keys(imported.installed).filter((id) => !(id in currentInstalled))
  writeValueToDatabase(database, 'fontManager', {
    version: 1,
    installed: { ...imported.installed, ...currentInstalled }
  })
  return importedIds.length
}

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

export function importKeyValue(
  database: DatabaseSync,
  key: string,
  importedValue: unknown
): boolean {
  const currentValue = readValueFromDatabase(database, key)
  if (key === 'psdStatusOverrides') {
    writeValueToDatabase(database, key, {
      ...(isPlainRecord(importedValue) ? importedValue : {}),
      ...(isPlainRecord(currentValue) ? currentValue : {})
    })
    return true
  }
  if (key === 'recentProjectIds') {
    const current = Array.isArray(currentValue)
      ? currentValue.filter((value): value is string => typeof value === 'string')
      : []
    const imported = Array.isArray(importedValue)
      ? importedValue.filter((value): value is string => typeof value === 'string')
      : []
    writeValueToDatabase(database, key, [...new Set([...current, ...imported])])
    return true
  }
  // A migration fills missing preferences but must not roll back preferences
  // already changed in the destination app.
  if (currentValue !== undefined) return false
  writeValueToDatabase(database, key, importedValue)
  return true
}

export function remapProjectMemory(
  memory: LegacyMemoryFile,
  childIdMap: Map<string, string>
): LegacyMemoryFile {
  const projects: Record<string, ProjectMemory> = {}
  for (const project of Object.values(memory.projects ?? {})) {
    const childId = childIdMap.get(project.childId) ?? project.childId
    const current = projects[childId]
    projects[childId] = current
      ? { ...current, files: { ...project.files, ...current.files } }
      : { ...project, childId }
  }
  return { projects }
}

export function isLegacyMemory(
  value: Record<string, unknown>
): value is Record<string, unknown> & LegacyMemoryFile {
  return Boolean(
    value.projects && typeof value.projects === 'object' && !Array.isArray(value.projects)
  )
}

export function isLegacyFontMemory(value: Record<string, unknown>): boolean {
  return Boolean(
    value.installed && typeof value.installed === 'object' && !Array.isArray(value.installed)
  )
}

export function isLegacyMainStore(value: Record<string, unknown>): boolean {
  return (
    Array.isArray(value.projects) ||
    'recentProjectIds' in value ||
    'psdStatusOverrides' in value ||
    'ui.thumbSize' in value ||
    'theme' in value
  )
}
