import type { WorkMode } from './types'
export type StatisticsTimeSource = 'mark' | 'file' | 'manual'
export interface StatisticsTimeTarget { parentId?: string; childId?: string; paths?: string[] }
export interface StatisticsTimeRequest extends StatisticsTimeTarget { mode: WorkMode; source: StatisticsTimeSource; date?: string }
export interface StatisticsTimeValue { source: StatisticsTimeSource; at: number; markAt: number }
export const STATISTICS_TIME_LABELS = { mark: '标记时间', file: '文件修改时间', manual: '手动日期' } as const
export function statisticsDateTimestamp(date: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('请选择有效日期')
  const [y, m, d] = date.split('-').map(Number)
  const value = new Date(y, m - 1, d, 12)
  if (value.getFullYear() !== y || value.getMonth() !== m - 1 || value.getDate() !== d) throw new Error('请选择有效日期')
  return value.getTime()
}
