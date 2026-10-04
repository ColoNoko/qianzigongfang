import { readdir, stat } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import type {
  SelfCheckCandidate,
  SelfCheckImportRequest,
  SelfCheckImportResult,
  SelfCheckPreviewResult
} from '@shared/ipc-api'
import type { ChildProject, ParentProject } from '@shared/types'
import { extractChapterNumber, normalizeChapterNumber } from '@shared/chapter'
import { PAIRED_PSD_STATS_VERSION } from '@shared/status'
import { scanChildProject } from './scanner'
import { getProjectTree, setProjectSourceRoot, updateProjectTree } from './project-repository'
import { writeLog } from './logger'

function normalizePathForLookup(absPath: string): string {
  return absPath.replace(/\\/g, '/').normalize('NFC').toLocaleLowerCase().replace(/\/+$/, '')
}

function normalizeChapter(value: string): string {
  return normalizeChapterNumber(value)
}

function inferChapterAndTitle(folderName: string): {
  chapterNumber: string
  projectTitle: string
} {
  const normalized = folderName.trim()
  const withUnit = normalized.match(
    /^((?:第\s*)?\d+(?:\.\d+)?\s*(?:话|話|集|回|章)?)(?:[\s._\-—–·]+(.+))?$/i
  )
  if (withUnit) {
    const chapterNumber = extractChapterNumber(withUnit[1])
    const projectTitle = withUnit[2]?.trim() || normalized
    return { chapterNumber, projectTitle }
  }

  const leadingNumber = normalized.match(/^(\d+(?:\.\d+)?)(?:[\s._\-—–·]+(.+))?$/)
  if (leadingNumber) {
    return {
      chapterNumber: extractChapterNumber(leadingNumber[1]),
      projectTitle: leadingNumber[2]?.trim() || normalized
    }
  }

  return { chapterNumber: extractChapterNumber(normalized), projectTitle: normalized }
}

function makeChildId(): string {
  return `child-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

function isPathInside(root: string, child: string): boolean {
  const rel = relative(resolve(root), resolve(child))
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`))
}

/**
 * 扫描根去重（大小写 / NFC / 结尾斜杠归一化后比较），保留**首次出现的顺序**。
 * 顺序有意义：`sourceRoots[0]` 会同步到兼容字段 `sourceRoot`。
 */
function normalizeRoots(paths: readonly unknown[]): string[] {
  const seen = new Set<string>()
  const roots: string[] = []
  for (const raw of paths) {
    if (typeof raw !== 'string') continue
    const trimmed = raw.trim()
    if (!trimmed) continue
    const key = normalizePathForLookup(trimmed)
    if (seen.has(key)) continue
    seen.add(key)
    roots.push(trimmed)
  }
  return roots
}

/**
 * `candidate` 是否**严格位于** `root` 内部（等于它自己不算）。
 *
 * ⚠️ `isAbsolute(rel)` 这一项**不能省** —— 2026-10-04 被真实数据抓出来的：
 *    `path.relative()` 在**跨盘**时返回的是**绝对路径**，不是 `..\…`。实测
 *    `relative('D:\…\【鹅妈妈】', 'E:\…\搬砖\有\完')` === `'E:\…\搬砖\有\完'`。
 *    只判 `''` / `'..'` / `'..\'` 的话，跨盘会被判成"在里面"，于是**所有 D 盘父级的根**
 *    都会被 E 盘那个「搬砖」触发而误挡（实测：鹅妈妈连同它的 8 条真章节被一起挡掉）。
 *
 * ⚠️ 上面既有的 `isPathInside()` 有**同一个洞**（也只判 `''` / `'..'`），影响面是
 *    `isGroupingLevel()`：同一父级的根若跨盘，候选会被误判成容器层而跳过。
 *    那是另一条路径、另一种表现，**本轮没动**（不夹带），已单独记为待办。
 */
function isStrictlyInside(root: string, candidate: string): boolean {
  const rel = relative(resolve(root), resolve(candidate))
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)
}

/**
 * 反推出来的根，是不是**容器层**（分类目录 / 作品目录）而不是"章节所在的那一层"。
 *
 * 判据只有一条：**别的父级**有子项目落在这个根里面。刻意**不引入**"像不像章节"的
 * 启发式 —— 那类启发式（`hasRootProjectFiles`）正是 2026-10-04 这次 bug 的来源。
 *
 * 现场两条（都是真的，探针在 18 个父级上逐个数过）：
 *   · `老师的人偶`：子项目路径被存成了"卷的父目录"，`dirname` 于是爬到 `…\嵌字`
 *     —— 那是**作品目录**，下面每一部都是别人的作品 ⇒ 15 条误报；
 *   · `白沙水族馆`：路径**本身是对的**，但 `dirname(它)` 落在分类层 `…\翻译`
 *     ⇒ `『喵的』/『轻小说』/【插件】/游戏` 被当成新章节 ⇒ 7 条误报。
 *
 * 命中就把这个根丢掉；全丢光时上层**既有的** `roots.length === 0` 分支会给出
 * 「无法自动确定父级目录，请手动选择一次」—— 不新增文案、不新增分支。
 *
 * ⚠️ 已知边界（**故意不处理**）：若两个父级**真的共用**同一个章节目录，这里会把那个根
 *    判成容器层而多要一次手选。18 个父级里没有这种情形；真共用了，"手选一次并记住"
 *    也是可接受的代价 —— 比静默报出十几条别人的作品好。
 */
function hasOtherParentsInside(
  root: string,
  parent: ParentProject,
  projects: readonly ParentProject[]
): boolean {
  for (const other of projects) {
    if (other.id === parent.id) continue
    for (const child of other.children) {
      if (isStrictlyInside(root, child.folderPath)) return true
    }
  }
  return false
}

/**
 * 该父级的扫描根（可能多个）。
 *
 * 1. 用户手动记住的目录优先 —— 他说了算，不再叠加自动推导，否则"记住"的意图会被稀释。
 *    `sourceRoots` 是主字段，`sourceRoot` 是旧版单根字段，会一起读。
 *    ⚠️ **手动记住的根不做容器层过滤**：那是用户的明确选择，同上。
 * 2. 否则：**每个子项目所在的那一层**，去重后作为多个根 —— 但**容器层要丢掉**
 *    （判据见 `hasOtherParentsInside`，那是 2026-10-04 那次"28 条同级作品"的根因）。
 *
 * 为什么不能只取一个根：同一父级下的子项目可能分散在多个中间目录里
 * （真实案例：`搬砖\{无,有}\<章节>`，三个子项目横跨 `无` 和 `有`）。老实现
 * 遇到这种情况会回落到"所有子项目的公共祖先"= `搬砖`，而 `搬砖` 的一级子目录
 * 是 `无 / 有 / 【红尘】` 这类**分类目录**，于是它们被当成"新章节"报给用户，
 * 又因为名字里没有数字、集数都归一化成空串而全部误报"同父级下已存在该集数"。
 */
function getSourceRoots(parent: ParentProject, projects: readonly ParentProject[]): string[] {
  const remembered = normalizeRoots([
    ...(Array.isArray(parent.sourceRoots) ? parent.sourceRoots : []),
    ...(typeof parent.sourceRoot === 'string' ? [parent.sourceRoot] : [])
  ])
  if (remembered.length > 0) return remembered

  const derived = normalizeRoots(parent.children.map((child) => dirname(resolve(child.folderPath))))
  return derived.filter((root) => !hasOtherParentsInside(root, parent, projects))
}

/**
 * 候选是不是"容器层"：它本身是某个扫描根，或者它下面还有别的扫描根。
 *
 * 例：根 = {搬砖\无, 搬砖\有} 时 `搬砖\无` 不算候选（它就是根）；
 * 根 = {搬砖, 搬砖\无}（章节既直接放在父级下、又有放在子目录下的）时，
 * `搬砖\无` 也不算候选 —— 它是分类层，不是章节。
 */
function isGroupingLevel(candidatePath: string, roots: readonly string[]): boolean {
  return roots.some((root) => isPathInside(candidatePath, root))
}

function findParent(projects: ParentProject[], parentId: string): ParentProject | undefined {
  return projects.find((parent) => parent.id === parentId)
}

function existingFolderPathSet(projects: ParentProject[]): Set<string> {
  const paths = new Set<string>()
  for (const parent of projects) {
    for (const child of parent.children) {
      paths.add(normalizePathForLookup(child.folderPath))
    }
  }
  return paths
}

function secondVersionChapter(
  chapterNumber: string,
  existing: Set<string>,
  fallbackTitle = ''
): string {
  // 空集数不能一律返回「副本」：同一批里多个"未识别集数"的条目会拿到同一个名字，
  // 于是兄弟项目重名。回落到文件夹名，再照常做「之N」去重。
  // 先归一化：Latin 字母等会被 sanitize 掉（"新章节A之2" 落库后是 "新章节之2"），
  // 拿未归一化的字符串去重会漏判，两个不同条目的后缀会撞在一起。
  const base = normalizeChapter(chapterNumber) || normalizeChapter(fallbackTitle)
  if (!base) return '副本'
  // 保持与现有集数清洗规则兼容：只使用汉字和数字作为可见后缀。
  // 例如 1 -> 1之2，第1话 -> 第1话之2，番外 -> 番外之2
  let suffix = 2
  while (existing.has(normalizeChapter(`${base}之${suffix}`))) {
    suffix += 1
  }
  return `${base}之${suffix}`
}

export async function previewParentSelfCheck(
  parentId: string,
  explicitSourceRoot?: string
): Promise<SelfCheckPreviewResult> {
  const projects = await getProjectTree()
  const parent = findParent(projects, parentId)
  if (!parent) {
    return {
      canDetect: false,
      sourceRoot: null,
      sourceRoots: [],
      message: '父级项目不存在',
      candidates: [],
      duplicatePaths: 0
    }
  }

  const roots = normalizeRoots(
    explicitSourceRoot && explicitSourceRoot.trim()
      ? [explicitSourceRoot]
      : getSourceRoots(parent, projects)
  )
  if (roots.length === 0) {
    return {
      canDetect: false,
      sourceRoot: null,
      sourceRoots: [],
      message: '无法自动确定父级目录，请手动选择一次',
      candidates: [],
      duplicatePaths: 0
    }
  }

  const existingPaths = existingFolderPathSet(projects)
  // 只保留**解析出来**的集数：空串代表"未设置集数"，它跟"解析不出来"是两种语义，
  // 混进同一个集合会让一批没有编号的目录全部误报同集数冲突。
  const existingChaptersInParent = new Set(
    parent.children
      .map((child) => normalizeChapter(child.chapterNumber))
      .filter((key) => key !== '')
  )

  const candidates: SelfCheckCandidate[] = []
  const seenCandidatePaths = new Set<string>()
  const unreadableRoots: string[] = []
  let duplicatePaths = 0

  for (const root of roots) {
    let entries
    try {
      entries = await readdir(root, { withFileTypes: true })
    } catch {
      // 单个根读不到（被删/被移动）不该让另外的根一起失败。
      unreadableRoots.push(root)
      continue
    }

    const folderNames = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b, 'zh-CN', { numeric: true }))

    for (const folderName of folderNames) {
      const folderPath = resolve(root, folderName)
      const pathKey = normalizePathForLookup(folderPath)
      if (seenCandidatePaths.has(pathKey)) continue
      if (existingPaths.has(pathKey)) {
        duplicatePaths += 1
        continue
      }
      // 容器层（分类目录 / 另一个扫描根本身）不是章节。
      if (isGroupingLevel(folderPath, roots)) continue

      seenCandidatePaths.add(pathKey)
      const inferred = inferChapterAndTitle(folderName)
      const chapterKey = normalizeChapter(inferred.chapterNumber)
      if (chapterKey !== '' && existingChaptersInParent.has(chapterKey)) {
        candidates.push({
          folderName,
          folderPath,
          chapterNumber: inferred.chapterNumber,
          projectTitle: inferred.projectTitle,
          conflict: 'same-chapter',
          existingChapterNumber: chapterKey
        })
      } else {
        candidates.push({
          folderName,
          folderPath,
          chapterNumber: inferred.chapterNumber,
          projectTitle: inferred.projectTitle,
          conflict: 'none'
        })
      }
    }
  }

  // 一个根都读不到：不要假装"扫到 0 个"（那会让用户以为这一话真的没有新章节）。
  if (unreadableRoots.length === roots.length) {
    return {
      canDetect: false,
      sourceRoot: roots[0] ?? null,
      sourceRoots: roots,
      unreadableRoots,
      message: '无法读取父级目录',
      candidates: [],
      duplicatePaths
    }
  }

  return {
    canDetect: true,
    sourceRoot: roots[0] ?? null,
    sourceRoots: roots,
    unreadableRoots,
    candidates,
    duplicatePaths
  }
}

export async function importParentSelfCheck(
  request: SelfCheckImportRequest
): Promise<SelfCheckImportResult> {
  const result: SelfCheckImportResult = { added: 0, skipped: 0, failed: 0 }
  if (!request.parentId || !request.sourceRoot || !Array.isArray(request.items)) {
    result.failed = request.items?.length ?? 0
    return result
  }

  const scannedItems: Array<{
    folderPath: string
    folderName: string
    chapterNumber: string
    projectTitle: string
    conflictAction?: 'skip' | 'second-version'
    lastMtimeMs: number
    psdStats: ChildProject['psdStats']
    scanError?: string
  }> = []

  for (const item of request.items) {
    if (item.conflictAction === 'skip') {
      result.skipped += 1
      continue
    }
    try {
      const directoryStats = await stat(item.folderPath)
      if (!directoryStats.isDirectory()) throw new Error('不是目录')
      const scan = await scanChildProject(item.folderPath)
      const lastMtimeMs = scan.jpgPairs.reduce(
        (latest, pair) => Math.max(latest, pair.psd.mtimeMs),
        0
      )
      const psdStats = scan.jpgPairs
        .filter((pair) => pair.countsTowardProgress ?? Boolean(pair.jpgPath))
        .map((pair) => ({ mtimeMs: pair.psd.mtimeMs, ctimeMs: pair.psd.ctimeMs }))
      scannedItems.push({
        folderPath: item.folderPath,
        folderName: item.folderName,
        chapterNumber: item.chapterNumber,
        projectTitle: item.projectTitle,
        conflictAction: item.conflictAction,
        lastMtimeMs,
        psdStats
      })
    } catch (error) {
      result.failed += 1
    }
  }

  let addedInTransaction = 0
  let skippedInTransaction = result.skipped

  try {
    await updateProjectTree((projects) => {
      const parent = findParent(projects, request.parentId)
      if (!parent) throw new Error('父级项目不存在')

      if (request.rememberSourceRoot) {
        const roots = normalizeRoots([
          ...(Array.isArray(request.sourceRoots) ? request.sourceRoots : []),
          request.sourceRoot
        ])
        if (roots.length > 0) {
          parent.sourceRoots = roots
          // 兼容旧读取方：单根字段继续同步成主根。
          parent.sourceRoot = roots[0]
        }
      }

      const existingPaths = existingFolderPathSet(projects)
      // 与预览同一口径：空集数（"未设置集数"）不参与冲突比较，否则一批没有编号的
      // 目录会互相判冲突，而"导入为第二版本"又会把它们全部改写成同一个副本名。
      const existingChaptersInParent = new Set(
        parent.children
          .map((child) => normalizeChapter(child.chapterNumber))
          .filter((key) => key !== '')
      )

      for (const item of scannedItems) {
        const pathKey = normalizePathForLookup(item.folderPath)
        if (existingPaths.has(pathKey)) {
          skippedInTransaction += 1
          continue
        }

        const chapterKey = normalizeChapter(item.chapterNumber)
        if (existingChaptersInParent.has(chapterKey)) {
          if (item.conflictAction !== 'second-version') {
            skippedInTransaction += 1
            continue
          }
          // 第二版本：在原集数后追加“之N”后缀，并避开已存在的同后缀章节。
          item.chapterNumber = secondVersionChapter(
            item.chapterNumber,
            existingChaptersInParent,
            item.folderName
          )
        }

        const child: ChildProject = {
          id: makeChildId(),
          parentTitle: parent.title,
          folderPath: item.folderPath,
          chapterNumber: normalizeChapter(item.chapterNumber),
          projectTitle: item.projectTitle.trim(),
          lastMtimeMs: item.lastMtimeMs,
          psdStats: item.psdStats,
          statsVersion: PAIRED_PSD_STATS_VERSION
        }
        parent.children.push(child)
        existingPaths.add(pathKey)
        // 空集数不入比较集合：它表示"还没设集数"，不是"某个已经用掉的集数"。
        // （否则同一批里的第二条空集数条目会被自己刚加进去的第一条判成冲突。）
        const addedChapterKey = normalizeChapter(child.chapterNumber)
        if (addedChapterKey !== '') existingChaptersInParent.add(addedChapterKey)
        addedInTransaction += 1
      }

      parent.lastMtimeMs = parent.children.reduce(
        (latest, child) => Math.max(latest, child.lastMtimeMs),
        0
      )
    })

    result.added = addedInTransaction
    result.skipped = skippedInTransaction

    // 极简日志：只保留一行结果，不记录路径与审计字段。
    void writeLog({
      level: 'info',
      scope: 'self-check',
      message: `自检完成 新增=${result.added} 跳过=${result.skipped} 失败=${result.failed}`
    }).catch(() => undefined)
  } catch (error) {
    result.added = 0
    result.failed += scannedItems.length
    void writeLog({
      level: 'error',
      scope: 'self-check',
      message: `自检失败 新增=${result.added} 跳过=${result.skipped} 失败=${result.failed}`
    }).catch(() => undefined)
  }

  return result
}

export async function setParentSourceRoot(parentId: string, sourceRoot: string): Promise<void> {
  await setProjectSourceRoot(parentId, sourceRoot)
}
