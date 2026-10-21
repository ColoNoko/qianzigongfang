import { describe, expect, it } from 'vitest'
import {
  ANCHOR_DRAG_THRESHOLD_PX,
  anchorOffsetFromCenter,
  decideImageGesture,
  draggedPosition,
  isDragGesture,
  normalizedDragDelta,
  normalizedPointFromCenterOffset,
  type ViewerImageMetrics
} from '../anchor-geometry'

function metrics(overrides?: Partial<ViewerImageMetrics>): ViewerImageMetrics {
  return {
    naturalWidth: 1000,
    naturalHeight: 2000,
    scale: 0.3,
    offsetX: 0,
    offsetY: 0,
    ...overrides
  }
}

describe('锚点几何 · 归一化坐标 → 相对容器中心的像素偏移', () => {
  it('图片正中 (0.5, 0.5) 就落在容器中心（再叠加平移量）', () => {
    expect(anchorOffsetFromCenter(0.5, 0.5, metrics())).toEqual({ x: 0, y: 0 })
    expect(anchorOffsetFromCenter(0.5, 0.5, metrics({ offsetX: 12, offsetY: -7 }))).toEqual({
      x: 12,
      y: -7
    })
  })

  it('左上角 (0, 0) 落在图片实际显示的左上角（校验与 ImageViewer 的 transform 同源）', () => {
    // 容器 800×600、图 1000×2000 ⇒ 适应窗口 scale = min(0.8, 0.3) = 0.3
    // 图显示尺寸 300×600 ⇒ 左边缘在容器中心往左 150px、上边缘在中心往上 300px
    expect(anchorOffsetFromCenter(0, 0, metrics())).toEqual({ x: -150, y: -300 })
    expect(anchorOffsetFromCenter(1, 1, metrics())).toEqual({ x: 150, y: 300 })
  })

  it('缩放参与计算：同一坐标放大一倍，偏移跟着翻倍', () => {
    const one = anchorOffsetFromCenter(0.25, 0.75, metrics())
    const two = anchorOffsetFromCenter(0.25, 0.75, metrics({ scale: 0.6 }))
    expect(one).toEqual({ x: -75, y: 150 })
    expect(two).toEqual({ x: -150, y: 300 })
  })

  it('图片尺寸还没读出来时不画（返回 null，而不是画在容器中心）', () => {
    expect(anchorOffsetFromCenter(0.5, 0.5, metrics({ naturalWidth: 0 }))).toBeNull()
    expect(anchorOffsetFromCenter(0.5, 0.5, metrics({ naturalHeight: 0 }))).toBeNull()
    expect(anchorOffsetFromCenter(0.5, 0.5, metrics({ scale: 0 }))).toBeNull()
  })

  it('坐标不是有限数就返回 null（坏 txt 不许把界面画歪）', () => {
    expect(anchorOffsetFromCenter(Number.NaN, 0.5, metrics())).toBeNull()
    expect(anchorOffsetFromCenter(0.5, Number.POSITIVE_INFINITY, metrics())).toBeNull()
  })

  it('画布外的坐标照实算（parser 会另给警告，这里不替它判断）', () => {
    // 用精度比较：0.6 × 600 在 IEEE754 下是 360.00000000000006，亚像素噪声对定位无意义
    const outside = anchorOffsetFromCenter(-0.1, 1.1, metrics())
    expect(outside).not.toBeNull()
    expect(outside?.x).toBeCloseTo(-180, 6)
    expect(outside?.y).toBeCloseTo(360, 6)
  })
})

describe('锚点拖动（P2-c）· 位移 → 归一化增量', () => {
  it('基准是「图上的一像素」= 原图宽 × 缩放，不是容器宽', () => {
    // 原图 1000 宽、缩放 0.3 ⇒ 图上 1 归一化单位 = 300 屏幕像素
    // 拖 30 屏幕像素 ⇒ 归一化 0.1
    const delta = normalizedDragDelta(30, 60, {
      naturalWidth: 1000,
      naturalHeight: 2000,
      scale: 0.3
    })
    expect(delta).toEqual({ dx: 0.1, dy: 0.1 })
  })

  it('缩放变化时同一个屏幕位移换算出**不同**的归一化增量（放大后更"灵敏"）', () => {
    const small = normalizedDragDelta(30, 0, {
      naturalWidth: 1000,
      naturalHeight: 2000,
      scale: 0.3
    })
    const big = normalizedDragDelta(30, 0, { naturalWidth: 1000, naturalHeight: 2000, scale: 0.6 })
    expect(small?.dx).toBeCloseTo(0.1, 9)
    expect(big?.dx).toBeCloseTo(0.05, 9)
  })

  it('图片尺寸 / 缩放没就绪 ⇒ 返回 null（不许瞎算一个值写回文件）', () => {
    const zero = { naturalWidth: 0, naturalHeight: 2000, scale: 1 }
    expect(normalizedDragDelta(10, 10, zero)).toBeNull()
    expect(
      normalizedDragDelta(10, 10, { naturalWidth: 1000, naturalHeight: 0, scale: 1 })
    ).toBeNull()
    expect(
      normalizedDragDelta(10, 10, { naturalWidth: 1000, naturalHeight: 2000, scale: 0 })
    ).toBeNull()
    expect(
      normalizedDragDelta(Number.NaN, 10, { naturalWidth: 1000, naturalHeight: 2000, scale: 1 })
    ).toBeNull()
  })
})

describe('锚点拖动（P2-c）· 阈值：点击还是拖动', () => {
  it('小抖动仍算"点一下"（P1 的双向高亮不能丢）', () => {
    expect(isDragGesture(0, 0)).toBe(false)
    expect(isDragGesture(3, 3)).toBe(false)
  })

  it('越过阈值（含两轴中较大的那个）才算拖', () => {
    expect(isDragGesture(ANCHOR_DRAG_THRESHOLD_PX, 0)).toBe(true)
    expect(isDragGesture(0, ANCHOR_DRAG_THRESHOLD_PX)).toBe(true)
    expect(isDragGesture(0, ANCHOR_DRAG_THRESHOLD_PX - 1)).toBe(false)
  })

  it('非有限数不算拖（坏事件不许触发写回）', () => {
    expect(isDragGesture(Number.NaN, 0)).toBe(false)
    expect(isDragGesture(0, Number.POSITIVE_INFINITY)).toBe(false)
  })
})

describe('锚点拖动（P2-c）· 结果位置夹进 0..1', () => {
  it('常规位移就是相加', () => {
    const moved = draggedPosition({ x: 0.5, y: 0.5 }, { dx: 0.1, dy: -0.2 })
    expect(moved.x).toBeCloseTo(0.6, 9)
    expect(moved.y).toBeCloseTo(0.3, 9)
  })

  it('**拖出画布会被夹住**（归一化坐标写回文件后必须落在画布内）', () => {
    expect(draggedPosition({ x: 0.9, y: 0.1 }, { dx: 0.5, dy: -0.9 })).toEqual({ x: 1, y: 0 })
    expect(draggedPosition({ x: 0.1, y: 0.9 }, { dx: -0.5, dy: 0.9 })).toEqual({ x: 0, y: 1 })
  })

  it('起点或增量坏掉时给 0（不写 NaN 进文件）', () => {
    expect(draggedPosition({ x: Number.NaN, y: 0.5 }, { dx: 0.1, dy: 0.1 })).toEqual({
      x: 0,
      y: 0.6
    })
    expect(draggedPosition({ x: 0.5, y: 0.5 }, { dx: Number.NaN, dy: 0.1 })).toEqual({
      x: 0,
      y: 0.6
    })
  })
})

/**
 * 「新增框」（第 5 批，2026-10-07）—— 点在图上的**哪个位置**。
 *
 * 这是第 1 批那条换算（归一化 → 相对容器中心的像素）的**逆**：
 * 必须与它共用同一份 `ViewerImageMetrics` 与同一个缩放基准，
 * 否则"点下去的地方"与"锚点画在的地方"会差一截（而且要等真机才发现）。
 */
describe('新增框 · 点击像素 → 归一化坐标（第 1 批换算的**逆**）', () => {
  it('往返：先算锚点偏移、再算回来 ⇒ 回到原来的归一化坐标（含平移量）', () => {
    for (const [x, y] of [
      [0.25, 0.75],
      [0.5, 0.5],
      [0, 1]
    ] as const) {
      for (const offsetX of [0, 12, -30]) {
        const m = metrics({ offsetX, offsetY: -7 })
        const px = anchorOffsetFromCenter(x, y, m)
        expect(px).not.toBeNull()
        const back = normalizedPointFromCenterOffset(px as { x: number; y: number }, m)
        expect(back).not.toBeNull()
        expect((back as { x: number; y: number }).x).toBeCloseTo(x, 9)
        expect((back as { x: number; y: number }).y).toBeCloseTo(y, 9)
      }
    }
  })

  it('与 ImageViewer 的 transform 同源：手算出来的像素 → 坐标', () => {
    // 图 1000×2000、scale 0.3 ⇒ 显示 300×600 ⇒ 中心往左/往右各 150、上/下各 300
    const m = metrics()
    expect(normalizedPointFromCenterOffset({ x: 0, y: 0 }, m)).toEqual({ x: 0.5, y: 0.5 })
    expect(normalizedPointFromCenterOffset({ x: -150, y: -300 }, m)).toEqual({ x: 0, y: 0 })
    expect(normalizedPointFromCenterOffset({ x: 150, y: 300 }, m)).toEqual({ x: 1, y: 1 })
  })

  it('尺寸 / 缩放没就绪 ⇒ null（不许瞎算一个坐标写进文件）', () => {
    expect(normalizedPointFromCenterOffset({ x: 0, y: 0 }, metrics({ naturalWidth: 0 }))).toBeNull()
    expect(normalizedPointFromCenterOffset({ x: 0, y: 0 }, metrics({ scale: 0 }))).toBeNull()
    expect(normalizedPointFromCenterOffset({ x: Number.NaN, y: 0 }, metrics())).toBeNull()
  })

  it('点在图外（画面留白处）⇒ **照实算、不夹取**（夹到边缘等于把一个框钉在那儿）', () => {
    const m = metrics()
    // 右边缘是中心往右 150px；再往外 30px = 1.1
    const outside = normalizedPointFromCenterOffset({ x: 180, y: 0 }, m)
    expect(outside).not.toBeNull()
    expect((outside as { x: number; y: number }).x).toBeCloseTo(1.1, 9)
    expect((outside as { x: number; y: number }).y).toBeCloseTo(0.5, 9)
  })
})

/**
 * 「新增框」的手势归属：**点一下 / 拖一下 / 右键**三种不能互相抢。
 *
 * 阈值**只走 `isDragGesture` 一处** —— 这里再写一个常量就是"同一条规则两处实现"，
 * 而那正是"想平移却多出一个框"（在改用户数据）的来源。
 */
describe('新增框 · 手势判定：点一下 / 拖一下 / 右键', () => {
  it('没开新增模式 ⇒ 什么也不算（左右键都一样，一律 ignore）', () => {
    expect(decideImageGesture({ button: 0, dxPx: 0, dyPx: 0, addMode: false })).toBe('ignore')
    expect(decideImageGesture({ button: 2, dxPx: 0, dyPx: 0, addMode: false })).toBe('ignore')
  })

  it('开着 + 左键 + 位移在阈值内 ⇒ 新增框内（"点一下"）', () => {
    expect(decideImageGesture({ button: 0, dxPx: 3, dyPx: 0, addMode: true })).toBe('add-inside')
    expect(
      decideImageGesture({
        button: 0,
        dxPx: ANCHOR_DRAG_THRESHOLD_PX - 1,
        dyPx: 0,
        addMode: true
      })
    ).toBe('add-inside')
  })

  it('开着 + 左键 + 位移越过阈值 ⇒ 归属平移（"拖一下"绝不算新增）', () => {
    expect(
      decideImageGesture({ button: 0, dxPx: ANCHOR_DRAG_THRESHOLD_PX, dyPx: 0, addMode: true })
    ).toBe('pan')
    // 两轴取较大的那个：竖直拖也算拖
    expect(decideImageGesture({ button: 0, dxPx: 0, dyPx: 20, addMode: true })).toBe('pan')
  })

  it('开着 + 右键 ⇒ 新增框外（**不看位移** —— 右键是有意图的一下）', () => {
    expect(decideImageGesture({ button: 2, dxPx: 0, dyPx: 0, addMode: true })).toBe('add-outside')
    expect(decideImageGesture({ button: 2, dxPx: 40, dyPx: 40, addMode: true })).toBe('add-outside')
  })

  it('其它键（中键等）⇒ ignore', () => {
    expect(decideImageGesture({ button: 1, dxPx: 0, dyPx: 0, addMode: true })).toBe('ignore')
  })
})
