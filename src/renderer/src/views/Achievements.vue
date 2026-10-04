<script setup lang="ts">
// Achievements — year/month bar chart of typeset-done PSDs via ECharts.
// Data is cached in `useAchievementsStore` so re-mounting the view does
// not trigger a re-scan; a refresh button calls `store.refresh()` on
// demand. The scan iterates all child project folders via recursive
// `scanChildProject` IPC, filters with `isTypesetDone`, and buckets by mtime
// year-month.
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import * as echarts from 'echarts'
import { useAchievementsStore } from '@renderer/stores/achievements'
import { useThemeStore } from '@renderer/stores/theme'
import EmptyState from '@renderer/components/EmptyState.vue'
import AppSelect from '@renderer/components/AppSelect.vue'
import { WORK_MODE_LABELS, WORK_MODE_OPTIONS } from '@shared/modes'
import type { WorkMode } from '@shared/types'

const store = useAchievementsStore()
const themeStore = useThemeStore()
const {
  loading,
  total,
  byYear,
  loaded,
  selectedMode,
  currentMonthTotal,
  currentMonthProjectCount,
  currentYearTotal,
  currentYearProjectCount,
  totalProjectCount
} = storeToRefs(store)
const { resolvedTheme, hue, saturation, neutralSaturation } = storeToRefs(themeStore)

function onModeChange(value: string | number): void {
  store.setSelectedMode(value as WorkMode)
}

const chartRef = ref<HTMLDivElement | null>(null)
const viewMode = ref<'year' | 'month'>('month')
let chart: echarts.ECharts | null = null

const isEmpty = computed(() => loaded.value && !loading.value && total.value === 0)

const modeLabel = computed(() => WORK_MODE_LABELS[selectedMode.value])

const summaryCards = computed(() => [
  {
    title: `当月${modeLabel.value}数量`,
    count: currentMonthTotal.value,
    projectCount: currentMonthProjectCount.value,
    testId: 'month-count'
  },
  {
    title: `当年${modeLabel.value}数量`,
    count: currentYearTotal.value,
    projectCount: currentYearProjectCount.value,
    testId: 'year-count'
  },
  {
    title: `总${modeLabel.value}数量`,
    count: total.value,
    projectCount: totalProjectCount.value,
    testId: 'total-count'
  }
])

function themeVariable(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
}

const chartPalette = computed(() => {
  // These refs make the canvas chart react to runtime color-setting changes.
  void hue.value
  void saturation.value
  void neutralSaturation.value

  const fallback =
    resolvedTheme.value === 'dark'
      ? {
          text: '#f2f2f2',
          secondaryText: '#d0d0d0',
          axis: '#a8a8a8',
          grid: 'rgba(255, 255, 255, 0.16)',
          tooltipBackground: '#2a2a2a',
          tooltipBorder: '#555555',
          colors: ['#a17edd', '#dc7493', '#5a9ae2', '#e0a94f', '#5cc48f']
        }
      : {
          text: '#1a1a1a',
          secondaryText: '#555555',
          axis: '#777777',
          grid: 'rgba(0, 0, 0, 0.12)',
          tooltipBackground: '#ffffff',
          tooltipBorder: '#d8d8d8',
          colors: ['#723ecc', '#d54d76', '#3b82f6', '#d97706', '#07a855']
        }

  // 坐标轴与网格线也必须走 themeVariable：它们原来直接吃 fallback 里的灰，
  // 于是图表永远是"中性灰坐标轴"，用户换了色相也不会跟。
  return {
    ...fallback,
    text: themeVariable('--fg', fallback.text),
    secondaryText: themeVariable('--fg-muted', fallback.secondaryText),
    axis: themeVariable('--border-strong', fallback.axis),
    grid: themeVariable('--border', fallback.grid),
    tooltipBackground: themeVariable('--bg-raised', fallback.tooltipBackground),
    tooltipBorder: themeVariable('--border-strong', fallback.tooltipBorder),
    // 系列色 = 品牌双色（主色 + 完成色）+ 三个语义色。不再拿 danger 红当普通
    // 系列色：红色在图表里只应该表示"出问题了"。
    colors: [
      themeVariable('--primary', fallback.colors[0]),
      themeVariable('--done', fallback.colors[1]),
      themeVariable('--info', fallback.colors[2]),
      themeVariable('--warning', fallback.colors[3]),
      themeVariable('--success', fallback.colors[4])
    ]
  }
})

/** ECharts option derived from `byYear` — one bar series per year. */
const chartOption = computed(() => {
  const yearMap = byYear.value
  const sortedYears = [...yearMap.keys()].sort((a, b) => a - b)
  const palette = chartPalette.value
  const axisStyle = {
    axisLabel: { color: palette.secondaryText, fontSize: 13, fontWeight: 600 },
    axisLine: { lineStyle: { color: palette.axis } },
    axisTick: { lineStyle: { color: palette.axis } }
  }
  const valueAxisStyle = {
    ...axisStyle,
    splitLine: { lineStyle: { color: palette.grid } }
  }
  const tooltipStyle = {
    backgroundColor: palette.tooltipBackground,
    borderColor: palette.tooltipBorder,
    textStyle: { color: palette.text, fontWeight: 600 }
  }
  const valueLabel = {
    show: true,
    position: 'top' as const,
    color: palette.text,
    fontWeight: 700,
    formatter: (params: { value: number }) => (params.value > 0 ? String(params.value) : '')
  }

  if (viewMode.value === 'year') {
    return {
      color: palette.colors,
      textStyle: { color: palette.text },
      tooltip: { trigger: 'axis', ...tooltipStyle },
      xAxis: {
        type: 'category',
        data: sortedYears.map((year) => `${year}年`),
        ...axisStyle
      },
      yAxis: { type: 'value', ...valueAxisStyle },
      series: [
        {
          name: `${modeLabel.value}图片`,
          type: 'bar' as const,
          data: sortedYears.map((year) =>
            (yearMap.get(year) ?? []).reduce((sum, count) => sum + count, 0)
          ),
          label: valueLabel
        }
      ]
    }
  }

  const monthLabels = Array.from({ length: 12 }, (_, i) => `${i + 1}月`)
  const series = sortedYears.map((year) => ({
    name: String(year),
    type: 'bar' as const,
    data: yearMap.get(year) ?? new Array(12).fill(0),
    label: valueLabel
  }))

  return {
    color: palette.colors,
    textStyle: { color: palette.text },
    tooltip: {
      trigger: 'axis',
      ...tooltipStyle,
      formatter: (params: { dataIndex: number; value: number; seriesName: string }[]) => {
        const month = (params[0]?.dataIndex ?? 0) + 1
        const monthStr = String(month).padStart(2, '0')
        const lines = params
          .filter((p) => p.value > 0)
          .map((p) => `${p.seriesName}年${monthStr}月: ${p.value}张`)
        return lines.length > 0 ? lines.join('<br/>') : `${monthStr}月: 0张`
      }
    },
    legend: {
      data: sortedYears.map(String),
      textStyle: { color: palette.text, fontSize: 13, fontWeight: 600 }
    },
    xAxis: { type: 'category', data: monthLabels, ...axisStyle },
    yAxis: { type: 'value', ...valueAxisStyle },
    series
  }
})

function renderChart(): void {
  if (!chartRef.value) return
  if (!chart) {
    chart = echarts.init(chartRef.value)
  }
  chart.setOption(chartOption.value, true)
}

async function renderChartAfterDomUpdate(): Promise<void> {
  await nextTick()
  if (loaded.value && !loading.value && total.value > 0) {
    renderChart()
  }
}

function handleResize(): void {
  chart?.resize()
}

onMounted(() => {
  window.addEventListener('resize', handleResize)
  if (!store.loaded) {
    store.refresh()
  } else {
    void renderChartAfterDomUpdate()
  }
})

// Re-render chart when data arrives or refresh completes.
watch(
  [loaded, loading, total],
  () => {
    void renderChartAfterDomUpdate()
  },
  { flush: 'post', immediate: true }
)

watch(viewMode, () => {
  void renderChartAfterDomUpdate()
})

watch(selectedMode, () => {
  void renderChartAfterDomUpdate()
})

watch([resolvedTheme, hue, saturation, neutralSaturation], () => {
  void renderChartAfterDomUpdate()
})

// Dispose chart when transitioning to empty state so a stale instance
// is not left bound to a removed DOM node.
watch(isEmpty, (empty) => {
  if (empty && chart) {
    chart.dispose()
    chart = null
  }
})

onUnmounted(() => {
  window.removeEventListener('resize', handleResize)
  chart?.dispose()
  chart = null
})
</script>

<template>
  <div class="page-in min-h-full bg-app-bg p-6 text-text-primary">
    <div class="mb-4 flex items-center justify-between">
      <h1 class="text-xl font-semibold tracking-tight text-text-primary">成就</h1>
      <div class="flex items-center gap-2">
        <AppSelect
          :model-value="selectedMode"
          :options="WORK_MODE_OPTIONS"
          size="small"
          test-id="achievement-mode-select"
          @change="onModeChange"
        />
        <div class="flex overflow-hidden rounded-badge border border-border">
          <button
            class="px-3 py-2 text-sm"
            :class="
              viewMode === 'year'
                ? 'bg-accent text-text-on-accent'
                : 'bg-card-bg text-text-primary hover:bg-card-bg-hover'
            "
            data-testid="achievement-year-mode"
            @click="viewMode = 'year'"
          >
            年
          </button>
          <button
            class="px-3 py-2 text-sm"
            :class="
              viewMode === 'month'
                ? 'bg-accent text-text-on-accent'
                : 'bg-card-bg text-text-primary hover:bg-card-bg-hover'
            "
            data-testid="achievement-month-mode"
            @click="viewMode = 'month'"
          >
            月
          </button>
        </div>
        <button
          class="rounded-badge bg-accent px-4 py-2 text-text-on-accent transition-colors hover:bg-primary-hover active:bg-primary-active disabled:opacity-40"
          :disabled="loading"
          data-testid="refresh-btn"
          @click="store.refresh()"
        >
          {{ loading ? '扫描中...' : '刷新' }}
        </button>
      </div>
    </div>

    <!-- Loading state (first load only) -->
    <div v-if="loading && !loaded" class="flex min-h-[40vh] items-center justify-center">
      <p class="text-text-secondary">扫描中...</p>
    </div>

    <!-- Empty state -->
    <EmptyState v-else-if="isEmpty" data-testid="empty-state" headline="暂无成就数据" />

    <!-- Chart + summary -->
    <div v-else class="flex flex-col gap-4">
      <div class="grid gap-3 md:grid-cols-3">
        <div
          v-for="card in summaryCards"
          :key="card.title"
          class="rounded-lg border border-border bg-card-bg p-4 shadow-[var(--shadow-1)]"
          :data-testid="card.testId"
        >
          <p class="text-sm font-medium text-text-secondary">{{ card.title }}</p>
          <p class="mt-2 text-2xl font-semibold tabular-nums text-done">{{ card.count }}</p>
          <p class="mt-1 text-xs text-text-secondary">
            {{ modeLabel }}项目数:
            <span class="font-bold text-text-primary">{{ card.projectCount }}</span>
          </p>
        </div>
      </div>
      <div
        ref="chartRef"
        class="h-[400px] w-full rounded-lg border border-border bg-card-bg p-4 shadow-[var(--shadow-1)]"
        data-testid="chart-container"
      ></div>
    </div>
  </div>
</template>
