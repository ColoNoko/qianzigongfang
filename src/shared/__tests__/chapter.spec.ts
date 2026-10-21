import { describe, expect, it } from 'vitest'
import {
  compareChapterNumbers,
  compareChapterNumbersByOrder,
  extractChapterNumber,
  inferChapterAndTitle,
  normalizeChapterNumber,
  formatChapterNumber,
  isValidChapterNumber,
  sanitizeChapterInput,
  splitChapterIdentity
} from '../chapter'

describe('chapter number helpers', () => {
  it('extracts unambiguous chapter numbers from common folder names', () => {
    expect(extractChapterNumber('七龙珠003')).toBe('3')
    expect(extractChapterNumber('第001.50話')).toBe('1.5')
    expect(extractChapterNumber('作品名')).toBe('')
  })

  it.each([
    ['[02]', '2'], ['[13]', '13'], ['【０３】', '3'], ['(004.5)', '4.5'],
    ['第二话xxxx', '2'], ['第三话', '3'], ['第十二话 完', '12'],
    ['第2话 xxxx', '2'], ['xxxx 第2话', '2'], ['第2话 完结 1080p', '2'],
    ['2025-10-02 第三话 完', '3'], ['姊烦10.1 0101~0110', '10.1'],
    ['第一百零二话', '102'], ['第两百三十六話', '236'], ['第壹佰貳拾叁回', '123'],
    ['第一千零一章', '1001'], ['第二〇三话', '203'], ['第零话', '0'],
    ['第００３．５０話　完', '3.5'], ['十二话 开始', '12'],
    ['Series Vol.02 Ch.003.50 [1080p]', '3.5'], ['Series_v11_c90', '90'],
    ['Chapter21', '21'], ['作品 #002', '2'], ['Episode 04', '4'],
    ['作品 018.5 (2019) [汉化组2]', '18.5'], ['003_开端', '3'],
    ['作品10.1 0101-0110', '10.1'], ['作品 4 1920x1080', '4'],
    ['作品 4 v2', '4'], ['第2025话', '2025']
  ])('recognizes %s as %s', (name, number) => {
    expect(extractChapterNumber(name)).toBe(number)
  })

  it.each([
    '2025-10-02 完', '2025年10月02日', '20251002', '1080p', '1920x1080',
    '作品 4K', '作品 0101~0110', '作品 001-010', '第1-3话', 'Chapter 1-3',
    '第2话 第3话', '作品 12 34', 'Vol.02', '第十二卷', '作品 v1.1',
    '作品 [汉化组2]', '作品 (2025)', 'SP02', 'abc123', 'c1fi7', '第十百话',
    '番外篇', '三国演义', '作品名'
  ])('does not guess a chapter for %s', name => {
    expect(extractChapterNumber(name)).toBe('')
  })

  it('shares title inference without removing dates or numbers from non-prefix titles', () => {
    expect(inferChapterAndTitle('第十二话 开端')).toEqual({ chapterNumber: '12', projectTitle: '开端' })
    expect(inferChapterAndTitle('第二话xxxx')).toEqual({ chapterNumber: '2', projectTitle: 'xxxx' })
    expect(inferChapterAndTitle('2025-10-02 第三话 完')).toEqual({ chapterNumber: '3', projectTitle: '2025-10-02 第三话 完' })
    expect(inferChapterAndTitle('002_继续')).toEqual({ chapterNumber: '2', projectTitle: '继续' })
    expect(normalizeChapterNumber('特别一')).toBe('特别一')
    expect(normalizeChapterNumber('2025')).toBe('2025')
  })

  it('keeps Chinese, digits and a single decimal point for manual input', () => {
    expect(sanitizeChapterInput('第03..5話')).toBe('第03.5話')
    expect(isValidChapterNumber('3.5')).toBe(true)
    expect(isValidChapterNumber('番外篇')).toBe(true)
    expect(isValidChapterNumber('3.')).toBe(false)
  })

  it('formats normalized and legacy values consistently', () => {
    expect(formatChapterNumber('003')).toBe('第3集')
    expect(formatChapterNumber('第3話')).toBe('第3集')
  })

  it('sorts Chinese/custom chapter labels after numeric chapters', () => {
    const chapters = ['番外篇', '10', '2', '后日谈']
    expect(chapters.sort(compareChapterNumbers)).toEqual(['2', '10', '番外篇', '后日谈'])
  })

  it('reverses numeric chapters without moving custom labels before them', () => {
    const chapters = ['番外篇', '10', '2', '后日谈']
    expect(
      chapters.sort((left, right) => compareChapterNumbersByOrder(left, right, 'descending'))
    ).toEqual(['10', '2', '后日谈', '番外篇'])
  })
})

/**
 * 「作品名键 + 集数键」（2026-10-05，P1）—— 冲突判定的身份拆分。
 *
 * 背景：老规则只看"集数"，于是同一个父级里放多部作品时，数字巧合就撞号
 * （真实现场：`一根筋 96` 撞 `矢野同學觀察日記 - 96`、`番外 22 23 24` 被解析成 24
 *  撞 `惡役千金LV99 - 24`）。拆分规则刻意**不含任何猜测**：
 * 只是"把名字里最后一个数字切掉，剩下的就是作品名键"。
 */
describe('splitChapterIdentity —「作品名键 + 集数键」', () => {
  it('把名字切成"作品名部分"与集数（数字仍取名字里最后一个）', () => {
    expect(splitChapterIdentity('一根筋 96')).toEqual({ worksKey: '一根筋', chapterKey: '96' })
    expect(splitChapterIdentity('姊煩10.2')).toEqual({ worksKey: '姊煩', chapterKey: '10.2' })
    expect(splitChapterIdentity('HIGH 08')).toEqual({ worksKey: 'high', chapterKey: '8' })
  })

  it('数字后面的尾巴留在作品名里（不猜"到哪儿算作品名"）', () => {
    expect(splitChapterIdentity('戀上□姐煩 - 姐煩19 - 中文（繁体）')).toEqual({
      worksKey: '戀上□姐煩 - 姐煩 - 中文（繁体）',
      chapterKey: '19'
    })
  })

  it('番外这类多数字标题：整段一起切掉，集数取"番外+第一个数"（A 方向改准了）', () => {
    expect(splitChapterIdentity('想讓高森同學安靜下來！ - 番外 22 23 24')).toEqual({
      worksKey: '想讓高森同學安靜下來！ -',
      chapterKey: '番外22'
    })
  })

  it('名字里没有数字 ⇒ 集数为空（不参与冲突），整个名字就是作品键', () => {
    expect(splitChapterIdentity('作品名')).toEqual({ worksKey: '作品名', chapterKey: '' })
  })

  it('整个名字就是一个数字 ⇒ 作品键为空（调用方据此退回"只比集数"的保守口径）', () => {
    expect(splitChapterIdentity('19')).toEqual({ worksKey: '', chapterKey: '19' })
  })

  it('归一化只做无歧义那几项：大小写 / 空白折叠 / NFC', () => {
    expect(splitChapterIdentity('一根筋  96').worksKey).toBe('一根筋')
    expect(splitChapterIdentity('JJ 96').worksKey).toBe(splitChapterIdentity('jj 96').worksKey)
  })

  it('不碰繁简与异体字：姊/姐 视为不同作品名（这是**故意**的：宁可漏报也不猜）', () => {
    expect(splitChapterIdentity('姊煩10.2').worksKey).not.toBe(
      splitChapterIdentity('姐煩10.2').worksKey
    )
  })
})

/**
 * A 方向：切集数更准（2026-10-05）。
 *
 * 现场四类误判（实测）：`第二话xxxx` 完全识别不出、`第2话 完结 1080p` 把分辨率当集数、
 * `2025-10-02 第三话 完` 把日期里的 02 当集数、`姊煩10.1 0101~0110` 把范围尾数当集数。
 * 规则：**带单位的优先**（第X话/集/回/章/卷，阿拉伯与汉字数字都认）→ 番外 → 小数 →
 * 范围 → 裸尾数（**排除日期/分辨率/单独年份这些噪声**）。汉字数字**转成阿拉伯数字**。
 */
describe('A：切集数更准（带单位优先 / 汉字数字 / 噪声排除）', () => {
  it('汉字数字转成阿拉伯数字', () => {
    expect(extractChapterNumber('第二话xxxx')).toBe('2')
    expect(extractChapterNumber('第三话')).toBe('3')
    expect(extractChapterNumber('第十二话 完')).toBe('12')
    expect(extractChapterNumber('第二十话')).toBe('20')
    expect(extractChapterNumber('第一百零五話')).toBe('105')
  })

  it('带单位的优先于裸尾数（分辨率/日期不再被当集数）', () => {
    expect(extractChapterNumber('第2话 完结 1080p')).toBe('2')
    expect(extractChapterNumber('2025-10-02 第三话 完')).toBe('3')
    // 噪声在**后面**也要挡得住（否则"取最后一个数字"会取到 1080）
    expect(extractChapterNumber('作品A 1080p 03')).toBe('3')
    expect(extractChapterNumber('作品A 03 1080p')).toBe('3')
  })

  it('整个名字只有日期 ⇒ 认不出（保守：不参与冲突，也不瞎取一个数）', () => {
    expect(extractChapterNumber('作品A 2025-10-02')).toBe('')
    expect(extractChapterNumber('2025-10-02')).toBe('')
  })

  it('范围取范围**前面**那个数（不再取尾数）', () => {
    expect(extractChapterNumber('公司人141 45~58')).toBe('141')
    expect(extractChapterNumber('姊煩10.1 0101~0110')).toBe('10.1')
  })

  it('番外：连带后面的数字串一起吃掉，取第一个（`番外 22 23 24` ⇒ 番外22）', () => {
    expect(extractChapterNumber('番外 22 23 24')).toBe('番外22')
    expect(extractChapterNumber('番外12')).toBe('番外12')
  })

  it('小数（卷.话）优先于整数', () => {
    expect(extractChapterNumber('戀上10.2')).toBe('10.2')
    expect(extractChapterNumber('第001.50話')).toBe('1.5')
  })

  it('回归：原来的正常命名一个都不能变', () => {
    expect(extractChapterNumber('七龙珠003')).toBe('3')
    expect(extractChapterNumber('HIGH 08')).toBe('8')
    expect(extractChapterNumber('一根筋 96')).toBe('96')
    expect(extractChapterNumber('14歲 08')).toBe('8')
    expect(extractChapterNumber('作品名')).toBe('')
  })

  it('切分同步改：作品名键切掉的是"被选中的那一段"，不是"最后一个数字"', () => {
    // 日期 + 第三话：集数 3（不是 2），作品键里只少了"第三话"
    expect(splitChapterIdentity('2025-10-02 第三话 完')).toEqual({
      worksKey: '2025-10-02 完',
      chapterKey: '3'
    })
    expect(splitChapterIdentity('想讓高森同學安靜下來！ - 番外 22 23 24')).toEqual({
      worksKey: '想讓高森同學安靜下來！ -',
      chapterKey: '番外22'
    })
  })
})
