import { statSync } from 'node:fs'
import { getDatabase } from './connection'
import { DatabaseSync } from 'node:sqlite'
import type { ParentProject, WorkMode } from '@shared/types'
import { normalizePathKey } from '@shared/paths'
import { statisticsDateTimestamp, type StatisticsTimeRequest, type StatisticsTimeTarget, type StatisticsTimeSource } from '@shared/statistics-time'
import type { MarkAuditOperation } from '@shared/mark-audit'
import { WORK_MODES, storedModeStatus, normalizeModeTimestamps } from '@shared/modes'

function tree(db: DatabaseSync): ParentProject[] {
  const row = db.prepare("SELECT value_json FROM key_value_store WHERE key = 'projects'").get() as {value_json: string} | undefined
  return row ? JSON.parse(row.value_json) : []
}
function rule(db: DatabaseSync, scope: string, mode: WorkMode): StatisticsTimeSource | undefined {
  return (db.prepare('SELECT source FROM statistics_time_rules WHERE scope_id = ? AND mode = ?').get(scope, mode) as {source: StatisticsTimeSource} | undefined)?.source
}
export function inheritedTimeRule(db: DatabaseSync, childId: string, mode: WorkMode): StatisticsTimeSource {
  const parent = tree(db).find(p => p.children.some(c => c.id === childId))
  return rule(db, 'child:' + childId, mode) ?? (parent && rule(db, 'parent:' + parent.id, mode)) ?? 'mark'
}
export async function getStatisticsTime(target: StatisticsTimeTarget, mode: WorkMode): Promise<StatisticsTimeSource> {
  const db = await getDatabase()
  if (target.paths?.length && target.childId) {
    const values = target.paths.map(path => (db.prepare('SELECT source FROM statistics_time_pages WHERE child_id = ? AND path_key = ? AND mode = ?').get(target.childId!, normalizePathKey(path), mode) as {source: StatisticsTimeSource} | undefined)?.source ?? inheritedTimeRule(db, target.childId!, mode))
    return values.every(v => v === values[0]) ? values[0] : 'mark'
  }
  return target.childId ? inheritedTimeRule(db, target.childId, mode) : rule(db, 'parent:' + target.parentId, mode) ?? 'mark'
}
export function syncStatisticsTime(db: DatabaseSync, childId: string, pathKey: string, path: string, modes: Record<string, boolean>, timestamps: Record<string, number>, updatedAt: number): void {
  for (const mode of WORK_MODES) {
    const saved = db.prepare('SELECT mark_at FROM statistics_time_pages WHERE child_id = ? AND path_key = ? AND mode = ?').get(childId, pathKey, mode) as {mark_at: number} | undefined
    const markAt = timestamps[mode] || saved?.mark_at || updatedAt
    if (!modes[mode]) {
      // Keep the date for undo; pending pages are excluded by the statistics query.
      continue
    } else if (!saved || saved.mark_at !== markAt) {
      const source = inheritedTimeRule(db, childId, mode)
      let at = markAt
      let actual: StatisticsTimeSource = 'mark'
      if (source === 'file') { try { at = statSync(path).mtimeMs; actual = 'file' } catch { /* Missing files retain completion time. */ } }
      db.prepare('INSERT OR REPLACE INTO statistics_time_pages VALUES (?, ?, ?, ?, ?, ?)').run(childId, pathKey, mode, actual, at, markAt)
    }
  }
}
export async function setStatisticsTime(request: StatisticsTimeRequest): Promise<{changed: number; fallback: number}> {
  if (!WORK_MODES.includes(request.mode) || !['mark', 'file', 'manual'].includes(request.source)) throw new Error('无效的统计时间设置')
  const at = request.source === 'manual' ? statisticsDateTimestamp(request.date ?? '') : 0
  const db = await getDatabase()
  const parents = tree(db)
  const children = request.parentId ? parents.find(p => p.id === request.parentId)?.children : parents.flatMap(p => p.children).filter(c => c.id === request.childId)
  if (!children?.length) throw new Error('项目不存在或没有章节')
  const paths = request.paths?.map(normalizePathKey)
  if (paths && (!request.childId || !paths.length)) throw new Error('请选择图片')
  let changed = 0, fallback = 0
  db.exec('BEGIN IMMEDIATE')
  try {
    const before = snapshot(db)
    if (!paths) {
      const scope = request.parentId ? 'parent:' + request.parentId : 'child:' + request.childId
      db.prepare('INSERT OR REPLACE INTO statistics_time_rules VALUES (?, ?, ?)').run(scope, request.mode, request.source)
      if (request.parentId) for (const child of children) db.prepare('DELETE FROM statistics_time_rules WHERE scope_id = ? AND mode = ?').run('child:' + child.id, request.mode)
    }
    for (const child of children) {
      const rows = db.prepare('SELECT path_key, path, status, mode_statuses_json, mode_timestamps_json, updated_at FROM project_memory_files WHERE child_id = ?').all(child.id) as unknown as {path_key:string; path:string; status:string; mode_statuses_json:string; mode_timestamps_json:string; updated_at:number}[]
      for (const row of rows) {
        if (paths && !paths.includes(row.path_key)) continue
        const modes = storedModeStatus(row.mode_statuses_json, row.status)
        if (!(modes[request.mode] ?? (request.mode === 'typeset' && row.status === 'done'))) continue
        const prior = db.prepare('SELECT mark_at, at, source FROM statistics_time_pages WHERE child_id = ? AND path_key = ? AND mode = ?').get(child.id, row.path_key, request.mode) as {mark_at:number; at:number; source:StatisticsTimeSource} | undefined
        let timestamps: Partial<Record<WorkMode, number>> = {}
        try { timestamps = normalizeModeTimestamps(JSON.parse(row.mode_timestamps_json || '{}')) } catch { /* Legacy fallback below. */ }
        const markAt = timestamps[request.mode] || prior?.mark_at || row.updated_at
        let assigned = request.source === 'manual' ? at : markAt
        let source = request.source
        if (source === 'file') { try { assigned = statSync(row.path).mtimeMs } catch { source = 'mark'; fallback++ } }
        if (prior?.mark_at === markAt && prior.at === assigned && prior.source === source) continue
        db.prepare('INSERT OR REPLACE INTO statistics_time_pages VALUES (?, ?, ?, ?, ?, ?)').run(child.id, row.path_key, request.mode, source, assigned, markAt)
        changed++
      }
    }
    const after = snapshot(db)
    if (JSON.stringify(before) !== JSON.stringify(after)) db.prepare('INSERT INTO statistics_time_audit (at, before_json, after_json) VALUES (?, ?, ?)').run(Date.now(), JSON.stringify(before), JSON.stringify(after))
    db.exec('COMMIT')
  } catch (error) { db.exec('ROLLBACK'); throw error }
  return {changed, fallback}
}
function snapshot(db: DatabaseSync) { return {rules:db.prepare('SELECT * FROM statistics_time_rules ORDER BY scope_id, mode').all(), pages:db.prepare('SELECT * FROM statistics_time_pages ORDER BY child_id, path_key, mode').all()} }

// Date changes participate in the existing undo/history entry point without rewriting mark times.
export async function statisticsTimeOperations(): Promise<MarkAuditOperation[]> {
  const db = await getDatabase()
  const rows = db.prepare('SELECT * FROM statistics_time_audit ORDER BY id DESC LIMIT 100').all() as unknown as {id:number;at:number;before_json:string;after_json:string}[]
  return rows.map(row => {
    const before = JSON.parse(row.before_json), after = JSON.parse(row.after_json)
    const changed = after.pages.filter((item: Record<string, unknown>) => !before.pages.some((old: unknown) => JSON.stringify(old) === JSON.stringify(item)))
    const ids = [...new Set<string>(changed.map((item: {child_id:string}) => item.child_id))]
    return {opId:'statistics-time:' + row.id, at:Math.abs(row.at),kind:row.at > 0 ? 'mark' : 'undo',source:'statistics-time', note:'调整统计时间', children:ids.map(childId => ({childId,folderPath:'',entries:[]})),fileCount:Math.max(1,changed.length),skippedCount:0} as MarkAuditOperation
  })
}
export async function undoStatisticsTime(opId: string) {
  const db = await getDatabase()
  const id = Number(opId.replace('statistics-time:', ''))
  const record = db.prepare('SELECT * FROM statistics_time_audit WHERE id = ? AND at > 0').get(id) as {before_json:string;after_json:string} | undefined
  if (!record) throw new Error('统计时间操作不存在或已经撤销')
  const before = JSON.parse(record.before_json), after = JSON.parse(record.after_json)
  const ids = new Set<string>()
  let revertedFiles = 0
  db.exec('BEGIN IMMEDIATE')
  try {
    for (const type of ['rules','pages'] as const) {
      const columns = type === 'rules' ? ['scope_id','mode'] : ['child_id','path_key','mode']
      const key = (row: Record<string, unknown>) => JSON.stringify(columns.map(c => row[c]))
      const oldRows = new Map<string, Record<string, string | number>>(before[type].map((row: Record<string,string | number>) => [key(row),row]))
      const newRows = new Map<string, Record<string, string | number>>(after[type].map((row: Record<string,string | number>) => [key(row),row]))
      for (const k of new Set([...oldRows.keys(),...newRows.keys()])) {
        const old = oldRows.get(k), next = newRows.get(k)
        if (JSON.stringify(old) === JSON.stringify(next)) continue
        const row = (next ?? old)!, where = columns.map(c => c + ' = ?').join(' AND '), args = columns.map(c => row[c])
        const current = db.prepare(`SELECT * FROM statistics_time_${type} WHERE ${where}`).get(...args)
        if (JSON.stringify(current) !== JSON.stringify(next)) continue
        db.prepare(`DELETE FROM statistics_time_${type} WHERE ${where}`).run(...args)
        if (old) { const names = Object.keys(old); db.prepare(`INSERT INTO statistics_time_${type} (${names.join(',')}) VALUES (${names.map(() => '?').join(',')})`).run(...Object.values(old)) }
        if (type === 'pages') { revertedFiles++; ids.add(String(row.child_id)) }
      }
    }
    db.prepare('UPDATE statistics_time_audit SET at = -at WHERE id = ?').run(id)
    db.exec('COMMIT')
  } catch(error) { db.exec('ROLLBACK'); throw error }
  return {revertedFiles,childIds:[...ids],operation:null}
}

export async function restoreStatisticsTimes(file: string, apply = false): Promise<number> {
  const db = await getDatabase(), backup = new DatabaseSync(file, {readOnly:true})
  let changed = 0
  try {
    if (!backup.prepare("SELECT name FROM sqlite_master WHERE name = 'statistics_time_pages'").get()) return 0
    const saved = snapshot(backup)
    const scopes = new Set(tree(db).flatMap(p => ['parent:' + p.id, ...p.children.map(c => 'child:' + c.id)]))
    if (apply) db.exec('BEGIN IMMEDIATE')
    try {
      const before = snapshot(db)
      const backupScopes = new Set(tree(backup).flatMap(p => ['parent:' + p.id, ...p.children.map(c => 'child:' + c.id)]))
      for (const row of before.rules) {
        if (!scopes.has(String(row.scope_id)) || !backupScopes.has(String(row.scope_id))) continue
        if (!saved.rules.some(old => old.scope_id === row.scope_id && old.mode === row.mode)) {
          changed++
          if (apply) db.prepare('DELETE FROM statistics_time_rules WHERE scope_id = ? AND mode = ?').run(row.scope_id,row.mode)
        }
      }
      for (const row of saved.rules) {
        if (!scopes.has(String(row.scope_id))) continue
        const existing = db.prepare('SELECT * FROM statistics_time_rules WHERE scope_id = ? AND mode = ?').get(row.scope_id, row.mode)
        if (JSON.stringify(existing) !== JSON.stringify(row)) { changed++; if (apply) db.prepare('INSERT OR REPLACE INTO statistics_time_rules VALUES (?, ?, ?)').run(row.scope_id,row.mode,row.source) }
      }
      const savedPages = new Map(saved.pages.map(row => [JSON.stringify([row.child_id,row.path_key,row.mode]),row]))
      for (const row of backup.prepare('SELECT child_id,path_key FROM project_memory_files').all()) {
        if (!db.prepare('SELECT 1 FROM project_memory_files WHERE child_id = ? AND path_key = ?').get(row.child_id,row.path_key)) continue
        for (const mode of WORK_MODES) {
          const date = savedPages.get(JSON.stringify([row.child_id,row.path_key,mode]))
          const current = db.prepare('SELECT * FROM statistics_time_pages WHERE child_id = ? AND path_key = ? AND mode = ?').get(row.child_id,row.path_key,mode)
          if (JSON.stringify(date) === JSON.stringify(current)) continue
          changed++
          if (apply) {
            db.prepare('DELETE FROM statistics_time_pages WHERE child_id = ? AND path_key = ? AND mode = ?').run(row.child_id,row.path_key,mode)
            if (date) db.prepare('INSERT INTO statistics_time_pages VALUES (?, ?, ?, ?, ?, ?)').run(date.child_id,date.path_key,date.mode,date.source,date.at,date.mark_at)
          }
        }
      }
      if (apply) {
        db.prepare('INSERT INTO statistics_time_audit (at,before_json,after_json) VALUES (?, ?, ?)').run(Date.now(),JSON.stringify(before),JSON.stringify(snapshot(db)))
        db.exec('COMMIT')
      }
    } catch(error) { if (apply) db.exec('ROLLBACK'); throw error }
  } finally { backup.close() }
  return changed
}
