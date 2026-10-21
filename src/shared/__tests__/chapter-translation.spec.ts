import { describe, expect, it } from 'vitest'
import type { LabelPlusDocument, LabelPlusImageEntry } from '../labelplus-import'
import {
  CHAPTER_TRANSLATION_MAX_ATTEMPTS,
  buildChapterTranslationWithEntry,
  buildEmptyChapterTranslationText,
  chapterTranslationExportFileName,
  findTranslationEntryForPage,
  findTranslationLabelByPosition,
  rankChapterTranslationCandidates,
  serializeChapterTranslationLabel,
  type ChapterTranslationCandidate
} from '../chapter-translation'

function candidate(name: string, mtimeMs: number): ChapterTranslationCandidate {
  return { name, path: `D:\\x\\${name}`, mtimeMs }
}

describe('章节译文 · 候选排序（取最新）', () => {
  it('按修改时间倒序，最新的排最前', () => {
    const ranked = rankChapterTranslationCandidates([
      candidate('a.txt', 100),
      candidate('c.txt', 300),
      candidate('b.txt', 200)
    ])
    expect(ranked.map((item) => item.name)).toEqual(['c.txt', 'b.txt', 'a.txt'])
  })

  it('修改时间相同时按文件名升序，结果稳定可复现', () => {
    const ranked = rankChapterTranslationCandidates([
      candidate('b.txt', 100),
      candidate('a.txt', 100)
    ])
    expect(ranked.map((item) => item.name)).toEqual(['a.txt', 'b.txt'])
  })

  it('最多只留前 N 个候选，且不修改传入的数组', () => {
    const input = Array.from({ length: CHAPTER_TRANSLATION_MAX_ATTEMPTS + 3 }, (_, index) =>
      candidate(`${index}.txt`, index)
    )
    const snapshot = input.map((item) => item.name)
    const ranked = rankChapterTranslationCandidates(input)
    expect(ranked).toHaveLength(CHAPTER_TRANSLATION_MAX_ATTEMPTS)
    expect(ranked[0].name).toBe(`${CHAPTER_TRANSLATION_MAX_ATTEMPTS + 2}.txt`)
    expect(input.map((item) => item.name)).toEqual(snapshot)
  })

  it('空目录给空数组（不是 null）', () => {
    expect(rankChapterTranslationCandidates([])).toEqual([])
  })
})

describe('章节译文 · 这一页对应哪一条译文', () => {
  const document: LabelPlusDocument = {
    sourcePath: 'D:\\x\\20.txt',
    version: { first: 1, last: 0 },
    groups: ['框内', '框外'],
    images: [
      {
        fileName: '20.jpg',
        labels: [
          {
            index: 1,
            group: '框内',
            text: '甲',
            position: { unit: 'normalized', x: 0.5, y: 0.5 }
          }
        ]
      },
      { fileName: '21.PNG', labels: [] }
    ],
    warnings: []
  }

  it('完整文件名（不分大小写）命中', () => {
    expect(findTranslationEntryForPage(document, '20.jpg')?.fileName).toBe('20.jpg')
    expect(findTranslationEntryForPage(document, '21.png')?.fileName).toBe('21.PNG')
  })

  it('主名相同、扩展名不同时退一档命中（txt 写 20.jpg，磁盘是 20.png）', () => {
    expect(findTranslationEntryForPage(document, '20.png')?.fileName).toBe('20.jpg')
  })

  it('两种都命中时以完整文件名优先', () => {
    const both: LabelPlusDocument = {
      ...document,
      images: [
        { fileName: '20.jpg', labels: [] },
        { fileName: '20.png', labels: [] }
      ]
    }
    expect(findTranslationEntryForPage(both, '20.png')?.fileName).toBe('20.png')
  })

  it('找不到 / 没有 txt / 文件名为空 都返回 null（本页无译文）', () => {
    expect(findTranslationEntryForPage(document, '99.jpg')).toBeNull()
    expect(findTranslationEntryForPage(document, null)).toBeNull()
    expect(findTranslationEntryForPage(document, '   ')).toBeNull()
    expect(findTranslationEntryForPage(null, '20.jpg')).toBeNull()
  })
})

describe('第3批 · 另存的默认文件名', () => {
  /** 时间固定成本地时间构造 ⇒ 断言与运行机器的时区无关。 */
  const at = new Date(2026, 9, 6, 21, 30, 45).getTime()

  it('`{底稿名}-另存-{YYYYMMDD-HHmm}.txt`（个位补零）', () => {
    expect(chapterTranslationExportFileName('译文', at)).toBe('译文-另存-20261006-2130.txt')
    expect(chapterTranslationExportFileName('第1話', new Date(2026, 0, 2, 3, 4).getTime())).toBe(
      '第1話-另存-20260102-0304.txt'
    )
  })

  it('洗掉 Windows 不许的字符（清洗规则**只有一处**，与导出校对记录共用）', () => {
    expect(chapterTranslationExportFileName('这作品?真的:好看', at)).toBe(
      '这作品_真的_好看-另存-20261006-2130.txt'
    )
  })

  it('名字空了也不至于产出一个没有主名的文件', () => {
    expect(chapterTranslationExportFileName('   ', at)).toBe('译文-另存-20261006-2130.txt')
  })
})

describe('第3批 · 从零生成的那份空底稿（版式照真实 LabelPlusFX 产物）', () => {
  it('**逐字**：版本行 + 两条 `-` 夹着的分组表 + 每张图一个 8 分隔符的块', () => {
    expect(buildEmptyChapterTranslationText(['01.png', '02.png'])).toBe(
      ['1,0', '-', '默认', '-', '>>>>>>>>[01.png]<<<<<<<<', '', '>>>>>>>>[02.png]<<<<<<<<'].join(
        '\n'
      ) + '\n'
    )
  })

  it('拿得到真实分组表就写它（去重、去空行）；拿不到才写 `默认`', () => {
    expect(buildEmptyChapterTranslationText([], ['框内', '框外', '框内', '  '])).toBe(
      ['1,0', '-', '框内', '框外', '-'].join('\n') + '\n'
    )
    expect(buildEmptyChapterTranslationText([], [])).toBe(
      ['1,0', '-', '默认', '-'].join('\n') + '\n'
    )
  })

  it('**只写结构、不编内容**：没有条目就是一个标签行都没有', () => {
    const text = buildEmptyChapterTranslationText(['01.png'])
    expect(text).not.toContain('------[')
    expect(text.endsWith('>>>>>>>>[01.png]<<<<<<<<\n')).toBe(true)
  })

  it('空图名 / 空数组都不炸（宁可少一个块，也不写一行坏结构）', () => {
    expect(buildEmptyChapterTranslationText(['01.png', '  ', ''])).toBe(
      ['1,0', '-', '默认', '-', '>>>>>>>>[01.png]<<<<<<<<'].join('\n') + '\n'
    )
    expect(buildEmptyChapterTranslationText([])).toBe(['1,0', '-', '默认', '-'].join('\n') + '\n')
  })
})

/**
 * 「从零新建」（第 5 批，2026-10-07）—— 这一话连一份能解析的 txt 都没有时，
 * 造一份**合法**的、并且在**点中的那一页**里带上第一条译文。
 *
 * 版式与"空底稿"同源（版本行 → 两条 `-` 夹分组表 → 每页一个图片块，块间空一行）；
 * 差别只有一处：目标页的块里多一条条目。
 */
describe('章节译文 · 从零新建（带第一条条目）', () => {
  it('版式逐字：目标页带一条条目，其余页仍是空块', () => {
    const text = buildChapterTranslationWithEntry({
      pages: ['20.jpg', '21.jpg'],
      groups: ['框内', '框外'],
      imageName: '20.jpg',
      groupIndex: 1,
      position: { x: 0.5, y: 0.5 },
      text: '第一句'
    })

    expect(text).toBe(
      [
        '1,0',
        '-',
        '框内',
        '框外',
        '-',
        '>>>>>>>>[20.jpg]<<<<<<<<',
        '----------------[1]----------------[0.5000,0.5000,1]',
        '第一句',
        '',
        '>>>>>>>>[21.jpg]<<<<<<<<',
        ''
      ].join('\n')
    )
  })

  it('缺省分组表 = 框内/框外；**组号 = 表序**（框外 → 2）', () => {
    const text = buildChapterTranslationWithEntry({
      pages: ['20.jpg'],
      imageName: '20.jpg',
      groupIndex: 2,
      position: { x: 0.25, y: 0.75 }
    })

    expect(text).toBe(
      [
        '1,0',
        '-',
        '框内',
        '框外',
        '-',
        '>>>>>>>>[20.jpg]<<<<<<<<',
        '----------------[1]----------------[0.2500,0.7500,2]'
      ].join('\n') + '\n'
    )
  })

  it('不填文本 ⇒ 空条目（只有标签头，没有内容行）', () => {
    const lines = serializeChapterTranslationLabel({
      index: 1,
      groupIndex: 1,
      position: { x: 0.5, y: 0.5 }
    })
    expect(lines).toEqual(['----------------[1]----------------[0.5000,0.5000,1]'])
  })

  it('多行文本 ⇒ 每一行都进内容区（断句是真的换行）', () => {
    const lines = serializeChapterTranslationLabel({
      index: 3,
      groupIndex: 2,
      position: { x: 0.1, y: 0.2 },
      text: '甲\n乙'
    })
    expect(lines).toEqual(['----------------[3]----------------[0.1000,0.2000,2]', '甲', '乙'])
  })

  it('图名不分大小写（点在 20.JPG 上也落到 20.jpg 那一块）', () => {
    const text = buildChapterTranslationWithEntry({
      pages: ['20.jpg'],
      imageName: '20.JPG',
      groupIndex: 1,
      position: { x: 0.5, y: 0.5 },
      text: '甲'
    })

    expect(text).toContain('>>>>>>>>[20.jpg]<<<<<<<<\n----------------[1]')
  })

  it('页表里没有这一页 / 组号非法 ⇒ **null**（拒绝，不产出一份"少了那条"的 txt）', () => {
    const base = {
      pages: ['20.jpg'],
      groupIndex: 1,
      position: { x: 0.5, y: 0.5 }
    }
    expect(buildChapterTranslationWithEntry({ ...base, imageName: '99.jpg' })).toBeNull()
    expect(
      buildChapterTranslationWithEntry({ ...base, imageName: '20.jpg', groupIndex: 0 })
    ).toBeNull()
    expect(buildChapterTranslationWithEntry({ ...base, imageName: '20.jpg', pages: [] })).toBeNull()
    expect(
      buildChapterTranslationWithEntry({
        ...base,
        imageName: '20.jpg',
        position: { x: 1.5, y: 0.5 }
      })
    ).toBeNull()
  })
})

/**
 * 第 5 批 5d-2（2026-10-07）：「**哪一行是我刚新增的**」。
 *
 * 为什么需要它：新增之后，宿主手上只有**主进程算出来的序号**与**用户点下去的那个坐标**
 * （小数点后十几位），而盘上写的是 `toFixed(4)` 之后的值 —— 两个数**不相等**。
 * 拿手上的坐标去全等匹配，会在某些小数位上"一条都找不到"，而换个位置点又好了。
 */
describe('findTranslationLabelByPosition · 按坐标找回刚新增的那一条', () => {
  function page(labels: Array<{ index: number; x: number; y: number }>): LabelPlusImageEntry {
    return {
      fileName: '20.jpg',
      labels: labels.map((label) => ({
        index: label.index,
        group: '框内',
        text: '',
        position: { unit: 'normalized', x: label.x, y: label.y }
      }))
    }
  }

  it('坐标**四舍五入到写盘那 4 位之后**相等 ⇒ 命中（这是它与"全等匹配"的关键差别）', () => {
    // 用户点出来的原始坐标是 0.123456789，盘上写的是 0.1235
    const entry = page([
      { index: 1, x: 0.5, y: 0.5 },
      { index: 2, x: 0.1235, y: 0.9877 }
    ])
    expect(
      findTranslationLabelByPosition(entry, { x: 0.123456789, y: 0.987654321 }, undefined)?.index
    ).toBe(2)
  })

  it('先按序号定位（主进程算出来的那个才是权威）', () => {
    const entry = page([
      { index: 1, x: 0.5, y: 0.5 },
      { index: 2, x: 0.5, y: 0.5 }
    ])
    expect(findTranslationLabelByPosition(entry, { x: 0.5, y: 0.5 }, 2)?.index).toBe(2)
    // 序号给了但那儿没有 ⇒ 退回按坐标找（别返回 null 让界面什么都不亮）
    expect(findTranslationLabelByPosition(entry, { x: 0.5, y: 0.5 }, 9)?.index).toBe(1)
  })

  it('坐标差得远 ⇒ 找不着（**不蒙一个**：宁可什么都不亮，也不点亮错的那行）', () => {
    const entry = page([{ index: 1, x: 0.1, y: 0.1 }])
    expect(findTranslationLabelByPosition(entry, { x: 0.9, y: 0.9 }, undefined)).toBeNull()
  })

  it('坐标非法 / 没有这一页 ⇒ null（不许瞎算一个坐标去亮一行）', () => {
    const entry = page([{ index: 1, x: 0.5, y: 0.5 }])
    expect(findTranslationLabelByPosition(entry, { x: Number.NaN, y: 0.5 }, undefined)).toBeNull()
    expect(findTranslationLabelByPosition(null, { x: 0.5, y: 0.5 }, undefined)).toBeNull()
  })
})
