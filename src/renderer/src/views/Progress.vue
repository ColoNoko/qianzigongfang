<script setup lang="ts">
/**
 * 「进度」页（2026-10-03）—— 一张**欠账清单**。
 *
 * 逐本漫画回答："按这本的职责，我还欠几话没熟、多久没烤肉了。"
 * 与「成就」页的分工：成就是**回顾我干过多少**（按年月）；这一页是**逐本看当前欠账**。
 *
 * 口径全部在 `@shared/progress`（纯函数，31 条锁）：
 *   · 熟 = 该话在**当前职责**那个模式下所有文件都完成；
 *   · 多职责**分开展示**（点胶囊切换，不合并成"都完成"）；
 *   · 最新话优先按**标记完成时间**、保底用**最大集数**；
 *   · 距上次用**标记完成时间戳**（不用文件时间 —— 那个有历史脏值）。
 * 这一页只负责取数与摆放，不自己算口径。
 */
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import EmptyState from '@renderer/components/EmptyState.vue'
import NetworkRetry from '@renderer/components/NetworkRetry.vue'
import AppSelect from '@renderer/components/AppSelect.vue'
import ProgressTimelineDrawer from '@renderer/features/progress/ProgressTimelineDrawer.vue'
import { useProjectWorkspace } from '@renderer/stores/projectWorkspace'
import { useAchievementsStore } from '@renderer/stores/achievements'
import { useSettingsStore } from '@renderer/stores/settings'
import { useParentDuties } from '@renderer/features/project/useParentDuties'
import { childWorkbenchPath } from '@renderer/features/project/project-route'
import { formatChapterNumber } from '@shared/chapter'
import { WORK_MODE_LABELS, WORK_MODE_SHORT_LABELS } from '@shared/modes'
import {
  buildChapterDutyFacts,
  buildTimelineEvents,
  computeParentDutyProgress,
  latestActiveChildId,
  parseProgressSort,
  PROGRESS_SORT_OPTIONS,
  sortProgressRows,
  type ChapterDutyFact,
  type ParentDutyProgress,
  type ProgressTimelineEvent,
  type TimelinePlace
} from '@shared/progress'
import type { WorkMode } from '@shared/types'

const workspace = useProjectWorkspace()
const achievements = useAchievementsStore()
const settings = useSettingsStore()
const router = useRouter()
const { dutyMap } = useParentDuties()

/**
 * 每本漫画当前看哪个职责（多职责时点胶囊切）。
 *
 * **只存在这一页的内存里、不写库** —— 它是个"看数据的角度"，不是设置；
 * 真正的职责（这本归我干什么）在侧栏 / 项目页那枚胶囊上设置。
 */
const dutyChoice = ref<Record<string, WorkMode>>({})

/**
 * 排序档位**存在设置里**（`ui.progressSort`，与 `ui.childSortOrder` 同一条路），
 * 所以离开这一页再回来、乃至重启程序，都还是你上次选的那一档。
 */
const sortChoice = computed(() => parseProgressSort(settings.progressSort))
const drawerOpen = ref(false)
const refreshing = ref(false)
const treeLoading = ref(workspace.parents.length === 0)
/**
 * 项目树读不到时的原因（`null` = 没出错）。
 *
 * ⚠️ **失败 ≠ 空**：读不到就和"还没有项目"共用空状态的话，界面会说假话
 * （用户看到"还没有项目"，实际是磁盘/IPC 出了问题）—— 2026-10-03 审查修的。
 * 失败必须能看见，且给一条重试的路；错误原文照实显示（与 `Project.vue` 同一套路）。
 */
const loadError = ref<string | null>(null)

/** 拉项目树，失败**不抛**：记进 `loadError`，由渲染层展示与重试。 */
async function loadParentsSafely(): Promise<void> {
  try {
    await workspace.loadParents()
    loadError.value = null
  } catch (error) {
    loadError.value = error instanceof Error ? error.message : String(error)
  }
}

onMounted(async () => {
  if (workspace.parents.length === 0) await loadParentsSafely()
  treeLoading.value = false
  // 标记记录是**权威口径**（全量、不依赖"这一话被打开过"）；`useParentDuties` 也会拉一次。
  // 它自己吞错误（读不到只记 console），所以这一页的错误状态只由项目树决定。
  if (!achievements.loaded) void achievements.refresh()
})

/** childId → 标记记录（主进程 `memoryMarkStatistics` 的形状）。 */
const statsByChild = computed(() => new Map(achievements.statistics.map((s) => [s.childId, s])))

/**
 * 每本漫画的"事实"（项目树 + 标记记录合成），**算一次两处用**：
 * 列表要它、点标题跳转也要它（跳哪一话就是按同一份事实选的）。
 */
const factsByParent = computed(() => {
  const map = new Map<string, ChapterDutyFact[]>()
  for (const parent of workspace.parents) {
    map.set(parent.id, buildChapterDutyFacts(parent.children, statsByChild.value))
  }
  return map
})

/** 当前该看哪个职责：用户在本页点过就用点的那个，否则用职责表里第一个。 */
function activeDutyOf(parentId: string, duties: WorkMode[]): WorkMode | null {
  const chosen = dutyChoice.value[parentId]
  if (chosen && duties.includes(chosen)) return chosen
  return duties[0] ?? null
}

const rows = computed<ParentDutyProgress[]>(() =>
  workspace.parents.map((parent) => {
    const duties = dutyMap.value[parent.id] ?? []
    return computeParentDutyProgress({
      parentId: parent.id,
      title: parent.title,
      duties,
      duty: activeDutyOf(parent.id, duties),
      lastMtimeMs: parent.lastMtimeMs,
      facts: factsByParent.value.get(parent.id) ?? []
    })
  })
)

const sortedRows = computed(() =>
  sortProgressRows(rows.value, sortChoice.value.key, sortChoice.value.direction)
)

/**
 * 排序项（2026-10-03 用户定的文案 + 方向）。
 * ⚠️ 标签里的箭头 = **那一列字面上的方向**：完成度↓ 就是"完成度高的在前"，
 * 间隔↓ 就是"间隔长的在前"（"从未"算最长）。键与方向的实现见 `@shared/progress`。
 */
/** 下拉的档位 —— 唯一出处是 `@shared/progress`（本页不手抄，免得和设置里的校验漂移）。 */
// 拷一份可变数组：`AppSelect` 的 options 类型是可变的，而唯一出处那份是 readonly
const SORT_OPTIONS = [...PROGRESS_SORT_OPTIONS]

function onSortChange(value: string | number): void {
  settings.setProgressSort(String(value))
}

const busy = computed(() => treeLoading.value || (!achievements.loaded && achievements.loading))
/** 空状态只在"确实读到了、而且真的一本都没有"时出现（读不到走上面的错误块）。 */
const isEmpty = computed(
  () => !busy.value && !loadError.value && workspace.parents.length === 0
)

async function onRefresh(): Promise<void> {
  if (refreshing.value) return
  refreshing.value = true
  try {
    // `loadParentsSafely` 与 `achievements.refresh` 都不会抛（各自吞掉并记录）
    await Promise.all([loadParentsSafely(), achievements.refresh()])
  } finally {
    refreshing.value = false
  }
}

/** 点职责胶囊：整行数据切到这个职责（不写库）。 */
function pickDuty(parentId: string, duty: WorkMode): void {
  dutyChoice.value = { ...dutyChoice.value, [parentId]: duty }
}

/** 没设职责 → 去「项目」页那枚胶囊上设（本页不做原地设置，避免两处都能改）。 */
function goSetDuties(): void {
  void router.push('/project')
}

/**
 * 点漫画名 → 跳到该漫画**最近在干的那一话**（工作台）。
 * 规则与列表里"最新话"同源（`latestActiveChildId`），点了就能直接接着干活。
 */
function openParent(row: ParentDutyProgress): void {
  const parent = workspace.parents.find((item) => item.id === row.parentId)
  if (!parent) return
  const childId = latestActiveChildId(factsByParent.value.get(parent.id) ?? [], row.duty)
  if (!childId) return
  const child = parent.children.find((item) => item.id === childId)
  if (!child) return
  void router.push(childWorkbenchPath(child.parentTitle, child.id))
}

/**
 * 时间线：**一条 = 某天 × 某话 × 某职责**（2026-10-04 用户拍板按天切分）。
 *
 * 口径与分桶全在 `@shared/progress` 的 `buildTimelineEvents` 里（纯函数、有单测）；
 * 这一页只负责备料：① 从项目树建"某话属于哪本、显示成第几集"的表 ② 把标记记录递给它。
 */
const timelineEvents = computed<ProgressTimelineEvent[]>(() => {
  const where = new Map<string, TimelinePlace>()
  for (const parent of workspace.parents) {
    for (const child of parent.children) {
      where.set(child.id, {
        parentTitle: parent.title,
        chapterNumber: formatChapterNumber(child.chapterNumber)
      })
    }
  }
  return buildTimelineEvents(achievements.statistics, where)
})

function progressPct(row: ParentDutyProgress): number {
  if (row.totalChapters === 0) return 0
  return Math.round((row.cookedChapters / row.totalChapters) * 100)
}

function uncookedText(row: ParentDutyProgress): string {
  if (!row.duty) return '—'
  return row.uncookedChapters === 0 ? '✓ 全熟' : `${row.uncookedChapters} 话`
}

function uncookedClass(row: ParentDutyProgress): string {
  if (!row.duty) return 'text-text-tertiary'
  return row.uncookedChapters === 0
    ? 'text-[11px] font-semibold text-success'
    : 'text-[11px] font-semibold text-done'
}

function daysText(row: ParentDutyProgress): string {
  if (row.daysSinceLastMark === null) return row.duty ? '从未' : '—'
  if (row.daysSinceLastMark === 0) return '今天'
  return `${row.daysSinceLastMark} 天前`
}

/** 「上次更新」的文案：从没完整做完一话 → 「从未」；没设职责 → 破折号。 */
function lastCookedText(row: ParentDutyProgress): string {
  if (row.daysSinceLastCooked === null) return row.duty ? '从未' : '—'
  if (row.daysSinceLastCooked === 0) return '今天'
  return `${row.daysSinceLastCooked} 天前`
}

/**
 * 「上次更新」久了的着色：与「最近出勤」同一套阈值（30 天黄 / 90 天红）。
 *
 * ⚠️ 两列的阈值刻意**不用两套**：同一行里两个天数用不同门槛，读者没法比较，
 * 反而要记两条规则。同门槛还有个好处 —— 两列一起变黄时，"零敲碎打"一眼可见。
 */
function lastCookedClass(row: ParentDutyProgress): string {
  const days = row.daysSinceLastCooked
  if (days === null) return 'text-text-tertiary'
  if (days >= 90) return 'font-medium text-danger'
  if (days >= 30) return 'font-medium text-warning'
  return 'text-text-tertiary'
}

/** 久未动就该被看见：30 天起黄、90 天起红。 */
function daysClass(row: ParentDutyProgress): string {
  const days = row.daysSinceLastMark
  if (days === null) return 'text-text-tertiary'
  if (days >= 90) return 'font-medium text-danger'
  if (days >= 30) return 'font-medium text-warning'
  return 'text-text-tertiary'
}
</script>

<template>
  <div class="page-in min-h-full bg-app-bg p-6 text-text-primary">
    <div class="mb-4 flex items-center justify-between gap-3">
      <h1 class="text-xl font-semibold tracking-tight text-text-primary">进度</h1>
      <div class="flex items-center gap-2">
        <AppSelect
          :model-value="settings.progressSort"
          :options="SORT_OPTIONS"
          test-id="progress-sort"
          @change="onSortChange"
        />
        <button
          type="button"
          class="flex h-9 items-center rounded-badge border border-border bg-card-bg px-3 text-sm text-text-secondary transition-colors hover:bg-card-bg-hover hover:text-text-primary"
          data-testid="progress-timeline-open"
          @click="drawerOpen = true"
        >
          时间线
        </button>
        <button
          type="button"
          class="flex h-9 items-center rounded-badge bg-accent px-4 text-sm text-text-on-accent transition-colors hover:bg-primary-hover active:bg-primary-active disabled:opacity-40"
          :disabled="refreshing"
          data-testid="progress-refresh"
          @click="onRefresh"
        >
          {{ refreshing ? '刷新中…' : '刷新' }}
        </button>
      </div>
    </div>

    <p class="mb-3 text-[11px] leading-5 text-text-tertiary" data-testid="progress-hint">
      「更新至 / 上次更新 / 最近出勤 / 待烤 / 完成度」都按当前选中的职责算（点职责那枚小胶囊可切换）。
      「更新至」= 最近完整做完的那一话；「上次更新」= 距那次完整做完多少天；「最近出勤」= 距最近一次动手标记多少天（哪怕只标了一张）。
    </p>

    <div v-if="busy" class="flex min-h-[40vh] items-center justify-center">
      <p class="text-text-secondary">正在读取项目与标记记录…</p>
    </div>

    <!-- ⚠️ 错误必须排在空状态**前面**：读不到 ≠ 没有项目（2026-10-03 审查修复） -->
    <NetworkRetry
      v-else-if="loadError"
      :error="loadError"
      message="项目树没能读回来"
      data-testid="progress-error"
      @retry="onRefresh"
    />

    <EmptyState v-else-if="isEmpty" data-testid="progress-empty" headline="还没有项目" />

    <div
      v-else
      class="overflow-hidden rounded-lg border border-border bg-card-bg shadow-[var(--shadow-1)]"
      data-testid="progress-table"
    >
      <div
        class="flex items-center gap-2 border-b border-border px-4 py-2 text-[11px] font-medium text-text-tertiary"
      >
        <span class="min-w-0 flex-1">漫画</span>
        <span class="w-16 text-center">职责</span>
        <span class="w-20 text-right">更新至</span>
        <span class="w-20 text-right" title="距上次完整做完一话多少天">上次更新</span>
        <span class="w-20 text-right" title="距最近一次动手标记多少天（哪怕只标了一张）">最近出勤</span>
        <span class="w-20 text-right">待烤</span>
        <span class="flex w-40 items-center justify-end">完成度</span>
      </div>

      <div
        v-for="row in sortedRows"
        :key="row.parentId"
        class="flex items-center gap-2 border-b border-hairline px-4 py-2.5 last:border-b-0 hover:bg-card-bg-hover"
        data-testid="progress-row"
      >
        <button
          type="button"
          class="min-w-0 flex-1 truncate text-left text-[13px] font-medium text-text-primary transition-colors hover:text-accent disabled:cursor-default disabled:hover:text-text-primary"
          :disabled="row.totalChapters === 0"
          :title="row.totalChapters === 0 ? '这一本还没有登记话' : '打开最近在做的那一话'"
          :data-testid="`progress-title-${row.parentId}`"
          @click="openParent(row)"
        >
          {{ row.title }}
        </button>

        <span class="flex w-16 justify-center" data-testid="progress-duties">
          <button
            v-if="row.duties.length === 0"
            type="button"
            class="rounded-badge px-1.5 py-0.5 text-[10px] leading-none text-text-tertiary transition-colors hover:bg-card-bg-hover hover:text-text-primary"
            title="这一本还没设职责 —— 点它去「项目」页设置"
            :data-testid="`progress-set-duties-${row.parentId}`"
            @click="goSetDuties"
          >
            未设职责
          </button>
          <template v-else>
            <!-- 与侧栏同一枚原语（styles/index.css 的 .duty-chip）：单职责 15px、双职责 30px；
                 选中的那一段才实心 —— 两段之间**不画分隔线**，色差本身就是分界
                 （侧栏那种"两段都未选"的纯标签才需要那道缝）。 -->
            <span
              class="duty-chip"
              :class="row.duties.length > 1 ? 'duty-chip--pair' : 'duty-chip--single'"
            >
              <button
                v-for="duty in row.duties"
                :key="duty"
                type="button"
                class="duty-chip__seg transition-colors"
                :class="row.duty === duty ? 'duty-chip__seg--on' : 'hover:text-text-primary'"
                :title="`看「${WORK_MODE_LABELS[duty]}」的进度`"
                :aria-pressed="row.duty === duty"
                :data-testid="`progress-duty-${row.parentId}-${duty}`"
                @click="pickDuty(row.parentId, duty)"
              >
                {{ WORK_MODE_SHORT_LABELS[duty] }}
              </button>
            </span>
          </template>
        </span>

        <span
          class="w-20 text-right text-[12px] text-text-secondary"
          data-testid="progress-latest"
        >
          {{ row.latestCookedChapter }}
        </span>

        <!-- 「上次更新」= 距上次**完整做完一话**多少天（2026-10-04 新增）：
             与右边「最近出勤」配对看 —— 出勤新、更新旧 = 一直在零敲碎打。 -->
        <span
          class="w-20 text-right text-[12px]"
          :class="lastCookedClass(row)"
          data-testid="progress-last-cooked"
        >
          {{ lastCookedText(row) }}
        </span>

        <span
          class="w-20 text-right text-[12px]"
          :class="daysClass(row)"
          data-testid="progress-days"
        >
          {{ daysText(row) }}
        </span>

        <span class="w-20 text-right" :class="uncookedClass(row)" data-testid="progress-uncooked">
          {{ uncookedText(row) }}
        </span>

        <span class="flex w-40 items-center justify-end gap-2">
          <span class="relative h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-media-bg">
            <span
              class="absolute inset-y-0 left-0 rounded-full bg-done transition-[width] duration-300"
              :style="{ width: `${progressPct(row)}%` }"
              data-testid="progress-bar"
            />
          </span>
          <span class="w-10 text-right text-[11px] tabular-nums text-text-tertiary">
            {{ row.cookedChapters }}/{{ row.totalChapters }}
          </span>
        </span>
      </div>
    </div>

    <ProgressTimelineDrawer
      :open="drawerOpen"
      :events="timelineEvents"
      @close="drawerOpen = false"
    />
  </div>
</template>
