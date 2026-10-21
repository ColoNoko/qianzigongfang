import type { ChildMarkStatistics } from '@shared/ipc-api';
import type { ParentProject, WorkMode } from '@shared/types';
import type { StatisticsTimeSource } from '@shared/statistics-time';
import type { RankingEntry } from '@shared/achievement-ranking';
import { formatChapterNumber } from '@shared/chapter';
export interface AchievementPeriod {
  year: number;
  month: number;
  kind: 'month' | 'year';
}
export const dateKey = (at: number) => {
  const d = new Date(at);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
export function inPeriod(at: number, p: AchievementPeriod) {
  const d = new Date(at);
  return (
    Number.isFinite(at) &&
    d.getFullYear() === p.year &&
    (p.kind === 'year' || d.getMonth() + 1 === p.month)
  );
}
export function periodBin(at: number, p: AchievementPeriod) {
  const d = new Date(at);
  return p.kind === 'year' ? d.getMonth() + 1 : d.getDate();
}
export function achievementPeriodRows(
  stats: ChildMarkStatistics[],
  parents: ParentProject[],
  mode: WorkMode,
  p: AchievementPeriod
) {
  const places = new Map(
    parents.flatMap((parent) =>
      parent.children.map((child) => [child.id, { parent, child }] as const)
    )
  );
  return stats.flatMap((stat) => {
    const stamps = (stat.completedTimestamps[mode] ?? []).filter(
      (at) => Number.isFinite(at) && at > 0
    );
    const sources = new Map<number, StatisticsTimeSource[]>();
    for (const e of stat.datedEntries?.[mode] ?? []) {
      const list = sources.get(e.at) ?? [];
      list.push(e.source);
      sources.set(e.at, list);
    }
    const entries = stamps
      .map((at) => ({ at, source: sources.get(at)?.shift() ?? ('mark' as StatisticsTimeSource) }))
      .sort((a, b) => a.at - b.at);
    const periodEntries = entries.filter((e) => inPeriod(e.at, p));
    if (!periodEntries.length) return [];
    const place = places.get(stat.childId),
      parts = stat.folderPath.replaceAll('\\', '/').replace(/\/$/, '').split('/');
    return [
      {
        id: stat.childId,
        title: place?.parent.title ?? parts.at(-2) ?? '历史作品',
        chapter: place
          ? `${formatChapterNumber(place.child.chapterNumber)}${place.child.projectTitle ? ' · ' + place.child.projectTitle : ''}`
          : (parts.at(-1) ?? '历史章节'),
        workKey: place?.parent.id ?? parts.slice(0, -1).join('/'),
        folderPath: stat.folderPath,
        total: stat.fileCount,
        done: entries.length,
        complete: stat.fileCount > 0 && entries.length >= stat.fileCount,
        last: entries.at(-1)!.at,
        entries,
        periodEntries,
        available: !!place
      }
    ];
  });
}
export type AchievementPeriodRow = ReturnType<typeof achievementPeriodRows>[number];
export function rankForPeriod(
  entries: RankingEntry[],
  mode: WorkMode | 'overall',
  p: AchievementPeriod
) {
  const prefix = p.kind === 'year' ? `${p.year}-` : `${p.year}-${String(p.month).padStart(2, '0')}`;
  const rows = entries
    .map((e) => {
      const months = (mode === 'overall' ? Object.values(e.modes) : [e.modes[mode]])
        .flatMap((m) => m.monthly)
        .filter((m) => m.month.startsWith(prefix));
      return {
        ...e,
        count: months.reduce((n, m) => n + m.count, 0),
        chapters: months.reduce((n, m) => n + m.projectCount, 0)
      };
    })
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  let rank = 0;
  return rows.map((r, i) => {
    if (i === 0 || rows[i - 1].count !== r.count) rank = i + 1;
    return { ...r, rank };
  });
}
