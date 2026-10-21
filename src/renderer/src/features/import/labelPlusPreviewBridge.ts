/**
 * 「LabelPlus 预览窗」那两条通道的渲染侧适配层（P7 之五，2026-10-05）。
 *
 * 预览窗是**独立的一个 BrowserWindow**，它自己不碰导入页那套表单，
 * 只按 sessionId 取"这一页要画什么"。所以与 `importBridge` 分开放。
 */
import type { LabelPlusPreviewPage, LabelPlusPreviewSessionInfo } from '@shared/labelplus-import'

/** 取一次预览会话（原图 + 译文行 + 该从第几页开始）。 */
export function getLabelPlusPreviewSession(
  sessionId: string
): Promise<LabelPlusPreviewSessionInfo | null> {
  return window.comicType.getLabelPlusPreviewSession(sessionId)
}

/** 按需取某一页（翻页时现取，避免一次性把所有页都渲染出来）。 */
export function getLabelPlusPreviewPage(
  sessionId: string,
  index: number
): Promise<LabelPlusPreviewPage> {
  return window.comicType.getLabelPlusPreviewPage(sessionId, index)
}
