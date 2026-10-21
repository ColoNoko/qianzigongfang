import { getDatabase } from './connection'
import {
  normalizeReviewFolder,
  normalizeReviewImage,
  type TranslationReviewRecord
} from '@shared/translation-review'

/**
 * 校对记录表（`translation_review`）的薄封装 —— 译文栏改版第 2 批（2026-10-06）。
 *
 * 照 `project-memory-store.ts` 的写法：只管这一张表的读写，**不塞进 connection.ts**
 * （那里管"库怎么打开"，不管"领域问题"）。建表在 `connection.ts` 的 `createSchema()`。
 *
 * ## 这里唯一一条不能违反的规矩：**原文写一次就不再改**
 *
 * upsert 的 `DO UPDATE` 里**故意不列 `original_text`**。理由不是洁癖：
 * 覆盖保存之后，原文在 txt 里**已经不存在了**，库里这份是全项目唯一的一份。
 * 第二次校对此格时若把它一起覆盖，丢的就是**真数据**（用户再也看不到"原来翻的是什么"）。
 * 所以这条不是"记得带上"，而是**结构上不可能写坏**。
 *
 * ## 键归一
 *
 * 读写都过 `normalizeReviewFolder` / `normalizeReviewImage`：路径斜杠与图名大小写
 * 归一之后才是同一个键 —— 否则"写进去读不回来"这类错会以"图标偶尔不出现"的形式出现，
 * 很难查。
 */

interface ReviewRow {
  folder_path: string
  image_name: string
  label_index: number
  page: number
  original_text: string
  reviewed_text: string
  reason: string
  at: number
}

function toRecord(row: ReviewRow): TranslationReviewRecord {
  return {
    folderPath: row.folder_path,
    imageName: row.image_name,
    labelIndex: row.label_index,
    page: row.page,
    originalText: row.original_text,
    reviewedText: row.reviewed_text,
    reason: row.reason,
    at: row.at
  }
}

/** 这一话的全部校对记录，按页码 + 条目序号排（导出的顺序就是它）。 */
export async function listTranslationReviews(
  folderPath: string
): Promise<TranslationReviewRecord[]> {
  const folder = normalizeReviewFolder(folderPath)
  if (!folder) return []
  const database = await getDatabase()
  const rows = database
    .prepare(
      `
      SELECT folder_path, image_name, label_index, page, original_text, reviewed_text, reason, at
      FROM translation_review
      WHERE folder_path = ?
      ORDER BY page ASC, label_index ASC, image_key ASC
    `
    )
    .all(folder) as unknown as ReviewRow[]
  return rows.map(toRecord)
}

/**
 * 写一条（有则更新）。**原文只在第一次写入时落库**（见文件头）。
 *
 * 单条 SQL 自带事务性，不需要显式 BEGIN —— 这里没有"多条之间要么全成要么全不成"的东西。
 */
export async function saveTranslationReview(record: TranslationReviewRecord): Promise<void> {
  const folder = normalizeReviewFolder(record.folderPath)
  const imageKey = normalizeReviewImage(record.imageName)
  const labelIndex = Math.trunc(Number(record.labelIndex))
  if (!folder || !imageKey || !Number.isFinite(labelIndex)) {
    throw new Error('校对记录缺少定位信息（话目录 / 图名 / 条目序号）')
  }
  const database = await getDatabase()
  database
    .prepare(
      `
      INSERT INTO translation_review
        (folder_path, image_key, label_index, image_name, page, original_text, reviewed_text, reason, at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(folder_path, image_key, label_index) DO UPDATE SET
        image_name = excluded.image_name,
        page = excluded.page,
        reviewed_text = excluded.reviewed_text,
        reason = excluded.reason,
        at = excluded.at
    `
    )
    .run(
      folder,
      imageKey,
      labelIndex,
      String(record.imageName ?? '').trim(),
      Math.max(0, Math.trunc(Number(record.page) || 0)),
      String(record.originalText ?? ''),
      String(record.reviewedText ?? ''),
      String(record.reason ?? ''),
      Number.isFinite(record.at) ? Math.trunc(record.at) : Date.now()
    )
}

/**
 * 删掉一条校对记录（"这条我不算校对过"）。返回**真的删掉了一行吗**。
 *
 * ⚠️ 这一格是**唯一**存着"校对前的原文"的地方（覆盖保存后 txt 里就没有它了）。
 * 所以**界面必须先确认"原文已经写回 txt"再调它** —— 顺序反了就等于把原文彻底丢掉。
 * 这里不替调用方判断顺序（那是流程的事），只如实回答"删掉没有"：
 * `false` = 本来就没有这条（不是错误，界面不该为此报错）。
 */
/**
 * **重排校对记录**（第 5 批 5e，2026-10-07）—— 删掉某一条译文之后，把同一张图里
 * 序号大于它的那些记录**整体 -1**，并**删掉被删那一条自己的记录**。
 *
 * ## 为什么必须迁移（不是"可选的好习惯"）
 *
 * 主键是 `(话目录, 图名小写, 条目序号)` —— **序号是主键的一部分**，而界面上的条目序号
 * 在删除后是**重排过的**（不留空号）。不迁移的话，记录会挂在旧序号上，
 * 于是**指向另一句话**（"某条目的校对记录凭空串到别条上"）。
 *
 * ## 为什么必须在一个事务里
 *
 * 主键换了就只能"删 + 插"两步 ⇒ 两步之间失败会留下**半挪**的记录：
 * 一部分已经 -1、一部分还是旧序号 —— 那种状态在界面上表现为"有的条目有记录、有的没有"，
 * 比"完全没挪"更难查。`BEGIN IMMEDIATE` 在本仓已有三处先例（`project-repository` 等）。
 *
 * ## 三条边界
 *
 * · **只动这一张图**（`image_key` 一起匹配）—— 别的图、别的话一条都不许碰；
 * · 被删序号**之上**的那些（`> deletedIndex`）才挪；之下与它自己之外的一律不动；
 * · 缺定位信息 / 序号非法 ⇒ 返回 `0`，**一条都不动**（不误动一整话）。
 *
 * 返回**真的挪了几条**（0 = 本来就没有要挪的，不是错误）。
 */
export async function renumberTranslationReviews(
  folderPath: string,
  imageName: string,
  deletedIndex: number
): Promise<number> {
  const folder = normalizeReviewFolder(folderPath)
  const imageKey = normalizeReviewImage(imageName)
  const removed = Math.trunc(Number(deletedIndex))
  if (!folder || !imageKey || !Number.isFinite(removed) || removed <= 0) return 0

  const database = await getDatabase()
  database.exec('BEGIN IMMEDIATE')
  try {
    // 先读：这一张图的全部记录（含"要被删掉的那一条"）
    const rows = database
      .prepare(
        `
        SELECT label_index, image_name, page, original_text, reviewed_text, reason, at
        FROM translation_review
        WHERE folder_path = ? AND image_key = ?
      `
      )
      .all(folder, imageKey) as Array<{
      label_index: number
      image_name: string
      page: number
      original_text: string
      reviewed_text: string
      reason: string
      at: number
    }>

    // 要保留的 = 除"被删那一条"之外的（其余字段原样带着走）
    const kept = rows.filter((row) => row.label_index !== removed)
    const movedCount = kept.filter((row) => row.label_index > removed).length

    // 删掉这一张图的全部，再按新序号整批插回（主键变了，只能这么挪）
    database
      .prepare('DELETE FROM translation_review WHERE folder_path = ? AND image_key = ?')
      .run(folder, imageKey)
    const insert = database.prepare(`
      INSERT INTO translation_review
        (folder_path, image_key, label_index, image_name, page, original_text, reviewed_text, reason, at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    for (const row of kept) {
      const nextIndex = row.label_index > removed ? row.label_index - 1 : row.label_index
      insert.run(
        folder,
        imageKey,
        nextIndex,
        row.image_name,
        row.page,
        row.original_text,
        row.reviewed_text,
        row.reason,
        row.at
      )
    }

    database.exec('COMMIT')
    return movedCount
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
}

export async function deleteTranslationReview(
  folderPath: string,
  imageName: string,
  labelIndex: number
): Promise<boolean> {
  const folder = normalizeReviewFolder(folderPath)
  const imageKey = normalizeReviewImage(imageName)
  const index = Math.trunc(Number(labelIndex))
  if (!folder || !imageKey || !Number.isFinite(index)) return false
  const database = await getDatabase()
  const result = database
    .prepare(
      `
      DELETE FROM translation_review
      WHERE folder_path = ? AND image_key = ? AND label_index = ?
    `
    )
    .run(folder, imageKey, index)
  return Number(result.changes) > 0
}

/** Select one label, or the suffix renumbered by a deletion (including its removed row). */
export interface TranslationReviewScope {
  imageName: string
  labelIndex?: number
  fromLabelIndex?: number
}

export interface TranslationReviewSnapshot {
  folderPath: string
  scopes: TranslationReviewScope[]
  records: TranslationReviewRecord[]
}

function isInReviewScope(record: TranslationReviewRecord, scope: TranslationReviewScope): boolean {
  return (
    normalizeReviewImage(record.imageName) === normalizeReviewImage(scope.imageName) &&
    (scope.labelIndex === undefined || record.labelIndex === scope.labelIndex) &&
    (scope.fromLabelIndex === undefined || record.labelIndex >= scope.fromLabelIndex)
  )
}

/** Capture only rows affected by this write, including the absence of a review. */
export async function snapshotTranslationReviews(
  folderPath: string,
  scopes: readonly TranslationReviewScope[]
): Promise<TranslationReviewSnapshot> {
  const folder = normalizeReviewFolder(folderPath)
  const selected = scopes.map((scope) => ({
    ...scope,
    imageName: normalizeReviewImage(scope.imageName)
  }))
  if (
    !folder ||
    selected.some(
      (scope) =>
        !scope.imageName ||
        (scope.labelIndex !== undefined &&
          (!Number.isInteger(scope.labelIndex) || scope.labelIndex <= 0)) ||
        (scope.fromLabelIndex !== undefined &&
          (!Number.isInteger(scope.fromLabelIndex) || scope.fromLabelIndex <= 0))
    )
  ) {
    throw new Error('校对快照缺少有效的定位信息')
  }
  const records = selected.length ? await listTranslationReviews(folder) : []
  return {
    folderPath: folder,
    scopes: selected,
    records: records.filter((record) => selected.some((scope) => isInReviewScope(record, scope)))
  }
}

/** Restore exact original text/reason/timestamps atomically; normal upsert preserves originals. */
export async function restoreTranslationReviewSnapshot(
  snapshot: TranslationReviewSnapshot
): Promise<void> {
  if (!snapshot.scopes.length) return
  const database = await getDatabase()
  database.exec('BEGIN IMMEDIATE')
  try {
    for (const scope of snapshot.scopes) {
      if (scope.fromLabelIndex !== undefined) {
        database
          .prepare(
            'DELETE FROM translation_review WHERE folder_path = ? AND image_key = ? AND label_index >= ?'
          )
          .run(snapshot.folderPath, normalizeReviewImage(scope.imageName), scope.fromLabelIndex)
      } else if (scope.labelIndex === undefined) {
        database
          .prepare('DELETE FROM translation_review WHERE folder_path = ? AND image_key = ?')
          .run(snapshot.folderPath, normalizeReviewImage(scope.imageName))
      } else {
        database
          .prepare(
            'DELETE FROM translation_review WHERE folder_path = ? AND image_key = ? AND label_index = ?'
          )
          .run(snapshot.folderPath, normalizeReviewImage(scope.imageName), scope.labelIndex)
      }
    }
    const insert = database.prepare(`
      INSERT INTO translation_review
        (folder_path, image_key, label_index, image_name, page, original_text, reviewed_text, reason, at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    for (const record of snapshot.records) {
      insert.run(
        snapshot.folderPath,
        normalizeReviewImage(record.imageName),
        record.labelIndex,
        record.imageName,
        record.page,
        record.originalText,
        record.reviewedText,
        record.reason,
        record.at
      )
    }
    database.exec('COMMIT')
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
}
