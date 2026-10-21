// @vitest-environment node
/**
 * 校对记录的**纯规则**（译文栏改版第 2 批）—— 导出格式、漏翻那句话、键的归一口径。
 *
 * 这一组全部是"不碰文件系统、不碰数据库"的纯函数，所以能**逐字**锁住：
 * 导出文件是**发给别人看的**，格式差一个字就得多一次来回解释；
 * 而"原文为空 ⇒ 写哪句话"这种文案，界面与导出**必须是同一句**（同一个出处）。
 */
import { describe, expect, it } from 'vitest'
import {
  REVIEW_MISSING_ORIGINAL,
  buildTranslationReviewExport,
  displayReviewOriginal,
  formatReviewExportTime,
  normalizeReviewFolder,
  normalizeReviewImage,
  paneModeForWorkMode,
  reviewKey,
  translationReviewExportFileName
} from '../translation-review'

/** 时间固定成本地时间构造 ⇒ 断言与运行机器的时区无关。 */
function fixedTime(): number {
  return new Date(2026, 9, 6, 20, 15, 30).getTime()
}

describe('第2批 · 漏翻那句文案：一个出处，界面与导出共用', () => {
  it('原文为空 / 只有空白 ⇒ 恰好是那一句（不是空串，也不是"未填写"）', () => {
    expect(displayReviewOriginal('')).toBe(REVIEW_MISSING_ORIGINAL)
    expect(displayReviewOriginal('   ')).toBe(REVIEW_MISSING_ORIGINAL)
    expect(displayReviewOriginal('\n\t ')).toBe(REVIEW_MISSING_ORIGINAL)
    expect(displayReviewOriginal(null)).toBe(REVIEW_MISSING_ORIGINAL)
    expect(displayReviewOriginal(undefined)).toBe(REVIEW_MISSING_ORIGINAL)
    expect(REVIEW_MISSING_ORIGINAL).toBe('（无 —— 翻译漏了这处）')
  })

  it('原文非空 ⇒ 原样（只去首尾空白，与清单里的口径一致）', () => {
    expect(displayReviewOriginal('  台词  ')).toBe('台词')
    expect(displayReviewOriginal('多行\n台词')).toBe('多行\n台词')
  })
})

describe('第2批 · 导出文本（逐字锁）', () => {
  const entries = [
    {
      page: 3,
      imageName: 'page_002.jpg',
      originalText: '难道是我说错话了?',
      reviewedText: '难道是我说错话了吗?',
      reason: '语气太硬'
    },
    {
      page: 5,
      imageName: 'page_003.jpg',
      originalText: '',
      reviewedText: '补一句',
      reason: ''
    }
  ]

  it('文件头四行 + 每条三行式 + 条间空行 + 结尾一个换行（**逐字**）', () => {
    const text = buildTranslationReviewExport({
      workTitle: 'ドラゴンボール',
      chapterTitle: '第1集',
      exportedAt: fixedTime(),
      entries
    })
    expect(text).toBe(
      [
        '作品：ドラゴンボール',
        '话：第1集',
        '时间：2026-10-06 20:15',
        '已校：2 条',
        '',
        '第3页·page_002.jpg',
        '翻：难道是我说错话了?',
        '校：难道是我说错话了吗?',
        '评：语气太硬',
        '',
        '第5页·page_003.jpg',
        '翻：（无 —— 翻译漏了这处）',
        '校：补一句',
        ''
      ].join('\n')
    )
  })

  it('**无评不写「评：」那一行**（不是写一行空的）', () => {
    const text = buildTranslationReviewExport({
      workTitle: '作品',
      chapterTitle: '第1集',
      exportedAt: fixedTime(),
      entries
    })
    // 只有第一条带理由 ⇒ 整份文本里「评：」恰好出现一次
    expect(text.split('评：')).toHaveLength(2)
    // 第二条（没理由）后面直接就是结尾，没有"评："那一行
    expect(text.endsWith('校：补一句\n')).toBe(true)
  })

  it('一条都没有 ⇒ 只有文件头（条数写 0），不编造内容', () => {
    expect(
      buildTranslationReviewExport({
        workTitle: '作品',
        chapterTitle: '第1集',
        exportedAt: fixedTime(),
        entries: []
      })
    ).toBe('作品：作品\n话：第1集\n时间：2026-10-06 20:15\n已校：0 条\n')
  })

  it('导出的时间是**本机本地时间** `YYYY-MM-DD HH:mm`（个位补零）', () => {
    expect(formatReviewExportTime(new Date(2026, 0, 2, 3, 4).getTime())).toBe('2026-01-02 03:04')
  })

  it('作品名里的换行与空白不会把文件头撑坏（每行一个事实）', () => {
    const text = buildTranslationReviewExport({
      workTitle: '  作品  ',
      chapterTitle: '\t第1集 ',
      exportedAt: fixedTime(),
      entries: []
    })
    expect(text.split('\n')[0]).toBe('作品：作品')
    expect(text.split('\n')[1]).toBe('话：第1集')
  })
})

describe('第2批 · 键的归一口径（读写两侧必须同一套）', () => {
  it('话目录：斜杠统一、去尾斜杠、转小写（Windows 路径本来就不分大小写）', () => {
    expect(normalizeReviewFolder('D:\\漫画\\第1話\\')).toBe('d:/漫画/第1話')
    expect(normalizeReviewFolder('  D:/漫画/第1話  ')).toBe('d:/漫画/第1話')
    expect(normalizeReviewFolder(null)).toBe('')
  })

  it('图名：不分大小写（与"这一页对应哪条译文"的匹配口径一致）', () => {
    expect(normalizeReviewImage(' 20.JPG ')).toBe('20.jpg')
    expect(normalizeReviewImage(null)).toBe('')
  })

  it('同一格（目录 / 图名大小写与斜杠不同）算出**同一个键**', () => {
    expect(reviewKey('D:\\漫画\\第1話\\', '20.JPG', 3)).toBe(
      reviewKey('d:/漫画/第1話', '20.jpg', 3)
    )
    // 不同格则不同键（序号差 1 也要分开）
    expect(reviewKey('D:/漫画/第1話', '20.jpg', 3)).not.toBe(
      reviewKey('D:/漫画/第1話', '20.jpg', 4)
    )
    expect(reviewKey('D:/漫画/第1話', '20.jpg', 3)).not.toBe(
      reviewKey('D:/漫画/第2話', '20.jpg', 3)
    )
  })
})

describe('第2批 · 另存为的默认文件名', () => {
  it('作品-话-校对记录.txt', () => {
    expect(translationReviewExportFileName('ドラゴンボール', '第1集')).toBe(
      'ドラゴンボール-第1集-校对记录.txt'
    )
  })

  it('洗掉 Windows 文件名里的非法字符（作品名里带 `?` `:` 很常见）', () => {
    expect(translationReviewExportFileName('这作品?真的:好看', '第1集')).toBe(
      '这作品_真的_好看-第1集-校对记录.txt'
    )
    expect(translationReviewExportFileName('a/b\\c*d', 'e')).toBe('a_b_c_d-e-校对记录.txt')
  })

  it('没有作品名也照样是个能用的文件名', () => {
    expect(translationReviewExportFileName('', '第1集')).toBe('第1集-校对记录.txt')
    expect(translationReviewExportFileName('', '')).toBe('校对记录.txt')
  })
})

describe('第2批 · 档位与四模式的联动规则', () => {
  it('只有「校对」工序落到校对档，其余三档都在翻译档', () => {
    expect(paneModeForWorkMode('proofread')).toBe('review')
    expect(paneModeForWorkMode('translated')).toBe('translate')
    expect(paneModeForWorkMode('typeset')).toBe('translate')
    expect(paneModeForWorkMode('supervised')).toBe('translate')
    // 还没读到模式（首帧）也算翻译档，不猜
    expect(paneModeForWorkMode(null)).toBe('translate')
    expect(paneModeForWorkMode(undefined)).toBe('translate')
  })
})
