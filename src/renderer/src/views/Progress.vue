<script setup lang="ts">
import { computed, onMounted, ref, watchEffect } from 'vue';
import { useRouter } from 'vue-router';
import { Button } from '@renderer/components/ui/button';
import { Input } from '@renderer/components/ui/input';
import { Progress } from '@renderer/components/ui/progress';
import { ToggleGroup, ToggleGroupItem } from '@renderer/components/ui/toggle-group';
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent
} from '@renderer/components/ui/collapsible';
import { ChevronDown, ChevronRight, History, RefreshCw, Search } from 'lucide-vue-next';
import WorkModeSegments from '@renderer/components/WorkModeSegments.vue';
import AppSelect from '@renderer/components/AppSelect.vue';
import HomeCover from '@renderer/features/dashboard/HomeCover.vue';
import NetworkRetry from '@renderer/components/NetworkRetry.vue';
import ProgressTimelineDrawer from '@renderer/features/progress/ProgressTimelineDrawer.vue';
import { workProgress } from '@renderer/features/progress/work-progress';
import { useProjectWorkspace } from '@renderer/stores/projectWorkspace';
import { useAchievementsStore } from '@renderer/stores/achievements';
import { useSettingsStore } from '@renderer/stores/settings';
import { useParentDuties } from '@renderer/features/project/useParentDuties';
import { childWorkbenchPath } from '@renderer/features/project/project-route';
import { buildTimelineEvents, timelineDayLabel } from '@shared/progress';
import { formatChapterNumber } from '@shared/chapter';
import { WORK_MODE_LABELS } from '@shared/modes';
import type { ChildProject } from '@shared/types';

const workspace = useProjectWorkspace();
const achievements = useAchievementsStore();
const settings = useSettingsStore();
const router = useRouter();
const { dutyMap } = useParentDuties();
const mode = ref(settings.activeWorkMode);
const filter = ref('all');
const search = ref('');
const sort = ref('recent');
const expanded = ref<Record<string, boolean>>({});
const drawerOpen = ref(false);
const refreshing = ref(false);
const loading = ref(workspace.parents.length === 0);
const loadError = ref<string | null>(null);
const sortOptions = [
  { value: 'recent', label: '最近完工优先' },
  { value: 'remaining', label: '剩余页数最多' },
  { value: 'oldest', label: '最久未完工' }
];
const filters = [
  { value: 'all', label: '全部' },
  { value: 'active', label: '进行中' },
  { value: 'pending', label: '未开始' },
  { value: 'done', label: '已完成' },
  { value: 'stale', label: '久未处理' }
];
watchEffect(() => {
  if (!settings.enabledWorkModes.includes(mode.value)) mode.value = settings.enabledWorkModes[0];
});
async function refresh() {
  if (refreshing.value) return;
  refreshing.value = true;
  try {
    await workspace.loadParents();
    await achievements.refresh();
    loadError.value = null;
  } catch (error) {
    loadError.value = error instanceof Error ? error.message : String(error);
  } finally {
    loading.value = false;
    refreshing.value = false;
  }
}
onMounted(refresh);
const stats = computed(() => new Map(achievements.statistics.map((s) => [s.childId, s])));
const allRows = computed(() =>
  workspace.parents
    .filter((p) => dutyMap.value[p.id]?.includes(mode.value))
    .map((p) => workProgress(p, mode.value, stats.value))
);
const summary = computed(() => ({
  works: allRows.value.filter((r) => !r.complete).length,
  chapters: allRows.value.reduce((n, r) => n + r.chapters.length - r.completed, 0),
  remaining: allRows.value.reduce((n, r) => n + r.remaining, 0),
  unknown: allRows.value.reduce((n, r) => n + r.unknown, 0)
}));
const rows = computed(() =>
  allRows.value
    .filter((r) => {
      const query = search.value.trim().toLocaleLowerCase();
      return (
        (!query ||
          [
            r.parent.title,
            ...r.chapters.map((c) => `${c.child.chapterNumber} ${c.child.projectTitle}`)
          ].some((t) => t.toLocaleLowerCase().includes(query))) &&
        (filter.value === 'all' || (filter.value === 'stale' ? r.stale : r.state === filter.value))
      );
    })
    .sort((a, b) =>
      sort.value === 'remaining'
        ? b.remaining - a.remaining
        : sort.value === 'oldest'
          ? (a.at || Infinity) - (b.at || Infinity)
          : b.at - a.at
    )
);
const events = computed(() => {
  const places = new Map(
    workspace.parents.flatMap((p) =>
      p.children.map(
        (c) =>
          [
            c.id,
            { parentTitle: p.title, chapterNumber: formatChapterNumber(c.chapterNumber) }
          ] as const
      )
    )
  );
  return buildTimelineEvents(achievements.statistics, places, Infinity).filter(
    (e) => e.mode === mode.value
  );
});
function recent(at: number) {
  return at ? timelineDayLabel(at, Date.now()) : '暂无完工';
}
function stateLabel(state: string) {
  return state === 'done' ? '已完成' : state === 'active' ? '进行中' : '未开始';
}
async function openChild(child: ChildProject) {
  await settings.setActiveWorkMode(mode.value);
  await router.push({
    path: childWorkbenchPath(child.parentTitle, child.id),
    query: { workMode: mode.value }
  });
}
function continueWork(row: ReturnType<typeof workProgress>) {
  if (row.next) void openChild(row.next.child);
  else expanded.value[row.parent.id] = true;
}
function clearFilter() {
  search.value = '';
  filter.value = 'all';
}
</script>

<template>
  <main class="progress-page page-layout" data-testid="progress-page">
    <header class="view-heading">
      <div>
        <h1 class="view-title">进度</h1>
        <p class="view-description">从这里，继续下一页。</p>
      </div>
      <div class="header-actions">
        <WorkModeSegments v-model="mode" :modes="settings.enabledWorkModes" label="进度职责" />
        <Button variant="outline" size="sm" @click="drawerOpen = true"
          ><History class="size-4" />时间线</Button
        >
        <Button
          variant="ghost"
          size="icon"
          :disabled="refreshing"
          aria-label="刷新进度"
          @click="refresh"
          ><RefreshCw class="size-4" :class="{ 'animate-spin': refreshing }"
        /></Button>
      </div>
    </header>
    <NetworkRetry v-if="loadError" message="进度加载失败" :error="loadError" @retry="refresh" />
    <p v-else-if="loading" class="empty">正在读取项目…</p>
    <template v-else>
      <section class="summary" aria-label="当前职责汇总">
        <div>
          <span>待处理作品</span>
          <p>
            <strong>{{ summary.works }}</strong> 部
          </p>
        </div>
        <div>
          <span>未完成章节</span>
          <p>
            <strong>{{ summary.chapters }}</strong> 话
          </p>
        </div>
        <div>
          <span>剩余页数</span>
          <p>
            <strong>{{ summary.remaining }}</strong> 页
            <small v-if="summary.unknown">另有 {{ summary.unknown }} 话待扫描</small>
          </p>
        </div>
      </section>
      <section class="works" aria-labelledby="works-title">
        <div class="section-header">
          <h2 id="works-title">
            作品进度 <span>{{ rows.length }} 部</span>
          </h2>

          <ToggleGroup
            type="single"
            :model-value="filter"
            variant="outline"
            size="sm"
            aria-label="进度状态"
            @update:model-value="
              (value) => {
                if (value) filter = String(value);
              }
            "
          >
            <ToggleGroupItem v-for="item in filters" :key="item.value" :value="item.value">{{
              item.label
            }}</ToggleGroupItem>
          </ToggleGroup>
          <div class="toolbar-right">
            <AppSelect
              :model-value="sort"
              :options="sortOptions"
              size="small"
              @update:model-value="sort = String($event)"
            />
            <div class="search">
              <Search class="size-4" /><Input
                v-model="search"
                aria-label="搜索作品或章节"
                placeholder="搜索作品或章节"
              />
            </div>
          </div>
        </div>
        <div class="column-head row-grid" aria-hidden="true">
          <span>作品 / 章节</span><span>完成进度</span><span>剩余页数</span><span>最近更新</span
          ><span>操作</span>
        </div>
        <Collapsible
          v-for="row in rows"
          :key="row.parent.id"
          v-model:open="expanded[row.parent.id]"
          class="work"
          data-testid="progress-row"
        >
          <div class="row-grid work-row">
            <div class="work-title">
              <CollapsibleTrigger as-child
                ><Button
                  variant="ghost"
                  size="icon"
                  :aria-label="`${expanded[row.parent.id] ? '收起' : '展开'}${row.parent.title}`"
                  ><ChevronDown v-if="expanded[row.parent.id]" class="size-4" /><ChevronRight
                    v-else
                    class="size-4" /></Button
              ></CollapsibleTrigger>
              <div class="min-w-0">
                <h3>{{ row.parent.title }}</h3>
                <div class="work-subtitle">
                  <span
                    v-for="duty in dutyMap[row.parent.id]"
                    :key="duty"
                    class="duty"
                    :class="{ selected: duty === mode }"
                    >{{ WORK_MODE_LABELS[duty] }}</span
                  ><span>{{ stateLabel(row.state) }}</span>
                </div>
              </div>
            </div>
            <div class="progress-cell">
              <div>
                {{ row.completed }} / {{ row.chapters.length }} 话
                <small
                  >{{
                    row.chapters.length
                      ? Math.round((row.completed / row.chapters.length) * 100)
                      : 0
                  }}%</small
                >
              </div>
              <Progress
                :model-value="row.chapters.length ? (row.completed / row.chapters.length) * 100 : 0"
                class="h-1"
              />
            </div>
            <div class="count-cell">
              <strong>{{ row.unknown && !row.remaining ? '—' : row.remaining }}</strong
              ><span v-if="row.remaining || !row.unknown"> 页</span
              ><small v-if="row.unknown">{{ row.unknown }} 话待扫描</small>
            </div>
            <time :title="row.at ? new Date(row.at).toLocaleString('zh-CN') : ''">{{
              recent(row.at)
            }}</time>
            <div>
              <Button
                :variant="row.complete ? 'outline' : 'default'"
                size="sm"
                :disabled="!row.chapters.length"
                @click="continueWork(row)"
                >{{ row.complete ? '查看章节' : '继续处理' }}</Button
              >
            </div>
          </div>
          <CollapsibleContent class="chapters">
            <div
              v-for="chapter in row.chapters"
              :key="chapter.child.id"
              class="row-grid chapter-row"
            >
              <div class="chapter-title">
                <HomeCover :folder="chapter.child.folderPath" class="chapter-cover" /><span>
                  {{ formatChapterNumber(chapter.child.chapterNumber)
                  }}<span v-if="chapter.child.projectTitle">
                    · {{ chapter.child.projectTitle }}</span
                  >
                </span>
              </div>
              <div class="progress-cell">
                <div>
                  {{ chapter.done }} / {{ chapter.total || '—' }} 页
                  <small>{{
                    chapter.total
                      ? `${Math.round((chapter.done / chapter.total) * 100)}%`
                      : '待扫描'
                  }}</small>
                </div>
                <Progress
                  :model-value="chapter.total ? (chapter.done / chapter.total) * 100 : 0"
                  class="h-1"
                />
              </div>
              <div>{{ chapter.total ? `${chapter.remaining} 页` : '—' }}</div>
              <time>{{ chapter.at ? recent(chapter.at) : '—' }}</time>
              <div>
                <Button variant="ghost" size="sm" @click="openChild(chapter.child)"
                  >{{ chapter.complete ? '查看' : '继续' }}<ChevronRight class="size-4"
                /></Button>
              </div>
            </div>
            <p v-if="!row.chapters.length" class="empty">还没有章节，请在项目中添加。</p>
          </CollapsibleContent>
        </Collapsible>
        <div v-if="!rows.length" class="empty">
          <p>
            {{ allRows.length ? '没有符合条件的作品' : `暂无${WORK_MODE_LABELS[mode]}职责的作品` }}
          </p>
          <Button v-if="allRows.length" variant="ghost" size="sm" @click="clearFilter"
            >清除筛选</Button
          ><Button v-else variant="ghost" size="sm" @click="router.push('/project')"
            >前往项目</Button
          >
        </div>
      </section>
    </template>
    <ProgressTimelineDrawer
      :open="drawerOpen"
      :events="events"
      :empty-hint="`还没有${WORK_MODE_LABELS[mode]}完成记录。`"
      @close="drawerOpen = false"
    />
  </main>
</template>

<style scoped>
.progress-page {
  width: 100%;

  color: var(--text-primary);
}
.header-actions,
.section-header,
.filters,
.work-title,
.work-subtitle {
  display: flex;
  align-items: center;
  gap: 12px;
}
.header-actions {
  flex-wrap: wrap;
}
h2 {
  font-size: 16px;
  font-weight: 650;
}
h2 span {
  font-size: 12px;
  font-weight: 400;
  margin-left: 10px;
  color: var(--text-secondary);
}
.subtitle {
  font-size: 12px;
  color: var(--text-secondary);
  margin-top: 5px;
}
.summary {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--card-bg);
  margin-bottom: 24px;
  padding: 22px 26px;
}
.summary > div + div {
  border-left: 1px solid var(--border);
  padding-left: 28px;
}
.summary span {
  font-size: 12px;
  color: var(--text-secondary);
}
.summary p {
  font-size: 12px;
  margin-top: 7px;
}
.summary strong {
  font-size: 28px;
  font-weight: 650;
  font-variant-numeric: tabular-nums;
  margin-right: 5px;
}
.summary small {
  color: var(--text-secondary);
  margin-left: 8px;
}
.works {
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--card-bg);
  overflow: hidden;
}
.section-header {
  padding: 18px 22px 10px;
}
.filters {
  padding: 8px 22px 18px;
  justify-content: center;
  flex-wrap: wrap;
}
.search {
  position: relative;
  width: 230px;
}
.search > svg {
  position: absolute;
  left: 10px;
  top: 10px;
  color: var(--text-secondary);
}
.search input {
  padding-left: 32px;
}
.row-grid {
  display: grid;
  grid-template-columns:
    minmax(220px, 2.4fr) minmax(140px, 1.4fr) minmax(80px, 0.7fr) minmax(90px, 0.8fr)
    minmax(100px, 0.8fr);
  gap: 20px;
  align-items: center;
  text-align: center;
  padding: 12px 20px;
  font-size: 12px;
}
.column-head {
  background: var(--bg-sunken);
  color: var(--text-secondary);
  border-top: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
}
.column-head > span:first-child {
  text-align: left;
  padding-left: 36px;
}
.work + .work {
  border-top: 1px solid var(--border);
}
.work-title {
  gap: 6px;
  text-align: left;
}
.work-title > button {
  flex-shrink: 0;
  width: 28px;
  height: 28px;
}
.work-title h3 {
  font-size: 14px;
  font-weight: 650;
  overflow-wrap: anywhere;
}
.work-subtitle {
  font-size: 11px;
  gap: 4px;
  flex-wrap: wrap;
  color: var(--text-secondary);
  margin-top: 5px;
}
.duty {
  border: 1px solid var(--border);
  border-radius: 3px;
  padding: 0 4px;
}
.duty.selected {
  color: var(--primary);
  border-color: var(--primary-border);
  background: var(--primary-soft);
}
.progress-cell {
  width: 100%;
  max-width: 300px;
  justify-self: center;
  font-variant-numeric: tabular-nums;
}
.progress-cell > div:first-child {
  position: relative;
  margin-bottom: 8px;
  padding: 0 30px;
}
.progress-cell small {
  position: absolute;
  right: 0;
  top: 1px;
  font-size: 10px;
  color: var(--text-secondary);
}
time {
  color: var(--text-secondary);
  font-size: 11px;
}
.count-cell small {
  display: block;
  color: var(--text-secondary);
  font-size: 10px;
  margin-top: 4px;
}
.chapters {
  background: var(--bg-sunken);
  border-top: 1px solid var(--border);
  padding: 0 20px;
}
.chapter-row {
  padding: 12px 0;
}
.chapter-row + .chapter-row {
  border-top: 1px solid var(--border);
}
.chapter-title {
  text-align: left;
  padding-left: 36px;
  overflow-wrap: anywhere;
}
.empty {
  padding: 40px 20px;
  text-align: center;
  color: var(--text-secondary);
  font-size: 13px;
}
@media (max-width: 1000px) {
  .row-grid {
    gap: 12px;
    grid-template-columns: minmax(170px, 2fr) minmax(125px, 1.3fr) 65px 76px 85px;
  }
  .summary {
    padding: 18px;
  }
  .summary > div + div {
    padding-left: 16px;
  }
  .summary small {
    display: block;
    margin-left: 0;
  }
  .filters {
    gap: 8px;
  }
  .search {
    width: 190px;
  }
}
@media (max-width: 740px) {
  .column-head {
    display: none;
  }
  .row-grid {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 14px;
  }
  .work-title,
  .chapter-title {
    grid-column: 1/-1;
  }
  .row-grid > div:last-child {
    grid-column: 2;
    grid-row: 3;
  }
  .row-grid > time {
    grid-column: 1;
    grid-row: 3;
  }
  .work-title {
    padding: 0;
  }
  .chapter-title {
    padding-left: 10px;
  }
  .summary {
    gap: 10px;
    padding: 14px;
  }
  .summary > div + div {
    padding-left: 10px;
  }
  .summary strong {
    font-size: 23px;
  }
  .header-actions {
    gap: 8px;
  }
  .filters {
    padding: 10px;
  }
  .search {
    flex: 1;
    min-width: 160px;
  }
  .progress-cell > div:first-child {
    padding: 0 20px;
  }
  .count-cell {
    justify-self: center;
  }
}
.section-header {
  padding: 18px 22px;
  gap: 16px;
  flex-wrap: nowrap;
}
.section-header h2 {
  white-space: nowrap;
  flex-shrink: 0;
}
.toolbar-right {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-left: auto;
}
.column-head {
  background: var(--card-bg);
  font-size: 14px;
  font-weight: 600;
}
.progress-cell > div:first-child {
  text-align: left;
  padding-left: 0;
}
.chapter-title {
  display: flex;
  align-items: center;
  gap: 12px;
}
.chapter-cover {
  width: 32px;
  height: 44px;
  border-radius: 4px;
}
.section-header :deep([role='group']) {
  flex-shrink: 0;
}
.toolbar-right .search {
  width: 190px;
}
@media (max-width: 1100px) {
  .section-header {
    gap: 8px;
    padding: 14px 12px;
  }
  .toolbar-right {
    gap: 6px;
  }
  .toolbar-right .search {
    width: 145px;
  }
  .section-header h2 {
    font-size: 14px;
  }
  .section-header h2 span {
    margin-left: 4px;
  }
  .section-header :deep(button) {
    padding-left: 7px;
    padding-right: 7px;
  }
}
@media (max-width: 850px) {
  .section-header {
    overflow-x: auto;
  }
  .toolbar-right .search {
    width: 130px;
  }
}
</style>
