/**
 * achievement-ranking —— 排行模式的纯函数（需求二 / 需求三）。
 *
 * 两档对比：
 *   · `kind = WorkMode`：只比那一个模式（同职责公平竞技）；
 *   · `kind = 'overall'`：四个模式合计的"总工作量"（跨职责也能比）。
 *     ⚠️ 综合榜把四个模式的数量相加，同一张图标了多个模式会被算多次 ——
 *     那是**多份劳动**，是有意的；标题用"总工作量"，不说"总张数"。
 *
 * 这里不碰 DOM、不碰 ECharts：把"n 份档案怎么对齐到同一条时间轴"与
 * "当月/当年/总 的头牌是谁"这两件事做成可单测的纯函数。
 */
import type { AchievementModeAggregate, AchievementModesPayload } from './achievement-profile'
import { markMonthKey } from './mark-stats'
import { WORK_MODES } from './modes'
import { WORK_MODE_LABELS } from './modes'
import type { WorkMode } from './types'

export type RankingKind = WorkMode | 'overall'
export type RankingViewMode = 'month' | 'year'
export type RankingScope = 'month' | 'year' | 'total'

/** 综合榜的统一称号（2026-10-05 用户拍板「烤肉」；想换只改这里）。 */
export const OVERALL_RANKING_LABEL = '烤肉'
export const KPI_SCOPE_LABELS: Record<RankingScope, string> = {
  month: '当月',
  year: '当年',
  total: '总'
}
export const KPI_TITLE_NOUNS: Record<RankingScope, string> = {
  month: '头牌',
  year: '冠军',
  total: '之王'
}

export interface RankingEntry {
  id: string
  name: string
  duty: WorkMode | null
  isSelf: boolean
  modes: AchievementModesPayload
}

export interface RankingSeriesResult {
  categories: string[]
  series: Array<{
    name: string
    duty: WorkMode | null
    isSelf: boolean
    /** `null` = 那个刻度上不该画点（首尾空月份被裁掉了）。 */
    data: Array<number | null>
  }>
}

export interface KpiCardResult {
  key: string
  scope: RankingScope
  kind: RankingKind
  title: string
  count: number
  winners: Array<{ name: string; isSelf: boolean }>
  tie: boolean
  empty: boolean
}

function monthlyCounts(modeAgg: AchievementModeAggregate): Map<string, number> {
  const map = new Map<string, number>()
  for (const point of modeAgg.monthly) map.set(point.month, point.count)
  return map
}

function overallMonthlyCounts(modes: AchievementModesPayload): Map<string, number> {
  const map = new Map<string, number>()
  for (const mode of WORK_MODES) {
    for (const point of modes[mode].monthly) {
      map.set(point.month, (map.get(point.month) ?? 0) + point.count)
    }
  }
  return map
}

function overallTotal(modes: AchievementModesPayload): number {
  return WORK_MODES.reduce((sum, mode) => sum + modes[mode].total, 0)
}

/** 一个参赛者在当前对比档下的"月度账 + 总量"。 */
export function countsForEntry(
  entry: RankingEntry,
  kind: RankingKind
): { monthly: Map<string, number>; total: number } {
  if (kind === 'overall') {
    return { monthly: overallMonthlyCounts(entry.modes), total: overallTotal(entry.modes) }
  }
  return { monthly: monthlyCounts(entry.modes[kind]), total: entry.modes[kind].total }
}

export function rankingKindLabel(kind: RankingKind): string {
  return kind === 'overall' ? OVERALL_RANKING_LABEL : WORK_MODE_LABELS[kind]
}

/**
 * 折线节点上的"头像"：昵称首字（按**码点**切，emoji / 生僻字不会被切坏）。
 * 空昵称回落到 `?`，绝不返回空串（那样节点上会出现一个空圈）。
 */
export function avatarInitial(name: string): string {
  const chars = Array.from(name.trim())
  return chars.length > 0 ? chars[0] : '?'
}

/**
 * 「按模式」档的参赛者：**只留同职责的对手**，自己永远在场
 * （2026-10-05 用户拍板 B 方案：胶囊既切对比模式、又只看同职责对手）。
 *
 * 同时把"被筛掉几个人"带出去 —— 界面要如实提示，否则导入的档案
 * 会因为职责不符而"凭空消失"，看起来像丢了数据。
 */
export function filterEntriesByDuty(
  entries: RankingEntry[],
  kind: RankingKind
): { visible: RankingEntry[]; hidden: number } {
  if (kind === 'overall') return { visible: entries, hidden: 0 }
  const visible = entries.filter((entry) => entry.isSelf || entry.duty === kind)
  return { visible, hidden: entries.length - visible.length }
}

/** 图上的王冠系列名（不属于任何参赛者，图例里不出现）。 */
export const CROWN_SERIES_NAME = '__crown__'
/** 奖牌角标：前三名统一是金 / 银 / 铜（参与者胶囊与图例上用）。 */
export const MEDAL_BADGES: Record<1 | 2 | 3, string> = { 1: '🥇', 2: '🥈', 3: '🥉' }

function formatMonthLabel(month: string): string {
  const [year, monthStr] = month.split('-')
  return `${year}年${Number(monthStr)}月`
}

/**
 * 裁掉**首尾**的空月份（2026-10-05 用户看图后要求）：
 * 每个人的线都从"他第一个有数据的月份"开始、到最后一个有数据的月份结束 ——
 * 否则一个 9 月才开始的人，线会从 7 月贴着 0 一路爬过来，看着像"干了但从没产出"。
 *
 * ⚠️ **中间**的空月份**不裁**：那个 0 是事实（那个月真没干活），
 * 中间也断开反而让人以为"数据丢了"。
 */
function trimEmptyEdges(values: number[]): Array<number | null> {
  const first = values.findIndex((value) => value > 0)
  if (first === -1) return values.map(() => null)
  let last = values.length - 1
  while (last > first && values[last] <= 0) last--
  return values.map((value, index) => (index >= first && index <= last ? value : null))
}

/**
 * 把 n 个参赛者对齐到同一条时间轴：
 *   · 横轴 = `axisEntries` 里出现过的月份（或年份）的并集，升序；
 *   · 每条 series 对应一个人，`isSelf` 供界面把自己的线加粗置顶；
 *   · 每个人**首尾**的空月份裁成 `null`（线从自己第一个有数据的月份开始）。
 *
 * `axisEntries` 默认 = `entries`。界面会传"有资格参赛的人"（还没被图例勾掉的那些），
 * 这样把所有线都勾掉时横轴与图例还在，用户能再勾回来，不会被困在空图上。
 */
export function buildRankingSeries(
  entries: RankingEntry[],
  kind: RankingKind,
  viewMode: RankingViewMode,
  axisEntries: RankingEntry[] = entries
): RankingSeriesResult {
  const prepared = entries.map((entry) => ({ entry, counts: countsForEntry(entry, kind) }))
  const allMonths = new Set<string>()
  for (const axisEntry of axisEntries) {
    for (const month of countsForEntry(axisEntry, kind).monthly.keys()) allMonths.add(month)
  }

  if (viewMode === 'year') {
    const years = [...new Set([...allMonths].map((month) => month.slice(0, 4)))].sort()
    const series = prepared.map(({ entry, counts }) => ({
      name: entry.name,
      duty: entry.duty,
      isSelf: entry.isSelf,
      data: trimEmptyEdges(
        years.map((year) =>
          [...counts.monthly.entries()].reduce(
            (sum, [month, value]) => sum + (month.startsWith(year) ? value : 0),
            0
          )
        )
      )
    }))
    return { categories: years.map((year) => `${year}年`), series }
  }

  const months = [...allMonths].sort()
  const series = prepared.map(({ entry, counts }) => ({
    name: entry.name,
    duty: entry.duty,
    isSelf: entry.isSelf,
    data: trimEmptyEdges(months.map((month) => counts.monthly.get(month) ?? 0))
  }))
  return { categories: months.map(formatMonthLabel), series }
}

/**
 * 每个月（每个横轴刻度）的**最高者**：王冠就戴在这些节点上（并列则都戴）。
 * 该月所有人都是 0 / 没数据 ⇒ 不戴（不把王冠发给"没人干活的那个月"）。
 */
export function crownPoints(
  categories: string[],
  series: Array<{ name: string; data: Array<number | null> }>
): Array<{ name: string; point: [string, number] }> {
  const points: Array<{ name: string; point: [string, number] }> = []
  for (let index = 0; index < categories.length; index++) {
    const values = series.map((item) => ({ name: item.name, value: item.data[index] ?? null }))
    const max = values.reduce(
      (acc, item) => (typeof item.value === 'number' && item.value > acc ? item.value : acc),
      0
    )
    if (max <= 0) continue
    for (const item of values) {
      if (item.value === max) points.push({ name: item.name, point: [categories[index], max] })
    }
  }
  return points
}

/**
 * 按当前对比档的**累计**从高到低排（参与者那一行的显示顺序）。
 *
 * 只用于**显示排序**：折线的颜色 / 画线顺序仍走原始顺序，
 * 否则数据一刷新颜色就会跳来跳去。并列保持原顺序（稳定排序）。
 */
export function sortEntriesByTotal(entries: RankingEntry[], kind: RankingKind): RankingEntry[] {
  return entries
    .map((entry, index) => ({ entry, index, total: countsForEntry(entry, kind).total }))
    .sort((a, b) => b.total - a.total || a.index - b.index)
    .map((item) => item.entry)
}

/**
 * 参赛者的金/银/铜名次（按当前对比档的**累计**排名）：
 * 累计第一 = 金，第二 = 银，第三 = 铜；并列则同名次。
 * 累计为 0 的人不发奖牌（没成绩就没有名次）。
 */
export function rankingMedals(
  entries: RankingEntry[],
  kind: RankingKind
): Array<{ name: string; rank: 1 | 2 | 3 }> {
  const totals = entries.map((entry) => ({
    name: entry.name,
    total: countsForEntry(entry, kind).total
  }))
  const distinct = [...new Set(totals.map((item) => item.total).filter((total) => total > 0))].sort(
    (a, b) => b - a
  )
  const medals: Array<{ name: string; rank: 1 | 2 | 3 }> = []
  distinct.slice(0, 3).forEach((total, index) => {
    const rank = (index + 1) as 1 | 2 | 3
    for (const item of totals) {
      if (item.total === total) medals.push({ name: item.name, rank })
    }
  })
  return medals
}

function scopeValue(
  counts: { monthly: Map<string, number>; total: number },
  scope: RankingScope,
  now: number
): number {
  if (scope === 'month') return counts.monthly.get(markMonthKey(now)) ?? 0
  if (scope === 'year') {
    const prefix = `${new Date(now).getFullYear()}-`
    return [...counts.monthly.entries()].reduce(
      (sum, [month, value]) => sum + (month.startsWith(prefix) ? value : 0),
      0
    )
  }
  return counts.total
}

/**
 * 当月 / 当年 / 总 三张 KPI 卡。
 *   · 并列第一：`tie = true`，`winners` 列出所有并列者；
 *   · 所有人都是 0：`empty = true`（界面显示"暂无数据"）。
 */
export function buildKpiCards(
  entries: RankingEntry[],
  kind: RankingKind,
  now: number = Date.now()
): KpiCardResult[] {
  const prepared = entries.map((entry) => ({ entry, counts: countsForEntry(entry, kind) }))
  const label = rankingKindLabel(kind)
  const scopes: RankingScope[] = ['month', 'year', 'total']

  return scopes.map((scope) => {
    const scored = prepared.map(({ entry, counts }) => ({
      entry,
      value: scopeValue(counts, scope, now)
    }))
    const max = Math.max(0, ...scored.map((item) => item.value))
    const winners = scored
      .filter((item) => item.value === max && item.value > 0)
      .map((item) => ({ name: item.entry.name, isSelf: item.entry.isSelf }))

    return {
      key: `${kind}-${scope}`,
      scope,
      kind,
      title: `${KPI_SCOPE_LABELS[scope]}${label}${KPI_TITLE_NOUNS[scope]}`,
      count: max,
      winners,
      tie: winners.length > 1,
      empty: winners.length === 0
    }
  })
}
