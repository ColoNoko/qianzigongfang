import { readdir, stat } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import type {
  SelfCheckCandidate,
  SelfCheckExistingChapter,
  SelfCheckRenameHint,
  SelfCheckImportRequest,
  SelfCheckImportResult,
  SelfCheckPreviewResult
} from '@shared/ipc-api'
import type { ChildProject, ParentProject } from '@shared/types'
import { inferChapterAndTitle, normalizeChapterNumber, splitChapterIdentity } from '@shared/chapter'
import { requireCompleteScan } from '@shared/project-scan'
import { computeIdentityFingerprint } from './scan-fingerprint'
import { isPathInside, isStrictlyInside, lastPathSegment, normalizePathKey } from '@shared/paths'
import {
  applyParentSourceRoots,
  findOtherParentInside,
  normalizeRememberedRoots
} from '@shared/source-roots'
import { PAIRED_PSD_STATS_VERSION } from '@shared/status'
import { projectScans } from './project-scans'
import { getProjectTree, setProjectSourceRoot, updateProjectTree } from './project-repository'
import { writeLog } from './logger'

/**
 * ⚠️ 「谁在谁里面」与「路径当 key」**不在这里定义** —— 它们是 `@shared/paths` 的
 * `isPathInside` / `isStrictlyInside` / `normalizePathKey`（全项目唯一一处，2026-10-05 收敛）。
 *
 * 为什么值得专门写一句：这里原来有**两份**几乎一样的包含判断，2026-10-04 那次事故里
 * 只修了其中一份（`isStrictlyInside` 补上"跨盘不算在里面"），双胞胎 `isPathInside` 漏了。
 * 别再在本文件里重写这类判断 —— 要新语义就往 `shared/paths.ts` 里加。
 */
function normalizeChapter(value: string): string {
  return normalizeChapterNumber(value)
}

function makeChildId(): string {
  return `child-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
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
 * ⚠️ 判据用的是 `@shared/paths` 的 `isStrictlyInside`（**严格**在内部：等于自己不算）。
 *    2026-10-04 那次"跨盘连坐"就是这条判据的洞：`path.relative()` 跨盘返回绝对路径，
 *    只判 `''`/`'..'` 就会把**别的盘**的章节当成"落在这个根里面"。判据已收进
 *    `shared/paths.ts` 一处，并有一条平台无关的跨盘锁盯着（`path-contains.spec.ts`）。
 *
 * ⚠️ 已知边界（**故意不处理**）：若两个父级**真的共用**同一个章节目录，这里会把那个根
 *    判成容器层而多要一次手选。18 个父级里没有这种情形；真共用了，"手选一次并记住"
 *    也是可接受的代价 —— 比静默报出十几条别人的作品好。
 */
/**
 * 反推出的根下面有没有**别的父级**的章节 —— 判据本体在
 * `@shared/source-roots.ts` 的 `findOtherParentInside`（2026-10-05 收编）。
 *
 * 收编的理由：「修改扫描目录」弹窗要拦的是**同一件事**（用户手选的目录里住着别的作品的话），
 * 两处各写一份必然漂 —— 这与 `isPathInside` / `isStrictlyInside` 双胞胎的教训是同一个。
 */
function hasOtherParentsInside(
  root: string,
  parent: ParentProject,
  projects: readonly ParentProject[]
): boolean {
  return findOtherParentInside(root, parent.id, projects) !== undefined
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
  const remembered = normalizeRememberedRoots([
    ...(Array.isArray(parent.sourceRoots) ? parent.sourceRoots : []),
    ...(typeof parent.sourceRoot === 'string' ? [parent.sourceRoot] : [])
  ])
  if (remembered.length > 0) return remembered

  const derived = normalizeRememberedRoots(
    parent.children.map((child) => dirname(resolve(child.folderPath)))
  )
  return derived.filter((root) => !hasOtherParentsInside(root, parent, projects))
}

/**
 * 候选是不是"容器层"：它本身是某个扫描根，或者它下面还有别的扫描根。
 *
 * 例：根 = {搬砖\无, 搬砖\有} 时 `搬砖\无` 不算候选（它就是根）；
 * 根 = {搬砖, 搬砖\无}（章节既直接放在父级下、又有放在子目录下的）时，
 * `搬砖\无` 也不算候选 —— 它是分类层，不是章节。
 *
 * ⚠️ 参数顺序按 `isPathInside(容器, 候选)` 读：这里问的是"**这个根**在不在候选里面"
 *    （等于候选自己也算），所以写作 `(candidatePath, root)` —— 一句话：
 *    **候选是某个根的祖先、或就是那个根** ⇒ 它是容器层。若改成 `(root, candidatePath)`，
 *    问的就变成"候选在某个根里面"，那是另一件事（候选本来就都住在根里），别改。
 *
 * ⚠️ 2026-10-05 之前这里用的是本文件里的**第二份** `isPathInside`（只判 `''` / `'..'`）：
 *    同一父级的根**跨盘**时（一本漫画的话分布在两个盘），另一个盘那个根下面的候选
 *    会被误判成容器层而整批跳过。判据现在来自 `@shared/paths`，那一类由
 *    `shared/__tests__/path-contains.spec.ts` 平台无关地锁住。
 */
function isGroupingLevel(candidatePath: string, roots: readonly string[]): boolean {
  return roots.some((root) => isPathInside(candidatePath, root))
}

/**
 * 这个扫描根是不是"**落在某一话自己的文件夹里**"（等于它，或比它更深）—— 2026-10-05。
 *
 * 现场（用户实测）：父级 `白沙水族馆` **记住的根** = 第12集自己的文件夹
 * `D:\…\翻译\白い砂のアクアトープ 12巻`。扫它只能扫到这一话**内部**的一级子目录 ——
 * 里面只有 `backup`（一摞 `.bak` 备份），于是被当成"1 个新章节"（还认不出集数）。
 *
 * 这与 2026-10-04 那次是**镜像方向**：那次治"根太高"（爬到容器层，把别的作品当新话），
 * 这次治"根太低"（落进话内部，把这一话的子目录当新话）。
 *
 * ⚠️ 判据是**路径关系**（等于 / 严格位于某一话 `folderPath` 之内），**不引入任何启发式**。
 * ⚠️ **记住的根也照样查这一条** —— 与"记住的根不做容器层过滤"不冲突：
 * 容器层过滤是"猜用户想扫哪一层"（所以让用户说了算）；而"根落在话内部"是**几何事实**：
 * 扫它必然只能扫到那一话的内部（backup / output / images…），除了垃圾什么都不可能出来。
 */
function isInsideOwnChapter(root: string, parent: ParentProject): boolean {
  const rootKey = normalizePathKey(root)
  return parent.children.some(
    (child) =>
      normalizePathKey(child.folderPath) === rootKey || isStrictlyInside(child.folderPath, root)
  )
}

function findParent(projects: ParentProject[], parentId: string): ParentProject | undefined {
  return projects.find((parent) => parent.id === parentId)
}

function existingFolderPathSet(projects: ParentProject[]): Set<string> {
  const paths = new Set<string>()
  for (const parent of projects) {
    for (const child of parent.children) {
      paths.add(normalizePathKey(child.folderPath))
    }
  }
  return paths
}

/**
 * 父级下"已占用的集数"索引（2026-10-05，P1）—— 冲突判定的**唯一一处实现**。
 *
 * 键从"集数"升级为「**作品名键 + 集数**」（`splitChapterIdentity`）：
 * 同一个父级里放多部作品时，数字巧合不再撞号；同一作品名下同号仍然算冲突（真重复的安全网）。
 *
 * 三条口径都是为了**不猜**、且在信息不足时**保守**：
 *   ① 候选自己认不出作品名（整个名字就是数字）⇒ 退回"只要有谁占了这个号就算冲突"；
 *   ② 既有的那一话认不出作品名 ⇒ 同样保守命中（不敢把它当"别的作品"放过去）；
 *   ③ 两边都能认出作品名 ⇒ 只有**完全相同**才算冲突（一个字符之差就是两个作品名，
 *      宁可漏报真重复 —— 漏掉的那部分交给"文件指纹相同"那条提示兜底）。
 *
 * ⚠️ 预览与导入**必须共用这一处**（§16 的老规矩：两处口径不一致会出现
 * "预览说不冲突、导入却拦住"）。
 */
function createParentChapterIndex(children: readonly ChildProject[]): {
  find(folderName: string): ChildProject | undefined
  add(child: ChildProject): void
} {
  const byWorks = new Map<string, ChildProject>()
  const numberOnly = new Map<string, ChildProject>()
  const anyNumber = new Map<string, ChildProject>()

  function add(child: ChildProject): void {
    const chapterKey = normalizeChapter(child.chapterNumber)
    if (chapterKey === '') return
    if (!anyNumber.has(chapterKey)) anyNumber.set(chapterKey, child)
    const { worksKey } = splitChapterIdentity(lastPathSegment(child.folderPath))
    if (worksKey === '') {
      if (!numberOnly.has(chapterKey)) numberOnly.set(chapterKey, child)
      return
    }
    const key = `${worksKey}\u0000${chapterKey}`
    if (!byWorks.has(key)) byWorks.set(key, child)
  }

  for (const child of children) add(child)

  return {
    add,
    find(folderName: string): ChildProject | undefined {
      const { worksKey, chapterKey } = splitChapterIdentity(folderName)
      if (chapterKey === '') return undefined
      if (worksKey === '') return anyNumber.get(chapterKey)
      return byWorks.get(`${worksKey}\u0000${chapterKey}`) ?? numberOnly.get(chapterKey)
    }
  }
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

/**
 * 自检导入时扫一个候选目录，**入库前过 `requireCompleteScan` 那道闸**（2026-10-05 移植）。
 *
 * 目录不在 / 部分读不到 / 文件仍在写 ⇒ 抛错，由调用方记入 failed ——
 * 宁可这一条不导入，也不把半截统计写进库（侧栏/首页会永久显示错误数字）。
 * 提成独立函数是为了能在单测里只 mock `scanner` 就把"闸确实挂在这条路上"锁住。
 */
export async function scanImportCandidate(folderPath: string): Promise<{
  lastMtimeMs: number
  psdStats: ChildProject['psdStats']
  contentFingerprint: string
}> {
  const directoryStats = await stat(folderPath)
  if (!directoryStats.isDirectory()) throw new Error('不是目录')
  const scan = await projectScans.request(folderPath)
  requireCompleteScan(scan)
  const lastMtimeMs = scan.jpgPairs.reduce((latest, pair) => Math.max(latest, pair.psd.mtimeMs), 0)
  const psdStats = scan.jpgPairs
    .filter((pair) => pair.countsTowardProgress ?? Boolean(pair.jpgPath))
    .map((pair) => ({ mtimeMs: pair.psd.mtimeMs, ctimeMs: pair.psd.ctimeMs }))
  // 顺手记下内容指纹（R1）：新导入的话一落地就有"改名比对基准"，不必等第一次打开。
  const contentFingerprint = await computeIdentityFingerprint(scan, folderPath)
  return { lastMtimeMs, psdStats, contentFingerprint }
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

  const roots = normalizeRememberedRoots(
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

  // 落在"某一话自己的文件夹"里的根一律拒用（见 `isInsideOwnChapter`）。
  // 全被拒 ⇒ 复用既有的"无法自动确定"分支，但**把原因说清楚**（不然用户只会看到
  // 一个让人莫名其妙的空弹窗，然后又被"选择目录"引到同一个坑里）。
  const usableRoots = roots.filter((root) => !isInsideOwnChapter(root, parent))
  if (usableRoots.length === 0) {
    return {
      canDetect: false,
      sourceRoot: null,
      sourceRoots: [],
      message:
        '这个扫描目录是某一话自己的文件夹（不是"各话所在的那一层"），扫它只会把这一话的子目录当成新话。请选择一次正确的目录',
      candidates: [],
      duplicatePaths: 0
    }
  }

  const existingPaths = existingFolderPathSet(projects)
  // 冲突索引（2026-10-05，P1）：键 =「作品名键 + 集数」。
  // 空集数（"未设置集数"）与"解析不出来"都不参与比较（§16.1 第 2 条，别改回去）。
  const existingChaptersInParent = createParentChapterIndex(parent.children)

  const candidates: SelfCheckCandidate[] = []
  const seenCandidatePaths = new Set<string>()
  const unreadableRoots: string[] = []
  let duplicatePaths = 0

  for (const root of usableRoots) {
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
      const pathKey = normalizePathKey(folderPath)
      if (seenCandidatePaths.has(pathKey)) continue
      if (existingPaths.has(pathKey)) {
        duplicatePaths += 1
        continue
      }
      // 容器层（分类目录 / 另一个扫描根本身）不是章节。
      if (isGroupingLevel(folderPath, usableRoots)) continue

      seenCandidatePaths.add(pathKey)
      const inferred = inferChapterAndTitle(folderName)
      const chapterKey = normalizeChapter(inferred.chapterNumber)
      const occupied = existingChaptersInParent.find(folderName)
      if (occupied) {
        candidates.push({
          folderName,
          folderPath,
          chapterNumber: inferred.chapterNumber,
          projectTitle: inferred.projectTitle,
          conflict: 'same-chapter',
          existingChapterNumber: chapterKey,
          // 只报事实：谁占了这个号、它在哪。标题为空（真实库里有）就回落到文件夹名。
          existingChapterTitle:
            occupied.projectTitle.trim() || lastPathSegment(occupied.folderPath),
          existingChapterPath: occupied.folderPath
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
  if (unreadableRoots.length === usableRoots.length) {
    return {
      canDetect: false,
      sourceRoot: usableRoots[0] ?? null,
      sourceRoots: usableRoots,
      unreadableRoots,
      message: '无法读取父级目录',
      candidates: [],
      duplicatePaths
    }
  }

  // "认领"用的既有话清单（2026-10-05，R2）：改名的旧话会表现为"目录不在"，
  // 这条标记就是用户指认时的第一线索。并行 stat，代价可忽略。
  const existingChapters: SelfCheckExistingChapter[] = await Promise.all(
    parent.children.map(async (child) => ({
      id: child.id,
      chapterNumber: normalizeChapter(child.chapterNumber),
      projectTitle: child.projectTitle,
      folderPath: child.folderPath,
      missing: !(await pathExists(child.folderPath))
    }))
  )

  return {
    canDetect: true,
    sourceRoot: usableRoots[0] ?? null,
    sourceRoots: usableRoots,
    unreadableRoots,
    candidates,
    duplicatePaths,
    existingChapters
  }
}

/** 路径在磁盘上是否存在（只用来标"目录不在"，不参与任何判定）。 */
async function pathExists(target: string): Promise<boolean> {
  try {
    await stat(target)
    return true
  } catch {
    return false
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
    contentFingerprint: string
    scanError?: string
  }> = []

  for (const item of request.items) {
    if (item.conflictAction === 'skip') {
      result.skipped += 1
      continue
    }
    try {
      const scanned = await scanImportCandidate(item.folderPath)
      if (request.requireContent && !scanned.psdStats?.length) {
        result.skipped++
        continue
      }
      scannedItems.push({
        folderPath: item.folderPath,
        folderName: item.folderName,
        chapterNumber: item.chapterNumber,
        projectTitle: item.projectTitle,
        conflictAction: item.conflictAction,
        lastMtimeMs: scanned.lastMtimeMs,
        psdStats: scanned.psdStats,
        contentFingerprint: scanned.contentFingerprint
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
        // ⚠️ 走**唯一那处**"写一对字段"的实现（`applyParentSourceRoots`）：
        // 这里原来自己写了一遍 `parent.sourceRoots = …; parent.sourceRoot = …`，
        // 而弹窗那条「记住此目录」走的是另一条只改旧字段的通道 —— 两条通道各写各的，
        // 就出现了"提前退出留半截状态"（旧根留在主字段里继续被扫）。见那个函数的注释。
        applyParentSourceRoots(parent, [
          ...(Array.isArray(request.sourceRoots) ? request.sourceRoots : []),
          request.sourceRoot
        ])
      }

      const existingPaths = existingFolderPathSet(projects)
      // 与预览**同一处实现**的冲突索引（§16：两处口径必须一致）。
      const existingChaptersInParent = createParentChapterIndex(parent.children)
      // 「之N」后缀去重只用得到集数本身（那是命名问题，不是冲突判定）。
      const existingChapterNumbers = new Set(
        parent.children
          .map((child) => normalizeChapter(child.chapterNumber))
          .filter((key) => key !== '')
      )

      for (const item of scannedItems) {
        const pathKey = normalizePathKey(item.folderPath)
        if (existingPaths.has(pathKey)) {
          skippedInTransaction += 1
          continue
        }

        if (existingChaptersInParent.find(item.folderName)) {
          if (item.conflictAction !== 'second-version') {
            skippedInTransaction += 1
            continue
          }
          // 第二版本：在原集数后追加“之N”后缀，并避开已存在的同后缀章节。
          item.chapterNumber = secondVersionChapter(
            item.chapterNumber,
            existingChapterNumbers,
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
          statsVersion: PAIRED_PSD_STATS_VERSION,
          // 改名认领的比对基准（R1）：导入那一刻的内容指纹。
          ...(item.contentFingerprint ? { contentFingerprint: item.contentFingerprint } : {})
        }
        parent.children.push(child)
        existingPaths.add(pathKey)
        // 空集数不入比较：它表示"还没设集数"，不是"某个已经用掉的集数"。
        // （否则同一批里的第二条空集数条目会被自己刚加进去的第一条判成冲突。）
        existingChaptersInParent.add(child)
        const addedChapterKey = normalizeChapter(child.chapterNumber)
        if (addedChapterKey !== '') existingChapterNumbers.add(addedChapterKey)
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

/**
 * 「疑似改名」检测（2026-10-05，R1）—— **只比对内容指纹**（事实，不猜）。
 *
 * 比对对象只有一种：**目录已经不在磁盘上、且记过指纹**的旧话（那是"被改名/被删"的形状）。
 * 候选这边用原始扫描器逐个数一遍（不走调度器的双次校验：这里只是比对，不写库，
 * 不需要"等文件写完"那一步的代价）。指纹完全相同 ⇒ 返回这条提示；**仍要用户确认**才认领。
 *
 * 代价说明：只在用户点「检查是不是改名」时跑，每次候选一次扫描 —— 不在预览的常走路径上。
 */
export async function detectRenamedCandidates(
  parentId: string,
  candidatePaths: readonly string[]
): Promise<SelfCheckRenameHint[]> {
  if (candidatePaths.length === 0) return []
  const projects = await getProjectTree()
  const parent = findParent(projects, parentId)
  if (!parent) return []

  const missing: Array<{ child: ChildProject; fingerprint: string }> = []
  for (const child of parent.children) {
    const fingerprint = child.contentFingerprint
    if (!fingerprint) continue
    if (await pathExists(child.folderPath)) continue
    missing.push({ child, fingerprint })
  }
  // 没有"目录不在、又记过指纹"的旧话 ⇒ 没什么可比对的（不假装能检测）。
  if (missing.length === 0) return []

  const hints: SelfCheckRenameHint[] = []
  for (const candidatePath of candidatePaths) {
    try {
      const scan = await projectScans.request(candidatePath)
      if (scan.status !== 'complete') continue
      const fingerprint = await computeIdentityFingerprint(scan, candidatePath)
      const matches: typeof missing = []
      for (const entry of missing) {
        if (
          entry.fingerprint === fingerprint ||
          entry.fingerprint ===
            (await computeIdentityFingerprint(scan, candidatePath, entry.child.folderPath))
        ) {
          matches.push(entry)
        }
      }
      // 多条旧章节都匹配时不擅自挑第一条，交给用户手动认领。
      if (matches.length !== 1) continue
      const hit = matches[0]
      hints.push({
        folderPath: candidatePath,
        childId: hit.child.id,
        chapterTitle: hit.child.projectTitle.trim() || lastPathSegment(hit.child.folderPath),
        chapterNumber: normalizeChapter(hit.child.chapterNumber)
      })
    } catch {
      // 单个候选扫不到就跳过：它是"检测不到"，不是"没改名"。
    }
  }
  return hints
}

export async function setParentSourceRoot(parentId: string, sourceRoot: string): Promise<void> {
  await setProjectSourceRoot(parentId, sourceRoot)
}
