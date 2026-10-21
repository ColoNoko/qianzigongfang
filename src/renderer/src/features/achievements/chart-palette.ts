import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useThemeStore } from '@renderer/stores/theme'

export function themeVariable(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
}

export interface ChartPalette {
  text: string
  secondaryText: string
  axis: string
  grid: string
  tooltipBackground: string
  tooltipBorder: string
  colors: string[]
}

export function axisStyle(palette: ChartPalette): Record<string, unknown> {
  return {
    axisLabel: { color: palette.secondaryText, fontSize: 13, fontWeight: 600 },
    axisLine: { lineStyle: { color: palette.axis } },
    axisTick: { lineStyle: { color: palette.axis } }
  }
}

export function valueAxisStyle(palette: ChartPalette): Record<string, unknown> {
  return {
    ...axisStyle(palette),
    splitLine: { lineStyle: { color: palette.grid } }
  }
}

export function tooltipStyle(palette: ChartPalette): Record<string, unknown> {
  return {
    backgroundColor: palette.tooltipBackground,
    borderColor: palette.tooltipBorder,
    textStyle: { color: palette.text, fontWeight: 600 }
  }
}

export function valueLabel(palette: ChartPalette): Record<string, unknown> {
  return {
    show: true,
    position: 'top' as const,
    color: palette.text,
    fontWeight: 700,
    formatter: (params: { value: number }) => (params.value > 0 ? String(params.value) : '')
  }
}
export function useChartPalette() {
  const { hue, saturation, neutralSaturation, resolvedTheme } = storeToRefs(useThemeStore())

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
  return chartPalette
}
