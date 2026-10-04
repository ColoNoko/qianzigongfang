/**
 * thumb-scale —— 缩略图的尺寸规则（D1）。
 *
 * 以前缩略图是**按原生尺寸**画成 PNG data URL 的：实测一页 1062×1500 的图，
 * 缩略图约 1.0–1.4 MB，转成 base64 再 +33% → **每页 1.3–1.9 MB 常驻内存**；
 * 一话 38 页就是 50–70 MB（PSD 的话更大）。而网格里的卡片图片区只有 162×208 —— 
 * 多出来的像素一个都用不上，纯粹占内存、还拖慢长话的滚动。
 *
 * 这里只做"算尺寸"这一件纯事（可表格单测）；真正画到 canvas 的活儿在组件里。
 */

/** 缩略图最长边（px）。360 是给 162×208 的卡片留了 ~2× 的余量（高分屏也不糊）。 */
export const THUMB_MAX_EDGE = 360

/**
 * 小于这个长度的 data URL 不折腾降采样。
 *
 * 既是性能考虑（小图没必要），也是**测试安全阀**：jsdom 里 `new Image()` 不会真的解码，
 * 一旦去等 load/error 就会挂住用例。真实照片的 data URL 远大于它。
 */
export const DOWNSCALE_MIN_LENGTH = 300_000

export interface PixelSize {
  width: number
  height: number
}

/**
 * 按"最长边不超过 maxEdge"等比缩小；本来就够小（或参数不合法）时原样返回。
 * 返回的宽高一定是 ≥1 的整数 —— canvas 不接受 0 或小数。
 */
export function fitWithin(width: number, height: number, maxEdge = THUMB_MAX_EDGE): PixelSize {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return { width: 0, height: 0 }
  }
  const longest = Math.max(width, height)
  if (!Number.isFinite(maxEdge) || maxEdge <= 0 || longest <= maxEdge) {
    return { width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)) }
  }
  const scale = maxEdge / longest
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale))
  }
}

