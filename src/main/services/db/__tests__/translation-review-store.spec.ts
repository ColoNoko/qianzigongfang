// @vitest-environment node
/**
 * 校对记录表（`translation_review`）—— 译文栏改版第 2 批（2026-10-06）。
 *
 * 这里锁三件事：
 * 1. **写一条 → 读回来逐字段一致**（含页码、原文、校文、理由、时间）；
 * 2. **原文写一次就不再改** —— 这是这张表存在的理由，也是最容易写坏的一条：
 *    覆盖保存之后 txt 里已经没有原文了，库里这份是全项目唯一的一份；
 * 3. **话与话之间不串**（按话目录分区），且排序是"页码 → 条目序号"。
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { mkdir, rm } from 'node:fs/promises'
import { resolve } from 'node:path'

const DATABASE_ROOT = resolve(__dirname, '../../../../../.omo/fixtures/translation-review-test')

vi.mock('electron', () => ({
  app: { getPath: () => DATABASE_ROOT }
}))

import { closeDatabase } from '../../database'
import {
  deleteTranslationReview,
  listTranslationReviews,
  renumberTranslationReviews,
  saveTranslationReview
} from '../translation-review-store'
import type { TranslationReviewRecord } from '@shared/translation-review'

const FOLDER = 'D:\\漫画\\第1話'

function record(partial: Partial<TranslationReviewRecord> = {}): TranslationReviewRecord {
  return {
    folderPath: FOLDER,
    imageName: '20.jpg',
    labelIndex: 3,
    page: 2,
    originalText: '现在反悔 还来得及哦',
    reviewedText: '现在反悔已经来不及了',
    reason: '原文是命令句，语气要更硬',
    at: 1000,
    ...partial
  }
}

beforeAll(async () => {
  await rm(DATABASE_ROOT, { recursive: true, force: true })
  await mkdir(DATABASE_ROOT, { recursive: true })
})

afterAll(async () => {
  await closeDatabase()
  await rm(DATABASE_ROOT, { recursive: true, force: true })
})

it('写一条 → 读回来**逐字段一致**', async () => {
  await saveTranslationReview(record())
  const rows = await listTranslationReviews(FOLDER)
  expect(rows).toHaveLength(1)
  expect(rows[0]).toEqual({
    folderPath: 'd:/漫画/第1話', // 入库时过一遍归一（斜杠统一、去尾斜杠、转小写）
    imageName: '20.jpg',
    labelIndex: 3,
    page: 2,
    originalText: '现在反悔 还来得及哦',
    reviewedText: '现在反悔已经来不及了',
    reason: '原文是命令句，语气要更硬',
    at: 1000
  })
})

it('**原文写一次就不再改**（第二次校对只更新校文/理由/时间）', async () => {
  await saveTranslationReview(
    record({
      originalText: '（这是第二次传上来的"原文"，不许覆盖）',
      reviewedText: '第二次校对的稿子',
      reason: '第二版理由',
      at: 2000
    })
  )
  const rows = await listTranslationReviews(FOLDER)
  expect(rows).toHaveLength(1)
  // ⚠️ 这一格必须还是第一次那份：它已经不在 txt 里了，覆盖掉 = 真数据丢失
  expect(rows[0].originalText).toBe('现在反悔 还来得及哦')
  expect(rows[0].reviewedText).toBe('第二次校对的稿子')
  expect(rows[0].reason).toBe('第二版理由')
  expect(rows[0].at).toBe(2000)
})

it('键的口径：图名不分大小写、路径斜杠统一（写 `20.JPG\\` 读 `20.jpg` 是同一行）', async () => {
  await saveTranslationReview(record({ imageName: '  20.JPG  ', reviewedText: '同一行的更新' }))
  const rows = await listTranslationReviews('D:/漫画/第1話/')
  expect(rows).toHaveLength(1)
  expect(rows[0].reviewedText).toBe('同一行的更新')
  // 显示用的图名跟着最后一次写入走（定位用的是归一后的键）
  expect(rows[0].imageName).toBe('20.JPG')
})

it('话与话之间不串（按话目录分区）', async () => {
  await saveTranslationReview(record({ folderPath: 'D:\\漫画\\第2話', labelIndex: 7, at: 3000 }))
  const first = await listTranslationReviews(FOLDER)
  const second = await listTranslationReviews('D:\\漫画\\第2話\\')
  expect(first.map((row) => row.labelIndex)).toEqual([3])
  expect(second.map((row) => row.labelIndex)).toEqual([7])
})

it('同一话里按「页码 → 条目序号」排（导出的顺序就是它）', async () => {
  await saveTranslationReview(record({ labelIndex: 9, page: 1, imageName: '19.jpg', at: 4000 }))
  await saveTranslationReview(record({ labelIndex: 2, page: 5, imageName: '23.jpg', at: 5000 }))
  const rows = await listTranslationReviews(FOLDER)
  expect(rows.map((row) => [row.page, row.labelIndex])).toEqual([
    [1, 9],
    [2, 3],
    [5, 2]
  ])
})

it('读一个从没记过的话 ⇒ 空数组（不是"读不了"）', async () => {
  expect(await listTranslationReviews('D:\\漫画\\第99話')).toEqual([])
  expect(await listTranslationReviews('')).toEqual([])
})

it('缺定位信息 ⇒ 当场抛（宁可报错，也不要写出一行谁也定位不到的记录）', async () => {
  await expect(saveTranslationReview(record({ folderPath: '' }))).rejects.toThrow()
  await expect(saveTranslationReview(record({ imageName: '   ' }))).rejects.toThrow()
})

describe('第4批 · 删掉一条校对记录（校对反悔）', () => {
  // 每条例句用**自己的话目录**：这个文件里的用例共用一份库，
  // 拿同一个话目录会让"还剩几条"跟着别的用例的执行顺序变（那种用例改天必假红）。
  const FOLDER_A = 'D:\\漫画\\第4批-A'
  const FOLDER_B = 'D:\\漫画\\第4批-B'
  const FOLDER_C = 'D:\\漫画\\第4批-C'

  it('只删那一行，别的不动；返回"真删掉了吗"', async () => {
    await saveTranslationReview(record({ folderPath: FOLDER_A, imageName: 'a.jpg', labelIndex: 3 }))
    await saveTranslationReview(record({ folderPath: FOLDER_A, imageName: 'a.jpg', labelIndex: 7 }))

    expect(await deleteTranslationReview(FOLDER_A, 'a.jpg', 3)).toBe(true)
    const rows = await listTranslationReviews(FOLDER_A)
    expect(rows.map((row) => row.labelIndex)).toEqual([7])
  })

  it('本来就没有这条 ⇒ 返回 false（**不是错误**，界面不该为此报错）', async () => {
    expect(await deleteTranslationReview(FOLDER_A, 'a.jpg', 999)).toBe(false)
  })

  it('键的口径与写入一致：图名大小写 / 斜杠不同也删得掉', async () => {
    await saveTranslationReview(
      record({ folderPath: FOLDER_B, imageName: 'b.JPG', labelIndex: 11 })
    )
    expect(await deleteTranslationReview('D:/漫画/第4批-B/', '  b.jpg ', 11)).toBe(true)
    expect(await listTranslationReviews(FOLDER_B)).toEqual([])
  })

  it('缺定位信息 ⇒ false（不误删一整话）', async () => {
    await saveTranslationReview(record({ folderPath: FOLDER_C, imageName: 'c.jpg', labelIndex: 5 }))
    expect(await deleteTranslationReview('', 'c.jpg', 5)).toBe(false)
    expect(await deleteTranslationReview(FOLDER_C, '   ', 5)).toBe(false)
    expect((await listTranslationReviews(FOLDER_C)).map((row) => row.labelIndex)).toEqual([5])
  })
})

/**
 * **重排**（第 5 批 5e，2026-10-07）—— 删除一条译文之后，校对记录必须跟着挪。
 *
 * 为什么必须要它：`translation_review` 的主键是 `(话目录, 图名小写, 条目序号)`，
 * **序号是主键的一部分** ⇒ 删掉第 3 条之后，原第 4/5… 条不挪的话，
 * 记录就会**指向另一句话**（界面看是"某条目的校对记录凭空串到别条上"）。
 *
 * ⚠️ 主键换了就必须"删 + 插"两步 ⇒ **必须在一个事务里**：
 * 两步中间失败会留下**半挪**的记录（比不挪更难查）。
 */
describe('renumberTranslationReviews', () => {
  const FOLDER_R = 'D:\\漫画\\第5批-R'
  const FOLDER_OTHER = 'D:\\漫画\\第5批-R2'

  it('删掉第 3 条 ⇒ 大于 3 的那些序号 -1，第 3 条自己消失，其余字段**逐字段不变**', async () => {
    await saveTranslationReview(
      record({
        folderPath: FOLDER_R,
        imageName: 'r.jpg',
        labelIndex: 2,
        originalText: '不动的',
        reviewedText: '不动的校',
        reason: '',
        page: 1
      })
    )
    await saveTranslationReview(
      record({
        folderPath: FOLDER_R,
        imageName: 'r.jpg',
        labelIndex: 3,
        originalText: '要被删掉的原文',
        reviewedText: '要被删掉的校文',
        reason: '要被删掉的理由',
        page: 1
      })
    )
    await saveTranslationReview(
      record({
        folderPath: FOLDER_R,
        imageName: 'r.jpg',
        labelIndex: 4,
        originalText: '跟着挪的原文',
        reviewedText: '跟着挪的校文',
        reason: '跟着挪的理由',
        page: 2
      })
    )
    await saveTranslationReview(
      record({ folderPath: FOLDER_R, imageName: 'r.jpg', labelIndex: 5, page: 2 })
    )

    const moved = await renumberTranslationReviews(FOLDER_R, 'r.jpg', 3)

    expect(moved).toBe(2)
    const rows = await listTranslationReviews(FOLDER_R)
    expect(rows.map((row) => row.labelIndex)).toEqual([2, 3, 4])
    const movedThree = rows.find((row) => row.labelIndex === 3)
    // 挪过来的那条：**其余字段一个都不许变**（原文是独占数据，挪丢了就真没了）
    expect(movedThree).toMatchObject({
      originalText: '跟着挪的原文',
      reviewedText: '跟着挪的校文',
      reason: '跟着挪的理由',
      page: 2
    })
    // 被删那条连同它的原文一起走了
    expect(rows.some((row) => row.originalText === '要被删掉的原文')).toBe(false)
  })

  it('不影响**别的图**与**别的话**（只动这一张图的那一段）', async () => {
    await saveTranslationReview(
      record({ folderPath: FOLDER_R, imageName: 'r2.jpg', labelIndex: 4, originalText: '别的图' })
    )
    await saveTranslationReview(
      record({
        folderPath: FOLDER_OTHER,
        imageName: 'r.jpg',
        labelIndex: 4,
        originalText: '别的话'
      })
    )
    await saveTranslationReview(
      record({ folderPath: FOLDER_R, imageName: 'r.jpg', labelIndex: 4, originalText: '本图的' })
    )

    await renumberTranslationReviews(FOLDER_R, 'r.jpg', 3)

    const others = await listTranslationReviews(FOLDER_R)
    expect(others.find((row) => row.imageName === 'r2.jpg')?.labelIndex).toBe(4)
    const otherChapter = await listTranslationReviews(FOLDER_OTHER)
    expect(otherChapter[0]?.labelIndex).toBe(4)
  })

  it('表里本来就没有 > 被删序号的那些 ⇒ 返回 0（不是错误）', async () => {
    await saveTranslationReview(
      record({
        folderPath: FOLDER_R,
        imageName: 'r3.jpg',
        labelIndex: 1,
        originalText: '只有这一条'
      })
    )
    expect(await renumberTranslationReviews(FOLDER_R, 'r3.jpg', 5)).toBe(0)
    // 被删序号之下的那些**不动**
    expect((await listTranslationReviews(FOLDER_R)).some((row) => row.labelIndex === 1)).toBe(true)
  })

  it('缺定位信息 ⇒ 0（不误动一整话）', async () => {
    expect(await renumberTranslationReviews('', 'r.jpg', 1)).toBe(0)
    expect(await renumberTranslationReviews(FOLDER_R, '  ', 1)).toBe(0)
    expect(await renumberTranslationReviews(FOLDER_R, 'r.jpg', 0)).toBe(0)
  })
})
