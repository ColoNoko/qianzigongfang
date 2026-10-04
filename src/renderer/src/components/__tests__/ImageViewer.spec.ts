// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import ImageViewer from '../ImageViewer.vue'

/**
 * ImageViewer 此前**没有 spec** —— 本轮给它加受控缩放，顺手把两种模式的行为锁住：
 *   · 不给 `zoomRatio`：老行为（自己管缩放）
 *   · 给 `zoomRatio`：受控（倍数由父组件持有，滚轮只负责报数）
 * 右下角那组控件能不能和滚轮共用一个旋钮，全靠这几条。
 */

// jsdom 没有 ResizeObserver；组件在 onMounted 里会建一个。
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

const CONTAINER = { width: 1000, height: 1000 }
const IMAGE = { width: 2000, height: 2000 }
/** 容器 1000、图 2000 → 适应窗口的比例是 0.5；倍数为 2 时画面上就是 scale(1)。 */
const FIT = 0.5

function viewer(props: { src: string; zoomRatio?: number }): VueWrapper {
  const wrapper = mount(ImageViewer, { props }) as VueWrapper
  const root = wrapper.element as HTMLElement
  Object.defineProperty(root, 'clientWidth', { value: CONTAINER.width, configurable: true })
  Object.defineProperty(root, 'clientHeight', { value: CONTAINER.height, configurable: true })
  return wrapper
}

/** 让 <img> 报告一个真实的原始尺寸并触发 @load（jsdom 不加载图片）。 */
async function pretendImageLoaded(
  wrapper: VueWrapper,
  width = IMAGE.width,
  height = IMAGE.height
): Promise<void> {
  const img = wrapper.find('img').element as HTMLImageElement
  Object.defineProperty(img, 'naturalWidth', { value: width, configurable: true })
  Object.defineProperty(img, 'naturalHeight', { value: height, configurable: true })
  await wrapper.find('img').trigger('load')
}

/**
 * 必须手工建 WheelEvent：@vue/test-utils 的 `trigger('wheel', { ctrlKey })`
 * 会去写 MouseEvent 上只读的 ctrlKey，在 jsdom 里直接抛错。
 */
async function wheel(wrapper: VueWrapper, init: { ctrlKey: boolean; deltaY: number }): Promise<void> {
  wrapper.element.dispatchEvent(
    new WheelEvent('wheel', {
      ctrlKey: init.ctrlKey,
      deltaY: init.deltaY,
      clientX: 10,
      clientY: 10,
      bubbles: true,
      cancelable: true
    })
  )
  await wrapper.vm.$nextTick()
}

function scaleOf(wrapper: VueWrapper): number {
  const transform = (wrapper.find('img').element as HTMLElement).style.transform
  const matched = /scale\(([^)]+)\)/.exec(transform)
  return matched ? Number(matched[1]) : Number.NaN
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub)
})

describe('ImageViewer 缩放', () => {
  it('自管模式（不给 zoomRatio）：Ctrl+滚轮放大内部倍数，且不对外报数', async () => {
    const wrapper = viewer({ src: 'data:image/png;base64,x' })
    await pretendImageLoaded(wrapper)
    expect(scaleOf(wrapper)).toBeCloseTo(FIT, 5)

    await wheel(wrapper, { ctrlKey: true, deltaY: -100 })

    expect(scaleOf(wrapper)).toBeCloseTo(FIT * 1.1, 5)
    expect(wrapper.emitted('update:zoomRatio')).toBeFalsy()
  })

  it('自管模式：光滚轮（不带 Ctrl）不缩放 —— 那是翻页的手势', async () => {
    const wrapper = viewer({ src: 'data:image/png;base64,x' })
    await pretendImageLoaded(wrapper)

    await wheel(wrapper, { ctrlKey: false, deltaY: -100 })

    expect(scaleOf(wrapper)).toBeCloseTo(FIT, 5)
  })

  it('受控模式：倍数由 prop 决定（父组件说 2 倍就是 2 倍）', async () => {
    const wrapper = viewer({ src: 'data:image/png;base64,x', zoomRatio: 2 })
    await pretendImageLoaded(wrapper)

    expect(scaleOf(wrapper)).toBeCloseTo(FIT * 2, 5)
  })

  it('受控模式：Ctrl+滚轮只把新倍数报上去，不在内部各改一套', async () => {
    const wrapper = viewer({ src: 'data:image/png;base64,x', zoomRatio: 2 })
    await pretendImageLoaded(wrapper)

    await wheel(wrapper, { ctrlKey: true, deltaY: -100 })

    const events = wrapper.emitted('update:zoomRatio')
    expect(events).toBeTruthy()
    expect(events![0][0]).toBeCloseTo(2.2, 5)
    // 父组件没接这个事件（测试里没更新 prop），所以画面仍是 2 倍 —— 状态只有一份。
    expect(scaleOf(wrapper)).toBeCloseTo(FIT * 2, 5)
  })

  it('受控模式：缩到适应窗口以下 → 吸附回 1 倍并报 1（沿用老行为）', async () => {
    const wrapper = viewer({ src: 'data:image/png;base64,x', zoomRatio: 1.05 })
    await pretendImageLoaded(wrapper)

    await wheel(wrapper, { ctrlKey: true, deltaY: 100 })

    const events = wrapper.emitted('update:zoomRatio')
    expect(events).toBeTruthy()
    expect(events![0][0]).toBe(1)
  })

  it('受控模式：双击画面 = 回适应窗口（与「一键回默认」同一个状态）', async () => {
    const wrapper = viewer({ src: 'data:image/png;base64,x', zoomRatio: 3 })
    await pretendImageLoaded(wrapper)

    await wrapper.element.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    await wrapper.vm.$nextTick()

    expect(wrapper.emitted('update:zoomRatio')![0][0]).toBe(1)
  })

  it('受控模式：换一张图不会把父组件的倍数清掉（翻页保持缩放）', async () => {
    const wrapper = viewer({ src: 'data:image/png;base64,a', zoomRatio: 2 })
    await pretendImageLoaded(wrapper)

    await wrapper.setProps({ src: 'data:image/png;base64,b' })
    await pretendImageLoaded(wrapper)

    expect(scaleOf(wrapper)).toBeCloseTo(FIT * 2, 5)
    expect(wrapper.emitted('update:zoomRatio')).toBeFalsy()
  })

  it('自管模式：换一张图回到适应窗口（老行为不变）', async () => {
    const wrapper = viewer({ src: 'data:image/png;base64,a' })
    await pretendImageLoaded(wrapper)
    await wheel(wrapper, { ctrlKey: true, deltaY: -100 })
    expect(scaleOf(wrapper)).toBeCloseTo(FIT * 1.1, 5)

    await wrapper.setProps({ src: 'data:image/png;base64,b' })
    await pretendImageLoaded(wrapper)

    expect(scaleOf(wrapper)).toBeCloseTo(FIT, 5)
  })
})
