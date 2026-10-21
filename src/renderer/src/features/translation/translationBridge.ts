/**
 * 译文通道出口（P1「译文对照」）。
 *
 * 与其它桥同一条规矩：**薄直通** —— 同样的参数交给同一条通道，
 * 不组装参数、不给默认值，而且**在调用时才读 `window.comicType`**（不抓模块级快照，
 * 否则测试里 `beforeEach` 换掉整个对象会让用例全部失联）。
 *
 * 唯一的加工是"把两种失败说成人话"，理由见下面两段注释。
 */
import type {
  ChapterTranslationCreateRequest,
  ChapterTranslationCreateResult,
  ChapterTranslationDeleteSaveRequest,
  ChapterTranslationDeleteSaveResult,
  ChapterTranslationExportRequest,
  ChapterTranslationExportResult,
  ChapterTranslationInsertSaveRequest,
  ChapterTranslationInsertSaveResult,
  ChapterTranslationReadResult,
  ChapterTranslationSaveRequest,
  ChapterTranslationSaveResult,
  ChapterTranslationUndoRequest,
  ChapterTranslationUndoResult
} from '@shared/chapter-translation'
import type {
  TranslationReviewDeleteRequest,
  TranslationReviewDeleteResult,
  TranslationReviewExportRequest,
  TranslationReviewExportResult,
  TranslationReviewListResult,
  TranslationReviewRecord,
  TranslationReviewSaveResult
} from '@shared/translation-review'

/**
 * ⚠️ **"界面是新的、后台还是旧的"**（本仓库 2026-10-05 现场撞到过一次）：
 * 本机在 WSL 上、项目在 `/mnt/d`（跨文件系统），文件监视不可靠 ——
 * 开发模式下渲染层由 Vite 现读源码，而 preload / main 走 `out/` 里的编译产物。
 * 于是新界面能打开、一调用新通道就报 `... is not a function`，用户看不懂也想不到要重启。
 * 别的先例（`useSourceRootEditor`）用的就是这句，这里保持一致。
 */
export const STALE_BACKEND_MESSAGE =
  '程序后台还是旧版本，请完全关闭程序后再重新启动一次（界面已更新，后台没有）'

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function errorResult(message: string): ChapterTranslationReadResult {
  return { status: 'error', file: null, txtCount: 0, message, document: null }
}

/**
 * 读这一话的 LabelPlus 译文。
 *
 * **永不抛**：三种结果（ok / not-found / error）都是"事实"，交给右栏照实显示。
 * 这不是"静默吞异常" —— 消息会落到界面上；只是不该让一次读目录失败把整个工作台掀翻。
 */
export async function readChapterTranslation(
  folderPath: string
): Promise<ChapterTranslationReadResult> {
  const api = window.comicType
  if (typeof api?.readChapterTranslation !== 'function') {
    return errorResult(STALE_BACKEND_MESSAGE)
  }
  try {
    return await api.readChapterTranslation(folderPath)
  } catch (error) {
    return errorResult(`读不了话目录：${describeError(error)}`)
  }
}

/**
 * 把译文改动写回那份 txt（P2）。
 *
 * **永不抛**：`conflict` / `invalid` / `io` 都是**正常结果** —— 界面照实说明并给出下一步
 * （重新读取 / 强制覆盖），而不是把一句 `Error: ...` 甩给用户。
 * 这条通道是整个程序里**唯一会写用户话目录文件**的，所以"写没写成"必须说清楚。
 */
export async function saveChapterTranslation(
  request: ChapterTranslationSaveRequest
): Promise<ChapterTranslationSaveResult> {
  const api = window.comicType
  if (typeof api?.saveChapterTranslation !== 'function') {
    return { ok: false, kind: 'io', message: STALE_BACKEND_MESSAGE }
  }
  try {
    return await api.saveChapterTranslation(request)
  } catch (error) {
    return { ok: false, kind: 'io', message: `保存失败：${describeError(error)}` }
  }
}

/**
 * **回退最近一次保存**（2026-10-07）。
 *
 * 与 `saveChapterTranslation` 走同一条通道的规矩：**永不抛** —— `conflict` / `invalid` / `io`
 * 都是正常结果（界面照实说人话），而不是把一句 `Error: ...` 甩给用户。
 *
 * ⚠️ "本会话还没保存过"也是走 `ok: false, kind: 'invalid'` 回来的（不是异常）：
 * 那是最常见的一种"没什么可退"，界面该把它当普通事实说，而不是当错误。
 */
export async function undoChapterTranslation(
  request: ChapterTranslationUndoRequest
): Promise<ChapterTranslationUndoResult> {
  const api = window.comicType
  if (typeof api?.undoChapterTranslation !== 'function') {
    return { ok: false, kind: 'io', message: STALE_BACKEND_MESSAGE }
  }
  try {
    return await api.undoChapterTranslation(request)
  } catch (error) {
    return { ok: false, kind: 'io', message: `回退失败：${describeError(error)}` }
  }
}

/**
 * 「新增框」**已有 txt**：把一条新条目插进去（第 5 批 5d-2）。
 *
 * 与 `saveChapterTranslation` 同一条规矩：**永不抛** —— `conflict` / `invalid` / `io`
 * 都是正常结果（界面照实说人话）。
 *
 * ⚠️ **旧版本后台**（preload 里没有这条）⇒ 说那句人话、且**什么都不写** ——
 * 这条路上"静默失败"的后果是"用户以为加上了、其实文件里没有"。
 */
export async function insertChapterTranslation(
  request: ChapterTranslationInsertSaveRequest
): Promise<ChapterTranslationInsertSaveResult> {
  const api = window.comicType
  if (typeof api?.insertChapterTranslation !== 'function') {
    return { ok: false, kind: 'io', message: STALE_BACKEND_MESSAGE }
  }
  try {
    return await api.insertChapterTranslation(request)
  } catch (error) {
    return { ok: false, kind: 'io', message: `新增失败：${describeError(error)}` }
  }
}

/**
 * 「新增框」**一份 txt 都没有**：在话目录里从零新建一份（第 5 批 5d-2）。
 *
 * 这一条的失败**绝不能静默**：它写的是用户目录里的**新文件** ——
 * 没写成而界面不吭声，用户会以为"已经有一份译文了"。
 */
export async function createChapterTranslation(
  request: ChapterTranslationCreateRequest
): Promise<ChapterTranslationCreateResult> {
  const api = window.comicType
  if (typeof api?.createChapterTranslation !== 'function') {
    return { ok: false, kind: 'io', message: STALE_BACKEND_MESSAGE }
  }
  try {
    return await api.createChapterTranslation(request)
  } catch (error) {
    return { ok: false, kind: 'io', message: `新建译文失败：${describeError(error)}` }
  }
}

/**
 * 「删除一条译文」（第 5 批 5e）。
 *
 * 与 `saveChapterTranslation` / `insertChapterTranslation` 同一条规矩：**永不抛** ——
 * `conflict` / `invalid` / `io` 都是正常结果（界面照实说人话）。
 *
 * ⚠️ **旧版本后台**（preload 里没有这条）⇒ 说那句人话、且**什么都不写**：
 * 这条路上"静默失败"的后果是"用户以为删掉了、其实文件里还在"。
 */
export async function deleteChapterTranslation(
  request: ChapterTranslationDeleteSaveRequest
): Promise<ChapterTranslationDeleteSaveResult> {
  const api = window.comicType
  if (typeof api?.deleteChapterTranslation !== 'function') {
    return { ok: false, kind: 'io', message: STALE_BACKEND_MESSAGE }
  }
  try {
    return await api.deleteChapterTranslation(request)
  } catch (error) {
    return { ok: false, kind: 'io', message: `删除失败：${describeError(error)}` }
  }
}

/**
 * 读这一话的校对记录（第 2 批）。
 *
 * **永不抛** —— 但**不把失败吞成"空"**：`ok: false` + 一句人话，
 * 因为"读不出来"与"这一话没校对过"在界面上长得一样（都没有铅笔图标），
 * 而后者会让用户以为记录丢了。读不出来就照实说。
 */
export async function listTranslationReviews(
  folderPath: string
): Promise<TranslationReviewListResult> {
  const api = window.comicType
  if (typeof api?.listTranslationReviews !== 'function') {
    return { ok: false, records: [], message: STALE_BACKEND_MESSAGE }
  }
  try {
    return await api.listTranslationReviews(folderPath)
  } catch (error) {
    return { ok: false, records: [], message: `读不了校对记录：${describeError(error)}` }
  }
}

/** 写一条校对记录。**永不抛**：写不进去也返回一句人话（界面照实说）。 */
export async function saveTranslationReview(
  record: TranslationReviewRecord
): Promise<TranslationReviewSaveResult> {
  const api = window.comicType
  if (typeof api?.saveTranslationReview !== 'function') {
    return { ok: false, message: STALE_BACKEND_MESSAGE }
  }
  try {
    return await api.saveTranslationReview(record)
  } catch (error) {
    return { ok: false, message: `校对记录存不进去：${describeError(error)}` }
  }
}

/**
 * 导出校对记录（弹「另存为」）。
 *
 * **永不抛**：用户取消是 `saved: false` 且没有 `error` —— 那是"正常结果"，
 * 界面不该为它弹一句红字。
 */
export async function exportTranslationReview(
  request: TranslationReviewExportRequest
): Promise<TranslationReviewExportResult> {
  const api = window.comicType
  if (typeof api?.exportTranslationReview !== 'function') {
    return { saved: false, error: STALE_BACKEND_MESSAGE }
  }
  try {
    return await api.exportTranslationReview(request)
  } catch (error) {
    return { saved: false, error: `导出失败：${describeError(error)}` }
  }
}

/**
 * 把**当前翻译另存一份**到用户选的位置（第 3 批）。
 *
 * **永不抛**：用户取消是 `kind: 'canceled'` 且 `message` 为空串 ——
 * 那是"正常结果"，界面不该为它弹一句红字。
 *
 * ⚠️ 与 `saveChapterTranslation` 是两件事：那条写的是**用户话目录里那份原件**，
 * 这条写的是**用户自己挑的位置**（不比对指纹、不留备份）。
 */
export async function exportChapterTranslation(
  request: ChapterTranslationExportRequest
): Promise<ChapterTranslationExportResult> {
  const api = window.comicType
  if (typeof api?.exportChapterTranslation !== 'function') {
    return { ok: false, kind: 'io', message: STALE_BACKEND_MESSAGE }
  }
  try {
    return await api.exportChapterTranslation(request)
  } catch (error) {
    return { ok: false, kind: 'io', message: `另存失败：${describeError(error)}` }
  }
}

/**
 * 删掉一条校对记录（第 4 批修：校对反悔）。
 *
 * **永不抛** —— 但**"删掉没有"要如实回答**：`deleted: false` 表示本来就没有这条。
 * ⚠️ 顺序由调用方保证：**先把原文写回 txt 成功了，再调这里**。
 */
export async function deleteTranslationReview(
  request: TranslationReviewDeleteRequest
): Promise<TranslationReviewDeleteResult> {
  const api = window.comicType
  if (typeof api?.deleteTranslationReview !== 'function') {
    return { ok: false, message: STALE_BACKEND_MESSAGE }
  }
  try {
    return await api.deleteTranslationReview(request)
  } catch (error) {
    return { ok: false, message: `删不掉这条校对记录：${describeError(error)}` }
  }
}
