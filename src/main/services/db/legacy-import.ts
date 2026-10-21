import { DatabaseSync } from 'node:sqlite'
import { readFile } from 'node:fs/promises'
import { extname, join, resolve } from 'node:path'
import type { LegacyJsonImportResult } from '@shared/ipc-api'
import { readValueFromDatabase, writeValueToDatabase } from './values'
import {
  type LegacyMemoryFile,
  importProjectMemory,
  mergeLegacyProjects,
  mergeFontManager,
  importKeyValue,
  remapProjectMemory,
  isLegacyMemory,
  isLegacyFontMemory,
  isLegacyMainStore
} from './legacy-merge'
import { readSqliteImportSnapshot, importSqliteSnapshot } from './legacy-snapshot'

export async function readJsonFile(path: string): Promise<Record<string, unknown> | null> {
  try {
    const value = JSON.parse(await readFile(path, 'utf8'))
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

export async function migrateLegacyData(database: DatabaseSync, userData: string): Promise<void> {
  const migrated = database
    .prepare(`SELECT value FROM app_metadata WHERE key = 'legacy_json_migrated'`)
    .get() as { value?: string } | undefined
  if (migrated?.value === '1') return

  const [legacyStore, legacyMemory, legacyFonts] = await Promise.all([
    readJsonFile(join(userData, 'qianzi-gongfang.json')),
    readJsonFile(join(userData, 'config', 'memory.json')),
    readJsonFile(join(userData, 'config', 'font-manager.json'))
  ])

  database.exec('BEGIN IMMEDIATE')
  try {
    const keyValueStatement = database.prepare(`
      INSERT INTO key_value_store (key, value_json, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO NOTHING
    `)
    for (const [key, value] of Object.entries(legacyStore ?? {})) {
      keyValueStatement.run(key, JSON.stringify(value), Date.now())
    }
    if (legacyFonts) {
      keyValueStatement.run('fontManager', JSON.stringify(legacyFonts), Date.now())
    }
    if (legacyMemory) importProjectMemory(database, legacyMemory as LegacyMemoryFile)
    database
      .prepare(
        `INSERT OR REPLACE INTO app_metadata (key, value) VALUES ('legacy_json_migrated', '1')`
      )
      .run()
    database.exec('COMMIT')
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
}

export async function importLegacyJsonFiles(
  paths: string[],
  context: { databasePath: () => string; getDatabase: () => Promise<DatabaseSync> }
): Promise<LegacyJsonImportResult> {
  const result: LegacyJsonImportResult = {
    canceled: false,
    importedFiles: 0,
    skippedFiles: 0,
    projectsAdded: 0,
    memoryProjectsImported: 0,
    fontRecordsImported: 0,
    importedSettings: 0,
    warnings: []
  }
  const targetPath = resolve(context.databasePath())
  const files = await Promise.all(
    paths.map(async (path) => {
      const kind = ['.sqlite', '.sqlite3', '.db'].includes(extname(path).toLocaleLowerCase())
        ? ('sqlite' as const)
        : ('json' as const)
      return { path, kind, value: kind === 'json' ? await readJsonFile(path) : null }
    })
  )
  const database = await context.getDatabase()
  const childIdMap = new Map<string, string>()
  const pendingJsonMemories: LegacyMemoryFile[] = []
  database.exec('BEGIN IMMEDIATE')
  try {
    for (const file of files) {
      if (file.kind === 'sqlite') {
        if (resolve(file.path) === targetPath) {
          result.skippedFiles += 1
          result.warnings.push(`${file.path}：不能导入当前正在使用的数据库`)
          continue
        }
        const snapshot = readSqliteImportSnapshot(file.path)
        if (!snapshot) {
          result.skippedFiles += 1
          result.warnings.push(`${file.path}：不是兼容的汉化工坊 SQLite 数据库`)
          continue
        }
        const sqliteChildIdMap = importSqliteSnapshot(database, snapshot, result)
        for (const [sourceId, targetId] of sqliteChildIdMap) {
          childIdMap.set(sourceId, targetId)
        }
        result.importedFiles += 1
        continue
      }

      if (!file.value) {
        result.skippedFiles += 1
        result.warnings.push(`${file.path}：不是有效的 JSON 文件`)
        continue
      }

      if (isLegacyMemory(file.value)) {
        pendingJsonMemories.push(file.value)
        result.importedFiles += 1
        continue
      }

      if (isLegacyFontMemory(file.value)) {
        result.fontRecordsImported += mergeFontManager(database, file.value)
        result.importedFiles += 1
        continue
      }

      if (isLegacyMainStore(file.value)) {
        for (const [key, value] of Object.entries(file.value)) {
          if (key === 'projects') {
            const merged = mergeLegacyProjects(readValueFromDatabase(database, 'projects'), value)
            writeValueToDatabase(database, 'projects', merged.projects)
            result.projectsAdded += merged.added
            for (const [sourceId, targetId] of merged.childIdMap) {
              childIdMap.set(sourceId, targetId)
            }
          } else if (importKeyValue(database, key, value)) {
            result.importedSettings += 1
          }
        }
        result.importedFiles += 1
        continue
      }

      result.skippedFiles += 1
      result.warnings.push(`${file.path}：无法识别旧版数据类型`)
    }
    for (const memory of pendingJsonMemories) {
      result.memoryProjectsImported += importProjectMemory(
        database,
        remapProjectMemory(memory, childIdMap),
        true
      )
    }
    database.exec('COMMIT')
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
  return result
}
