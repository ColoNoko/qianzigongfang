// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import SplitPane from '../SplitPane.vue'

const CONTAINER_WIDTH = 1000
const CONTAINER_LEFT = 56

/**
 * jsdom reports a zero-sized rect for every element, and SplitPane clamps
 * against real pixels — so give it a container to measure.
 */
function stubLayout(width = CONTAINER_WIDTH, left = CONTAINER_LEFT): void {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    x: left,
    y: 0,
    left,
    top: 0,
    right: left + width,
    bottom: 600,
    width,
    height: 600,
    toJSON: () => ({})
  } as DOMRect)
}

function primaryWidth(wrapper: ReturnType<typeof mount>): string {
  return wrapper.get('div.shrink-0.overflow-hidden').attributes('style') ?? ''
}

/**
 * MouseEvent (not `trigger`) because jsdom exposes clientX as a getter-only
 * prototype property, so vue-test-utils cannot assign it onto a constructed
 * event.
 */
function pointerDown(wrapper: ReturnType<typeof mount>, clientX = CONTAINER_LEFT + 400): void {
  wrapper
    .get('[data-testid="split-pane-divider"]')
    .element.dispatchEvent(new MouseEvent('pointerdown', { clientX, bubbles: true, cancelable: true }))
}

function pointerMove(clientX: number): void {
  window.dispatchEvent(new MouseEvent('pointermove', { clientX }))
}

function pointerUp(): void {
  window.dispatchEvent(new MouseEvent('pointerup'))
}

function mountPane(primaryPercent?: number) {
  return mount(SplitPane, {
    props: primaryPercent === undefined ? {} : { primaryPercent },
    slots: { primary: '<p>list</p>', secondary: '<p>grid</p>' }
  })
}

beforeEach(() => {
  stubLayout()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('SplitPane', () => {
  it('opens at the persisted width instead of the hard-coded default', () => {
    const wrapper = mountPane(42)
    // 42% of 1000px is inside the clamp band → kept as given.
    expect(primaryWidth(wrapper)).toContain('width: 42%')
  })

  it('reports the new width once, on release', async () => {
    const wrapper = mountPane(40)

    pointerDown(wrapper)
    pointerMove(656)
    await wrapper.vm.$nextTick()

    // 656 - 56 = 600px of a 1000px container.
    expect(primaryWidth(wrapper)).toContain('width: 60%')
    // Nothing persisted while the pointer is still down.
    expect(wrapper.emitted('update:primaryPercent')).toBeFalsy()

    pointerUp()
    expect(wrapper.emitted('update:primaryPercent')).toEqual([[60]])
  })

  it('clamps the reported width to the minimum list size', async () => {
    const wrapper = mountPane(40)
    pointerDown(wrapper)

    // Drag far past the left edge: the floor is 20% of the window (1024 * 0.2).
    pointerMove(0)
    pointerUp()

    const reported = wrapper.emitted('update:primaryPercent')?.[0]?.[0] as number
    expect(reported).toBeCloseTo(20.48, 2)
  })

  it('debounces arrow-key nudges into a single report', async () => {
    vi.useFakeTimers()
    const wrapper = mountPane(40)
    const divider = wrapper.get('[data-testid="split-pane-divider"]')

    await divider.trigger('keydown', { key: 'ArrowRight' })
    await divider.trigger('keydown', { key: 'ArrowRight' })
    expect(wrapper.emitted('update:primaryPercent')).toBeFalsy()

    vi.advanceTimersByTime(300)
    // 400px + 2 * 24px = 448px of 1000px.
    expect(wrapper.emitted('update:primaryPercent')).toEqual([[44.8]])
  })

  it('follows a width that arrives after mount, unless the user already moved the divider', async () => {
    const wrapper = mountPane(33.333)
    await wrapper.setProps({ primaryPercent: 50 })
    expect(primaryWidth(wrapper)).toContain('width: 50%')

    // The user's own adjustment outranks a later settings update.
    pointerDown(wrapper)
    pointerMove(656)
    pointerUp()
    await wrapper.vm.$nextTick()
    expect(primaryWidth(wrapper)).toContain('width: 60%')

    await wrapper.setProps({ primaryPercent: 20 })
    expect(primaryWidth(wrapper)).toContain('width: 60%')
  })

  it('does not report a width when it unmounts mid-drag', async () => {
    const wrapper = mountPane(40)
    pointerDown(wrapper)
    wrapper.unmount()

    expect(wrapper.emitted('update:primaryPercent')).toBeFalsy()
    // The drag listeners are gone with the component.
    expect(() => pointerMove(900)).not.toThrow()
  })
})
