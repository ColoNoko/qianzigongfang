import { defineStore } from 'pinia'
import type {
  ChildProject,
  ChapterProgress,
  ParentProject,
  PsdStat,
  WorkMode,
  WorkModeStatus
} from '@shared/types'
import { computeProgress } from '@shared/status'
import type { PsdStatusOverride } from './workspace/helpers'
import { scanActions } from './workspace/scan-actions'
import { markingActions } from './workspace/marking-actions'
import { treeActions } from './workspace/tree-actions'
import { importActions } from './workspace/import-actions'
import { cacheActions } from './workspace/cache-actions'

export { ChildRootMissingError, latestPairMtime, psdStatsFromPairs } from './workspace/helpers'
export type { ImportResult } from './workspace/helpers'
export const useProjectWorkspace = defineStore('projectWorkspace', {
  state: () => ({
    parents: [] as ParentProject[],
    activeChild: null as ChildProject | null,
    psdStats: [] as PsdStat[],
    txtFiles: [] as string[],
    scannedImages: { childId: '', files: [] as string[] },
    /**
     * LRU cache of thumbnail data URLs. Key = absPath, value = data URL.
     * Capped at `THUMB_CACHE_MAX` (200) entries; the least-recently-used
     * entry is evicted on overflow.
     */
    thumbUrlCache: new Map<string, string>(),
    psdStatusOverrides: {} as Record<string, PsdStatusOverride>,
    psdModeStatuses: {} as Record<string, WorkModeStatus>,
    psdModeTimestamps: {} as Record<string, Partial<Record<WorkMode, number>>>,
    psdStatusOverridesLoaded: false
  }),

  getters: {
    /**
     * Search all parents for a child with the given id. Returns the first
     * match or null. Parameterized getter (returns a function) so the
     * component can pass the route childId at call time.
     */
    findChild(state) {
      return (childId: string): ChildProject | null => {
        for (const parent of state.parents) {
          const child = parent.children.find((c) => c.id === childId)
          if (child) return child
        }
        return null
      }
    },

    /**
     * Derive `ChapterProgress` from the current `psdStats` via the pure
     * `computeProgress` helper (task 2.4). Returns `{done:0,total:0,pct:null}`
     * when there are no stats — FooterBar renders "无文件" for that case.
     */
    progress(state): ChapterProgress {
      return computeProgress(state.psdStats)
    }
  },

  actions: { ...scanActions, ...markingActions, ...treeActions, ...importActions, ...cacheActions }
})
