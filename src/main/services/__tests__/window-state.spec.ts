// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import {
  MIN_WINDOW_HEIGHT,
  MIN_WINDOW_WIDTH,
  defaultWindowBounds,
  normalizeWindowBounds,
  normalizeWindowPosition
} from '../window-state'

const WORK_AREA = { width: 1920, height: 1040 }

describe('defaultWindowBounds', () => {
  it('keeps the historical two-thirds / three-quarters sizing', () => {
    expect(defaultWindowBounds(WORK_AREA)).toEqual({
      width: 1280,
      height: 780,
      maximized: false
    })
  })
})

describe('normalizeWindowBounds', () => {
  it('accepts a stored size that fits the current screen', () => {
    expect(normalizeWindowBounds({ width: 1200, height: 700, maximized: false }, WORK_AREA)).toEqual(
      {
        width: 1200,
        height: 700,
        maximized: false
      }
    )
  })

  it('remembers the maximized flag so a maximized window reopens maximized', () => {
    expect(
      normalizeWindowBounds({ width: 1200, height: 700, maximized: true }, WORK_AREA).maximized
    ).toBe(true)
    // Anything other than an explicit true is treated as "not maximized".
    expect(
      normalizeWindowBounds({ width: 1200, height: 700, maximized: 'yes' }, WORK_AREA).maximized
    ).toBe(false)
  })

  it('clamps a size larger than the screen instead of restoring it off-screen', () => {
    const bounds = normalizeWindowBounds({ width: 5000, height: 4000 }, WORK_AREA)
    expect(bounds).toEqual({ width: 1920, height: 1040, maximized: false })
  })

  it('clamps a size below the window minimum up to it', () => {
    const bounds = normalizeWindowBounds({ width: 320, height: 200 }, WORK_AREA)
    expect(bounds).toEqual({
      width: MIN_WINDOW_WIDTH,
      height: MIN_WINDOW_HEIGHT,
      maximized: false
    })
  })

  it.each([
    ['missing', undefined],
    ['null', null],
    ['a number', 1280],
    ['an array', [1280, 780]],
    ['a partial record', { width: 1280 }],
    ['zero', { width: 0, height: 0 }],
    ['NaN', { width: Number.NaN, height: 780 }],
    ['strings', { width: '1280', height: '780' }]
  ])('falls back to the default size for %s', (_label, value) => {
    expect(normalizeWindowBounds(value, WORK_AREA)).toEqual(defaultWindowBounds(WORK_AREA))
  })

  it('never returns less than the minimum even on a screen smaller than the window', () => {
    const tiny = { width: 800, height: 500 }
    expect(normalizeWindowBounds({ width: 700, height: 400 }, tiny)).toEqual({
      width: MIN_WINDOW_WIDTH,
      height: MIN_WINDOW_HEIGHT,
      maximized: false
    })
  })

  it('rounds fractional sizes', () => {
    expect(normalizeWindowBounds({ width: 1200.6, height: 700.2 }, WORK_AREA)).toEqual({
      width: 1201,
      height: 700,
      maximized: false
    })
  })
})

/**
 * D4：窗口**位置**的校验（大小那一套在文件上半部分）。
 *
 * 位置比大小更容易出事：换显示器、拔扩展屏、改分辨率之后，上次的坐标可能已经在屏幕外 ——
 * 那种窗口既看不见、也没有任务栏入口。所以：够不着就**不恢复**（交给系统居中）。
 */
describe('normalizeWindowPosition', () => {
  const primary = { x: 0, y: 0, width: 1920, height: 1040 }
  const left = { x: -1920, y: 0, width: 1920, height: 1040 }

  it('在工作区内 → 原样恢复', () => {
    expect(normalizeWindowPosition({ x: 100, y: 80 }, [primary], { width: 1200, height: 800 })).toEqual({
      x: 100,
      y: 80
    })
  })

  it('在主屏左边的第二块屏（负坐标）→ 同样能恢复', () => {
    expect(
      normalizeWindowPosition({ x: -1800, y: 40 }, [primary, left], { width: 1200, height: 800 })
    ).toEqual({ x: -1800, y: 40 })
  })

  it('完全在屏幕外（拔掉扩展屏之后）→ 不恢复', () => {
    expect(
      normalizeWindowPosition({ x: 4000, y: 200 }, [primary], { width: 1200, height: 800 })
    ).toBeNull()
  })

  it('只露出一条缝（抓不住标题栏）→ 不恢复', () => {
    // 右边只剩 40px 可见
    expect(
      normalizeWindowPosition({ x: 1880, y: 200 }, [primary], { width: 1200, height: 800 })
    ).toBeNull()
    // 上边缘跑到工作区上方（标题栏在屏幕外）
    expect(
      normalizeWindowPosition({ x: 200, y: -200 }, [primary], { width: 1200, height: 800 })
    ).toBeNull()
  })

  it('缺坐标 / 非数字 / 没有显示器 → 一律不恢复', () => {
    expect(normalizeWindowPosition({}, [primary], { width: 1200, height: 800 })).toBeNull()
    expect(normalizeWindowPosition({ x: 'a', y: 1 }, [primary], { width: 1200, height: 800 })).toBeNull()
    expect(normalizeWindowPosition({ x: 10, y: 10 }, [], { width: 1200, height: 800 })).toBeNull()
    expect(normalizeWindowPosition(null, [primary], { width: 1200, height: 800 })).toBeNull()
  })
})
