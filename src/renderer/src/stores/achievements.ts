import { defineStore } from 'pinia'
import type { ChildMarkStatistics } from '@shared/ipc-api'
import type { WorkMode } from '@shared/types'
import { aggregateMarkStatistics, markMonthKey } from '@shared/mark-stats'

/**
 * 成就 store。
 *
 * **第十五轮换了数据源**：以前是从项目树缓存里的 `psdStats` / `psdModeStats` 聚合 ——
 * 那是"当前磁盘里有什么"的快照，为了让项目瘦身删掉几张图，历史成就就跟着缩水。
 * 现在从**标记记录**（`project_memory_files`：按文件路径保存的四模式状态 + 完成时间戳）聚合，
 * 删图、挪目录都不影响历史；分月归属也从"PSD 文件修改时间"改成"标记那一刻的时间"。
 *
 * 因此这个 store **不再需要项目树**：`memoryMarkStatistics()` 一次拿回按话汇总的记录，
 * 聚合是纯函数（`@shared/mark-stats`，有表格单测）。
 */
const SILENT_REFRESH_MS = 5 * 60 * 1000
let silentRefreshTimer: ReturnType<typeof setInterval> | null = null

export const useAchievementsStore = defineStore('achievements', {
  state: () => ({
    selectedMode: 'typeset' as WorkMode,
    /** 数据源缓存：按话汇总的标记记录（切模式时直接拿它重算，不再跑 IPC）。 */
    statistics: [] as ChildMarkStatistics[],
    /** 聚合结果：月份 → 完成条目数。 */
    data: new Map<string, number>(),
    /** 聚合结果：月份 → 该月"整话完成"的话 id。 */
    projectData: new Map<string, string[]>(),
    loading: false,
    total: 0,
    loaded: false
  }),

  getters: {
    /** 年份 → 12 个月的完成数（图表用）。 */
    byYear(state): Map<number, number[]> {
      const result = new Map<number, number[]>()
      for (const [key, count] of state.data) {
        const [yearStr, monthStr] = key.split('-')
        const year = Number(yearStr)
        const month = Number(monthStr)
        if (!result.has(year)) result.set(year, new Array(12).fill(0))
        result.get(year)![month - 1] += count
      }
      return result
    },

    currentMonthTotal(state): number {
      return state.data.get(markMonthKey(Date.now())) ?? 0
    },

    currentMonthProjectCount(state): number {
      return state.projectData.get(markMonthKey(Date.now()))?.length ?? 0
    },

    currentYearTotal(state): number {
      const prefix = `${new Date().getFullYear()}-`
      return [...state.data.entries()].reduce(
        (sum, [key, count]) => sum + (key.startsWith(prefix) ? count : 0),
        0
      )
    },

    currentYearProjectCount(state): number {
      const prefix = `${new Date().getFullYear()}-`
      const ids = new Set<string>()
      for (const [key, childIds] of state.projectData) {
        if (key.startsWith(prefix)) childIds.forEach((id) => ids.add(id))
      }
      return ids.size
    },

    totalProjectCount(state): number {
      const ids = new Set<string>()
      for (const childIds of state.projectData.values()) childIds.forEach((id) => ids.add(id))
      return ids.size
    }
  },

  actions: {
    /** 用缓存里的记录重算聚合（切模式、刷新之后都走这里）。 */
    applyStatistics(): void {
      const aggregates = aggregateMarkStatistics(this.statistics, this.selectedMode)
      this.data = aggregates.data
      this.projectData = aggregates.projectData
      this.total = aggregates.total
      this.loaded = true
    },

    setSelectedMode(mode: WorkMode): void {
      if (this.selectedMode === mode) return
      this.selectedMode = mode
      this.applyStatistics()
    },

    /**
     * 重新读一遍标记记录并聚合。
     *
     * 这是**唯一**的取数入口（成就页打开 / 刷新按钮 / 每 5 分钟静默 / 任何标记动作之后）。
     * 以前这里会先把项目树读一遍；现在不需要 —— 统计只吃标记记录。
     */
    async refresh(): Promise<void> {
      if (this.loading) return
      this.loading = true
      try {
        if (typeof window.comicType?.memoryMarkStatistics === 'function') {
          this.statistics = await window.comicType.memoryMarkStatistics()
        }
        this.applyStatistics()
      } catch (error) {
        console.error('[achievements] mark-statistics refresh failed:', error)
      } finally {
        this.loaded = true
        this.loading = false
      }
    },

    /**
     * 标记动作之后重算。
     *
     * 名字保留下来是因为调用点很多（标记、批量标记、导入、自检、撤销……），
     * 但语义已经统一成"重新读记录" —— 不再有"拿项目树那份缓存近似一下"的第二条路
     * （那正是旧版会显示旧数字的原因）。参数不再需要，仅为兼容调用点保留。
     */
    async refreshChildProject(): Promise<void> {
      await this.refresh()
    },

    /** 某一话被删掉了：重算一遍（记录随之消失，数字自然跟着掉）。 */
    removeChildProject(): void {
      void this.refresh()
    },

    startSilentRefresh(): void {
      if (silentRefreshTimer !== null) return
      silentRefreshTimer = setInterval(() => {
        if (document.visibilityState === 'hidden' || this.loading) return
        void this.refresh()
      }, SILENT_REFRESH_MS)
    },

    stopSilentRefresh(): void {
      if (silentRefreshTimer === null) return
      clearInterval(silentRefreshTimer)
      silentRefreshTimer = null
    }
  }
})
