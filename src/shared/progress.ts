import { compareChapterNumbers, formatChapterNumber } from './chapter'
import { WORK_MODES } from './modes'
import type { WorkMode } from './types'

/**
 * 「进度」页的计算口径（2026-10-03）。
 *
 * 这一页回答的是：**按这本漫画的职责，我还欠几话、多久没烤肉了。**
 * 纯函数，脱离 DOM 单测（`__tests__/progress.spec.ts` 逐条锁着下面这些规则）。
 *
 * 口径（用户逐条拍板，改之前先看 spec）：
 *   ① **熟** = 该话在「当前职责」这个模式下，**所有文件**都已完成；
 *   ② **多职责分开算**（不合并成"都完成才算熟"）—— 界面点哪个职责，整行数据切到哪个；
 *   ③ **最新话**优先按**标记完成时间**取（最近烤的那一话），保底才用**最大集数** ——
 *      因为存在【短篇】【番外】与相同集数；
 *   ④ **距上次**用**标记完成时间戳**，不是文件修改时间（后者有历史脏值）；
 *      且**不做"未知"兜底**：久就是久，如实显示天数；
 *   ⑤ **默认排序 = 项目页那一套**（最近改动在前）。
 */

/** 一话在某本漫画下的标记事实（由项目树 + 标记记录合成）。 */
export interface ChapterDutyFact {
  childId: string
  /** 原始集数字段（可能带小数、也可能是"番外""归档"这种自定义值）。 */
  chapterNumber: string
  /**
   * 该话**总文件数**（完成度的分母）。
   *
   * 来源：项目树的 PSD 统计；拿不到时退回标记记录里的文件数。
   * ⚠️ 为 0 = 还没扫到 / 目录不在 ⇒ 这一话**不算熟**（见 `isChapterCooked`），
   * 但也不该被当成"做完了"。
   */
  totalFiles: number
  /** 每个模式"已完成文件数"（来自标记记录的完成时间戳列表长度）。 */
  doneByMode: Record<WorkMode, number>
  /** 每个模式"最近一次完成标记"的时间戳（ms）；从没标记过则没有这一项。 */
  lastMarkAtByMode: Partial<Record<WorkMode, number>>
}

/** 进度页的一行（一本漫画 × 当前职责）。 */
export interface ParentDutyProgress {
  parentId: string
  title: string
  /** 这本挂的职责（声明过的，或界面推断出来的）；空 = 没设职责。 */
  duties: WorkMode[]
  /** 当前口径（点击切换后的那个职责）；没职责时为 null。 */
  duty: WorkMode | null
  /**
   * 「进展」/「更新至」这一列的显示串 = **最近"收工"的那一话**（该话在当前职责下全部文件都完成），
   * 例如 `第13集` / `归档`；一话都没收工 → `—`。
   * ⚠️ 不是"最近标记的那一话"（那是"还在做哪一话"），也不是"集数最大的那一话" ——
   * 2026-10-03 之前用的就是后者，用户反馈"容易误导"（一话没做完却报个集号）。
   *
   * 2026-10-04：列名从「进展」改成「**更新至**」（用户拍板）——"更新到第几话"比"进展"直白。
   */
  latestCookedChapter: string
  /**
   * 「最近出勤」= 距上次**动过手**（任何一张标记）的天数；**null = 该职责下从没标记过**。
   *
   * 2026-10-04：列名从「距上次」改成「**最近出勤**」（用户拍板）—— 与下面那一列配对后，
   * "出勤"（人来干活）与"更新"（产出成品）是两个不同的概念，名字必须分得开。
   */
  daysSinceLastMark: number | null
  /**
   * 「上次更新」（2026-10-04 用户新增的列）= 距上次**完整做完一话**的天数。
   *
   * 口径：取**已收工**那几话里最晚的标记时间（`lastMarkAtByMode[duty]`），
   * 再算到现在的整天数；该职责下一话都没收工过 → **null**（界面显示「从未」）。
   *
   * ⚠️ 与 `daysSinceLastMark` 的关系是**不变量**：`daysSinceLastCooked >= daysSinceLastMark`
   *    （收工那话的标记时间必然不晚于全部标记里最晚的那个）。
   * ⚠️ 精度：这个时间戳是"该话最近一次标记"——一话做完之后你又回头动过它，时间会往后走，
   *    所以它是真实间隔的**下界**（宁可报得乐观，也不虚报"很久没做"）。`progress.spec` 锁着。
   */
  daysSinceLastCooked: number | null
  cookedChapters: number
  uncookedChapters: number
  totalChapters: number
  /** 默认排序（项目页口径）用：最近改动在前。 */
  lastMtimeMs: number
}

/**
 * 一话在某个职责下算不算"熟"。
 *
 * 判据：该模式完成的文件数 **≥** 该话总文件数（且总数 > 0）。
 * · 只看**当前职责那个模式** —— 别的模式做到 100% 也不算；
 * · 总数 0（没扫到 / 目录不在）⇒ 不算熟，也不许算成完成；
 * · 完成数 **超过** 总数（分母是过期缓存）⇒ 仍算熟：
 *   宁可把做完的说成做完，也别把做完的说成没做。
 */
export function isChapterCooked(fact: ChapterDutyFact, duty: WorkMode): boolean {
  if (fact.totalFiles <= 0) return false
  return (fact.doneByMode[duty] ?? 0) >= fact.totalFiles
}

/** 该职责下**最近一次**完成标记的时间；从没标记过 → null。 */
export function lastMarkAtOf(facts: readonly ChapterDutyFact[], duty: WorkMode): number | null {
  let latest: number | null = null
  for (const fact of facts) {
    const at = fact.lastMarkAtByMode[duty]
    if (typeof at === 'number' && (latest === null || at > latest)) latest = at
  }
  return latest
}

/**
 * 该职责下**最近一次"完整收工"**的时间；一话都没收工过 → null。
 *
 * 与 `lastMarkAtOf` 的唯一区别：只看**已收工**的话（`isChapterCooked`）。
 * 所以它必然 **≤ `lastMarkAtOf`**，换成"距今天数"就是 **≥**（见 `daysSinceLastCooked` 的不变量）。
 */
export function lastCookedAtOf(facts: readonly ChapterDutyFact[], duty: WorkMode): number | null {
  let latest: number | null = null
  for (const fact of facts) {
    if (!isChapterCooked(fact, duty)) continue
    const at = fact.lastMarkAtByMode[duty]
    if (typeof at === 'number' && (latest === null || at > latest)) latest = at
  }
  return latest
}

/**
 * "最新话"该怎么显示。
 *
 * 两级：
 *   1. 该职责下**最近标记完成**的那一话（存在【短篇】【番外】、集数也可能重复，
 *      所以"我最近烤到哪一话"比"集数最大的那一话"更贴近事实）；
 *   2. 一话都没标记过 → 保底取**集数最大**的那一话。
 *
 * ⚠️ 保底那一级有两条规矩（`progress.spec` 锁着）：
 *   · **数字集数优先**：一本里既有「第139集」又有「归档」时，显示「第139集」——
 *     "归档 / 工作稿 / 番外"这类是标签，不是集数，拿它当"更新到第几话"没有意义；
 *   · 一话数字集数都没有（搬砖那种整本都是「归档 / 有」）→ 才用自定义标签，
 *     按 `compareChapterNumbers` 取最大的那个。
 *
 * 一话都没有 → `—`（不是空串，也不是"第0集"）。
 */
export function latestCookedChapterOf(
  facts: readonly ChapterDutyFact[],
  duty: WorkMode | null
): string {
  if (!duty) return '—'

  let best: ChapterDutyFact | null = null
  let bestAt = -1
  for (const fact of facts) {
    if (!isChapterCooked(fact, duty)) continue
    const at = fact.lastMarkAtByMode[duty]
    if (typeof at !== 'number') continue
    if (best === null || at > bestAt || (at === bestAt && isLaterChapter(fact, best))) {
      best = fact
      bestAt = at
    }
  }
  return best ? formatChapterNumber(best.chapterNumber) : '—'
}

/**
 * "点漫画名该跳到哪一话" = **这本最近在干的那一话**（工作台）。
 *
 * 与 `latestChapterOf` **同一条规则**（所以抽成一个函数共用，不许抄第二份）：
 * 优先该职责下最近标记完成的那一话；一话都没标记过 → 集数最大的那一话。
 * 一话都没有 → null（界面把标题渲染成不可点）。
 */
export function latestActiveChildId(
  facts: readonly ChapterDutyFact[],
  duty: WorkMode | null
): string | null {
  return pickLatestActiveFact(facts, duty)?.childId ?? null
}

/** 上面两个函数的唯一实现。 */
function pickLatestActiveFact(
  facts: readonly ChapterDutyFact[],
  duty: WorkMode | null
): ChapterDutyFact | null {
  if (facts.length === 0) return null

  if (duty) {
    let best: ChapterDutyFact | null = null
    let bestAt = -1
    for (const fact of facts) {
      const at = fact.lastMarkAtByMode[duty]
      if (typeof at !== 'number') continue
      if (best === null || at > bestAt || (at === bestAt && isLaterChapter(fact, best))) {
        best = fact
        bestAt = at
      }
    }
    // 最近标记的那一话哪怕是「归档」也该显示 —— 那正是你刚烤的东西
    if (best) return best
  }

  return pickLatestByChapterNumber(facts)
}

/** 保底：数字集数优先（按数值比），全都没有数字时才退到自定义标签。 */
function pickLatestByChapterNumber(facts: readonly ChapterDutyFact[]): ChapterDutyFact {
  const numeric = facts.filter((fact) => isNumericChapter(fact.chapterNumber))
  const pool = numeric.length > 0 ? numeric : facts
  let latest = pool[0]
  for (const fact of pool) {
    if (isLaterChapter(fact, latest)) latest = fact
  }
  return latest
}

function isNumericChapter(chapterNumber: string): boolean {
  const normalized = chapterNumber.trim().normalize('NFC')
  return /^\d+(?:\.\d+)?$/.test(normalized) || /^第\d+(?:\.\d+)?[集話话]$/.test(normalized)
}

function isLaterChapter(candidate: ChapterDutyFact, current: ChapterDutyFact): boolean {
  return compareChapterNumbers(candidate.chapterNumber, current.chapterNumber) > 0
}

/** 整天数（向下取整）。久就是久 —— 不做"太久显示未知"的兜底。 */
export function daysBetween(fromMs: number, toMs: number): number {
  return Math.max(0, Math.floor((toMs - fromMs) / 86_400_000))
}

export interface ComputeParentProgressInput {
  parentId: string
  title: string
  duties: readonly WorkMode[]
  /** 当前口径（界面选中的职责）；null = 没设职责。 */
  duty: WorkMode | null
  lastMtimeMs: number
  /** 这本下的**所有话**（包括从没标记过的 —— 它们要算进"未熟"）。 */
  facts: readonly ChapterDutyFact[]
  /** 注入"现在"，方便单测；默认取当前时间。 */
  now?: number
}

/** 把一本漫画的原始事实算成进度页的一行。 */
export function computeParentDutyProgress(input: ComputeParentProgressInput): ParentDutyProgress {
  const { parentId, title, duties, duty, lastMtimeMs, facts } = input
  const now = input.now ?? Date.now()
  const totalChapters = facts.length

  // 没设职责 ⇒ 不算熟/未熟（"欠几话"要按哪个职责回答？没有答案就该说不出来），
  // 但仍给出话数与最新话，界面显示"未设职责"占位。
  const cookedChapters = duty ? facts.filter((fact) => isChapterCooked(fact, duty)).length : 0
  const uncookedChapters = duty ? totalChapters - cookedChapters : 0
  const lastMarkAt = duty ? lastMarkAtOf(facts, duty) : null
  const lastCookedAt = duty ? lastCookedAtOf(facts, duty) : null

  return {
    parentId,
    title,
    duties: [...duties],
    duty,
    latestCookedChapter: latestCookedChapterOf(facts, duty),
    daysSinceLastMark: lastMarkAt === null ? null : daysBetween(lastMarkAt, now),
    daysSinceLastCooked: lastCookedAt === null ? null : daysBetween(lastCookedAt, now),
    cookedChapters,
    uncookedChapters,
    totalChapters,
    lastMtimeMs
  }
}

/**
 * 排序键（2026-10-03 按用户定的"理解①"重写）。
 *
 * ⚠️ 键名就是**界面上那一列的名字**，方向就是**那一列字面的方向** —— 两者必须对得上：
 *   · `completion`：按**完成度**（已熟 / 总话数）。`desc` = 完成度高的在前（"完成度↓"）；
 *     `asc` = 欠账多的在前（"完成度↑"）。
 *   · `gap`：按**距上次间隔**。"desc" = 间隔长的在前（"间隔↓"），**"从未"算最长**、排最前；
 *     "asc" = 间隔短的在前（今天/昨天先出）。
 *   · `default`：**项目页那一套**（最近改动在前），固定方向、不受 direction 影响。
 *   · `title`：中文自然序。
 */
export type ProgressSortKey = 'default' | 'completion' | 'update' | 'title'
export type SortDirection = 'asc' | 'desc'

/**
 * 排序档位的**唯一出处**（界面下拉 / 设置存储的校验 / 单测都从这儿取）。
 *
 * 为什么要一处定义：档位是"值 + 键 + 方向 + 标签"四件东西的固定组合，抄两份必然漂移
 * （例如界面加了 `completion:desc` 而库里校验不认，用户选完一重启就回默认）。
 */
export interface ProgressSortOption {
  /** 落库的值（也是下拉的 value）：`键:方向`。 */
  value: string
  key: ProgressSortKey
  direction: SortDirection
  /** 界面上那几个字（就是列名 + 箭头）。 */
  label: string
  /** 这一档到底按什么排（只给人看：设置页/文档/注释）。 */
  hint: string
}

export const PROGRESS_SORT_OPTIONS: readonly ProgressSortOption[] = [
  {
    value: 'default:desc',
    key: 'default',
    direction: 'desc',
    label: '默认顺序',
    hint: '项目页那一套：最近改动在前'
  },
  {
    value: 'completion:desc',
    key: 'completion',
    direction: 'desc',
    label: '完成度↓',
    hint: '完成度高的在前'
  },
  {
    value: 'completion:asc',
    key: 'completion',
    direction: 'asc',
    label: '完成度↑',
    hint: '待烤多的在前'
  },
  {
    value: 'update:desc',
    key: 'update',
    direction: 'desc',
    label: '上次更新↓',
    hint: '完整收工间隔长的在前（"从未"算最长）'
  },
  {
    value: 'update:asc',
    key: 'update',
    direction: 'asc',
    label: '上次更新↑',
    hint: '间隔短的在前'
  },
  { value: 'title:asc', key: 'title', direction: 'asc', label: '名称 A → Z', hint: '按漫画名排' }
]

/** 没选过 / 库里的值不认时用它。 */
export const DEFAULT_PROGRESS_SORT = 'default:desc'

/** 库里读回来的值认不认（settings 的载入路径用它）。 */
export function isProgressSortValue(value: unknown): value is string {
  return typeof value === 'string' && PROGRESS_SORT_OPTIONS.some((option) => option.value === value)
}

/** 值 → { 键, 方向 }；垃圾值回落到默认档（**不抛**，读取路径不该因为一个偏好崩）。 */
export function parseProgressSort(value: unknown): {
  key: ProgressSortKey
  direction: SortDirection
} {
  const option =
    PROGRESS_SORT_OPTIONS.find((item) => item.value === value) ?? PROGRESS_SORT_OPTIONS[0]
  return { key: option.key, direction: option.direction }
}

/**
 * 排序。**不改动入参**，返回新数组；同键值保持原顺序（稳定 —— 免得"刷新一次顺序就变"）。
 */
export function sortProgressRows(
  rows: readonly ParentDutyProgress[],
  key: ProgressSortKey,
  direction: SortDirection = 'desc'
): ParentDutyProgress[] {
  const decorated = rows.map((row, index) => ({ row, index }))
  const sign = direction === 'desc' ? -1 : 1

  decorated.sort((a, b) => {
    let result = 0
    if (key === 'default') {
      // 项目页口径固定"最近改动在前"，不受 direction 影响（与项目页永远一致）
      result = b.row.lastMtimeMs - a.row.lastMtimeMs
    } else if (key === 'completion') {
      result = sign * compareCompletion(a.row, b.row)
    } else if (key === 'update') {
      // 「上次更新」= 距上次**完整收工**的天数（null = 从没收工 ⇒ 算最长，排最前）
      result = sign * compareGap(a.row.daysSinceLastCooked, b.row.daysSinceLastCooked)
    } else {
      result = sign * a.row.title.localeCompare(b.row.title, 'zh-CN', { numeric: true })
    }
    // 稳定：键值相同就用原顺序
    return result !== 0 ? result : a.index - b.index
  })

  return decorated.map((item) => item.row)
}

/**
 * 完成度比较：**按比例**，不是按已熟话数。
 *
 * 为什么必须按比例：快住手 73/75（97%）与鹅妈妈 40/40（100%）—— 比已熟话数会把
 * 快住手排前面，但它其实还欠着 2 话。比例才对应界面上那根进度条。
 * 没设职责的本（0/0）算 0（排在最后），与"这条数据说不出来"一致。
 */
function compareCompletion(a: ParentDutyProgress, b: ParentDutyProgress): number {
  const left = a.totalChapters > 0 ? a.cookedChapters / a.totalChapters : 0
  const right = b.totalChapters > 0 ? b.cookedChapters / b.totalChapters : 0
  if (left !== right) return left - right
  // 比例一样时（例如都是 0/0 与 0/23）用总话数兜底，保证顺序稳定可解释
  return a.totalChapters - b.totalChapters
}

/**
 * "间隔"的比较：**从未（null）永远算最长**。
 * 于是 `desc`（间隔↓：长的在前）时它排最前，`asc`（间隔↑：短的在前）时排最后。
 */
function compareGap(a: number | null, b: number | null): number {
  if (a === null && b === null) return 0
  if (a === null) return Number.POSITIVE_INFINITY
  if (b === null) return Number.NEGATIVE_INFINITY
  return a - b
}

// ── 事实合成：项目树 + 标记记录 → ChapterDutyFact[] ──────────────────────────

/**
 * 合成事实时用到的最小输入（结构化类型，故意不 import 渲染层/主进程的类型，
 * 好让 `shared/` 保持"谁也不依赖"）。
 */
export interface ProgressChildInput {
  id: string
  chapterNumber: string
  /** 项目树里的 PSD 统计（只用来数"这一话有多少个文件"）。 */
  psdStats?: readonly unknown[]
}

/** 标记记录里一话的口径（= 主进程 `ChildMarkStatistics` 的形状）。 */
export interface ProgressMarkStatInput {
  /** 该话在标记记录里的文件数（分母的**保底**来源）。 */
  fileCount: number
  /** 每个模式"已完成文件"的时间戳列表。 */
  completedTimestamps: Record<WorkMode, readonly number[]>
}

/**
 * 把一话的"项目树 + 标记记录"合成一个 `ChapterDutyFact`。
 *
 * ⚠️ **分母（总文件数）的取法**（这是全页最容易算错的一处，两条规矩都锁着）：
 *   1. **优先用项目树的 PSD 统计数**（`psdStats.length`）—— 它才是"这一话有多少个文件"；
 *   2. 统计缺了/还没扫到（长度 0）才退回**标记记录里的文件数**（`fileCount`）。
 *
 * 为什么不反过来：标记记录只记"被标记过"的文件。一话有 20 个 PSD、只标过 5 个时，
 * 若拿 5 当分母，就会把"只做了 1/4"误判成**全熟**。
 */
export function buildChapterDutyFacts(
  children: readonly ProgressChildInput[],
  statsByChild: ReadonlyMap<string, ProgressMarkStatInput>
): ChapterDutyFact[] {
  return children.map((child) => {
    const stat = statsByChild.get(child.id)
    const fromSnapshot = child.psdStats?.length ?? 0
    const totalFiles = fromSnapshot > 0 ? fromSnapshot : (stat?.fileCount ?? 0)

    const doneByMode = emptyDone()
    const lastMarkAtByMode: Partial<Record<WorkMode, number>> = {}
    for (const mode of WORK_MODES) {
      const stamps = stat?.completedTimestamps?.[mode] ?? []
      doneByMode[mode] = stamps.length
      if (stamps.length > 0) {
        const latest = stamps.reduce((max, at) => (at > max ? at : max), stamps[0])
        if (typeof latest === 'number' && latest > 0) lastMarkAtByMode[mode] = latest
      }
    }

    return {
      childId: child.id,
      chapterNumber: child.chapterNumber,
      totalFiles,
      doneByMode,
      lastMarkAtByMode
    }
  })
}

function emptyDone(): Record<WorkMode, number> {
  return { typeset: 0, translated: 0, proofread: 0, supervised: 0 }
}

/* ------------------------------------------------------------------ *
 * 时间线（抽屉里那一列回顾）
 * ------------------------------------------------------------------ */

/** 时间线上的一条：**某一天**，某本漫画、某一话、某个职责干完了 N 张。 */
export interface ProgressTimelineEvent {
  timeSources?: import('./statistics-time').StatisticsTimeSource[]
  chapterCompleted?: boolean
  /**
   * 这一话的 id（2026-10-05 从并行分支 T8 移植时补的）。
   *
   * 分组要靠它认"是不是同一话"：两话可能有**同样的显示名**（不同父级下的"第1集"），
   * 光比 `chapterNumber` 会把它们误并成一条。缺省时回落到 `chapterNumber`。
   */
  childId?: string
  /** 这条对应那天的**最后一笔**完成时间（排序与显示日期都用它）。 */
  at: number
  parentTitle: string
  chapterNumber: string
  mode: WorkMode
  /** **那天**一共完成几个文件（不是累计 —— 那正是 2026-10-04 改口径的原因）。 */
  fileCount: number
}

/** 时间线的数据源（= 主进程 `ChildMarkStatistics` 里用得着的部分）。 */
export interface TimelineSourceStat {
  fileCount?: number
  datedEntries?: Partial<Record<WorkMode, {at:number; source: import('./statistics-time').StatisticsTimeSource}[]>>
  childId: string
  completedTimestamps: Record<WorkMode, readonly number[]>
}

/** 「这一话属于哪一本、显示成第几集」—— 由调用方从项目树建好传进来。 */
export interface TimelinePlace {
  parentTitle: string
  chapterNumber: string
}

/** 抽屉最多显示多少条（真实库里标记上千条，全量渲染没必要）。 */
export const TIMELINE_LIMIT = 80

/**
 * 本地自然日的零点。
 *
 * ⚠️ 全仓库**只此一处**定义"一天从哪儿开始"：时间线分桶用它、抽屉显示"今天/昨天"也用它。
 * 抄第二份必然漂 —— 会出现"分在两个桶里、却都显示今天"这种自相矛盾。
 */
export function localDayStart(ms: number): number {
  const date = new Date(ms)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

/**
 * "今天 / 昨天 / N 天前 / 具体日期"。
 *
 * ⚠️ 按**自然日**算，不是"滚动 24 小时"：凌晨 00:30 回看昨夜 23:30，那是**昨天**
 * （只差一小时，但确实跨天了）—— 滚动口径会说成"今天"，与按天分组的行对不上。
 * ⚠️ 30 天以内说相对时间（回顾时更有用），更久给日期 —— 免得出现"937 天前"这种读不出感觉的数。
 * 这与列表「最近出勤」那一列**故意不同**：列表要"欠了多久"，抽屉要"这件事发生在哪天"。
 */
export function timelineDayLabel(at: number, now: number): string {
  // 用 round 而不是 floor：跨夏令时的"那天"可能是 23 或 25 小时
  const days = Math.round((localDayStart(now) - localDayStart(at)) / 86_400_000)
  if (days <= 0) return '今天'
  if (days === 1) return '昨天'
  if (days < 30) return `${days} 天前`
  return new Date(at).toLocaleDateString('zh-CN')
}

/**
 * 把标记记录摊成时间线（新到旧）。
 *
 * **口径（2026-10-04 用户拍板：按天切分）**：一条 = **某一天** × 一话 × 一职责；
 * `fileCount` = 那天完成的张数、`at` = 那天最后一笔。
 *
 * 为什么不是"一话一职责一条"（旧口径）：那样一行写着「今天 · 完成 7 张」，
 * 而 7 张可能是三个月里陆续做的 —— 日期取最近、张数取累计，两个来源不同的数
 * 挤在一格里，看着像在说同一件事。
 *
 * 找不到归属的话（已从项目树删掉 / 移走）**跳过**：时间线要显示"哪本哪话"，
 * 没归属就没法显示（成就页的数字不受影响 —— 那边直接按标记记录算）。
 */
export function buildTimelineEvents(
  stats: readonly TimelineSourceStat[],
  where: ReadonlyMap<string, TimelinePlace>,
  limit = TIMELINE_LIMIT
): ProgressTimelineEvent[] {
  const events: ProgressTimelineEvent[] = []
  for (const stat of stats) {
    const place = where.get(stat.childId)
    if (!place) continue
    for (const mode of WORK_MODES) {
      const stamps = stat.completedTimestamps[mode] ?? []
      if (stamps.length === 0) continue

      // 按自然日分桶：同一天里标了多少次 → 合成一条
      const latestOfDay = new Map<number, number>()
      const countOfDay = new Map<number, number>()
      for (const stamp of stamps) {
        const day = localDayStart(stamp)
        countOfDay.set(day, (countOfDay.get(day) ?? 0) + 1)
        const latest = latestOfDay.get(day)
        if (latest === undefined || stamp > latest) latestOfDay.set(day, stamp)
      }

      for (const [day, at] of latestOfDay) {
        events.push({
          timeSources: [...new Set(stat.datedEntries?.[mode]?.filter(entry => localDayStart(entry.at) === day).map(entry => entry.source) ?? ['mark' as const])],
          chapterCompleted: !!stat.fileCount && stamps.length >= stat.fileCount && at === Math.max(...stamps),
          childId: stat.childId,
          at,
          parentTitle: place.parentTitle,
          chapterNumber: place.chapterNumber,
          mode,
          fileCount: countOfDay.get(day) ?? 0
        })
      }
    }
  }

  // 稳定排序：现代 V8 的 sort 是稳定的，同一时刻保持插入顺序
  return events.sort((a, b) => b.at - a.at).slice(0, limit)
}

export interface ProgressTimelineGroup {
  key: string
  day: number
  at: number
  parentTitle: string
  mode: WorkMode
  fileCount: number
  chapters: ProgressTimelineEvent[]
}

/** Aggregate before applying the display limit, so a day's manga total is never cut short. */
export function groupTimelineEvents(
  events: readonly ProgressTimelineEvent[],
  limit = TIMELINE_LIMIT
): ProgressTimelineGroup[] {
  const groups = new Map<string, ProgressTimelineGroup>()
  for (const event of events) {
    const day = localDayStart(event.at)
    const key = JSON.stringify([day, event.parentTitle, event.mode])
    let group = groups.get(key)
    if (!group) {
      group = {
        key,
        day,
        at: event.at,
        parentTitle: event.parentTitle,
        mode: event.mode,
        fileCount: 0,
        chapters: []
      }
      groups.set(key, group)
    }
    group.at = Math.max(group.at, event.at)
    group.fileCount += event.fileCount
    const existing = group.chapters.find(
      (chapter) =>
        (chapter.childId ?? chapter.chapterNumber) === (event.childId ?? event.chapterNumber)
    )
    if (existing) {
      existing.fileCount += event.fileCount
      existing.at = Math.max(existing.at, event.at)
    } else group.chapters.push({ ...event })
  }
  return [...groups.values()].sort((a, b) => b.at - a.at).slice(0, limit)
}
