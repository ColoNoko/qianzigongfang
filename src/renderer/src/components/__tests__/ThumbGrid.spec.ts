// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import ThumbGrid from '../ThumbGrid.vue'
import type { ThumbItem } from '../ThumbGrid.vue'
import type { TypesetStatus } from '@shared/types'

function makeItems(n: number): ThumbItem[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `item-${i}`,
    filename: `page_${String(i + 1).padStart(3, '0')}.psd`,
    thumbUrl: null,
    mtimeText: '2024-01-01',
    status: 'pending' as TypesetStatus
  }))
}

/** Override jsdom's zero-length client dimensions on a DOM element. */
function setContainerDims(
  el: HTMLElement,
  clientWidth: number,
  clientHeight: number,
  scrollTop = 0
): void {
  Object.defineProperty(el, 'clientWidth', { value: clientWidth, configurable: true })
  Object.defineProperty(el, 'clientHeight', { value: clientHeight, configurable: true })
  Object.defineProperty(el, 'scrollTop', { value: scrollTop, configurable: true })
}

describe('ThumbGrid', () => {
  it('calls load only for visible indices 0,1,2 when 3 rows fit', async () => {
    const load = vi.fn()
    const items = makeItems(10)
    const wrapper = mount(ThumbGrid, {
      props: { items, load }
    })

    // 中 size: frameW=180, frameH=280, GAP=10 → rowHeight=290
    // clientWidth=174 → cols=max(1, floor(184/190))=1; clientHeight=738 → 3 rows visible
    const el = wrapper.vm.scrollContainer as HTMLElement
    setContainerDims(el, 174, 738, 0)
    wrapper.vm.measureAndLoad()
    await nextTick()

    expect(load).toHaveBeenCalledTimes(3)
    expect(load).toHaveBeenCalledWith(0, items[0])
    expect(load).toHaveBeenCalledWith(1, items[1])
    expect(load).toHaveBeenCalledWith(2, items[2])
    expect(load).not.toHaveBeenCalledWith(3, items[3])
  })

  it('emits dblclick with correct id on card double-click', async () => {
    const items = makeItems(10)
    const wrapper = mount(ThumbGrid, { props: { items } })

    const el = wrapper.vm.scrollContainer as HTMLElement
    setContainerDims(el, 144, 624, 0)
    wrapper.vm.measureAndLoad()
    await nextTick()

    const cards = wrapper.findAll('.thumb-card')
    expect(cards.length).toBeGreaterThan(0)
    await cards[0].trigger('dblclick')

    const events = wrapper.emitted('dblclick')
    expect(events).toBeTruthy()
    expect(events![0]).toEqual([items[0].id])
  })

  it('emits action with correct id when "去嵌字" button clicked', async () => {
    const items = makeItems(10)
    const wrapper = mount(ThumbGrid, { props: { items } })

    const el = wrapper.vm.scrollContainer as HTMLElement
    setContainerDims(el, 144, 624, 0)
    wrapper.vm.measureAndLoad()
    await nextTick()

    const buttons = wrapper.findAll('.thumb-action')
    expect(buttons.length).toBeGreaterThan(0)
    await buttons[0].trigger('click')

    const events = wrapper.emitted('action')
    expect(events).toBeTruthy()
    expect(events![0]).toEqual([items[0].id])
  })

  it('emits mark with correct id when status dot clicked', async () => {
    const items = makeItems(10)
    const wrapper = mount(ThumbGrid, { props: { items } })

    const el = wrapper.vm.scrollContainer as HTMLElement
    setContainerDims(el, 144, 624, 0)
    wrapper.vm.measureAndLoad()
    await nextTick()

    const buttons = wrapper.findAll('.thumb-status')
    expect(buttons.length).toBeGreaterThan(0)
    await buttons[0].trigger('click')

    const events = wrapper.emitted('mark')
    expect(events).toBeTruthy()
    expect(events![0]).toEqual([items[0].id])
  })

  it('supports ctrl click, shift range, and ctrl+a selection', async () => {
    const items = makeItems(10)
    const wrapper = mount(ThumbGrid, { props: { items } })

    const el = wrapper.vm.scrollContainer as HTMLElement
    setContainerDims(el, 144, 624, 0)
    wrapper.vm.measureAndLoad()
    await nextTick()

    const cards = wrapper.findAll('.thumb-card')
    await cards[0].trigger('click')
    expect(wrapper.emitted('selectionChange')!.at(-1)).toEqual([[items[0].id]])

    await cards[2].trigger('click', { ctrlKey: true })
    expect(wrapper.emitted('selectionChange')!.at(-1)).toEqual([[items[0].id, items[2].id]])

    await cards[4].trigger('click', { shiftKey: true })
    expect(wrapper.emitted('selectionChange')!.at(-1)).toEqual([
      [items[0].id, items[2].id, items[3].id, items[4].id]
    ])

    await wrapper.find('[tabindex="0"]').trigger('keydown', { key: 'a', ctrlKey: true })
    expect(wrapper.emitted('selectionChange')!.at(-1)).toEqual([items.map((item) => item.id)])
  })

  it('updates frame dimensions when thumbSize prop changes', async () => {
    const items = makeItems(10)
    const wrapper = mount(ThumbGrid, { props: { items, thumbSize: '中' } })

    const el = wrapper.vm.scrollContainer as HTMLElement
    setContainerDims(el, 144, 624, 0)
    wrapper.vm.measureAndLoad()
    await nextTick()

    // 中: frameW=180, image area=162×208 (about 1.5x the old area)
    const cardsBefore = wrapper.findAll('.thumb-card')
    expect(cardsBefore.length).toBeGreaterThan(0)
    expect(cardsBefore[0].attributes('style')).toContain('width: 180px')
    expect(cardsBefore[0].find('div').attributes('style')).toContain('width: 162px')
    expect(cardsBefore[0].find('div').attributes('style')).toContain('height: 208px')

    // Change to 大: frameW=229
    await wrapper.setProps({ thumbSize: '大' })
    await nextTick()

    const cardsAfter = wrapper.findAll('.thumb-card')
    expect(cardsAfter.length).toBeGreaterThan(0)
    expect(cardsAfter[0].attributes('style')).toContain('width: 229px')
  })

  it('keeps every frame large enough for its image + info block', async () => {
    // 这条锁住"图片被 flex 悄悄压小"这个回归。
    //
    // frameH 曾经只比 imgH 大 34px，而卡片里图片下面的信息区本身就要约 54px，
    // 于是 flex 只能压缩图片（中号声明 208px、实际渲染约 170px，页面左右各露出
    // 约 21px 的底色）。外框必须容得下：边框 2 + 上下内边距 16 + 信息区约 54。
    const wrapper = mount(ThumbGrid, { props: { items: makeItems(3) } })
    const el = wrapper.vm.scrollContainer as HTMLElement

    for (const size of ['小', '中', '大'] as const) {
      await wrapper.setProps({ thumbSize: size })
      setContainerDims(el, 144, 624, 0)
      wrapper.vm.measureAndLoad()
      await nextTick()

      const card = wrapper.findAll('.thumb-card')[0]
      const cardStyle = card.attributes('style') ?? ''
      const imgStyle = card.find('div').attributes('style') ?? ''
      const num = (style: string, prop: string): number =>
        Number(new RegExp(`${prop}:\\s*(\\d+)px`).exec(style)?.[1])

      expect(num(cardStyle, 'height') - num(imgStyle, 'height')).toBeGreaterThanOrEqual(72)
      expect(num(cardStyle, 'width') - num(imgStyle, 'width')).toBeGreaterThanOrEqual(18)
    }
  })

  it('measures and loads when items arrive after initial empty mount', async () => {
    const load = vi.fn()
    const wrapper = mount(ThumbGrid, {
      props: { items: [], load }
    })

    const el = wrapper.vm.scrollContainer as HTMLElement
    setContainerDims(el, 144, 624, 0)
    wrapper.vm.measureAndLoad()
    expect(load).not.toHaveBeenCalled()

    const items = makeItems(3)
    await wrapper.setProps({ items })
    await nextTick()

    expect(load).toHaveBeenCalledTimes(3)
    expect(load).toHaveBeenCalledWith(0, items[0])
    expect(load).toHaveBeenCalledWith(1, items[1])
    expect(load).toHaveBeenCalledWith(2, items[2])
  })

  it('labels the card action with the active work mode', async () => {
    const items = makeItems(3)
    const wrapper = mount(ThumbGrid, { props: { items, mode: 'translated' } })

    const el = wrapper.vm.scrollContainer as HTMLElement
    setContainerDims(el, 144, 624, 0)
    wrapper.vm.measureAndLoad()
    await nextTick()

    const buttons = wrapper.findAll('.thumb-action')
    expect(buttons.length).toBeGreaterThan(0)
    expect(buttons[0].text()).toBe('去翻译')
  })

  it('keeps "去嵌字" when no mode is supplied', async () => {
    const wrapper = mount(ThumbGrid, { props: { items: makeItems(3) } })
    const el = wrapper.vm.scrollContainer as HTMLElement
    setContainerDims(el, 144, 624, 0)
    wrapper.vm.measureAndLoad()
    await nextTick()

    expect(wrapper.findAll('.thumb-action')[0].text()).toBe('去嵌字')
  })

  it('keeps the action visible for status "none" — 嵌字 now routes it to Photoshop', async () => {
    const items = makeItems(2).map((item, i) =>
      i === 0 ? { ...item, status: 'none' as TypesetStatus } : item
    )

    for (const mode of ['typeset', 'translated'] as const) {
      const wrapper = mount(ThumbGrid, { props: { items, mode } })
      setContainerDims(wrapper.vm.scrollContainer as HTMLElement, 144, 624, 0)
      wrapper.vm.measureAndLoad()
      await nextTick()
      // Both cards stay actionable in every mode; the routing decides what the
      // click does (PSD / import script / external editor).
      expect(wrapper.findAll('.thumb-action')).toHaveLength(2)
    }
  })
})
