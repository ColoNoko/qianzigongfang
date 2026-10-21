/**
 * 配对与统计的小工具（纯函数）。
 *
 * P6（2026-10-05）从 `stores/projectWorkspace.ts` 拆出：**纯搬家**。
 * 唯一的机械改动是**每段开头加了一个 `export `**（它们原本是那个文件的模块私有函数），
 * 函数体本身逐字节未改。
 */
import { countablePsdStats } from '@shared/status'
import type { JpgPsdPair, PsdStat } from '@shared/types'

export function latestPairMtime(pairs: JpgPsdPair[]): number {
  return pairs.reduce((latest, pair) => Math.max(latest, pair.psd.mtimeMs), 0)
}

export function psdStatsFromPairs(pairs: JpgPsdPair[]): PsdStat[] {
  return countablePsdStats(pairs)
}

export function statsEqual(a: PsdStat[] | undefined, b: PsdStat[]): boolean {
  if (!a || a.length !== b.length) return false
  return a.every(
    (stat, index) => stat.mtimeMs === b[index].mtimeMs && stat.ctimeMs === b[index].ctimeMs
  )
}
