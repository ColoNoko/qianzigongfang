import { app } from 'electron'
import { DatabaseSync } from 'node:sqlite'
import { mkdir, readFile } from 'node:fs/promises'
import { dirname, extname, join, resolve } from 'node:path'
import type { LegacyJsonImportResult, ProjectMemory } from '@shared/ipc-api'

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

interface LegacyMemoryFile {
  projects?: Record<string, ProjectMemory>
}

interface SqliteImportSnapshot {
  values: Record<string, unknown>
  memory: LegacyMemoryFile
}

let databasePromise: Promise<DatabaseSync> | null = null
// Resolved handle for callers that must write during shutdown, where awaiting a
// promise is not an option (see setStoredValueSync).
let databaseInstance: DatabaseSync | null = null

export function databasePath(): string {
  return join(app.getPath('userData'), 'database', 'qianzi-gongfang.sqlite')
}

async function readJsonFile(path: string): Promise<Record<string, unknown> | null> {
  try {
    const value = JSON.parse(await readFile(path, 'utf8'))
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

function createSchema(database: DatabaseSync): void {
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;

    CREATE TABLE IF NOT EXISTS app_metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS key_value_store (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS project_memory (
      child_id TEXT PRIMARY KEY,
      folder_path TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );

    /*
     * 标记台账（第十四轮）：每次标记写入都在**同一个事务**里留一条流水。
     *
     * 一行 = "一次操作碰到的某一话"；op_id 把同一次用户操作的所有行串起来
     * （侧栏批量标记会逐话写库，没有它，一次点击在台账里会变成十几条散记录）。
     * entries_json 存逐文件的"改之前 / 改之后"（模式 + 时间戳），撤销就是把它读回来写。
     * ⚠️ 这段注释在 JS 模板字符串里，**不能出现反引号**（会提前把字符串截断）。
     */
    CREATE TABLE IF NOT EXISTS mark_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      op_id TEXT NOT NULL,
      at INTEGER NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('mark', 'migrate', 'undo', 'restore')),
      source TEXT NOT NULL,
      mode TEXT,
      target_status TEXT,
      ref_op_id TEXT,
      note TEXT,
      child_id TEXT NOT NULL,
      folder_path TEXT NOT NULL,
      entries_json TEXT NOT NULL,
      skipped INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_mark_audit_op ON mark_audit (op_id);
    CREATE INDEX IF NOT EXISTS idx_mark_audit_at ON mark_audit (at DESC);

    CREATE TABLE IF NOT EXISTS project_memory_files (
      child_id TEXT NOT NULL,
      path_key TEXT NOT NULL,
      path TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('done', 'pending')),
      mtime_ms REAL NOT NULL,
      updated_at INTEGER NOT NULL,
      mode_statuses_json TEXT NOT NULL DEFAULT '{}',
      mode_timestamps_json TEXT NOT NULL DEFAULT '{}',
      PRIMARY KEY (child_id, path_key),
      FOREIGN KEY (child_id) REFERENCES project_memory(child_id) ON DELETE CASCADE
    );
  `)

  // 兼容旧数据库：旧表没有 mode_statuses_json 时补列。
  const fileColumns = database.prepare(`PRAGMA table_info(project_memory_files)`).all() as Array<{
    name: string
  }>
  if (!fileColumns.some((column) => column.name === 'mode_statuses_json')) {
    database.exec(`
      ALTER TABLE project_memory_files
      ADD COLUMN mode_statuses_json TEXT NOT NULL DEFAULT '{}'
    `)
  }
  if (!fileColumns.some((column) => column.name === 'mode_timestamps_json')) {
    database.exec(`
      ALTER TABLE project_memory_files
      ADD COLUMN mode_timestamps_json TEXT NOT NULL DEFAULT '{}'
    `)
  }
}

function importProjectMemory(
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
      (child_id, path_key, path, status, mtime_ms, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(child_id, path_key) DO NOTHING
  `
      : `
    INSERT INTO project_memory_files
      (child_id, path_key, path, status, mtime_ms, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(child_id, path_key) DO UPDATE SET
      path = excluded.path,
      status = excluded.status,
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
      const fileResult = fileStatement.run(
        project.childId,
        pathKey,
        file.path,
        file.status,
        Number.isFinite(file.mtimeMs) ? file.mtimeMs : 0,
        Number.isFinite(file.updatedAt) ? file.updatedAt : Date.now()
      )
      changed ||= Number(fileResult.changes) > 0
    }
    if (changed) imported += 1
  }
  return imported
}

export function readValueFromDatabase(database: DatabaseSync, key: string): unknown {
  const row = database.prepare('SELECT value_json FROM key_value_store WHERE key = ?').get(key) as
    { value_json?: string } | undefined
  if (!row?.value_json) return undefined
  try {
    return JSON.parse(row.value_json)
  } catch {
    return undefined
  }
}

export function writeValueToDatabase(database: DatabaseSync, key: string, value: unknown): void {
  database
    .prepare(
      `
      INSERT INTO key_value_store (key, value_json, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value_json = excluded.value_json,
        updated_at = excluded.updated_at
    `
    )
    .run(key, JSON.stringify(value ?? null), Date.now())
}

function normalizeImportedPath(path: unknown): string {
  return typeof path === 'string'
    ? path.replace(/\\/g, '/').replace(/\/+$/, '').normalize('NFC').toLocaleLowerCase()
    : ''
}

function mergeLegacyProjects(
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

function mergeFontManager(database: DatabaseSync, importedValue: unknown): number {
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

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function importKeyValue(database: DatabaseSync, key: string, importedValue: unknown): boolean {
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

function remapProjectMemory(
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

function readSqliteImportSnapshot(path: string): SqliteImportSnapshot | null {
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
      const rows = source
        .prepare(
          `SELECT child_id, path_key, path, status, mtime_ms, updated_at
           FROM project_memory_files`
        )
        .all() as Array<{
        child_id: string
        path_key: string
        path: string
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
        projects[row.child_id].files[row.path_key] = {
          path: row.path,
          status: row.status,
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

function importSqliteSnapshot(
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

function isLegacyMemory(
  value: Record<string, unknown>
): value is Record<string, unknown> & LegacyMemoryFile {
  return Boolean(
    value.projects && typeof value.projects === 'object' && !Array.isArray(value.projects)
  )
}

function isLegacyFontMemory(value: Record<string, unknown>): boolean {
  return Boolean(
    value.installed && typeof value.installed === 'object' && !Array.isArray(value.installed)
  )
}

function isLegacyMainStore(value: Record<string, unknown>): boolean {
  return (
    Array.isArray(value.projects) ||
    'recentProjectIds' in value ||
    'psdStatusOverrides' in value ||
    'ui.thumbSize' in value ||
    'theme' in value
  )
}

async function migrateLegacyData(database: DatabaseSync): Promise<void> {
  const migrated = database
    .prepare(`SELECT value FROM app_metadata WHERE key = 'legacy_json_migrated'`)
    .get() as { value?: string } | undefined
  if (migrated?.value === '1') return

  const userData = app.getPath('userData')
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

async function openDatabase(): Promise<DatabaseSync> {
  const path = databasePath()
  await mkdir(dirname(path), { recursive: true })
  const database = new DatabaseSync(path)
  createSchema(database)
  await migrateLegacyData(database)
  return database
}

export function getDatabase(): Promise<DatabaseSync> {
  if (!databasePromise) {
    databasePromise = openDatabase()
      .then((database) => {
        databaseInstance = database
        return database
      })
      .catch((error) => {
        // Do not permanently cache a transient startup failure (for example a
        // temporarily locked or unavailable portable data directory). A later
        // IPC call should be able to retry after the filesystem recovers.
        databasePromise = null
        databaseInstance = null
        throw error
      })
  }
  return databasePromise
}

export async function importLegacyJsonFiles(paths: string[]): Promise<LegacyJsonImportResult> {
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
  const targetPath = resolve(databasePath())
  const files = await Promise.all(
    paths.map(async (path) => {
      const kind = ['.sqlite', '.sqlite3', '.db'].includes(extname(path).toLocaleLowerCase())
        ? ('sqlite' as const)
        : ('json' as const)
      return { path, kind, value: kind === 'json' ? await readJsonFile(path) : null }
    })
  )
  const database = await getDatabase()
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

export async function closeDatabase(): Promise<void> {
  if (!databasePromise) return
  const database = await databasePromise
  database.close()
  databasePromise = null
  databaseInstance = null
}
/** 已解析的连接（同步场景用：关闭期不能 await 一个 promise）。没有则返回 null。 */
export function getDatabaseSync(): DatabaseSync | null {
  return databaseInstance
}
