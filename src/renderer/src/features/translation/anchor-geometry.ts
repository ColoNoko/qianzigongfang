/**
 * 锚点几何 —— 把 LabelPlus 的归一化坐标（0..1，相对**图片左上角**）换算成
 * "相对看图容器中心"的像素偏移。
 *
 * ## 为什么是"相对中心"
 *
 * `ImageViewer` 里那张图是这样摆的（见该组件 `imgStyle`）：
 *
 * ```text
 * position: absolute; left: 50%; top: 50%
 * margin-left: -naturalWidth/2; margin-top: -naturalHeight/2   ← 先把图片中心对到容器中心
 * transform: translate(offsetX, offsetY) scale(scale)          ← 再平移 + 缩放（原点 = 中心）
 * ```
 *
 * 所以容器里的一个绝对定位元素只要写 `left: calc(50% + dx); top: calc(50% + dy)`，
 * 就与图片处在**同一个坐标系**里 —— 缩放和平移都会自动跟手，不需要去读组件的内部状态。
 *
 * ## 这个函数不做什么
 *
 * · **不夹取**画布外的坐标：txt 里真的写到 1.1 也照实画（parser 会另给一条警告），
 *   这里不替它判断 —— "报事实、不替用户决定"。
 * · **不缩放徽章尺寸**：徽章是固定大小的（照 LabelPlusFX），缩放补偿在模板那层做。
 */
export interface ViewerImageMetrics {
  /** 图片原始宽（`naturalWidth`）。还没读出来时是 0。 */
  naturalWidth: number
  /** 图片原始高（`naturalHeight`）。 */
  naturalHeight: number
  /** 当前绝对缩放 = 适应窗口的比例 × 界面上的倍数。 */
  scale: number
  /** 用户拖动产生的水平平移量（`ImageViewer` 内部维护）。 */
  offsetX: number
  /** 同上，竖直方向。 */
  offsetY: number
}

export interface AnchorOffset {
  /** 相对容器中心往右多少 px（可为负）。 */
  x: number
  /** 相对容器中心往下多少 px（可为负）。 */
  y: number
}

/**
 * 归一化坐标 → 相对容器中心的像素偏移。
 *
 * 图片尺寸还没读出来（或缩放为 0）时返回 `null` —— 此时**不该画**，
 * 否则所有锚点会挤在容器中心，看起来像"译文都堆在中间"。
 * 坐标不是有限数也返回 `null`（坏 txt 不许把界面画歪）。
 */
export function anchorOffsetFromCenter(
  x: number,
  y: number,
  metrics: ViewerImageMetrics
): AnchorOffset | null {
  const { naturalWidth, naturalHeight, scale, offsetX, offsetY } = metrics
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null
  if (!Number.isFinite(naturalWidth) || !Number.isFinite(naturalHeight)) return null
  if (naturalWidth <= 0 || naturalHeight <= 0) return null
  if (!Number.isFinite(scale) || scale <= 0) return null
  return {
    x: (x - 0.5) * naturalWidth * scale + (Number.isFinite(offsetX) ? offsetX : 0),
    y: (y - 0.5) * naturalHeight * scale + (Number.isFinite(offsetY) ? offsetY : 0)
  }
}

/**
 * 拖动锚点（P2-c）—— 三条纯规则，全部可脱离 DOM 单测。
 *
 * 为什么单独抽出来：手势里最容易错的就是这几个换算（除错了基准、忘了夹取、
 * 阈值写成"任意移动都算拖"），而它们的正确性**与 DOM 无关**，
 * 放在组件里就只能靠"真机上手试"，放进纯函数就能被锁住。
 */

/** 超过这个像素位移才算"拖"，否则仍算"点一下"（P1 那个双向高亮不能丢）。 */
export const ANCHOR_DRAG_THRESHOLD_PX = 4

/**
 * 指针位移（屏幕像素）→ **归一化坐标增量**。
 *
 * 基准是**图上的一像素** = `naturalWidth × scale`，不是容器宽度 ——
 * 图片被放大/缩小时，"拖 10 屏幕像素"对应的归一化位移是**不一样**的。
 *
 * 图片尺寸或缩放还没就绪时返回 `null`（那时拖动没有意义，不许瞎算一个值写回文件）。
 */
export function normalizedDragDelta(
  dxPx: number,
  dyPx: number,
  metrics: Pick<ViewerImageMetrics, 'naturalWidth' | 'naturalHeight' | 'scale'>
): { dx: number; dy: number } | null {
  const { naturalWidth, naturalHeight, scale } = metrics
  if (!Number.isFinite(dxPx) || !Number.isFinite(dyPx)) return null
  if (!Number.isFinite(naturalWidth) || !Number.isFinite(naturalHeight)) return null
  if (naturalWidth <= 0 || naturalHeight <= 0) return null
  if (!Number.isFinite(scale) || scale <= 0) return null
  return { dx: dxPx / (naturalWidth * scale), dy: dyPx / (naturalHeight * scale) }
}

/** 位移够不够得上"拖"。用**两轴较大的那个**：竖直拖一下也算拖。 */
export function isDragGesture(
  dxPx: number,
  dyPx: number,
  threshold: number = ANCHOR_DRAG_THRESHOLD_PX
): boolean {
  if (!Number.isFinite(dxPx) || !Number.isFinite(dyPx)) return false
  const gap = Math.max(Math.abs(dxPx), Math.abs(dyPx))
  return gap >= (Number.isFinite(threshold) && threshold > 0 ? threshold : ANCHOR_DRAG_THRESHOLD_PX)
}

/**
 * 拖动结果 = 起点 + 增量，**夹进 `[0, 1]`**。
 *
 * 夹取只在**拖动**这条路上做（读 txt 时故意不夹，坏坐标照实画并给警告）；
 * 因为归一化坐标写回文件后必须落在画布内 —— 拖出界还写 1.2 就是往用户文件里塞坏数据。
 */
export function draggedPosition(
  start: { x: number; y: number },
  delta: { dx: number; dy: number }
): { x: number; y: number } {
  const clamp = (value: number): number => (value < 0 ? 0 : value > 1 ? 1 : value)
  const x = Number.isFinite(start.x) && Number.isFinite(delta.dx) ? start.x + delta.dx : 0
  const y = Number.isFinite(start.y) && Number.isFinite(delta.dy) ? start.y + delta.dy : 0
  return { x: clamp(x), y: clamp(y) }
}

// ── 新增框（第 5 批，2026-10-07）：点在图上的哪个位置 ────────────────────────────

/**
 * **相对容器中心的像素偏移 → 归一化坐标**（0..1，相对图片左上角）。
 *
 * 这是 {@link anchorOffsetFromCenter} 的**逆** —— 刻意与它共用同一份
 * {@link ViewerImageMetrics} 与同一个缩放基准（"图上的一像素" = `naturalWidth × scale`）：
 * 两处各写一套换算，就会出现"点下去的位置"与"锚点画出来的位置"差一截，
 * 而那种偏差要等真机才看得出来（本仓在"同一个量两处各算一遍"上栽过不止一次）。
 *
 * ⚠️ **不夹取**：点在图外（画面留白处）就照实算出 < 0 或 > 1 的值 ——
 * 由调用方决定"拒绝"（夹到边缘等于把一个框凭空钉在那儿，那是另一种错）。
 * 图片尺寸 / 缩放还没就绪时返回 `null`（那时点击没有意义，不许瞎算一个坐标写进文件）。
 */
export function normalizedPointFromCenterOffset(
  offset: AnchorOffset,
  metrics: ViewerImageMetrics
): { x: number; y: number } | null {
  const { naturalWidth, naturalHeight, scale, offsetX, offsetY } = metrics
  if (!Number.isFinite(offset?.x) || !Number.isFinite(offset?.y)) return null
  if (!Number.isFinite(naturalWidth) || !Number.isFinite(naturalHeight)) return null
  if (naturalWidth <= 0 || naturalHeight <= 0) return null
  if (!Number.isFinite(scale) || scale <= 0) return null
  const panX = Number.isFinite(offsetX) ? offsetX : 0
  const panY = Number.isFinite(offsetY) ? offsetY : 0
  return {
    x: (offset.x - panX) / (naturalWidth * scale) + 0.5,
    y: (offset.y - panY) / (naturalHeight * scale) + 0.5
  }
}

/** 图上一个手势该归谁（新增框 / 平移 / 不归我们）。 */
export type ImageGestureIntent = 'add-inside' | 'add-outside' | 'pan' | 'ignore'

/**
 * **手势归属判定**：点一下 vs 拖一下 vs 右键（第 5 批）。
 *
 * 刻意写成纯函数 —— 这三条最容易错，而且错了**是在改用户数据**
 * （"想平移却多出一个框"，框是要写进 txt 的），比界面难看严重得多：
 *
 * 1. **没开新增模式 ⇒ `ignore`**：这个手势不归我们，平移照旧（"平移是高频操作"这条守住了）；
 * 2. **左键**：位移越过阈值 ⇒ `pan`（**不算新增**）；没越过 ⇒ `add-inside`；
 *    ⚠️ 阈值**只走 {@link isDragGesture} 一处**，别在这里再定义第二个常量；
 * 3. **右键** ⇒ `add-outside`，**不看位移**（右键是一下"有意图"的动作，不是滑过）。
 */
export function decideImageGesture(options: {
  /** `MouseEvent.button`：0 = 左键、1 = 中键、2 = 右键。 */
  button: number
  dxPx: number
  dyPx: number
  /** 页头那枚"新增框"开关开着没有。 */
  addMode: boolean
}): ImageGestureIntent {
  if (!options?.addMode) return 'ignore'
  if (options.button === 2) return 'add-outside'
  if (options.button !== 0) return 'ignore'
  return isDragGesture(options.dxPx, options.dyPx) ? 'pan' : 'add-inside'
}
