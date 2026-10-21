import { computed, onMounted, watchEffect } from 'vue'
import { useRouter } from 'vue-router'
import { useProjectStore, type DashboardChild, type DashboardParent } from '@renderer/stores/project'
import { useAchievementsStore } from '@renderer/stores/achievements'
import { useSettingsStore } from '@renderer/stores/settings'
import { childModeProgress } from '@shared/status'
import { WORK_MODE_LABELS } from '@shared/modes'
import type { ChapterProgress } from '@shared/types'
import { childWorkbenchPath } from '@renderer/features/project/project-route'
export interface HomeChapter { parent: DashboardParent; child: DashboardChild; progress: ChapterProgress; completedAt: number | null }
export function useDashboard() {
  const store = useProjectStore(), achievements = useAchievementsStore(), settings = useSettingsStore(), router = useRouter()
  watchEffect(() => { if (!settings.enabledWorkModes.includes(achievements.selectedMode)) achievements.setSelectedMode(settings.activeWorkMode) })
  onMounted(async () => { await store.loadProjects(); if (!achievements.loaded) void achievements.refresh() })
  const modeLabel = computed(() => WORK_MODE_LABELS[achievements.selectedMode])
  const chapters = computed<HomeChapter[]>(() => {
    const stats = new Map(achievements.statistics.map(s => [s.childId, s]))
    return store.projects.flatMap(parent => parent.children.map(child => {
      const record = stats.get(child.id), dates = record?.completedTimestamps[achievements.selectedMode] ?? []
      return { parent, child, progress: childModeProgress(child, achievements.selectedMode), completedAt: record && record.fileCount > 0 && dates.length >= record.fileCount ? Math.max(...dates) : null }
    }))
  })
  const ordered = computed(() => [...chapters.value].sort((a,b) => b.child.lastMtimeMs-a.child.lastMtimeMs))
  const recent = computed(() => {
    const visited = store.recentProjectIds.map(id => chapters.value.find(i => i.child.id === id)).filter((i): i is HomeChapter => Boolean(i))
    return (visited.length ? visited : ordered.value).slice(0,3)
  })
  const inProgress = computed(() => ordered.value.filter(i => i.progress.done > 0 && i.progress.done < i.progress.total))
  const pending = computed(() => ordered.value.filter(i => i.progress.done === 0))
  const completed = computed(() => chapters.value.filter(i => i.progress.total > 0 && i.progress.done >= i.progress.total).sort((a,b) => (b.completedAt ?? 0)-(a.completedAt ?? 0)))
  const empty = computed(() => !store.loading && !store.error && store.projects.length === 0)
  const open = (item: HomeChapter) => router.push(childWorkbenchPath(item.parent.title,item.child.id))
  const all = () => router.push('/project')
  const add = () => router.push('/project?add=1')
  return { store, achievements, settings, modeLabel, recent, inProgress, pending, completed, empty, open, all, add, details: () => router.push('/achievements') }
}
