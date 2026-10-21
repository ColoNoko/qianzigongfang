import { DatabaseSync } from 'node:sqlite'

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
