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

    // Narrow container keeps one column and three visible rows.
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

  it('fills the available row and reflows fewer columns for larger thumbnails', async () => {
    const wrapper = mount(ThumbGrid, { props: { items: makeItems(100), thumbSize: '小' } })
    const el = wrapper.vm.scrollContainer as HTMLElement
    setContainerDims(el, 1000, 600)
    wrapper.vm.measureAndLoad()
    await nextTick()
    const firstRow = () => wrapper.findAll('.thumb-card').filter(card => (card.element as HTMLElement).style.top === '0px')
    const rightEdge = () => { const last = firstRow().at(-1)!.element as HTMLElement; return parseFloat(last.style.left) + parseFloat(last.style.width) }
    const smallColumns = firstRow().length
    expect(rightEdge()).toBeLessThanOrEqual(1000)
    expect(1000 - rightEdge()).toBeLessThan(firstRow().length)
    await wrapper.setProps({ thumbSize: '大' })
    expect(firstRow().length).toBeLessThan(smallColumns)
    expect(rightEdge()).toBeLessThanOrEqual(1000)
    expect(1000 - rightEdge()).toBeLessThan(firstRow().length)
    expect(wrapper.findAll('.thumb-card').length).toBeLessThan(100)
    setContainerDims(el, 220, 600)
    wrapper.vm.measureAndLoad()
    await nextTick()
    expect(firstRow()).toHaveLength(1)
    expect(rightEdge()).toBeCloseTo(220)
    wrapper.unmount()
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
