import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { normalizePathKey } from '@shared/paths'
import { normalizeReviewFolder } from '@shared/translation-review'

type JsonRecord = Record<string, unknown>

function record(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Compare whole segments, but retain the file's original spelling in the new path. */
function pathMapper(previous: string, next: string): (path: string) => string {
  const parts = (path: string) => path.replace(/\\/g, '/').replace(/\/+$/, '').split('/')
  const prefix = parts(previous)
  return (path) => {
    const source = parts(path)
    if (
      source.length <= prefix.length ||
      !prefix.every((part, index) => normalizePathKey(part) === normalizePathKey(source[index]))
    )
      return path
    const relative = source.slice(prefix.length)
    // Do not turn malformed traversal paths into identities in another folder.
    if (relative.some((part) => !part || part === '.' || part === '..')) {
      throw new Error('标记路径包含无效的相对目录，已取消认领')
    }
    const separator = next.includes('\\') && !next.includes('/') ? '\\' : '/'
    return next.replace(/[\\/]+$/, '') + separator + relative.join(separator)
  }
}

function moveIdentity(
  path: string,
  pathKey: string,
  remap: (path: string) => string
): { path: string; pathKey: string } {
  const nextPath = remap(path)
  const nextKey = remap(pathKey)
  if (nextPath === path && nextKey === pathKey) return { path, pathKey }
  if (normalizePathKey(path) !== normalizePathKey(pathKey)) {
    throw new Error('标记路径与定位键不一致，已取消认领')
  }
  return { path: nextPath, pathKey: normalizePathKey(nextPath) }
}

function assertUnique(keys: string[]): void {
  if (new Set(keys).size !== keys.length) {
    throw new Error('新目录已有冲突的标记或统计记录，已取消认领')
  }
}

function migrateMarkAudit(
  database: DatabaseSync,
  childId: string,
  previous: string,
  next: string,
  remap: (path: string) => string
): void {
  const rows = database
    .prepare('SELECT id, folder_path, entries_json FROM mark_audit WHERE child_id = ?')
    .all(childId) as { id: number; folder_path: string; entries_json: string }[]
  const update = database.prepare(
    'UPDATE mark_audit SET folder_path = ?, entries_json = ? WHERE id = ?'
  )
  for (const row of rows) {
    const entries: unknown = JSON.parse(row.entries_json)
    if (!Array.isArray(entries)) throw new Error('标记历史格式损坏，已取消认领')
    const keys: string[] = []
    let changed = false
    for (const entry of entries) {
      if (!record(entry) || typeof entry.path !== 'string' || typeof entry.pathKey !== 'string') {
        throw new Error('标记历史路径损坏，已取消认领')
      }
      const moved = moveIdentity(entry.path, entry.pathKey, remap)
      keys.push(normalizePathKey(moved.pathKey))
      if (moved.path !== entry.path || moved.pathKey !== entry.pathKey) {
        Object.assign(entry, moved)
        changed = true
      }
    }
    if (changed) assertUnique(keys)
    const folder =
      normalizePathKey(row.folder_path) === normalizePathKey(previous) ? next : row.folder_path
    if (changed || folder !== row.folder_path) {
      update.run(folder, changed ? JSON.stringify(entries) : row.entries_json, row.id)
    }
  }
}

function migrateTimeSnapshot(
  raw: string,
  childId: string,
  remap: (path: string) => string
): string {
  const snapshot: unknown = JSON.parse(raw)
  if (!record(snapshot) || !Array.isArray(snapshot.pages)) {
    throw new Error('统计时间历史格式损坏，已取消认领')
  }
  const keys: string[] = []
  let changed = false
  for (const page of snapshot.pages) {
    if (!record(page)) throw new Error('统计时间历史格式损坏，已取消认领')
    if (page.child_id !== childId) continue
    if (typeof page.path_key !== 'string' || typeof page.mode !== 'string') {
      throw new Error('统计时间历史路径损坏，已取消认领')
    }
    const path = remap(page.path_key)
    if (path !== page.path_key) {
      page.path_key = normalizePathKey(path)
      changed = true
    }
    keys.push(JSON.stringify([normalizePathKey(String(page.path_key)), page.mode]))
  }
  if (!changed) return raw
  assertUnique(keys)
  return JSON.stringify(snapshot)
}

/**
 * Runs inside the project-tree transaction. UPDATE never replaces a destination row;
 * any collision or unreadable history aborts the entire reclaim, including the tree.
 * Only identities change: completion modes, dates, file versions and audit data survive.
 */
export function reclaimProjectPaths(
  database: DatabaseSync,
  childId: string,
  previous: string,
  next: string
): void {
  if (previous === next) return
  const remap = pathMapper(previous, next)
  const files = database
    .prepare('SELECT path_key, path FROM project_memory_files WHERE child_id = ?')
    .all(childId) as { path_key: string; path: string }[]
  const movedFiles = files.map((file) => ({
    ...file,
    next: moveIdentity(file.path, file.path_key, remap)
  }))
  assertUnique(movedFiles.map((file) => normalizePathKey(file.next.pathKey)))

  // Stage keys so nested moves (old -> old/new) cannot collide with another moving row.
  const temporary = `reclaim:${randomUUID()}:`
  const setFileKey = database.prepare(
    'UPDATE project_memory_files SET path_key = ?, path = ? WHERE child_id = ? AND path_key = ?'
  )
  const changedFiles = movedFiles.filter(
    (file) => file.next.pathKey !== file.path_key || file.next.path !== file.path
  )
  changedFiles.forEach((file, index) =>
    setFileKey.run(temporary + index, file.path, childId, file.path_key)
  )
  changedFiles.forEach((file, index) =>
    setFileKey.run(file.next.pathKey, file.next.path, childId, temporary + index)
  )

  const dates = database
    .prepare('SELECT path_key, mode FROM statistics_time_pages WHERE child_id = ?')
    .all(childId) as { path_key: string; mode: string }[]
  const movedDates = dates.map((date) => {
    const path = remap(date.path_key)
    return { ...date, nextKey: path === date.path_key ? date.path_key : normalizePathKey(path) }
  })
  assertUnique(
    movedDates.map((date) => JSON.stringify([normalizePathKey(date.nextKey), date.mode]))
  )
  const setDateKey = database.prepare(
    'UPDATE statistics_time_pages SET path_key = ? WHERE child_id = ? AND path_key = ? AND mode = ?'
  )
  const changedDates = movedDates.filter((date) => date.nextKey !== date.path_key)
  changedDates.forEach((date, index) =>
    setDateKey.run(temporary + index, childId, date.path_key, date.mode)
  )
  changedDates.forEach((date, index) =>
    setDateKey.run(date.nextKey, childId, temporary + index, date.mode)
  )

  migrateMarkAudit(database, childId, previous, next, remap)
  const histories = database
    .prepare('SELECT id, before_json, after_json FROM statistics_time_audit')
    .all() as { id: number; before_json: string; after_json: string }[]
  const setHistory = database.prepare(
    'UPDATE statistics_time_audit SET before_json = ?, after_json = ? WHERE id = ?'
  )
  for (const row of histories) {
    const before = migrateTimeSnapshot(row.before_json, childId, remap)
    const after = migrateTimeSnapshot(row.after_json, childId, remap)
    if (before !== row.before_json || after !== row.after_json)
      setHistory.run(before, after, row.id)
  }

  const oldReviewFolder = normalizeReviewFolder(previous)
  const newReviewFolder = normalizeReviewFolder(next)
  if (oldReviewFolder !== newReviewFolder) {
    // Review rows have no child ID: a destination already holding reviews is ambiguous,
    // even if its sentence keys happen not to overlap. Never silently combine chapters.
    if (
      database
        .prepare('SELECT 1 FROM translation_review WHERE folder_path = ?')
        .get(newReviewFolder)
    ) {
      throw new Error('新目录已有校对记录，已取消认领以免混合不同章节')
    }
    database
      .prepare('UPDATE translation_review SET folder_path = ? WHERE folder_path = ?')
      .run(newReviewFolder, oldReviewFolder)
  }
  database
    .prepare('UPDATE project_memory SET folder_path = ? WHERE child_id = ?')
    .run(next, childId)
}
