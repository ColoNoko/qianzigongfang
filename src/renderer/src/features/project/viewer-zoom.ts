/**
 * viewer-zoom — 预览 / 对照视图缩放控件背后的纯函数。
 *
 * 为什么把这几行单独拿出来：控件的"数字"必须**只有一套规则**（按钮、滚轮、输入框都走它），
 * 而规则本身不需要 DOM —— 放这里就能用表格单测锁住边界（照 card-action.ts / project-route.ts 的先例）。
 *
 * 语义（2026-09-27 用户拍板）：**适应窗口 = 100%**，即倍数是"相对各自适应窗口的倍数"。
 * 对照状态两栏像素尺寸常常不同，只有倍数语义才能用**一个数字同时描述两栏**。
 */

/** 下限 = 适应窗口本身（低于它会把图缩在容器中间，本版沿用"吸附回适应窗口"）。 */
export const MIN_ZOOM_RATIO = 1
/** 上限沿用 ImageViewer 既有的 `fitScale * 20` 保护，不新造规则。 */
export const MAX_ZOOM_RATIO = 20
/** 按钮步进。滚轮仍用 1.1 的细步长（见 ImageViewer.onWheel），两者改的是同一个数字。 */
export const ZOOM_STEP = 1.25

/** 倍数保留 4 位小数，避免连续 ×1.25 之后出现 1.9531250000000002 这种浮点尾巴。 */
function round4(value: number): number {
  return Math.round(value * 10000) / 10000
}

/** 夹取到 [1, 20]；非有限值回落成 1（适应窗口）。 */
export function clampZoomRatio(value: number): number {
  if (!Number.isFinite(value)) return MIN_ZOOM_RATIO
  return round4(Math.min(MAX_ZOOM_RATIO, Math.max(MIN_ZOOM_RATIO, value)))
}

export function zoomIn(current: number): number {
  return clampZoomRatio(clampZoomRatio(current) * ZOOM_STEP)
}

export function zoomOut(current: number): number {
  return clampZoomRatio(clampZoomRatio(current) / ZOOM_STEP)
}

/** 显示用文案：100% / 125% / 195%。四舍五入到整数百分比。 */
export function zoomPercentLabel(ratio: number): string {
  return `${Math.round(clampZoomRatio(ratio) * 100)}%`
}

/**
 * 解析输入框里的百分比。
 *
 * 认：`250`、`250%`、` 250 ％`（全角百分号）、`12.5`。
 * 不认（返回 null → 界面保持原值，不静默改成别的数）：空串、`abc`、`1e2`、`-50`、`+50`。
 * 认得出但超范围的**夹取**而不是拒绝：输入 9999 → 2000%（用户意图明确，只需被保护）。
 */
export function parseZoomPercentInput(raw: string): number | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim().replace(/[%％]\s*$/, '').trim()
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return null
  const percent = Number(trimmed)
  if (!Number.isFinite(percent)) return null
  return clampZoomRatio(percent / 100)
}
