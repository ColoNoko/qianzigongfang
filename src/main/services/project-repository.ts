import type { DatabaseSync } from 'node:sqlite'
import type { ProjectMemory, ProjectMemoryStatusUpdate } from '@shared/ipc-api'
import type { MarkAuditContext } from '@shared/mark-audit'
import type { ChildProgressUpdate, ParentProject, WorkMode } from '@shared/types'
import { normalizeDuties } from '@shared/duties'
import { extractChapterNumber } from '@shared/chapter'
import { normalizePathKey } from '@shared/paths'
import { applyParentSourceRoots } from '@shared/source-roots'
import { assertProjectTreeShape } from '@shared/project-tree'
import { reclaimProjectPaths } from './db/project-path-reclaim'
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
    assertProjectTreeShape(parsed)
    for (const parent of parsed as ParentProject[]) {
      for (const child of parent.children) {
        if (child.chapterNumber.trim()) continue
        const folder = child.folderPath.split(/[\\/]/).filter(Boolean).pop() ?? ''
        if (/^(?:\[\s*\d+(?:\.\d+)?\s*\]|【\s*\d+(?:\.\d+)?\s*】|\(\s*\d+(?:\.\d+)?\s*\))$/.test(folder.normalize('NFKC'))) {
          child.chapterNumber = extractChapterNumber(folder)
        }
      }
    }
    return { ok: true, projects: parsed as ParentProject[] }
  } catch {
    return { ok: false, raw }
  }
}

function readProjectTree(database: DatabaseSync): ParentProject[] {
  const parsed = parseProjectTree(readRawProjectTree(database))
  if (!parsed.ok) throw new Error('项目清单格式损坏，请检查项目数据或从备份恢复')
  return parsed.projects
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
  assertProjectTreeShape(projects)
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
 * 第二个参数供关联记录一起写入；调用方不得另开或提交事务。
 *
 * ⚠️ 事务内先**校验**那一格能不能解析：坏掉就拒绝写入（并把原值另存 `projects.corrupt.*`），
 * 绝不把"读不出来"当成"空树"写回去 —— 见 `parseProjectTree` 上方那段（2026-09-30 审查 high）。
 */
export async function updateProjectTree<T>(
  mutator: (projects: ParentProject[], database: DatabaseSync) => T
): Promise<T> {
  const database = await getDatabase()
  database.exec('BEGIN IMMEDIATE')
  let corruptRaw: string | null = null
  try {
    const parsed = parseProjectTree(readRawProjectTree(database))
    if (!parsed.ok) {
      corruptRaw = parsed.raw
      throw new Error('项目清单格式损坏（JSON 数组或项目条目无效）—— 已拒绝写入，避免把整棵树清空')
    }
    const projects = parsed.projects
    const result = mutator(projects, database)
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

/**
 * **并发安全的章节保存**（2026-10-05 从并行分支 T6 移植）。
 *
 * 以前「导入 / 编辑话」走 `saveProjectTree`（**整树覆盖**）：渲染层拿到树的快照、
 * 改完再整份写回 —— 中间一旦有别的操作动了树（后台扫描入库、另一窗口的导入/标记），
 * 那些改动就被旧快照**悄悄抹掉**。
 *
 * 这里改成"**只合并本次的章节改动**"：
 *   · `before` = 渲染层当时看到的树快照，`after` = 改完的树；
 *   · 在 `updateProjectTree` 的**同一个事务**里对着**库里最新的树**逐条合并：
 *       - `before → after` 没变的章节跳过（不碰别人改过的任何字段）；
 *       - 章节已被删除 ⇒ 抛错（不许旧编辑"复活"它）；
 *       - 章节的元信息（父标题/标题/集数/路径）已被别人改 ⇒ 抛错，请刷新重试；
 *       - 同路径去重：已存在同路径的其他章节时，新章节跳过、已有章节报错；
 *       - **元信息编辑不覆盖更新的进度/标记快照**：路径没变时只取标题/集数两个字段，
 *         其余（psdStats / psdModeStats / 指纹 / 版本号）一律保留库里的；
 *   · 移动章节后清掉被搬空的父级，最后重算父级 mtime。
 *
 * 返回合并后的**权威树**（渲染层应当采纳它，而不是继续用自己那份）。
 */
export async function saveProjectChanges(
  before: ParentProject[],
  after: ParentProject[]
): Promise<ParentProject[]> {
  assertProjectTreeShape(before)
  assertProjectTreeShape(after)
  return updateProjectTree((projects) => {
    const prior = new Map(
      before.flatMap((parent) => parent.children.map((child) => [child.id, child] as const))
    )
    const touchedOwners = new Set<string>()
    const key = (path: string) => path.replace(/\\/g, '/').toLowerCase().replace(/\/+$/, '')
    for (const desiredParent of after)
      for (const desired of desiredParent.children) {
        const original = prior.get(desired.id)
        if (original && JSON.stringify(original) === JSON.stringify(desired)) continue
        const owner = projects.find((parent) =>
          parent.children.some((child) => child.id === desired.id)
        )
        const current = owner?.children.find((child) => child.id === desired.id)
        if (original && !current) throw new Error('章节已被删除，请刷新后重试')
        if (
          original &&
          current &&
          ['parentTitle', 'projectTitle', 'chapterNumber', 'folderPath'].some(
            (field) =>
              current[field as keyof typeof current] !== original[field as keyof typeof original]
          )
        )
          throw new Error('章节已被其他操作修改，请刷新后重试')
        const duplicate = projects
          .flatMap((parent) => parent.children)
          .find(
            (child) => child.id !== desired.id && key(child.folderPath) === key(desired.folderPath)
          )
        if (duplicate) {
          if (original) throw new Error('该目录已属于其他章节')
          continue
        }
        let destination = projects.find((parent) => parent.id === desiredParent.id)
        if (!destination)
          destination = projects.find((parent) => parent.title === desiredParent.title)
        if (!destination) {
          destination = { ...desiredParent, children: [] }
          projects.push(destination)
        }
        if (owner) {
          touchedOwners.add(owner.id)
          owner.children = owner.children.filter((child) => child.id !== desired.id)
        }
        // 元信息编辑不得覆盖更新的进度/标记快照：路径没变时只取标题与集数。
        const next =
          current && key(current.folderPath) === key(desired.folderPath)
            ? {
                ...current,
                projectTitle: desired.projectTitle,
                chapterNumber: desired.chapterNumber
              }
            : { ...desired }
        next.parentTitle = destination.title
        destination.children.push(next)
      }
    for (let i = projects.length - 1; i >= 0; i--) {
      if (touchedOwners.has(projects[i].id) && !projects[i].children.length) projects.splice(i, 1)
    }
    recomputeParentMtimes(projects)
    return projects
  })
}

/**
 * 「认领」：把一条已登记的话**换门牌**（`folderPath`）—— 2026-10-05（R2）。
 *
 * 用途：本地文件夹改名后，旧话指向的路径不存在、改名后的文件夹被当成"新章节"。
 * 用户在候选上指认"它其实是《…》"，就走这里把旧话的路径换到新文件夹上。
 *
 * childId 和进度不动；文件标记、统计日期、撤销历史和校对记录的路径在同一事务里迁移。
 * 标记按 childId + 绝对路径定位，不能只改树里的 folderPath。
 * **禁止**用"删旧建新"实现 —— `deleteChildren` 会连带 `removeStoredProjectMemory`。
 * ⚠️ 新路径已被**别的**话占用 ⇒ 抛错（认领不能制造"两条话指向同一个文件夹"）。
 * 抛在 mutator 里是安全的：`updateProjectTree` 会 ROLLBACK 后原样抛出。
 */
export async function reclaimChildPath(
  parentId: string,
  childId: string,
  folderPath: string
): Promise<void> {
  const next = folderPath.trim()
  if (!next) throw new Error('要认领的新路径是空的')
  const nextKey = normalizePathKey(next)

  await updateProjectTree((projects, database) => {
    const parent = projects.find((item) => item.id === parentId)
    if (!parent) throw new Error(`父级不存在：${parentId}`)
    const child = parent.children.find((item) => item.id === childId)
    if (!child) throw new Error('要认领的那一话不在这个父级里')
    const taken = projects.some((item) =>
      item.children.some(
        (other) => other.id !== childId && normalizePathKey(other.folderPath) === nextKey
      )
    )
    if (taken) throw new Error('这个文件夹已经登记在别的话上了')
    reclaimProjectPaths(database, childId, child.folderPath, next)
    child.folderPath = next
  })
}

/**
 * 记下某一话的**内容指纹**（2026-10-05，R1）—— 按路径找到那条话，指纹变了才写。
 *
 * 只在**稳定扫描**之后调用（见 `project-scan-service`）：指纹是"那一话当时长什么样"的
 * 快照，将来本地文件夹改了名，就拿候选的指纹跟它对 —— 相同 ⇒ 疑似改名。
 * 找不到对应的话（还没登记）就什么都不做。
 */
export async function recordChildContentFingerprint(
  folderPath: string,
  contentFingerprint: string
): Promise<void> {
  const key = normalizePathKey(folderPath)
  const projects = await getProjectTree()
  const target = projects
    .flatMap((parent) => parent.children)
    .find((child) => normalizePathKey(child.folderPath) === key)
  if (!target || target.contentFingerprint === contentFingerprint) return

  await updateProjectTree((tree) => {
    for (const parent of tree) {
      for (const child of parent.children) {
        if (normalizePathKey(child.folderPath) === key) {
          child.contentFingerprint = contentFingerprint
          return
        }
      }
    }
  })
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

/**
 * 设置父级"记住的扫描根"（`null` 或空数组 = 恢复自动推导）。
 *
 * ⚠️ 父级不存在时**抛错**，不许静默返回 —— 静默返回 = "什么都没改却报成功"，
 * 而渲染层会照旧乐观更新界面（与 `setParentDuties` 同一条规矩）。
 * 抛在 mutator 里是安全的：`updateProjectTree` 会 ROLLBACK 后原样抛出。
 *
 * ⚠️ 清洗与"两个字段一起写"的规则**不在这里** —— 它们是 `@shared/source-roots.ts` 的
 * `applyParentSourceRoots` / `normalizeRememberedRoots`（纯规则，主进程与渲染层共用）。
 * 这个函数只负责"进事务 + 父级不存在就抛错"。
 */
export async function setParentSourceRoots(
  parentId: string,
  roots: readonly unknown[] | null
): Promise<void> {
  await updateProjectTree((projects) => {
    const parent = projects.find((item) => item.id === parentId)
    if (!parent) throw new Error(`父级不存在：${parentId}`)
    applyParentSourceRoots(parent, roots)
  })
}

/** 只更新父级项目的 sourceRoot，供自检记住源目录使用。 */
export async function setProjectSourceRoot(parentId: string, sourceRoot: string): Promise<void> {
  // ⚠️ 走"写一对"那条路（不是只改 sourceRoot）：这条通道的用户语义是
  // "**以后就扫这个目录**"，而读取时会 `[...sourceRoots, sourceRoot]` 拼起来 ——
  // 只改旧字段的话，旧根会继续参与扫描（见 `applyParentSourceRoots` 的注释）。
  await setParentSourceRoots(parentId, [sourceRoot])
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
 * 不是"保持上次"；保留空数组，避免重启后被误当成未声明而重新推断。
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
    parent.duties = clean
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
