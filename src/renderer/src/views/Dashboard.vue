<script setup lang="ts">
// Dashboard — landing view with recent-project cards, status lists, and
// an empty-registry CTA. Data comes from `useProjectStore` which loads the
// project registry via typed IPC (`window.comicType.storeGet`).
import { computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'
import type { ChapterProgress } from '@shared/types'
import { childModeProgress } from '@shared/status'
import { WORK_MODE_LABELS, WORK_MODE_OPTIONS } from '@shared/modes'
import type { WorkMode } from '@shared/types'
import AppSelect from '@renderer/components/AppSelect.vue'
import {
  useProjectStore,
  type DashboardChild,
  type DashboardParent
} from '@renderer/stores/project'
import { useAchievementsStore } from '@renderer/stores/achievements'
import { childWorkbenchPath } from '@renderer/features/project/project-route'
import StatusDot from '@renderer/components/StatusDot.vue'
import EmptyState from '@renderer/components/EmptyState.vue'
import { formatChapterNumber } from '@shared/chapter'

const router = useRouter()
const store = useProjectStore()
const achievements = useAchievementsStore()
const { projects, loading, recentProjectIds } = storeToRefs(store)
const {
  selectedMode,
  currentMonthTotal,
  currentMonthProjectCount,
  currentYearTotal,
  currentYearProjectCount,
  total,
  totalProjectCount
} = storeToRefs(achievements)

onMounted(async () => {
  await store.loadProjects()
  if (projects.value.length > 0 && !achievements.loaded) {
    void achievements.refresh()
  }
})

/** 当前统计模式的中文名（卡片标题、列标题都跟着它走）。 */
const modeLabel = computed(() => WORK_MODE_LABELS[selectedMode.value])

/**
 * 切换统计模式。
 *
 * 用的是**成就 store 的那一个模式**（不是新加一个）：首页与「成就」页的统计因此永远一致 ——
 * 以前首页写死嵌字口径、成就页跟模式，切到监修时两页说的不是一回事（§12.1 第 1 条）。
 */
function onModeChange(value: string | number): void {
  achievements.setSelectedMode(value as WorkMode)
}

/**
 * 单话进度：走**侧栏用的那同一个函数** `childModeProgress`。
 *
 * 口径统一在这里才有意义 —— 首页、侧栏、工作台页脚三处的数字必须能被同一个模式解释；
 * 以前首页固定按嵌字（`computeProgress(child.psdStats)`），切到别的模式就跟侧栏打架。
 */
function progressOf(child: DashboardChild): ChapterProgress {
  return childModeProgress(child, selectedMode.value)
}

interface RecentChild {
  parent: DashboardParent
  child: DashboardChild
  progress: ChapterProgress
}

const allProjectChildren = computed<RecentChild[]>(() => {
  const result: RecentChild[] = []
  for (const parent of projects.value) {
    for (const child of parent.children) {
      result.push({ parent, child, progress: progressOf(child) })
    }
  }
  return result
})

/** Up to three actually visited projects; mtime is the migration fallback. */
const recentChildren = computed<RecentChild[]>(() => {
  if (recentProjectIds.value.length > 0) {
    const resolved = recentProjectIds.value
      .map((id) => allProjectChildren.value.find((item) => item.child.id === id))
      .filter((item): item is RecentChild => Boolean(item))
      .slice(0, 3)
    if (resolved.length > 0) return resolved
  }
  return [...allProjectChildren.value]
    .sort((a, b) => b.child.lastMtimeMs - a.child.lastMtimeMs)
    .slice(0, 3)
})

const recentGridClass = computed(() => {
  if (recentChildren.value.length === 1) return 'grid-cols-1'
  if (recentChildren.value.length === 2) return 'grid-cols-2'
  return 'grid-cols-3'
})

interface StatusChild {
  parent: DashboardParent
  child: DashboardChild
  progress: ChapterProgress
}

/** Children with pct === 100. */
const completedChildren = computed<StatusChild[]>(() => {
  const result: StatusChild[] = []
  for (const parent of projects.value) {
    for (const child of parent.children) {
      const progress = progressOf(child)
      if (progress.pct === 100) {
        result.push({ parent, child, progress })
      }
    }
  }
  return result
})

/** Children with pct === 0 or pct === null (no PSDs / all status none). */
const pendingChildren = computed<StatusChild[]>(() => {
  const result: StatusChild[] = []
  for (const parent of projects.value) {
    for (const child of parent.children) {
      const progress = progressOf(child)
      if (progress.pct === 0 || progress.pct === null) {
        result.push({ parent, child, progress })
      }
    }
  }
  return result
})

const isEmpty = computed(() => !loading.value && projects.value.length === 0)

const achievementCards = computed(() => [
  {
    title: `当月${modeLabel.value}数量`,
    count: currentMonthTotal.value,
    projectCount: currentMonthProjectCount.value,
    testId: 'dashboard-month-count'
  },
  {
    title: `当年${modeLabel.value}数量`,
    count: currentYearTotal.value,
    projectCount: currentYearProjectCount.value,
    testId: 'dashboard-year-count'
  },
  {
    title: `总${modeLabel.value}数量`,
    count: total.value,
    projectCount: totalProjectCount.value,
    testId: 'dashboard-total-count'
  }
])

/** Navigate to the project workbench for a given parent + child. */
function goToProject(parent: DashboardParent, child: DashboardChild): void {
  router.push(childWorkbenchPath(parent.title, child.id))
}

function goAddProject(): void {
  router.push('/project?add=1')
}
</script>

<template>
  <div class="page-in flex h-full min-h-0 flex-col overflow-hidden bg-app-bg p-6 text-text-primary">
    <!-- Empty registry: prominent centered CTA -->
    <EmptyState
      v-if="isEmpty"
      headline="还没有添加任何项目"
      cta-text="添加项目"
      :cta-action="goAddProject"
      cta-test-id="add-project-cta"
    />

    <div v-else class="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
      <section class="shrink-0" data-testid="recent-projects">
        <div class="mb-1.5 flex items-center justify-between gap-3">
          <h2 class="text-sm font-medium text-text-secondary">继续上次的项目</h2>
          <!-- 统计模式：与「成就」页共用同一个模式（改一处两页一起变） -->
          <div class="flex items-center gap-2">
            <span class="text-xs text-text-tertiary">统计模式</span>
            <AppSelect
              :model-value="selectedMode"
              :options="WORK_MODE_OPTIONS"
              size="small"
              test-id="dashboard-mode-select"
              @change="onModeChange"
            />
          </div>
        </div>
        <div class="grid gap-3" :class="recentGridClass">
          <div
            v-for="item in recentChildren"
            :key="item.child.id"
            data-testid="recent-project-card"
            class="min-h-[96px] min-w-0 cursor-pointer rounded-lg border border-border bg-card-bg p-4 shadow-[var(--shadow-1)] transition-[transform,box-shadow,border-color] duration-200 ease-out hover:-translate-y-0.5 hover:border-border-strong hover:shadow-[var(--shadow-card-hover)]"
            @click="goToProject(item.parent, item.child)"
          >
            <div class="flex items-center justify-between gap-3">
              <div class="min-w-0">
                <p class="truncate text-xs text-text-tertiary">{{ item.parent.title }}</p>
                <p class="truncate text-base font-bold text-text-primary">
                  {{ formatChapterNumber(item.child.chapterNumber) }} ·
                  {{ item.child.projectTitle }}
                </p>
              </div>
              <span
                class="shrink-0 rounded-full bg-primary-soft px-2 py-1 text-[12px] font-medium leading-none tabular-nums text-accent"
              >
                {{ item.progress.done }} / {{ item.progress.total }}
              </span>
            </div>
            <div class="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-media-bg">
              <div
                class="h-full rounded-full bg-done transition-[width] duration-500 ease-out"
                :style="{ width: `${item.progress.pct ?? 0}%` }"
              />
            </div>
          </div>
        </div>
      </section>

      <section class="grid min-h-0 flex-1 grid-cols-2 gap-3" data-testid="status-overview-section">
        <div
          class="flex min-h-0 flex-col rounded-lg border border-border bg-card-bg p-3 shadow-[var(--shadow-1)]"
          data-testid="completed-section"
        >
          <h2 class="mb-2 shrink-0 text-sm font-medium text-text-secondary">已完成项目</h2>
          <ul v-if="completedChildren.length > 0" class="min-h-0 flex-1 overflow-y-auto pr-1">
            <li
              v-for="item in completedChildren"
              :key="item.child.id"
              class="flex cursor-pointer items-center gap-2 rounded-badge px-2 py-2 text-sm transition-colors hover:bg-card-bg-hover"
              @click="goToProject(item.parent, item.child)"
            >
              <StatusDot status="done" />
              <span class="min-w-0 flex-1 truncate">
                <span class="text-text-tertiary">{{ item.parent.title }}</span>
                <span class="font-medium text-text-primary">
                  · {{ formatChapterNumber(item.child.chapterNumber) }} ·
                  {{ item.child.projectTitle }}
                </span>
              </span>
              <span class="shrink-0 text-xs text-text-secondary"
                >{{ item.progress.total }} PSD</span
              >
            </li>
          </ul>
          <div v-else class="rounded-badge px-2 py-1.5 text-sm text-text-tertiary">暂无</div>
        </div>

        <div class="flex min-h-0 flex-col rounded-lg border border-border bg-card-bg p-3 shadow-[var(--shadow-1)]" data-testid="pending-section">
          <h2 class="mb-2 shrink-0 text-sm font-medium text-text-secondary">
            待{{ modeLabel }}项目
          </h2>
          <ul v-if="pendingChildren.length > 0" class="min-h-0 flex-1 overflow-y-auto pr-1">
            <li
              v-for="item in pendingChildren"
              :key="item.child.id"
              class="flex cursor-pointer items-center gap-2 rounded-badge px-2 py-2 text-sm transition-colors hover:bg-card-bg-hover"
              @click="goToProject(item.parent, item.child)"
            >
              <StatusDot status="pending" />
              <span class="min-w-0 flex-1 truncate">
                <span class="text-text-tertiary">{{ item.parent.title }}</span>
                <span class="font-medium text-text-primary">
                  · {{ formatChapterNumber(item.child.chapterNumber) }} ·
                  {{ item.child.projectTitle }}
                </span>
              </span>
              <span class="shrink-0 text-xs text-text-secondary"
                >{{ item.progress.total }} PSD</span
              >
            </li>
          </ul>
          <div v-else class="rounded-badge px-2 py-1.5 text-sm text-text-tertiary">暂无</div>
        </div>
      </section>

      <section class="min-h-0 shrink-0" data-testid="dashboard-achievements">
        <h2 class="mb-1.5 text-sm font-medium text-text-secondary">成就概览</h2>
        <div class="grid gap-3 md:grid-cols-3">
          <div
            v-for="card in achievementCards"
            :key="card.title"
            class="min-h-[112px] rounded-lg border border-border bg-card-bg p-4 shadow-[var(--shadow-1)]"
            :data-testid="card.testId"
          >
            <p class="text-sm font-medium text-text-secondary">{{ card.title }}</p>
            <p class="mt-1 text-xl font-semibold tabular-nums text-done">{{ card.count }}</p>
            <p class="mt-1 text-xs text-text-secondary">
              {{ modeLabel }}项目数:
              <span class="font-bold text-text-primary">{{ card.projectCount }}</span>
            </p>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>
