// @vitest-environment jsdom
import { expect, it, vi } from 'vitest'
const { init } = vi.hoisted(() => ({ init: vi.fn() }))
vi.mock('echarts', () => ({ init }))
import { createChartInstance } from './chart-instance'

it('rebinds replaced containers and releases chart and resize subscriptions', () => {
  const instances: { setOption: ReturnType<typeof vi.fn>; resize: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn> }[] = []
  init.mockImplementation(() => {
    const instance = { setOption: vi.fn(), resize: vi.fn(), dispose: vi.fn() }
    instances.push(instance)
    return instance
  })
  const disconnect = vi.fn()
  let resized = () => {}
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { resized = callback }
    observe = vi.fn()
    disconnect = disconnect
  })
  try {
    const chart = createChartInstance()
    const first = document.createElement('div')
    chart.render(first, {})
    chart.render(first, {})
    expect(instances).toHaveLength(1)
    resized()
    expect(instances[0].resize).toHaveBeenCalledOnce()
    chart.render(document.createElement('div'), {})
    expect(instances[0].dispose).toHaveBeenCalledOnce()
    expect(instances).toHaveLength(2)
    chart.dispose()
    expect(disconnect).toHaveBeenCalledTimes(2)
    expect(instances[1].dispose).toHaveBeenCalledOnce()
  } finally { vi.unstubAllGlobals() }
})
