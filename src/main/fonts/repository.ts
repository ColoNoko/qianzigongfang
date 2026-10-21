import { app } from 'electron'
import { mkdirSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { parseFontFile, type FontMetadata } from './metadata'
import type { FontListResult } from '@shared/ipc-api'

const PARSER_VERSION = 2
let database: DatabaseSync | undefined
let databaseFile = ''
const pending = new Map<string, Promise<FontMetadata[]>>()
function db(): DatabaseSync {
  const directory = join(app.getPath('userData'), 'cache', 'fonts')
  const file = join(directory, 'catalog.sqlite')
  if (database && databaseFile === file) return database
  database?.close()
  mkdirSync(directory, { recursive: true })
  database = new DatabaseSync(file)
  databaseFile = file
  database.exec(`CREATE TABLE IF NOT EXISTS metadata(path TEXT PRIMARY KEY, signature TEXT NOT NULL, version INTEGER NOT NULL, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS snapshots(scope TEXT PRIMARY KEY, version INTEGER NOT NULL, value TEXT NOT NULL);`)
  database.prepare('DELETE FROM metadata WHERE version <> ?').run(PARSER_VERSION)
  database.prepare('DELETE FROM snapshots WHERE version <> ?').run(PARSER_VERSION)
  return database
}
export function readSnapshot(scope: string): FontListResult | undefined {
  const row = db().prepare('SELECT value FROM snapshots WHERE scope=?').get(scope) as
    { value: string } | undefined
  try {
    const value = row ? JSON.parse(row.value) : undefined
    return value &&
      Array.isArray(value.fonts) &&
      typeof value.supported === 'boolean' &&
      Number.isFinite(value.scannedAt)
      ? value
      : undefined
  } catch {
    return undefined
  }
}
export function writeSnapshot(scope: string, value: FontListResult): void {
  db()
    .prepare('INSERT OR REPLACE INTO snapshots VALUES(?,?,?)')
    .run(scope, PARSER_VERSION, JSON.stringify(value))
}
export function invalidateFontMetadata(path: string): void {
  db().prepare('DELETE FROM metadata WHERE path=?').run(resolve(path).toLowerCase())
}
export function readFontMetadata(path: string): Promise<FontMetadata[]> {
  const key = resolve(path).toLowerCase()
  const existing = pending.get(key)
  if (existing) return existing
  const task = (async () => {
    const before = await stat(path)
    const signature = `${before.size}:${before.mtimeMs}`
    let row: { value: string } | undefined
    try {
      row = db()
        .prepare('SELECT value FROM metadata WHERE path=? AND signature=? AND version=?')
        .get(key, signature, PARSER_VERSION) as { value: string } | undefined
    } catch {
      /* Metadata remains usable without persistent caching. */
    }
    if (row) {
      try {
        return JSON.parse(row.value) as FontMetadata[]
      } catch {
        /* Reparse corrupt cache. */
      }
    }
    const metadata = await parseFontFile(path)
    const after = await stat(path)
    if (after.size !== before.size || after.mtimeMs !== before.mtimeMs)
      throw new Error('字体文件在扫描期间变化，请刷新重试')
    try {
      db()
        .prepare('INSERT OR REPLACE INTO metadata VALUES(?,?,?,?)')
        .run(key, signature, PARSER_VERSION, JSON.stringify(metadata))
      db().exec(
        'DELETE FROM metadata WHERE rowid NOT IN (SELECT rowid FROM metadata ORDER BY rowid DESC LIMIT 20000)'
      )
    } catch {
      /* A full or unavailable cache must not hide fonts. */
    }
    return metadata
  })()
  pending.set(key, task)
  void task.then(
    () => pending.delete(key),
    () => pending.delete(key)
  )
  return task
}

export function clearSnapshot(): void {
  try {
    db().prepare('DELETE FROM snapshots WHERE scope=?').run('system')
  } catch {
    /* best effort */
  }
}

export function closeFontRepository(): void {
  database?.close()
  database = undefined
  databaseFile = ''
}
