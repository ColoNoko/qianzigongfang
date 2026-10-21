import { DatabaseSync } from 'node:sqlite'
import { dirname } from 'node:path'
import { storedModeStatus, normalizeModeTimestamps } from '@shared/modes'
import type { LegacyJsonImportResult, ProjectMemory } from '@shared/ipc-api'
import { readValueFromDatabase, writeValueToDatabase } from './values'
import {
  type LegacyMemoryFile,
  importProjectMemory,
  mergeLegacyProjects,
  mergeFontManager,
  importKeyValue,
  remapProjectMemory
} from './legacy-merge'

export interface SqliteImportSnapshot {
  values: Record<string, unknown>
  memory: LegacyMemoryFile
}

export function readSqliteImportSnapshot(path: string): SqliteImportSnapshot | null {
  let source: DatabaseSync | null = null
  try {
    source = new DatabaseSync(path, { readOnly: true })
    const tableRows = source
      .prepare(`SELECT name FROM sqlite_schema WHERE type = 'table'`)
      .all() as Array<{ name: string }>
    const tables = new Set(tableRows.map((row) => row.name))
    if (
      !tables.has('key_value_store') &&
      !tables.has('project_memory') &&
      !tables.has('project_memory_files')
    ) {
      return null
    }

    const values: Record<string, unknown> = {}
    if (tables.has('key_value_store')) {
      const rows = source.prepare('SELECT key, value_json FROM key_value_store').all() as Array<{
        key: string
        value_json: string
      }>
      for (const row of rows) {
        try {
          values[row.key] = JSON.parse(row.value_json)
        } catch {
          // A broken setting must not prevent the remaining database migration.
        }
      }
    }

    const projects: Record<string, ProjectMemory> = {}
    if (tables.has('project_memory')) {
      const rows = source
        .prepare('SELECT child_id, folder_path, updated_at FROM project_memory')
        .all() as Array<{ child_id: string; folder_path: string; updated_at: number }>
      for (const row of rows) {
        projects[row.child_id] = {
          childId: row.child_id,
          folderPath: row.folder_path,
          updatedAt: row.updated_at,
          files: {}
        }
      }
    }
    if (tables.has('project_memory_files')) {
      const columns = new Set(
        (
          source.prepare('PRAGMA table_info(project_memory_files)').all() as Array<{ name: string }>
        ).map((column) => column.name)
      )
      const optional = (name: string): string => (columns.has(name) ? name : `'{}' AS ${name}`)
      const rows = source
        .prepare(
          `SELECT child_id, path_key, path, status, mtime_ms, updated_at,
            ${optional('mode_statuses_json')}, ${optional('mode_timestamps_json')}
           FROM project_memory_files`
        )
        .all() as Array<{
        child_id: string
        path_key: string
        path: string
        mode_statuses_json: string
        mode_timestamps_json: string
        status: 'done' | 'pending'
        mtime_ms: number
        updated_at: number
      }>
      for (const row of rows) {
        if (row.status !== 'done' && row.status !== 'pending') continue
        projects[row.child_id] ??= {
          childId: row.child_id,
          folderPath: dirname(row.path),
          updatedAt: row.updated_at,
          files: {}
        }
        let timestamps = {}
        try {
          timestamps = normalizeModeTimestamps(JSON.parse(row.mode_timestamps_json))
        } catch {
          /* Preserve readable fields. */
        }
        projects[row.child_id].files[row.path_key] = {
          path: row.path,
          status: row.status,
          modes: storedModeStatus(row.mode_statuses_json, row.status),
          modeTimestamps: timestamps,
          mtimeMs: row.mtime_ms,
          updatedAt: row.updated_at
        }
      }
    }
    return { values, memory: { projects } }
  } catch {
    return null
  } finally {
    source?.close()
  }
}

export function importSqliteSnapshot(
  database: DatabaseSync,
  snapshot: SqliteImportSnapshot,
  result: LegacyJsonImportResult
): Map<string, string> {
  let childIdMap = new Map<string, string>()
  for (const [key, value] of Object.entries(snapshot.values)) {
    if (key === 'projects') {
      const merged = mergeLegacyProjects(readValueFromDatabase(database, key), value)
      writeValueToDatabase(database, key, merged.projects)
      result.projectsAdded += merged.added
      childIdMap = merged.childIdMap
    } else if (key === 'fontManager') {
      result.fontRecordsImported += mergeFontManager(database, value)
    } else if (importKeyValue(database, key, value)) {
      result.importedSettings += 1
    }
  }
  result.memoryProjectsImported += importProjectMemory(
    database,
    remapProjectMemory(snapshot.memory, childIdMap),
    true
  )
  return childIdMap
}
