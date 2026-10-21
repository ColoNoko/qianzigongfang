import type { WorkMode, WorkModeStatus } from './types'

export const WORK_MODES = ['typeset', 'translated', 'proofread', 'supervised'] as const

export const WORK_MODE_LABELS: Record<WorkMode, string> = {
  typeset: '嵌字',
  translated: '翻译',
  proofread: '校对',
  supervised: '监修'
}

/**
 * Single-character forms, used where the full label would read badly.
 * Batch actions concatenate: 已{short}全部 / 未{short}全部 — 已嵌全部 reads
 * naturally, whereas the full label would produce 已嵌字全部 / 已翻译全部.
 */
export const WORK_MODE_SHORT_LABELS: Record<WorkMode, string> = {
  typeset: '嵌',
  translated: '翻',
  proofread: '校',
  supervised: '监'
}

/**
 * 模式下拉的选项（**唯一出处**）。
 *
 * 原本 Dashboard / Achievements / Project 三处各抄了一份完全相同的数组 ——
 * 加一个模式或改一次文案就要改三处（而且很容易漏一处）。
 */
export const WORK_MODE_OPTIONS: Array<{ value: WorkMode; label: string }> = (
  ['typeset', 'translated', 'proofread', 'supervised'] as const
).map((mode) => ({ value: mode, label: WORK_MODE_LABELS[mode] }))

export function createEmptyModeStatus(): WorkModeStatus {
  return {
    typeset: false,
    translated: false,
    proofread: false,
    supervised: false
  }
}

export function normalizeModeStatus(value: unknown): WorkModeStatus {
  const result = createEmptyModeStatus()
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return result
  const source = value as Record<string, unknown>
  for (const mode of WORK_MODES) {
    if (typeof source[mode] === 'boolean') result[mode] = source[mode] as boolean
  }
  return result
}

/** Read persisted legacy records without treating absent mode fields as explicit false. */
export function storedModeStatus(json: string | null | undefined, legacyStatus?: string): WorkModeStatus {
  let value: unknown
  try { value = json ? JSON.parse(json) : undefined } catch { /* Recover the known legacy flag. */ }
  const modes = normalizeModeStatus(value)
  if (!value || typeof value !== 'object' || Array.isArray(value) || typeof (value as Record<string, unknown>).typeset !== 'boolean') {
    modes.typeset = legacyStatus === 'done'
  }
  return modes
}

/** 旧逻辑里 status 只表达“嵌字”。这里把多模式状态映射回旧字段。 */
export function modeStatusToLegacyStatus(modes: Partial<WorkModeStatus>): 'done' | 'pending' {
  return modes.typeset ? 'done' : 'pending'
}

export type ModeTimestamps = Partial<Record<WorkMode, number>>

export function normalizeModeTimestamps(value: unknown): ModeTimestamps {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
  const source = value as Record<string, unknown>
  const result: ModeTimestamps = {}
  for (const mode of WORK_MODES) {
    const timestamp = source[mode]
    if (typeof timestamp === 'number' && Number.isFinite(timestamp)) {
      result[mode] = timestamp
    }
  }
  return result
}
