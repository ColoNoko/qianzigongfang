import * as echarts from 'echarts'

/** Owns a single canvas instance; options and ranking rules remain with the caller. */
export function createChartInstance(onCreate?: (chart: echarts.ECharts) => void) {
  let instance: echarts.ECharts | null = null
  let container: HTMLElement | null = null
  let observer: ResizeObserver | null = null
  function dispose(): void {
    observer?.disconnect()
    observer = null
    instance?.dispose()
    instance = null
    container = null
  }
  return {
    render(
      element: HTMLElement | null,
      option: Parameters<echarts.ECharts['setOption']>[0]
    ): echarts.ECharts | null {
      if (!element) return null
      if (container !== element) dispose()
      if (!instance) {
        container = element
        instance = echarts.init(element)
        if (typeof ResizeObserver !== 'undefined') {
          observer = new ResizeObserver(() => instance?.resize())
          observer.observe(element)
        }
        onCreate?.(instance)
      }
      instance.setOption(option, true)
      return instance
    },
    resize(): void {
      instance?.resize()
    },
    dispose
  }
}
