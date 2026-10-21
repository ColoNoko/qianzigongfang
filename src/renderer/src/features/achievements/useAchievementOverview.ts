import { computed, type Ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useAchievementsStore } from '@renderer/stores/achievements'
import { WORK_MODE_LABELS } from '@shared/modes'
import {
  axisStyle,
  valueAxisStyle,
  tooltipStyle,
  valueLabel,
  type ChartPalette
} from './chart-palette'

/** Original v1.2.0 month/year totals, using the project's persistent completion history. */
export function useAchievementOverview(
  viewMode: Ref<'month' | 'year'>,
  chartPalette: Ref<ChartPalette>
) {
  const store = useAchievementsStore()
  const {
    loaded,
    loading,
    total,
    byYear,
    selectedMode,
    currentMonthTotal,
    currentMonthProjectCount,
    currentYearTotal,
    currentYearProjectCount,
    totalProjectCount
  } = storeToRefs(store)
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

  /** ECharts option derived from `byYear` — one bar series per year. */
  const chartOption = computed(() => {
    const yearMap = byYear.value
    const sortedYears = [...yearMap.keys()].sort((a, b) => a - b)
    const palette = chartPalette.value

    if (viewMode.value === 'year') {
      return {
        color: palette.colors,
        textStyle: { color: palette.text },
        tooltip: { trigger: 'axis', ...tooltipStyle(palette) },
        xAxis: {
          type: 'category',
          data: sortedYears.map((year) => `${year}年`),
          ...axisStyle(palette)
        },
        yAxis: { type: 'value', ...valueAxisStyle(palette) },
        series: [
          {
            name: `${modeLabel.value}图片`,
            type: 'bar' as const,
            data: sortedYears.map((year) =>
              (yearMap.get(year) ?? []).reduce((sum, count) => sum + count, 0)
            ),
            label: valueLabel(palette)
          }
        ]
      }
    }

    const monthLabels = Array.from({ length: 12 }, (_, i) => `${i + 1}月`)
    const series = sortedYears.map((year) => ({
      name: String(year),
      type: 'bar' as const,
      data: yearMap.get(year) ?? new Array(12).fill(0),
      label: valueLabel(palette)
    }))

    return {
      color: palette.colors,
      textStyle: { color: palette.text },
      tooltip: {
        trigger: 'axis',
        ...tooltipStyle(palette),
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
      xAxis: { type: 'category', data: monthLabels, ...axisStyle(palette) },
      yAxis: { type: 'value', ...valueAxisStyle(palette) },
      series
    }
  })

  return { isEmpty, modeLabel, summaryCards, chartOption }
}
