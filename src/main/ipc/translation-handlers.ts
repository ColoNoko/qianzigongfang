import { ipcMain } from 'electron'
import { dirname } from 'node:path'
import { readChapterTranslation } from '../services/chapter-translation'
import {
  createChapterTranslation,
  deleteChapterTranslation,
  insertChapterTranslation,
  saveChapterTranslation,
  undoChapterTranslation,
  type ChapterTranslationWriteEffects
} from '../services/chapter-translation-write'
import { exportChapterTranslation } from '../services/chapter-translation-export'
import {
  deleteTranslationReview,
  listTranslationReviews,
  renumberTranslationReviews,
  restoreTranslationReviewSnapshot,
  snapshotTranslationReviews,
  saveTranslationReview,
  type TranslationReviewScope
} from '../services/db/translation-review-store'
import { exportTranslationReviewFile } from '../services/translation-review-export'
import type {
  ChapterTranslationCreateRequest,
  ChapterTranslationDeleteSaveRequest,
  ChapterTranslationExportRequest,
  ChapterTranslationInsertSaveRequest,
  ChapterTranslationSaveRequest,
  ChapterTranslationUndoRequest
} from '@shared/chapter-translation'
import type {
  TranslationReviewDeleteRequest,
  TranslationReviewExportRequest,
  TranslationReviewRecord
} from '@shared/translation-review'

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
// Keep file writes, undo, and review mutations ordered across simultaneous IPC calls.
let pendingMutation: Promise<unknown> = Promise.resolve()
function serializeMutation<T>(work: () => Promise<T>): Promise<T> {
  const result = pendingMutation.then(work)
  pendingMutation = result.catch(() => undefined)
  return result
}

async function reviewEffects(
  folderPath: string,
  scopes: TranslationReviewScope[],
  apply?: () => Promise<void>
): Promise<ChapterTranslationWriteEffects> {
  const snapshot = await snapshotTranslationReviews(folderPath, scopes)
  return { apply, undo: () => restoreTranslationReviewSnapshot(snapshot) }
}

export function registerTranslationHandlers(): void {
  // P1「译文对照」：工作台在翻译/校对模式下要看这一话的译文。
  // 与导入那条链**不共用输入**（那边是用户现选 txt/zip），这里只看"话自己的目录"。
  ipcMain.handle('comicType:readChapterTranslation', async (_, folderPath: string) =>
    readChapterTranslation(folderPath)
  )

  // P2：把译文改动写回那份 txt。**全项目唯一会写用户话目录文件的通道。**
  // 安全语义（冲突拒绝 / 写前备份 / 原子替换 / 写后回读）都在服务里，这里只是接线。
  ipcMain.handle(
    'comicType:saveChapterTranslation',
    async (_, request: ChapterTranslationSaveRequest) =>
      serializeMutation(() =>
        saveChapterTranslation(request, () =>
          reviewEffects(
            dirname(request.filePath.trim()),
            (Array.isArray(request.edits) ? request.edits : [])
              .filter((edit) => edit.text !== undefined)
              .map(({ imageName, labelIndex }) => ({ imageName, labelIndex }))
          )
        )
      )
  )

  // 2026-10-07：**回退最近一次保存**。同样会写话目录，所以走上面同一个服务
  // （安全网一字不差：指纹比对 / 写前备份 / 原子替换 / 写后回读）。
  // 与"保存"的唯一区别是"要写回去的内容"取自主进程**会话内的内存堆栈** ⇒ 重启即失效。
  ipcMain.handle(
    'comicType:undoChapterTranslation',
    async (_, request: ChapterTranslationUndoRequest) =>
      serializeMutation(() => undoChapterTranslation(request))
  )

  // 第 3 批：把**当前翻译另存一份**到用户选的位置。
  // 与上面那条**分得很清**：这条不写话目录（写的是用户自己挑的位置），
  // 所以不比对基指纹、也不留备份 —— 但仍然是原子写 + 写后回读。
  ipcMain.handle(
    'comicType:exportChapterTranslation',
    async (_, request: ChapterTranslationExportRequest) => exportChapterTranslation(request)
  )

  // 第 5 批「新增框」5d-2：两条**会写用户话目录**的通道（页面这一半的接线）。
  // ① 这一话**已经有**可解析的 txt ⇒ 走插入（与「保存」共用同一段安全网，所以 Ctrl+Z 能撤）；
  // ② **一份都没有** ⇒ 在话目录里从零新建一份（`{话文件夹名}.txt`，同名 `-2`…，**绝不覆盖**）。
  // ⚠️ 这两条**只接线** —— 服务的实现与安全网在 `chapter-translation-write.ts`（5d-1 已写完、已有锁）。
  // 哪一条走哪边由**宿主**按 `readChapterTranslation` 的结果决定（有 txt 走插入、没有走新建），
  // 主进程不猜、渲染层也不猜。
  ipcMain.handle(
    'comicType:insertChapterTranslation',
    async (_, request: ChapterTranslationInsertSaveRequest) =>
      serializeMutation(() =>
        insertChapterTranslation(request, ({ insertedIndex }) =>
          reviewEffects(dirname(request.filePath.trim()), [
            { imageName: request.insert.imageName, labelIndex: insertedIndex }
          ])
        )
      )
  )
  ipcMain.handle(
    'comicType:createChapterTranslation',
    async (_, request: ChapterTranslationCreateRequest) =>
      serializeMutation(() =>
        createChapterTranslation(request, request.insert ? ({ insertedIndex }) =>
          reviewEffects(request.folderPath, [
            { imageName: request.insert!.imageName, labelIndex: insertedIndex }
          ]) : undefined
        )
      )
  )

  // TXT and reviews share one undo entry. Reviews are keyed by chapter directory,
  // never by the TXT filename, and renumbering runs only after a real file change.
  ipcMain.handle(
    'comicType:deleteChapterTranslation',
    async (_, request: ChapterTranslationDeleteSaveRequest) =>
      serializeMutation(() =>
        deleteChapterTranslation(request, () =>
          reviewEffects(
            dirname(request.filePath.trim()),
            [{ imageName: request.delete.imageName, fromLabelIndex: request.delete.labelIndex }],
            async () => {
              await renumberTranslationReviews(
                dirname(request.filePath.trim()),
                request.delete.imageName,
                request.delete.labelIndex
              )
            }
          )
        )
      )
  )

  // 第 2 批：校对记录（App 数据库里那张 `translation_review`）。
  // 与上面那两条**分得很清**：这两条只动我们自己的库，**一个字节都不写用户话目录**。
  ipcMain.handle('comicType:listTranslationReviews', async (_, folderPath: string) => {
    try {
      return {
        ok: true,
        records: await serializeMutation(() => listTranslationReviews(folderPath)),
        message: ''
      }
    } catch (error) {
      // "读不出来"与"这一话没校对过"必须分得开 —— 否则界面会假报"一条都没校对"，
      // 而用户会以为自己的记录丢了。
      return { ok: false, records: [], message: `读不了校对记录：${describeError(error)}` }
    }
  })

  ipcMain.handle('comicType:saveTranslationReview', async (_, record: TranslationReviewRecord) => {
    try {
      await serializeMutation(() => saveTranslationReview(record))
      return { ok: true }
    } catch (error) {
      return { ok: false, message: `校对记录存不进去：${describeError(error)}` }
    }
  })

  // 第 4 批修：删一条校对记录（"这条我不算校对过"）。
  // ⚠️ 界面**先**把原文写回 txt 成功、**再**发这一条；这里只删库，一个字节都不碰话目录。
  ipcMain.handle(
    'comicType:deleteTranslationReview',
    async (_, request: TranslationReviewDeleteRequest) => {
      try {
        const deleted = await serializeMutation(() =>
          deleteTranslationReview(request?.folderPath, request?.imageName, request?.labelIndex)
        )
        return { ok: true, deleted }
      } catch (error) {
        return { ok: false, message: `删不掉这条校对记录：${describeError(error)}` }
      }
    }
  )

  // 导出：只弹「另存为」写用户选的位置，**不写话目录**（本批不新增那条路径）。
  ipcMain.handle(
    'comicType:exportTranslationReview',
    async (_, request: TranslationReviewExportRequest) => exportTranslationReviewFile(request)
  )
}
