import type { ChildMarkStatistics } from '@shared/ipc-api';
import type { ParentProject, WorkMode } from '@shared/types';

export function workProgress(
  parent: ParentProject,
  mode: WorkMode,
  stats: Map<string, ChildMarkStatistics>
) {
  const chapters = parent.children.map((child) => {
    const stat = stats.get(child.id);
    const total = child.psdStats?.length || stat?.fileCount || 0;
    const done = Math.min(total, stat?.completedTimestamps[mode]?.length ?? 0);
    const operationAt = stat?.lastOperationAtByMode?.[mode] ?? 0;
    const at = Math.max(0, child.lastMtimeMs || 0, ...(child.psdStats ?? []).map(file => file.mtimeMs || 0));
    return {
      child,
      total,
      done,
      at,
      operationAt,
      complete: total > 0 && done >= total,
      remaining: Math.max(0, total - done)
    };
  });
  const completed = chapters.filter((c) => c.complete).length;
  const at = Math.max(0, ...chapters.filter(c => c.complete).map((c) => c.at));
  const started = chapters.some((c) => c.done > 0);
  const complete = chapters.length > 0 && completed === chapters.length;
  const next = chapters.filter((c) => !c.complete).sort((a, b) => b.operationAt - a.operationAt)[0];
  return {
    parent,
    chapters,
    completed,
    at,
    next,
    complete,
    state: complete ? 'done' : started ? 'active' : 'pending',
    remaining: chapters.reduce((n, c) => n + c.remaining, 0),
    unknown: chapters.filter((c) => !c.total).length,
    stale: !complete && at > 0 && Date.now() - at >= 30 * 86400000
  };
}
