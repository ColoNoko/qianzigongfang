/**
 * Window geometry persistence.
 *
 * Kept free of Electron imports so the clamping rules can be unit-tested: a
 * stored size outlives the screen it was measured on (monitor swapped, laptop
 * undocked, DPI changed), and restoring it blindly would put the window
 * off-screen or below its own minimum size.
 */

export interface WindowBoundsState {
  width: number
  height: number
  maximized: boolean
  /**
   * 窗口左上角（第十四轮 D4 新增）。
   *
   * 缺省 = 让系统居中（老行为）。**位置比大小更容易开错地方**：换显示器、拔掉扩展屏、
   * 分辨率变了，一个"上次在 (3000, 200)"的窗口就会落在屏幕外面，而且它没有任务栏入口 —— 
   * 所以这里跟大小一样有一道校验（见 `normalizeWindowPosition`）。
   */
  x?: number
  y?: number
}

export interface WindowWorkArea {
  width: number
  height: number
}

/** 一个显示器的**工作区**（含左上角；`x`/`y` 可能是负数 —— 主屏左边那块屏幕）。 */
export interface DisplayWorkArea {
  x: number
  y: number
  width: number
  height: number
}

/** 至少要露出这么多像素才算"找得回来"（够抓住标题栏拖回来）。 */
export const MIN_VISIBLE_WIDTH = 160
export const MIN_VISIBLE_HEIGHT = 48

/** key_value_store key holding the last window size. */
export const WINDOW_BOUNDS_STORE_KEY = 'window.bounds'

/** Must stay in sync with the BrowserWindow minWidth/minHeight options. */
export const MIN_WINDOW_WIDTH = 900
export const MIN_WINDOW_HEIGHT = 600

function positiveInteger(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  const rounded = Math.round(value)
  return rounded > 0 ? rounded : null
}

/** First-launch size — two thirds of the primary work area, as before. */
export function defaultWindowBounds(workArea: WindowWorkArea): WindowBoundsState {
  return {
    width: Math.floor((workArea.width * 2) / 3),
    height: Math.floor((workArea.height * 3) / 4),
    maximized: false
  }
}

/**
 * 从存储值里解析出窗口位置；**校验不过就返回 null**（交给系统居中）。
 *
 * 判据：窗口矩形必须与某个显示器的工作区相交出一块"够抓得住"的区域
 * （`MIN_VISIBLE_WIDTH × MIN_VISIBLE_HEIGHT`），且**上边缘落在工作区内**
 * ——否则标题栏在屏幕外，鼠标够不着、又看不见窗口。
 */
export function normalizeWindowPosition(
  value: unknown,
  displays: DisplayWorkArea[],
  size: { width: number; height: number }
): { x: number; y: number } | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const x = Number.isFinite(record.x) ? Math.round(record.x as number) : null
  const y = Number.isFinite(record.y) ? Math.round(record.y as number) : null
  if (x === null || y === null) return null
  if (displays.length === 0) return null

  for (const area of displays) {
    const overlapWidth = Math.min(x + size.width, area.x + area.width) - Math.max(x, area.x)
    const overlapHeight = Math.min(y + size.height, area.y + area.height) - Math.max(y, area.y)
    const titleBarReachable = y >= area.y && y < area.y + area.height
    if (overlapWidth >= MIN_VISIBLE_WIDTH && overlapHeight >= MIN_VISIBLE_HEIGHT && titleBarReachable) {
      return { x, y }
    }
  }
  return null
}

/**
 * Turn a stored value into a usable size.
 *
 * Anything malformed (missing, non-numeric, zero, negative) falls back to the
 * default size. Valid sizes are clamped into [minimum, current work area] — the
 * work area loses, because a window must never be restored larger than the
 * screen it is about to open on.
 */
export function normalizeWindowBounds(
  value: unknown,
  workArea: WindowWorkArea
): WindowBoundsState {
  const fallback = defaultWindowBounds(workArea)
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return fallback

  const record = value as Record<string, unknown>
  const width = positiveInteger(record.width)
  const height = positiveInteger(record.height)
  if (width === null || height === null) return fallback

  const maxWidth = Math.max(MIN_WINDOW_WIDTH, Math.round(workArea.width))
  const maxHeight = Math.max(MIN_WINDOW_HEIGHT, Math.round(workArea.height))

  return {
    width: Math.min(maxWidth, Math.max(MIN_WINDOW_WIDTH, width)),
    height: Math.min(maxHeight, Math.max(MIN_WINDOW_HEIGHT, height)),
    maximized: record.maximized === true
  }
}
