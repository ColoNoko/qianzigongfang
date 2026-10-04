import { computed, onMounted, type ComputedRef } from 'vue'
import type { WorkMode } from '@shared/types'
import { inferParentDuties } from '@shared/duties'
import { useProjectWorkspace } from '@renderer/stores/projectWorkspace'
import { useAchievementsStore } from '@renderer/stores/achievements'

/**
 * 「这本漫画的职责是什么」—— 一处算清，两处（侧栏 / 项目页）共用。
 *
 * 规则：
 * - **声明过的**（父级上的 `duties`）优先；
 * - 没声明过就按**已有标记**推断一个（`inferParentDuties`，只给一个）；
 * - 推断结果**只用于显示与"进本自动切模式"，不写库** —— 用户不动手，数据就不动。
 *
 * 数据源用成就页那份 `memoryMarkStatistics`（标记记录，权威口径），不用项目树里的
 * `psdModeStats` 缓存 —— 后者按 §12.3 只在"该话被打开过"时才更新，会给出陈旧结论。
 */
export function useParentDuties(): {
  dutyMap: ComputedRef<Record<string, WorkMode[]>>
  dutiesOf: (parentId: string) => WorkMode[]
} {
  const workspace = useProjectWorkspace()
  const achievements = useAchievementsStore()

  // 一次会话只读一次（成就页/仪表盘也会读，store 里有 loaded 守卫）。
  onMounted(() => {
    if (!achievements.loaded) void achievements.refresh()
  })

  const dutyMap = computed<Record<string, WorkMode[]>>(() => {
    const marksByChild = new Map<string, Partial<Record<WorkMode, number>>>()
    for (const stat of achievements.statistics) {
      marksByChild.set(stat.childId, {
        typeset: stat.completedTimestamps.typeset.length,
        translated: stat.completedTimestamps.translated.length,
        proofread: stat.completedTimestamps.proofread.length,
        supervised: stat.completedTimestamps.supervised.length
      })
    }

    const result: Record<string, WorkMode[]> = {}
    for (const parent of workspace.parents) {
      if (parent.duties && parent.duties.length > 0) {
        result[parent.id] = parent.duties
        continue
      }
      result[parent.id] = inferParentDuties(
        parent.children.map((child) => marksByChild.get(child.id) ?? {})
      )
    }
    return result
  })

  function dutiesOf(parentId: string): WorkMode[] {
    return dutyMap.value[parentId] ?? []
  }

  return { dutyMap, dutiesOf }
}
