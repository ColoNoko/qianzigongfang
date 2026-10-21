<script setup lang="ts">
import { computed, onMounted, ref, watch, watchEffect } from 'vue';
import { useRouter } from 'vue-router';
import { Button } from '@renderer/components/ui/button';
import { Input } from '@renderer/components/ui/input';
import { Badge } from '@renderer/components/ui/badge';
import { Card, CardContent } from '@renderer/components/ui/card';
import {
  Table,
  TableHeader,
  TableHead,
  TableRow,
  TableBody,
  TableCell
} from '@renderer/components/ui/table';
import { ToggleGroup, ToggleGroupItem } from '@renderer/components/ui/toggle-group';
import { Checkbox } from '@renderer/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/components/ui/popover';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription
} from '@renderer/components/ui/dialog';
import { RefreshCw, Files, BookCheck, FolderOpen, ChevronRight } from 'lucide-vue-next';
import WorkModeSegments from '@renderer/components/WorkModeSegments.vue';
import ProfileManagerDialog from '@renderer/features/achievements/ProfileManagerDialog.vue';
import AchievementPeriodPicker from '@renderer/features/achievements/AchievementPeriodPicker.vue';
import {
  achievementPeriodRows,
  rankForPeriod,
  dateKey,
  periodBin,
  inPeriod,
  type AchievementPeriodRow
} from '@renderer/features/achievements/period-data';
import { useAchievementsStore } from '@renderer/stores/achievements';
import { useAchievementCompareStore } from '@renderer/stores/achievementCompare';
import { useProjectWorkspace } from '@renderer/stores/projectWorkspace';
import HomeCover from '@renderer/features/dashboard/HomeCover.vue';
import { useSettingsStore } from '@renderer/stores/settings';
import { useToastStore } from '@renderer/stores/toast';
import { WORK_MODE_LABELS } from '@shared/modes';
import { STATISTICS_TIME_LABELS } from '@shared/statistics-time';
import { aggregateModesPayload } from '@shared/achievement-profile';
import { filterEntriesByDuty, type RankingEntry } from '@shared/achievement-ranking';
import { childWorkbenchPath } from '@renderer/features/project/project-route';
import type { WorkMode } from '@shared/types';
const store = useAchievementsStore(),
  compare = useAchievementCompareStore(),
  workspace = useProjectWorkspace(),
  settings = useSettingsStore(),
  toast = useToastStore(),
  router = useRouter();
const tab = ref('overview'),
  kind = ref<'month' | 'year'>('month'),
  year = ref(new Date().getFullYear()),
  month = ref(new Date().getMonth() + 1),
  filter = ref<number | null>(null),
  search = ref(''),
  detailId = ref<string | null>(null),
  profilesOpen = ref(false),
  importing = ref(false),
  excluded = ref<string[]>([]);
const period = computed(() => ({ year: year.value, month: month.value, kind: kind.value })),
  label = computed(() => WORK_MODE_LABELS[store.selectedMode]),
  periodLabel = computed(
    () => `${year.value} 年${kind.value === 'month' ? ` ${month.value} 月` : ''}`
  );
watchEffect(() => {
  if (!settings.enabledWorkModes.includes(store.selectedMode))
    store.setSelectedMode(settings.activeWorkMode);
});
watch([year, month, kind, () => store.selectedMode], () => {
  filter.value = null;
  detailId.value = null;
});
const rows = computed(() =>
  achievementPeriodRows(store.statistics, workspace.parents, store.selectedMode, period.value)
);
const totals = computed(() => ({
  pages: rows.value.reduce((n, r) => n + r.periodEntries.length, 0),
  chapters: rows.value.filter((r) => r.complete && inPeriod(r.last, period.value)).length,
  works: new Set(rows.value.map((r) => r.workKey)).size
}));
const cards = computed(() => [
  {
    title: `完成${label.value}`,
    count: totals.value.pages,
    unit: '页',
    hint: '本期归档的已完成页面',
    icon: Files
  },
  {
    title: '完成章节',
    count: totals.value.chapters,
    unit: '话',
    hint: '最后一页在本期完成的章节',
    icon: BookCheck
  },
  {
    title: '涉及作品',
    count: totals.value.works,
    unit: '部',
    hint: '本期留下完成记录的漫画',
    icon: FolderOpen
  }
]);
const bins = computed(() => {
  const values = Array(
    kind.value === 'month' ? new Date(year.value, month.value, 0).getDate() : 12
  ).fill(0) as number[];
  rows.value.forEach((r) =>
    r.periodEntries.forEach((e) => values[periodBin(e.at, period.value) - 1]++)
  );
  return values;
});
const maximum = computed(() => Math.max(10, Math.ceil(Math.max(...bins.value) / 10) * 10));
function entriesFor(r: AchievementPeriodRow) {
  return r.periodEntries.filter(
    (e) => filter.value === null || periodBin(e.at, period.value) === filter.value
  );
}
const visibleRows = computed(() =>
  rows.value
    .filter(
      (r) =>
        entriesFor(r).length &&
        `${r.title}${r.chapter}`.toLowerCase().includes(search.value.trim().toLowerCase())
    )
    .sort((a, b) => entriesFor(b).at(-1)!.at - entriesFor(a).at(-1)!.at)
);
function sources(r: AchievementPeriodRow) {
  return [...new Set(entriesFor(r).map((e) => STATISTICS_TIME_LABELS[e.source]))].join('、');
}
const detail = computed(() => rows.value.find((r) => r.id === detailId.value));
const detailDates = computed(() => {
  const map = new Map<string, { count: number; sources: Set<string> }>();
  for (const e of detail.value?.entries ?? []) {
    const k = dateKey(e.at),
      row = map.get(k) ?? { count: 0, sources: new Set<string>() };
    row.count++;
    row.sources.add(STATISTICS_TIME_LABELS[e.source]);
    map.set(k, row);
  }
  return [...map.entries()].sort(([a], [b]) => b.localeCompare(a));
});
const rankingKind = computed(() =>
  compare.rankingMode === 'overall' ? ('overall' as const) : store.selectedMode
);
const candidates = computed(() => {
  const all: RankingEntry[] = [
    {
      id: 'self',
      name: '我',
      duty: compare.selfDuty,
      isSelf: true,
      modes: aggregateModesPayload(store.statistics)
    },
    ...compare.profiles.map((p) => ({ ...p, isSelf: false }))
  ];
  return filterEntriesByDuty(all, rankingKind.value);
});
const rankRows = computed(() =>
  rankForPeriod(
    candidates.value.visible.filter((p) => !excluded.value.includes(p.id)),
    rankingKind.value,
    period.value
  )
);
const myRank = computed(() => rankRows.value.find((p) => p.isSelf));
function changePeriod(p: { year: number; month: number }) {
  year.value = p.year;
  month.value = p.month;
}
function changeMode(value: string | number) {
  store.setSelectedMode(value as WorkMode);
}
function toggleParticipant(id: string) {
  excluded.value = excluded.value.includes(id)
    ? excluded.value.filter((v) => v !== id)
    : [...excluded.value, id];
}
async function importProfile() {
  if (importing.value) return;
  importing.value = true;
  try {
    const result = await compare.importFromFile();
    if (result.status === 'imported')
      toast.addToast({
        type: result.warning ? 'warning' : 'success',
        message: result.warning ?? `已导入「${result.profile.name}」`
      });
    else if (result.status === 'error') toast.addToast({ type: 'error', message: result.message });
  } finally {
    importing.value = false;
  }
}
function openChapter() {
  const child = workspace.findChild(detail.value?.id ?? '');
  if (child) {
    detailId.value = null;
    void router.push(childWorkbenchPath(child.parentTitle, child.id));
  }
}
onMounted(() => {
  void store.refresh();
  void compare.load();
  if (!workspace.parents.length && typeof window.comicType?.projectGetTree === 'function')
    void workspace
      .loadParents()
      .catch(() =>
        toast.addToast({ type: 'warning', message: '作品名称读取失败，暂按历史目录显示。' })
      );
});
</script>
<template>
  <div class="achievement-page page-in page-layout" data-testid="achievements-page">
    <header class="view-heading">
      <h1 class="view-title">成就</h1>
      <div class="flex items-center gap-2">
        <ToggleGroup
          type="single"
          :model-value="tab"
          aria-label="成就视图"
          @update:model-value="
            (v) => {
              if (v) tab = String(v);
            }
          "
          ><ToggleGroupItem value="overview" data-testid="achievement-tab-overview"
            >概览</ToggleGroupItem
          ><ToggleGroupItem value="ranking" data-testid="achievement-tab-ranking"
            >排行</ToggleGroupItem
          ></ToggleGroup
        ><Button
          variant="ghost"
          size="icon-sm"
          aria-label="刷新成就"
          data-testid="refresh-btn"
          :disabled="store.loading"
          @click="store.refresh()"
          ><RefreshCw :class="{ 'animate-spin': store.loading }"
        /></Button>
      </div>
    </header>
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div class="flex flex-wrap items-center gap-2">
        <ToggleGroup
          v-if="tab === 'ranking'"
          type="single"
          :model-value="compare.rankingMode"
          aria-label="排行类型"
          @update:model-value="
            (v) => {
              if (v === 'overall' || v === 'mode') compare.setRankingMode(v);
            }
          "
          ><ToggleGroupItem value="overall">综合榜</ToggleGroupItem
          ><ToggleGroupItem value="mode">按工序</ToggleGroupItem></ToggleGroup
        ><WorkModeSegments
          v-if="tab === 'overview' || compare.rankingMode === 'mode'"
          :model-value="store.selectedMode"
          :modes="settings.enabledWorkModes"
          label="统计工序"
          @update:model-value="changeMode"
        />
      </div>
      <div class="flex flex-wrap items-center gap-3">
        <ToggleGroup
          type="single"
          :model-value="kind"
          aria-label="统计周期"
          @update:model-value="
            (v) => {
              if (v === 'month' || v === 'year') kind = v;
            }
          "
          ><ToggleGroupItem value="month">月</ToggleGroupItem
          ><ToggleGroupItem value="year">年</ToggleGroupItem></ToggleGroup
        ><AchievementPeriodPicker :year="year" :month="month" :kind="kind" @change="changePeriod" />
      </div>
    </div>
    <p
      v-if="store.loading && !store.loaded"
      role="status"
      class="py-20 text-center text-muted-foreground"
    >
      正在读取完成记录…
    </p>
    <template v-else-if="tab === 'overview'">
      <div class="my-4 grid gap-3 sm:grid-cols-3">
        <Card v-for="card in cards" :key="card.title"
          ><CardContent class="p-5"
            ><div class="flex items-center justify-between text-sm text-muted-foreground">
              <span>{{ card.title }}</span
              ><component :is="card.icon" class="size-4" />
            </div>
            <p class="my-2 text-3xl font-semibold tabular-nums">
              {{ card.count.toLocaleString() }}
              <span class="text-xs font-normal text-muted-foreground">{{ card.unit }}</span>
            </p>
            <p class="text-xs text-muted-foreground">{{ card.hint }}</p></CardContent
          ></Card
        >
      </div>
      <Card
        ><CardContent class="p-5"
          ><div class="flex items-center justify-between gap-3">
            <div>
              <h2 class="font-semibold">完成趋势</h2>
              <p class="mt-1 text-xs text-muted-foreground">
                {{ periodLabel }} · {{ kind === 'month' ? '每日' : '每月' }}完成页数
              </p>
            </div>
            <span class="text-xs text-muted-foreground">{{ label }} · 页</span>
          </div>
          <div class="achievement-chart" aria-label="完成趋势">
            <div class="chart-axis">
              <span>{{ maximum }}</span
              ><span>{{ maximum / 2 }}</span
              ><span>0</span>
            </div>
            <div
              class="chart-plot"
              :style="{ gridTemplateColumns: `repeat(${bins.length},minmax(0,1fr))` }"
            >
              <Button
                v-for="(n, i) in bins"
                :key="i"
                variant="ghost"
                class="chart-bin"
                :aria-pressed="filter === i + 1"
                :aria-label="`${i + 1}${kind === 'month' ? '日' : '月'}，${n} 页，点击筛选`"
                :title="`${i + 1}${kind === 'month' ? '日' : '月'} · ${n} 页`"
                @click="filter = filter === i + 1 ? null : i + 1"
                ><span
                  class="chart-bar"
                  :style="{
                    height: `calc((100% - 24px) * ${n / maximum})`,
                    opacity: n === 0 ? 0 : undefined
                  }"
                /><span class="chart-tick">{{
                  kind === 'year'
                    ? `${i + 1}月`
                    : i === 0 || (i + 1) % 5 === 0 || i === bins.length - 1
                      ? i + 1
                      : ''
                }}</span></Button
              >
            </div>
          </div>
          <div
            class="mt-3 flex min-h-8 flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground"
          >
            <span>{{
              totals.pages
                ? '点击柱形筛选作品明细；汇总卡始终显示整个周期。'
                : '本期暂无完成记录，可选择其他月份或年份。'
            }}</span
            ><Button v-if="filter !== null" variant="secondary" size="sm" @click="filter = null"
              >{{ filter }}{{ kind === 'month' ? ' 日' : ' 月' }} · 清除筛选</Button
            >
          </div></CardContent
        ></Card
      >
      <Card class="mt-4 overflow-hidden"
        ><div class="flex flex-wrap items-center justify-between gap-3 p-5">
          <div>
            <h2 class="font-semibold">
              作品明细
              <span class="text-xs font-normal text-muted-foreground"
                >· {{ visibleRows.length }} 话</span
              >
            </h2>
            <p class="sr-only">
              {{
                filter !== null
                  ? '仅显示所选日期的完成页数'
                  : '页数按所选周期统计，章节状态按当前工序显示'
              }}
            </p>
          </div>
          <Input
            v-model="search"
            class="w-56 max-w-full"
            placeholder="搜索漫画或章节"
            aria-label="搜索漫画或章节"
          />
        </div>
        <Table class="achievement-table overview-table"
          ><TableHeader
            ><TableRow
              ><TableHead>漫画 / 章节</TableHead
              ><TableHead class="text-right">{{ filter === null ? '本期' : '筛选' }}完成</TableHead
              ><TableHead>章节状态</TableHead><TableHead>最近统计日期</TableHead
              ><TableHead>时间来源</TableHead><TableHead /></TableRow></TableHeader
          ><TableBody
            ><TableRow v-for="row in visibleRows" :key="row.id"
              ><TableCell
                ><div class="flex items-center gap-3"><HomeCover v-if="workspace.findChild(row.id)" :folder="workspace.findChild(row.id)!.folderPath" class="achievement-cover" /><div><strong>{{ row.title }}</strong>
                <p class="mt-1 text-xs text-muted-foreground">
                  {{ row.chapter }} · {{ label }}
                </p></div></div></TableCell
              ><TableCell class="text-right tabular-nums">{{ entriesFor(row).length }} 页</TableCell
              ><TableCell
                ><Badge v-if="row.complete" variant="secondary">整话完成</Badge
                ><span v-else class="text-xs text-muted-foreground"
                  >{{ row.done }} / {{ row.total }} 页</span
                ></TableCell
              ><TableCell class="tabular-nums">{{ dateKey(entriesFor(row).at(-1)!.at) }}</TableCell
              ><TableCell class="text-xs text-muted-foreground">{{ sources(row) }}</TableCell
              ><TableCell
                ><Button
                  variant="ghost"
                  size="sm"
                  :aria-label="`查看${row.title}${row.chapter}详情`"
                  @click="detailId = row.id"
                  >查看详情<ChevronRight class="size-4" /></Button></TableCell></TableRow
            ><TableRow v-if="!visibleRows.length"
              ><TableCell colspan="6" class="py-10 text-center text-muted-foreground"
                >没有对应的完成记录，试试其他周期或清除筛选。</TableCell
              ></TableRow
            ></TableBody
          ></Table
        ></Card
      >
    </template>
    <template v-else>
      <Card class="my-4"
        ><CardContent class="flex flex-wrap items-center justify-between gap-4 p-5"
          ><div>
            <p class="text-xs text-muted-foreground">
              {{ periodLabel }} · {{ rankingKind === 'overall' ? '四工序合计' : label }}
            </p>
            <p class="mt-2 text-2xl font-semibold">
              {{ myRank && myRank.count > 0 ? `第 ${myRank.rank} 名` : '暂无排名' }}
              <span class="text-xs font-normal text-muted-foreground"
                >/ {{ rankRows.length }} 份参与档案</span
              >
            </p>
          </div>
          <div class="flex flex-wrap gap-2">
            <Popover
              ><PopoverTrigger as-child
                ><Button variant="outline" size="sm">参与对比</Button></PopoverTrigger
              ><PopoverContent class="w-64"
                ><label
                  v-for="p in candidates.visible"
                  :key="p.id"
                  class="mb-3 flex items-center gap-2 text-sm"
                  ><Checkbox
                    :model-value="!excluded.includes(p.id)"
                    @update:model-value="toggleParticipant(p.id)"
                  />{{ p.name }}</label
                ></PopoverContent
              ></Popover
            ><Button variant="outline" size="sm" :disabled="importing" @click="importProfile">{{
              importing ? '导入中…' : '导入他人档案'
            }}</Button
            ><Button variant="outline" size="sm" @click="profilesOpen = true">档案管理</Button>
          </div></CardContent
        ></Card
      >
      <Card class="overflow-hidden"
        ><div class="p-5">
          <h2 class="font-semibold">
            {{ rankingKind === 'overall' ? '综合完成量排行' : '完成页数排行' }}
          </h2>
          <p class="mt-1 text-xs text-muted-foreground">
            {{
              rankingKind === 'overall'
                ? '同一图片的不同工序分别计入完成量，章节数也按工序累计。'
                : '所有档案使用相同工序和周期。'
            }}{{ candidates.hidden ? ` 已隐藏 ${candidates.hidden} 份其他职责档案。` : '' }}
          </p>
        </div>
        <Table class="achievement-table ranking-table"
          ><TableHeader
            ><TableRow
              ><TableHead>排名</TableHead><TableHead>成员</TableHead
              ><TableHead class="text-right">完成量</TableHead
              ><TableHead class="text-right">完成章节</TableHead
              ><TableHead>完成量对比</TableHead></TableRow
            ></TableHeader
          ><TableBody
            ><TableRow v-for="p in rankRows" :key="p.id" :class="{ 'bg-primary-soft': p.isSelf }"
              ><TableCell class="font-semibold">{{ p.count ? p.rank : '—' }}</TableCell
              ><TableCell
                ><strong>{{ p.name }}</strong
                ><span v-if="p.isSelf" class="ml-2 text-xs text-muted-foreground"
                  >我的记录</span
                ></TableCell
              ><TableCell class="text-right tabular-nums"
                >{{ p.count.toLocaleString() }}
                {{ rankingKind === 'overall' ? '次' : '页' }}</TableCell
              ><TableCell class="text-right">{{ p.chapters }} 话</TableCell
              ><TableCell
                ><div class="h-1 w-32 max-w-full rounded bg-muted">
                  <div
                    class="h-full rounded bg-primary"
                    :style="{ width: `${(p.count / Math.max(rankRows[0]?.count ?? 0, 1)) * 100}%` }"
                  /></div></TableCell></TableRow
            ><TableRow v-if="!rankRows.length"
              ><TableCell colspan="5" class="py-10 text-center text-muted-foreground"
                >请在“参与对比”中勾选档案。</TableCell
              ></TableRow
            ></TableBody
          ></Table
        ></Card
      >
    </template>
    <footer class="mt-4 flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
      <span>按各作品选定的统计时间归档 · 整话完成日期取最后一页</span
      ><span v-if="tab === 'overview'">累计{{ label }} {{ store.total.toLocaleString() }} 页</span>
    </footer>
    <Dialog
      :open="!!detail"
      @update:open="
        (v) => {
          if (!v) detailId = null;
        }
      "
      ><DialogContent class="max-h-[85dvh] overflow-auto sm:max-w-xl"
        ><template v-if="detail"
          ><DialogTitle>{{ detail.title }} · {{ detail.chapter }}</DialogTitle
          ><DialogDescription>{{ label }} · 完成记录详情</DialogDescription>
          <div class="grid grid-cols-2 gap-4 py-2 text-sm">
            <div>
              <p class="text-xs text-muted-foreground">当前记录进度</p>
              <strong>{{ detail.done }} / {{ detail.total }} 页</strong>
            </div>
            <div>
              <p class="text-xs text-muted-foreground">本期完成</p>
              <strong>{{ detail.periodEntries.length }} 页</strong>
            </div>
            <div class="col-span-2">
              <p class="text-xs text-muted-foreground">整话完成日期</p>
              <strong>{{ detail.complete ? dateKey(detail.last) : '尚未全部完成' }}</strong>
            </div>
          </div>
          <h3 class="font-semibold">按日完成记录</h3>
          <div class="max-h-72 overflow-auto">
            <div
              v-for="[day, entry] in detailDates"
              :key="day"
              class="flex items-center justify-between gap-3 border-b py-3 text-sm"
            >
              <div>
                <strong>{{ day }}</strong>
                <p class="text-xs text-muted-foreground">{{ [...entry.sources].join('、') }}</p>
              </div>
              <span>{{ entry.count }} 页</span>
            </div>
          </div>
          <p class="text-xs leading-5 text-muted-foreground">
            这里展示保存的统计日期与页数，不重新扫描磁盘；混合时间来源会分别保留。
          </p>
          <Button v-if="detail.available" variant="outline" @click="openChapter"
            >打开对应章节</Button
          >
          <p v-else class="text-xs text-muted-foreground">
            该章节已不在项目列表中，历史记录仍保留。
          </p></template
        ></DialogContent
      ></Dialog
    >
    <ProfileManagerDialog :open="profilesOpen" @close="profilesOpen = false" />
  </div>
</template>
<style scoped>
.achievement-page {

  color: var(--text-primary);
}
.achievement-chart {
  display: flex;
  gap: 8px;
  height: 210px;
  margin-top: 24px;
}
.chart-axis {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding-bottom: 24px;
  width: 30px;
  text-align: right;
  font-size: 11px;
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
}
.chart-plot {
  display: grid;
  flex: 1;
  min-width: 0;
  gap: 5px;
  background:
    linear-gradient(var(--border), var(--border)) 0 0/100% 1px no-repeat,
    linear-gradient(var(--border), var(--border)) 0 calc(50% - 12px) / 100% 1px no-repeat,
    linear-gradient(var(--border), var(--border)) 0 calc(100% - 24px) / 100% 1px no-repeat;
}
.achievement-chart .chart-bin {
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  align-items: center;
  gap: 0;
  width: 100%;
  height: 100%;
  min-width: 0;
  padding: 0;
  border: 0;
  border-radius: 3px;
}
.chart-bin[aria-pressed='true'] {
  background: var(--primary-soft);
}
.chart-bar {
  width: min(100%, 32px);
  min-height: 2px;
  background: var(--primary);
  opacity: 0.6;
  border-radius: 3px 3px 0 0;
}
.chart-bin:hover .chart-bar,
.chart-bin[aria-pressed='true'] .chart-bar {
  opacity: 1;
}
.chart-tick {
  height: 24px;
  padding-top: 6px;
  font-size: 10px;
  line-height: 18px;
  color: var(--text-secondary);
}
.achievement-page :deep(th),
.achievement-page :deep(td) {
  white-space: nowrap;
  padding: 12px 20px;
}
.achievement-page :deep(th) {
  background: var(--bg-sunken);
}
@media (max-width: 800px) {
  .chart-plot {
    gap: 3px;
  }
  .chart-tick {
    font-size: 9px;
  }
}
:deep(.achievement-table thead){background:var(--card-bg)}
:deep(.achievement-table th){font-size:14px;font-weight:600;background:var(--card-bg)}
:deep(.achievement-table th),:deep(.achievement-table td){text-align:center}
:deep(.achievement-table th:first-child),:deep(.achievement-table td:first-child){text-align:left}
:deep(.achievement-table td:last-child>div){margin-inline:auto}
:deep(.ranking-table th:first-child),:deep(.ranking-table td:first-child){text-align:center}
:deep(.ranking-table th:nth-child(2)),:deep(.ranking-table td:nth-child(2)){text-align:left}
.achievement-cover{width:32px;height:44px}
</style>
