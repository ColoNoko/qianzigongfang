// @vitest-environment jsdom
/**
 * 译文锚点层的锁（P1 译文对照）。
 *
 * 浮层（悬停显示译文）**截不到**：它走原生 Popover，静态 HTML 里默认是关的、
 * 要 JS 调 `showPopover()` 才出来。所以这一条只能靠用例盯住 ——
 * 截图那组负责"看得见的东西"，这里负责"要交互才出现的东西"。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import type { LabelPlusLabel } from '@shared/labelplus-import'
import TranslationAnchorLayer from '../TranslationAnchorLayer.vue'

function labels(): LabelPlusLabel[] {
  return [
    {
      index: 1,
      group: '框内',
      text: '难道是我说错话了?',
      position: { unit: 'normalized', x: 0.5, y: 0.5 }
    },
    { index: 4, group: '框外', text: '嘟囔', position: { unit: 'normalized', x: 0.25, y: 0.75 } },
    { index: 9, group: '框外', text: '  ', position: { unit: 'normalized', x: 0.1, y: 0.1 } }
  ]
}

function mountLayer(
  overrides?: Partial<{
    naturalWidth: number
    naturalHeight: number
    scale: number
    offsetX: number
    offsetY: number
    activeIndex: number | null
    positionOverrides: Record<number, { x: number; y: number }>
    labels: LabelPlusLabel[]
  }>,
  attachTo?: HTMLElement
) {
  return mount(TranslationAnchorLayer, {
    ...(attachTo ? { attachTo } : {}),
    props: {
      labels: overrides?.labels ?? labels(),
      groups: ['框内', '框外'],
      naturalWidth: overrides?.naturalWidth ?? 1000,
      naturalHeight: overrides?.naturalHeight ?? 2000,
      scale: overrides?.scale ?? 0.3,
      offsetX: overrides?.offsetX ?? 0,
      offsetY: overrides?.offsetY ?? 0,
      activeIndex: overrides?.activeIndex ?? null,
      positionOverrides: overrides?.positionOverrides ?? {}
    }
  })
}

afterEach(() => {
  vi.useRealTimers()
})

describe('译文锚点层 · 徽章', () => {
  it('每条译文一个编号徽章，颜色按分组取 token', () => {
    const wrapper = mountLayer()
    const badges = wrapper.findAll('[data-testid^="translation-anchor-"]')
    // 3 条译文（浮层那枚是 translation-anchor-tip，不计入）
    expect(wrapper.findAll('button[data-testid^="translation-anchor-"]')).toHaveLength(3)
    expect(badges.length).toBeGreaterThanOrEqual(3)

    // ⚠️ 底色落在**内层那一片**上（"只让底色透、字不透"的前提），所以往 span 里看
    const plateOf = (index: number): string =>
      wrapper.get(`[data-testid="translation-anchor-${index}"] span`).attributes('style') ?? ''
    expect(plateOf(1)).toContain('--lp-group-1')
    expect(plateOf(4)).toContain('--lp-group-2')
  })

  it('位置按归一化坐标算（与看图组件的 transform 同源）', () => {
    const wrapper = mountLayer()
    // (0.5,0.5) ⇒ 容器正中
    expect(wrapper.get('[data-testid="translation-anchor-1"]').attributes('style')).toContain(
      'calc(50% + 0px)'
    )
    // (0.25,0.75) × 1000×2000 × 0.3 ⇒ x -75 / y +150
    const moved = wrapper.get('[data-testid="translation-anchor-4"]').attributes('style') ?? ''
    expect(moved).toContain('calc(50% - 75px)')
    expect(moved).toContain('calc(50% + 150px)')
  })

  it('图片尺寸还没读出来 ⇒ 一个徽章都不画（否则会全挤在中心）', () => {
    const wrapper = mountLayer({ naturalWidth: 0 })
    expect(wrapper.findAll('button[data-testid^="translation-anchor-"]')).toHaveLength(0)
  })

  it('选中的那一条带 data-active（两侧共用一个编号）', () => {
    const wrapper = mountLayer({ activeIndex: 4 })
    expect(wrapper.get('[data-testid="translation-anchor-4"]').attributes('data-active')).toBe(
      'true'
    )
    expect(wrapper.get('[data-testid="translation-anchor-1"]').attributes('data-active')).toBe(
      'false'
    )
  })

  it('点徽章 ⇒ emit pick(编号)（点锚点要能联动右栏）', async () => {
    const wrapper = mountLayer()
    await wrapper.get('[data-testid="translation-anchor-4"]').trigger('click')
    expect(wrapper.emitted('pick')?.at(-1)).toEqual([4])
  })
})

describe('译文锚点层 · 悬停浮层（截图拍不到，只能靠锁）', () => {
  it('悬停有延迟才弹：鼠标扫过一排徽章时不该噼里啪啦闪一串', async () => {
    vi.useFakeTimers()
    const wrapper = mountLayer()
    const tip = wrapper.get('[data-testid="translation-anchor-tip"]')

    await wrapper.get('[data-testid="translation-anchor-1"]').trigger('pointerenter')
    expect(tip.text()).toBe('')

    vi.advanceTimersByTime(150)
    await nextTick()
    expect(tip.text()).toBe('难道是我说错话了?')
  })

  it('第4批修：浮层里的**换行要真的换行**（LabelPlus 的 `\n` 是断句，不是空格）', async () => {
    vi.useFakeTimers()
    const wrapper = mountLayer({
      labels: [
        {
          index: 1,
          group: '框内',
          text: '第一句\n第二句',
          position: { unit: 'normalized', x: 0.5, y: 0.5 }
        }
      ]
    })
    const tip = wrapper.get('[data-testid="translation-anchor-tip"]')
    await wrapper.get('[data-testid="translation-anchor-1"]').trigger('pointerenter')
    vi.advanceTimersByTime(150)
    await nextTick()

    // 文本里保留 \n，且承载它的那一层带 whitespace-pre-wrap（否则浏览器会折成空格）
    expect(tip.text()).toBe('第一句\n第二句')
    expect(tip.html()).toContain('whitespace-pre-wrap')
  })

  it('浮层里就是这一条的译文；没填的照实标"（未填写）"', async () => {
    vi.useFakeTimers()
    const wrapper = mountLayer()
    const tip = wrapper.get('[data-testid="translation-anchor-tip"]')

    await wrapper.get('[data-testid="translation-anchor-9"]').trigger('pointerenter')
    vi.advanceTimersByTime(150)
    await nextTick()
    expect(tip.text()).toBe('（未填写）')
  })

  it('键盘聚焦也弹（不用鼠标也能看）', async () => {
    vi.useFakeTimers()
    const wrapper = mountLayer()
    const tip = wrapper.get('[data-testid="translation-anchor-tip"]')

    await wrapper.get('[data-testid="translation-anchor-4"]').trigger('focus')
    vi.advanceTimersByTime(150)
    await nextTick()
    expect(tip.text()).toBe('嘟囔')
  })

  it('移开之后延迟收起（留出把鼠标移进浮层的时间）', async () => {
    vi.useFakeTimers()
    const wrapper = mountLayer()
    const badge = wrapper.get('[data-testid="translation-anchor-1"]')
    const tip = wrapper.get('[data-testid="translation-anchor-tip"]')

    await badge.trigger('pointerenter')
    vi.advanceTimersByTime(150)
    await nextTick()
    expect(tip.text()).toBe('难道是我说错话了?')

    await badge.trigger('pointerleave')
    expect(tip.text()).toBe('难道是我说错话了?') // 还在（延迟期内）
    vi.advanceTimersByTime(200)
    await nextTick()
    expect(tip.text()).toBe('')
  })

  it('悬停时也把编号报上去（列表那一侧要跟着高亮）', async () => {
    vi.useFakeTimers()
    const wrapper = mountLayer()
    await wrapper.get('[data-testid="translation-anchor-1"]').trigger('pointerenter')
    expect(wrapper.emitted('hover')?.at(-1)).toEqual([1])
    await wrapper.get('[data-testid="translation-anchor-1"]').trigger('pointerleave')
    expect(wrapper.emitted('hover')?.at(-1)).toEqual([null])
  })
})

/**
 * 「看穿」交互态（2026-10-06 P1.1，用户："平常不透明，悬停/选中/聚焦时半透明，字本身不透明"）。
 *
 * 关键是**分开两层**：底色单独一层承担透明度，编号字始终不透明。
 * 顺带锁住"只有盯着的那一枚透"——一排徽章一起变淡会让画面失去锚点。
 */
describe('译文锚点层 · 看穿交互态', () => {
  const plateOf = (wrapper: ReturnType<typeof mountLayer>, index: number): string =>
    wrapper.get(`[data-testid="translation-anchor-${index}"] span`).attributes('style') ?? ''

  it('平常不透明：底色那层没有 opacity', () => {
    const wrapper = mountLayer()
    expect(plateOf(wrapper, 1)).not.toContain('opacity')
    expect(wrapper.get('[data-testid="translation-anchor-1"]').attributes('data-veiled')).toBe(
      'false'
    )
  })

  it('选中 ⇒ 底色半透明（走 token），编号加描边兜底', () => {
    const wrapper = mountLayer({ activeIndex: 1 })
    const badge = wrapper.get('[data-testid="translation-anchor-1"]')

    expect(badge.attributes('data-veiled')).toBe('true')
    expect(plateOf(wrapper, 1)).toContain('var(--lp-veil-opacity)')
    expect(badge.attributes('style')).toContain('--lp-badge-ink')
  })

  it('字本身不透明：整枚徽章上没有 opacity（只有内层底色那一片有）', () => {
    const wrapper = mountLayer({ activeIndex: 1 })
    const badgeStyle = wrapper.get('[data-testid="translation-anchor-1"]').attributes('style') ?? ''
    expect(badgeStyle).not.toContain('opacity')
  })

  it('只有盯着的那一枚透：同页其它徽章照旧不透明', () => {
    const wrapper = mountLayer({ activeIndex: 4 })
    expect(wrapper.get('[data-testid="translation-anchor-1"]').attributes('data-veiled')).toBe(
      'false'
    )
    expect(plateOf(wrapper, 1)).not.toContain('var(--lp-veil-opacity)')
  })

  it('悬停也算交互态（鼠标扫过时那枚就该透出来）', async () => {
    vi.useFakeTimers()
    const wrapper = mountLayer()
    await wrapper.get('[data-testid="translation-anchor-4"]').trigger('pointerenter')
    // 悬停的**即时**高亮由父层通过 activeIndex 报回来；这里锁的是浮层那一侧：
    // 悬停后浮层打开，徽章自己也进入 veiled（openIndex 命中）
    vi.advanceTimersByTime(150)
    await nextTick()
    expect(wrapper.get('[data-testid="translation-anchor-4"]').attributes('data-veiled')).toBe(
      'true'
    )
  })

  it('浮层：底色半透明单成一层，文字那一层不带透明度', () => {
    const wrapper = mountLayer()
    const tip = wrapper.get('[data-testid="translation-anchor-tip"]')
    const layers = tip.findAll('span')

    expect(layers[0].attributes('style')).toContain('var(--lp-tip-veil-opacity)')
    expect(layers[1].attributes('style') ?? '').not.toContain('opacity')
    // 字还是原来那层（浮层文案没被搬走）
    expect(layers[1].text()).toBe('')
  })
})

/**
 * P2-c：拖动锚点。
 *
 * 这一层的用例盯的是**手势的边界**（阈值 / 冒泡 / 何时才写回），
 * 因为这几件事错了都会**悄悄改到用户文件里的坐标** —— 而屏幕上看起来只是"挪了一下"。
 */
describe('译文锚点层 · P2-c 拖动', () => {
  /**
   * ⚠️ **不能**用 VTU 的 `trigger('pointerdown', { clientX })`：jsdom 没有 `PointerEvent`，
   * VTU 会退回 `MouseEvent`，而它的 `clientX` 是**只读 getter** ⇒
   * `TypeError: Cannot set property clientX of #<MouseEvent> which has only a getter`
   * （这一组 8 条第一次就是这么全红的 —— 一个共同原因，不是八个独立问题）。
   * 所以自己造事件、直接派发。
   */
  function pointerEvent(
    type: string,
    at: { x: number; y: number },
    extra?: { button?: number; pointerId?: number }
  ): Event {
    const event = new Event(type, { bubbles: true, cancelable: true })
    Object.assign(event, {
      clientX: at.x,
      clientY: at.y,
      button: extra?.button ?? 0,
      pointerId: extra?.pointerId ?? 1
    })
    return event
  }

  function badgeOf(wrapper: ReturnType<typeof mountLayer>, index: number) {
    return wrapper.get(`[data-testid="translation-anchor-${index}"]`)
  }

  async function send(
    wrapper: ReturnType<typeof mountLayer>,
    index: number,
    type: string,
    at: { x: number; y: number }
  ): Promise<void> {
    badgeOf(wrapper, index).element.dispatchEvent(pointerEvent(type, at))
    await nextTick()
  }

  it('没越过阈值 ⇒ 仍算"点一下"（不写回、click 照旧 emit pick）', async () => {
    const wrapper = mountLayer()
    await send(wrapper, 1, 'pointerdown', { x: 100, y: 100 })
    await send(wrapper, 1, 'pointermove', { x: 102, y: 101 }) // 2px：抖动
    await send(wrapper, 1, 'pointerup', { x: 102, y: 101 })

    expect(wrapper.emitted('move')).toBeUndefined()
    await badgeOf(wrapper, 1).trigger('click')
    expect(wrapper.emitted('pick')?.at(-1)).toEqual([1])
  })

  it('越过阈值 ⇒ 松手 emit move（归一化坐标），并且**吞掉后面那个 click**', async () => {
    const wrapper = mountLayer()
    await send(wrapper, 1, 'pointerdown', { x: 100, y: 100 })
    await send(wrapper, 1, 'pointermove', { x: 130, y: 160 }) // +30px / +60px
    await send(wrapper, 1, 'pointerup', { x: 130, y: 160 })

    // 原图 1000×2000、缩放 0.3 ⇒ 1 归一化单位 = 300px / 600px
    // 起点 (0.5, 0.5) + (0.1, 0.1) = (0.6, 0.6)
    const moved = wrapper.emitted('move')?.at(-1)
    expect(moved?.[0]).toBe(1)
    expect(moved?.[1]).toBeCloseTo(0.6, 9)
    expect(moved?.[2]).toBeCloseTo(0.6, 9)

    // 浏览器在 pointerup 之后还会补一个 click —— 那不是在"点选"，不许改选中态
    await badgeOf(wrapper, 1).trigger('click')
    expect(wrapper.emitted('pick')).toBeUndefined()
  })

  it('拖动期间**位置跟手**（徽章跟着指针走，不必等草稿回来）', async () => {
    const wrapper = mountLayer()
    const before = badgeOf(wrapper, 1).attributes('style')

    await send(wrapper, 1, 'pointerdown', { x: 100, y: 100 })
    await send(wrapper, 1, 'pointermove', { x: 400, y: 100 }) // +300px = 归一化 +1（撞右边界被夹住）

    expect(badgeOf(wrapper, 1).attributes('data-dragging')).toBe('true')
    expect(badgeOf(wrapper, 1).attributes('style')).not.toBe(before)
    expect(wrapper.emitted('move')).toBeUndefined() // 还没松手 —— 不许写
  })

  it('**拖出画布会被夹住**（写回文件里的坐标必须落在 0..1）', async () => {
    const wrapper = mountLayer()
    await send(wrapper, 9, 'pointerdown', { x: 500, y: 500 })
    await send(wrapper, 9, 'pointermove', { x: -400, y: -400 }) // 往左上拖出界
    await send(wrapper, 9, 'pointerup', { x: -400, y: -400 })

    const moved = wrapper.emitted('move')?.at(-1)
    expect(moved?.[1]).toBe(0)
    expect(moved?.[2]).toBe(0)
  })

  it('图片尺寸没就绪 ⇒ 锚点不画，也就无从拖动（不会写出任何坐标）', async () => {
    // ⚠️ 原先我写的是"拖到一半把尺寸置零"——那个场景**构造不出来**：尺寸一归零，
    // `anchorOffsetFromCenter` 就返回 null、徽章从 DOM 里消失，pointermove 无处可发。
    // 所以这里锁"实际会发生的事"；而"换算函数遇到 0/NaN 必须返回 null"另有纯函数锁
    // （见 anchor-geometry.spec 的「图片尺寸 / 缩放没就绪」那组）。
    const wrapper = mountLayer({ naturalWidth: 0 })
    expect(wrapper.find('[data-testid="translation-anchor-1"]').exists()).toBe(false)
    expect(wrapper.emitted('move')).toBeUndefined()
  })

  it('**pointerdown 不许冒泡**（否则 ImageViewer 会同时开始平移图）', async () => {
    const outer = document.createElement('div')
    document.body.appendChild(outer)
    const seen: string[] = []
    outer.addEventListener('pointerdown', () => seen.push('bubbled'))

    const wrapper = mountLayer(undefined, outer)
    await send(wrapper, 1, 'pointerdown', { x: 100, y: 100 })

    expect(seen).toEqual([])
    wrapper.unmount()
    outer.remove()
  })

  it('松手后**不弹回执**（用户 2026-10-06 明确不要）—— 徽章停在新位置本身就是反馈', async () => {
    vi.useFakeTimers()
    const wrapper = mountLayer()
    await send(wrapper, 1, 'pointerdown', { x: 100, y: 100 })
    await send(wrapper, 1, 'pointermove', { x: 130, y: 160 })
    await send(wrapper, 1, 'pointerup', { x: 130, y: 160 })

    expect(wrapper.emitted('move')?.at(-1)?.slice(1)).toEqual([0.6, 0.6])
    // 浮层仍只是"悬停才出"的那一枚，没被拖完的动作叫出来
    expect(wrapper.find('[data-testid="translation-anchor-receipt"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="translation-anchor-tip"]').text()).toBe('')
  })

  it('拖过之后的坐标由外面（草稿）给回来 —— 徽章照它画', () => {
    const wrapper = mountLayer({ positionOverrides: { 1: { x: 0, y: 0 } } })
    // 原图 1000×2000、scale 0.3 ⇒ (0,0) 在容器中心左上 150 / 300
    // （Vue 会把 `calc(50% + -150px)` 规范化成 `calc(50% - 150px)`，按规范化后的写）
    const style = badgeOf(wrapper, 1).attributes('style') ?? ''
    expect(style).toContain('calc(50% - 150px)')
    expect(style).toContain('calc(50% - 300px)')
  })
})
