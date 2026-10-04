import type { DatabaseSync } from 'node:sqlite'
import type { ProjectMemory, ProjectMemoryStatusUpdate } from '@shared/ipc-api'
import type { MarkAuditContext } from '@shared/mark-audit'
import type { ChildProgressUpdate, ParentProject, WorkMode } from '@shared/types'
import { normalizeDuties } from '@shared/duties'
import {
  getDatabase,
  getStoredProjectMemory,
  removeStoredProjectMemory,
  setStoredProjectMemoryStatuses
} from './database'

const PROJECTS_KEY = 'projects'

function readRawProjectTree(database: DatabaseSync): string | undefined {
  const row = database
    .prepare('SELECT value_json FROM key_value_store WHERE key = ?')
    .get(PROJECTS_KEY) as { value_json?: string } | undefined
  return row?.value_json
}

/** 解析结果：区分"真的没有项目"（`[]` 或那一格不存在）与"这格读不出来"。 */
type ProjectTreeParse = { ok: true; projects: ParentProject[] } | { ok: false; raw: string }

/**
 * ⚠️ 解析失败**不等于**空树（2026-09-30 审查 high）。
 *
 * 原来 `readProjectTree()` 在 JSON 坏掉时 `return []`，而 `updateProjectTree()` 在
 * mutator 之后**无条件**写回 —— 于是那一格只要坏过一次（行损坏 / 旧格式 / 外部写入
 * 非数组），**下一次任何更新**（扫描/标记之后必然跑的 `saveChildProgress`、重命名、
 * 删除、排序）就会把 `[]` 落库：侧栏所有父级与章节一起消失，原始内容不留档、全程无提示。
 */
function parseProjectTree(raw: string | undefined): ProjectTreeParse {
  if (raw === undefined) return { ok: true, projects: [] }
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return { ok: false, raw }
    return { ok: true, projects: parsed as ParentProject[] }
  } catch {
    return { ok: false, raw }
  }
}

function readProjectTree(database: DatabaseSync): ParentProject[] {
  const parsed = parseProjectTree(readRawProjectTree(database))
  return parsed.ok ? parsed.projects : []
}

/** 把"读不出来"那格**原样**另存一份取证（独立写入，不跟着下面的事务回滚）。 */
function stashCorruptProjectTree(database: DatabaseSync, raw: string): string {
  const key = `projects.corrupt.${Date.now()}`
  database
    .prepare(
      `INSERT INTO key_value_store (key, value_json, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`
    )
    .run(key, raw, Date.now())
  return key
}

function writeProjectTree(database: DatabaseSync, projects: ParentProject[]): void {
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
    .run(PROJECTS_KEY, JSON.stringify(projects), Date.now())
}

/**
 * 项目树深模块。
 *
 * 调用方只关心 ParentProject[]，不再直接读写 key_value_store['projects']，
 * 也不再负责事务边界和序列化细节。
 */
export async function getProjectTree(): Promise<ParentProject[]> {
  const database = await getDatabase()
  return readProjectTree(database)
}

/**
 * 在 SQLite 事务内读取最新项目树、交给调用方同步修改、然后一次性写回。
 * mutator 必须是同步函数，避免在事务持有期间 await 造成长时间锁库。
 *
 * ⚠️ 事务内先**校验**那一格能不能解析：坏掉就拒绝写入（并把原值另存 `projects.corrupt.*`），
 * 绝不把"读不出来"当成"空树"写回去 —— 见 `parseProjectTree` 上方那段（2026-09-30 审查 high）。
 */
export async function updateProjectTree<T>(mutator: (projects: ParentProject[]) => T): Promise<T> {
  const database = await getDatabase()
  database.exec('BEGIN IMMEDIATE')
  let corruptRaw: string | null = null
  try {
    const parsed = parseProjectTree(readRawProjectTree(database))
    if (!parsed.ok) {
      corruptRaw = parsed.raw
      throw new Error('项目清单（projects）不是合法的 JSON 数组 —— 已拒绝写入，避免把整棵树清空')
    }
    const projects = parsed.projects
    const result = mutator(projects)
    writeProjectTree(database, projects)
    database.exec('COMMIT')
    return result
  } catch (error) {
    try {
      database.exec('ROLLBACK')
    } catch {
      // 保留原始错误。
    }
    // 回滚之后再另存证据：写在事务里会被一起回滚掉。
    if (corruptRaw !== null) {
      try {
        stashCorruptProjectTree(database, corruptRaw)
      } catch {
        // 留证据失败不该盖住真正的错误。
      }
    }
    throw error
  }
}

/** 过渡接口：保存 Renderer 计算完成的完整项目树。 */
export async function saveProjectTree(projects: ParentProject[]): Promise<void> {
  const database = await getDatabase()
  database.exec('BEGIN IMMEDIATE')
  try {
    writeProjectTree(database, projects)
    database.exec('COMMIT')
  } catch (error) {
    try {
      database.exec('ROLLBACK')
    } catch {
      // 保留原始错误。
    }
    throw error
  }
}

/** 只更新子项目的进度缓存字段，避免 Renderer 整树写回。 */
export async function saveChildProgress(updates: ChildProgressUpdate[]): Promise<void> {
  const updateById = new Map(updates.map((update) => [update.childId, update]))

  await updateProjectTree((projects) => {
    for (const parent of projects) {
      for (const child of parent.children) {
        const update = updateById.get(child.id)
        if (!update) continue
        child.lastMtimeMs = update.lastMtimeMs
        if (update.psdStats !== undefined) child.psdStats = update.psdStats
        if (update.statsVersion !== undefined) child.statsVersion = update.statsVersion
        if (update.psdModeStats !== undefined) child.psdModeStats = update.psdModeStats
        if (update.modeStatsVersion !== undefined) child.modeStatsVersion = update.modeStatsVersion
      }
      parent.lastMtimeMs = parent.children.reduce(
        (latest, child) => Math.max(latest, child.lastMtimeMs),
        0
      )
    }
  })
}

/** 只更新父级项目的 sourceRoot，供自检记住源目录使用。 */
export async function setProjectSourceRoot(parentId: string, sourceRoot: string): Promise<void> {
  await updateProjectTree((projects) => {
    const parent = projects.find((item) => item.id === parentId)
    if (parent) parent.sourceRoot = sourceRoot
  })
}

function recomputeParentMtimes(projects: ParentProject[]): void {
  for (const parent of projects) {
    parent.lastMtimeMs = parent.children.reduce(
      (latest, child) => Math.max(latest, child.lastMtimeMs),
      0
    )
  }
}

/** 删除多个子项目；父级为空时一并移除。 */
export async function deleteChildren(childIds: string[]): Promise<void> {
  const ids = new Set(childIds)
  if (ids.size === 0) return

  await updateProjectTree((projects) => {
    for (const parent of projects) {
      parent.children = parent.children.filter((child) => !ids.has(child.id))
    }
    const nonEmpty = projects.filter((parent) => parent.children.length > 0)
    recomputeParentMtimes(nonEmpty)
    projects.splice(0, projects.length, ...nonEmpty)
  })

  // 树已删除后清理对应的项目记忆；和旧 Renderer 行为一致，分两步执行。
  await Promise.all([...ids].map((childId) => removeStoredProjectMemory(childId)))
}

/** 重命名父级项目，并同步所有子项目的 parentTitle。 */
export async function renameParent(parentId: string, title: string): Promise<void> {
  const trimmed = title.trim()
  if (!trimmed) return

  await updateProjectTree((projects) => {
    const parent = projects.find((item) => item.id === parentId)
    if (!parent) return
    parent.title = trimmed
    for (const child of parent.children) child.parentTitle = trimmed
    recomputeParentMtimes(projects)
  })
}

/**
 * 设置父级（漫画）的职责：这一本归我干哪几道工序（1~2 个模式）。
 *
 * 规范化在这里**再做一遍**：通道是公开边界，渲染层洗过不代表主进程可以信任
 * （与 `shared/duties.ts` 共用同一份规则，不抄第二份）。空数组的语义是**清空**，
 * 不是"保持上次" —— 清掉字段，别留一个空数组在库里。
 *
 * ⚠️ **父级不存在时抛错，不许静默返回**（2026-10-03 审查修复）：
 * 静默返回 = "什么都没改，却报成功"，而渲染层会照旧乐观更新本地状态 ——
 * 界面显示"设好了"、库里没有，两边各说各话（本项目在双实例场景下最容易撞上）。
 * 与 `undoMarkOperation` 的"台账里没有的操作必须抛错"同一条规矩。
 * 抛在 mutator 里是安全的：`updateProjectTree` 会 ROLLBACK 后原样抛出，库里一个字节没动。
 */
export async function setParentDuties(parentId: string, duties: WorkMode[]): Promise<void> {
  const clean = normalizeDuties(duties)
  await updateProjectTree((projects) => {
    const parent = projects.find((item) => item.id === parentId)
    if (!parent) throw new Error(`父级不存在：${parentId}`)
    if (clean.length === 0) delete parent.duties
    else parent.duties = clean
  })
}

/** 调整父级项目顺序。 */
export async function reorderParents(
  sourceParentId: string,
  targetParentId: string
): Promise<void> {
  await updateProjectTree((projects) => {
    const sourceIndex = projects.findIndex((parent) => parent.id === sourceParentId)
    const targetIndex = projects.findIndex((parent) => parent.id === targetParentId)
    if (sourceIndex === -1 || targetIndex === -1 || sourceIndex === targetIndex) return
    const [moved] = projects.splice(sourceIndex, 1)
    projects.splice(targetIndex, 0, moved)
  })
}

export function getProjectMemory(childId: string): Promise<ProjectMemory | null> {
  return getStoredProjectMemory(childId)
}

export function setProjectMemoryStatuses(
  childId: string,
  folderPath: string,
  updates: ProjectMemoryStatusUpdate[],
  audit?: MarkAuditContext
): Promise<void> {
  return setStoredProjectMemoryStatuses(childId, folderPath, updates, audit)
}

export function removeProjectMemory(childId: string): Promise<void> {
  return removeStoredProjectMemory(childId)
}
