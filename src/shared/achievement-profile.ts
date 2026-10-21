/**
 * achievement-profile —— 成就数据导出 / 导入档案的格式与校验（需求一）。
 *
 * 设计目标：
 *   · 导出内容**只含聚合数字**（每个模式、每个月的完成数 + 整话完成数），
 *     **不含** `folderPath` / 项目名 / 文件名 —— 路径只存在于程序内部，出不了门。
 *   · `schemaVersion` 是文件格式的"出生证"：同主版本 = 兼容（不认识的新字段忽略），
 *     跨主版本 = 弹警告、拒绝或"尽力导入"由调用方决定（这里只报事实）。
 *   · 本文件是纯函数：格式规则、解析规则都要能被表格单测锁住。
 */
import type { ChildMarkStatistics } from './ipc-api'
import { WORK_MODE_LABELS, WORK_MODES } from './modes'
import { aggregateMarkStatistics } from './mark-stats'
import type { WorkMode } from './types'

export const ACHIEVEMENT_FORMAT = 'qianzi-achievements'
export const ACHIEVEMENT_SCHEMA_VERSION = 1
/** 对比档案存在 key_value_store 里的键名（一个 key 存整份列表）。 */
export const ACHIEVEMENT_PROFILE_STORAGE_KEY = 'achievements.importProfiles'
/** 档案数量上限：太多会拖慢图表与存储，也超出"和几个朋友比一比"的场景。 */
export const MAX_IMPORTED_PROFILES = 20
/** 单份档案的月份条目上限（约 40 年）：超过基本不是合法档案。 */
export const MAX_PROFILE_MONTHS = 500
/** 导入文件大小上限（字节）。 */
export const MAX_IMPORT_FILE_BYTES = 2 * 1024 * 1024
/** 昵称长度上限。 */
export const MAX_NICKNAME_LENGTH = 40

export interface AchievementMonthlyPoint {
  /** 形如 `2026-09`。 */
  month: string
  count: number
  projectCount: number
}

export interface AchievementModeAggregate {
  total: number
  monthly: AchievementMonthlyPoint[]
}

export type AchievementModesPayload = Record<WorkMode, AchievementModeAggregate>

export interface AchievementExportPayload {
  format: typeof ACHIEVEMENT_FORMAT
  schemaVersion: number
  appVersion: string
  exportedAt: string
  profile: {
    nickname: string
    /** 可选：用户自己声明的主职责（排行里显示徽章用）。可空。 */
    duty?: WorkMode | null
  }
  modes: AchievementModesPayload
}

/** 导入后存在本地的"对比档案"（自己的数据永远不在这里）。 */
export interface ImportedAchievementProfile {
  id: string
  name: string
  importedAt: number
  duty: WorkMode | null
  modes: AchievementModesPayload
}

export type AchievementParseResult =
  | {
      ok: true
      profile: {
        name: string
        duty: WorkMode | null
        exportedAt: string
        modes: AchievementModesPayload
      }
    }
  | { ok: false; error: string }

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/

function emptyModesPayload(): AchievementModesPayload {
  return {
    typeset: { total: 0, monthly: [] },
    translated: { total: 0, monthly: [] },
    proofread: { total: 0, monthly: [] },
    supervised: { total: 0, monthly: [] }
  }
}

/** 把聚合结果（Map）转成导出用的数组，并按月份升序。 */
function monthlyPointsFromAggregates(
  data: Map<string, number>,
  projectData: Map<string, string[]>
): AchievementMonthlyPoint[] {
  const points: AchievementMonthlyPoint[] = []
  for (const [month, count] of [...data.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    points.push({ month, count, projectCount: projectData.get(month)?.length ?? 0 })
  }
  return points
}

/** 把一个模式的聚合结果转成导出结构。 */
export function aggregateModePayload(
  statistics: ChildMarkStatistics[],
  mode: WorkMode
): AchievementModeAggregate {
  const aggregates = aggregateMarkStatistics(statistics, mode)
  return {
    total: aggregates.total,
    monthly: monthlyPointsFromAggregates(aggregates.data, aggregates.projectData)
  }
}

/** 一次把四个模式都聚合好（导出与排行里的"自己"都用它）。 */
export function aggregateModesPayload(statistics: ChildMarkStatistics[]): AchievementModesPayload {
  const modes = emptyModesPayload()
  for (const mode of WORK_MODES) {
    modes[mode] = aggregateModePayload(statistics, mode)
  }
  return modes
}

/** 组装一份导出文件。 */
export function buildExportPayload(
  statistics: ChildMarkStatistics[],
  nickname: string,
  duty: WorkMode | null,
  appVersion: string,
  now: number = Date.now()
): AchievementExportPayload {
  return {
    format: ACHIEVEMENT_FORMAT,
    schemaVersion: ACHIEVEMENT_SCHEMA_VERSION,
    appVersion,
    exportedAt: new Date(now).toISOString(),
    profile: { nickname: normalizeNickname(nickname), duty },
    modes: aggregateModesPayload(statistics)
  }
}

/** 主职责只认四个已知模式，其余一律当"没填"。 */
export function normalizeDuty(value: unknown): WorkMode | null {
  if (typeof value !== 'string') return null
  return (WORK_MODES as readonly string[]).includes(value) ? (value as WorkMode) : null
}

/** 昵称：去空白、截断、空值回落成"未署名"。 */
export function normalizeNickname(value: unknown): string {
  if (typeof value !== 'string') return '未署名'
  const trimmed = value.trim().slice(0, MAX_NICKNAME_LENGTH)
  return trimmed.length > 0 ? trimmed : '未署名'
}

function fail(error: string): AchievementParseResult {
  return { ok: false, error }
}

function isValidCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function normalizeModeAggregate(
  raw: Record<string, unknown>,
  mode: WorkMode
): { ok: true; value: AchievementModeAggregate } | { ok: false; error: string } {
  const label = WORK_MODE_LABELS[mode]
  const monthlyRaw = raw.monthly
  if (monthlyRaw !== undefined && !Array.isArray(monthlyRaw)) {
    return { ok: false, error: `「${label}」的月度数据格式不正确` }
  }

  const byMonth = new Map<string, AchievementMonthlyPoint>()
  const list = Array.isArray(monthlyRaw) ? monthlyRaw : []
  for (const item of list) {
    if (typeof item !== 'object' || item === null) continue
    const point = item as Record<string, unknown>
    if (typeof point.month !== 'string' || !MONTH_PATTERN.test(point.month)) continue
    const count = isValidCount(point.count) ? point.count : 0
    const projectCount = isValidCount(point.projectCount) ? point.projectCount : 0
    const existing = byMonth.get(point.month)
    if (existing) {
      existing.count += count
      existing.projectCount += projectCount
    } else {
      byMonth.set(point.month, { month: point.month, count, projectCount })
    }
  }

  const monthly = [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month))
  const computedTotal = monthly.reduce((sum, point) => sum + point.count, 0)
  const total = monthly.length > 0 ? computedTotal : isValidCount(raw.total) ? raw.total : 0
  return { ok: true, value: { total, monthly } }
}

function normalizeModesPayload(
  raw: unknown
): { ok: true; value: AchievementModesPayload } | { ok: false; error: string } {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, error: '缺少成就数据' }
  }
  const source = raw as Record<string, unknown>
  const modes = emptyModesPayload()
  let monthCount = 0
  for (const mode of WORK_MODES) {
    const rawMode = source[mode]
    if (typeof rawMode !== 'object' || rawMode === null || Array.isArray(rawMode)) {
      return { ok: false, error: `缺少「${WORK_MODE_LABELS[mode]}」的数据` }
    }
    const normalized = normalizeModeAggregate(rawMode as Record<string, unknown>, mode)
    if (!normalized.ok) return normalized
    modes[mode] = normalized.value
    monthCount += normalized.value.monthly.length
  }
  if (monthCount > MAX_PROFILE_MONTHS) {
    return { ok: false, error: '文件里的月份数据过多，可能不是有效的成就档案' }
  }
  return { ok: true, value: modes }
}

/**
 * 解析一份导入文件。
 *
 * 宽进严出的边界：
 *   · `format` 不对 / `schemaVersion` 主版本不对 → 直接拒绝（不猜）；
 *   · 认识的结构里，未知字段一律忽略（向前兼容）；
 *   · 数字越界、缺字段 → 能用就用、不能用就报错，绝不让坏文件把界面弄崩。
 */
export function parseAchievementPayload(input: unknown): AchievementParseResult {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return fail('文件内容不是有效的 JSON 对象')
  }
  const raw = input as Record<string, unknown>
  if (raw.format !== ACHIEVEMENT_FORMAT) {
    return fail('这不是汉化工坊的成就数据文件')
  }
  const version = raw.schemaVersion
  if (
    typeof version !== 'number' ||
    !Number.isFinite(version) ||
    Math.floor(version) !== ACHIEVEMENT_SCHEMA_VERSION
  ) {
    return fail(
      `数据版本不兼容：文件是 v${String(version)}，本程序支持 v${ACHIEVEMENT_SCHEMA_VERSION}`
    )
  }

  const modesResult = normalizeModesPayload(raw.modes)
  if (!modesResult.ok) return modesResult

  const profileRaw = raw.profile
  const profileSource =
    typeof profileRaw === 'object' && profileRaw !== null && !Array.isArray(profileRaw)
      ? (profileRaw as Record<string, unknown>)
      : {}
  return {
    ok: true,
    profile: {
      name: normalizeNickname(profileSource.nickname),
      duty: normalizeDuty(profileSource.duty),
      exportedAt: typeof raw.exportedAt === 'string' ? raw.exportedAt : '',
      modes: modesResult.value
    }
  }
}

function plainModeAggregate(aggregate: AchievementModeAggregate): AchievementModeAggregate {
  return {
    total: aggregate.total,
    monthly: aggregate.monthly.map((point) => ({
      month: point.month,
      count: point.count,
      projectCount: point.projectCount
    }))
  }
}

/**
 * 摊平成"能过结构化克隆"的普通对象 —— **写库前必过这一道**。
 *
 * ⚠️ 直接把 Pinia 的响应式数组塞进 `ipcRenderer.invoke` 会被 Electron 的结构化克隆
 * 拒绝，报 `An object could not be cloned.`（交接文档 §13.2 的老坑，
 * 2026-10-05 导入档案时又踩了一次）。
 *
 * 顺带收成白名单：只有这几个字段会进库，多余键永远写不进去。
 */
export function toStoredProfiles(
  profiles: ImportedAchievementProfile[]
): ImportedAchievementProfile[] {
  return profiles.map((profile) => ({
    id: profile.id,
    name: profile.name,
    importedAt: profile.importedAt,
    duty: profile.duty,
    modes: {
      typeset: plainModeAggregate(profile.modes.typeset),
      translated: plainModeAggregate(profile.modes.translated),
      proofread: plainModeAggregate(profile.modes.proofread),
      supervised: plainModeAggregate(profile.modes.supervised)
    }
  }))
}

/**
 * 从文件路径猜一个档案名（"从别人的数据库导入"那条路用）。
 *
 * 取文件名去掉扩展名：用户可以把对方的库文件改名成 `逗比.sqlite`，
 * 导入后名字就是「逗比」；不满意也能在档案管理里重命名。
 */
export function profileNameFromFilePath(filePath: string): string {
  const base = filePath.split(/[\\/]/).pop() ?? ''
  return normalizeNickname(base.replace(/\.(sqlite3?|db|json)$/i, ''))
}

/**
 * 把 key_value_store 里的原始值洗成档案列表（本地存储可能被手改 / 损坏）。
 * 坏条目直接跳过，绝不因一条坏数据让整个排行页起不来。
 */
export function normalizeStoredProfiles(value: unknown): ImportedAchievementProfile[] {
  if (!Array.isArray(value)) return []
  const profiles: ImportedAchievementProfile[] = []
  for (const item of value) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) continue
    const raw = item as Record<string, unknown>
    if (typeof raw.id !== 'string' || raw.id.length === 0) continue
    const modesResult = normalizeModesPayload(raw.modes)
    if (!modesResult.ok) continue
    profiles.push({
      id: raw.id,
      name: normalizeNickname(raw.name),
      importedAt: isValidCount(raw.importedAt) ? raw.importedAt : 0,
      duty: normalizeDuty(raw.duty),
      modes: modesResult.value
    })
  }
  return profiles.slice(0, MAX_IMPORTED_PROFILES)
}
