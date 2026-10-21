import { app } from 'electron'
import { DatabaseSync } from 'node:sqlite'
import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { LegacyJsonImportResult } from '@shared/ipc-api'
import { createSchema } from './schema'
import { migrateLegacyData, importLegacyJsonFiles as importLegacyFiles } from './legacy-import'

export { readValueFromDatabase, writeValueToDatabase } from './values'
let databasePromise: Promise<DatabaseSync> | null = null

let databaseInstance: DatabaseSync | null = null

export function databasePath(): string {
  return join(app.getPath('userData'), 'database', 'qianzi-gongfang.sqlite')
}

async function openDatabase(): Promise<DatabaseSync> {
  const path = databasePath()
  await mkdir(dirname(path), { recursive: true })
  const database = new DatabaseSync(path)
  createSchema(database)
  await migrateLegacyData(database, app.getPath('userData'))
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

export async function closeDatabase(): Promise<void> {
  if (!databasePromise) return
  const database = await databasePromise
  database.close()
  databasePromise = null
  databaseInstance = null
}

export function getDatabaseSync(): DatabaseSync | null {
  return databaseInstance
}
export function importLegacyJsonFiles(paths: string[]): Promise<LegacyJsonImportResult> {
  return importLegacyFiles(paths, { databasePath, getDatabase })
}
