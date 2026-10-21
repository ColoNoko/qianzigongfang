/**
 * 原地改行 writer（P2-a）—— **纯函数**，不碰文件系统。
 *
 * 核心承诺：**除被改的那几行，文件其余部分逐字节不变**。
 * 所以这里的用例一律用"整份文本精确相等"来断言 —— 那才是最硬的说法，
 * 比"逐行比了一下"强（行内空白、BOM、换行风格都在这条断言里）。
 *
 * ⚠️ fixture 全部**合成**（不抄真实译文、不含真实路径）。
 */
import { describe, expect, it } from 'vitest'
import {
  buildChapterTranslationWithEntry,
  type ChapterTranslationEdit
} from '@shared/chapter-translation'
import { parseLabelPlusContent, parseLabelPlusTextWithSpans } from '../labelplus-parser'
import {
  deleteChapterTranslationEntry,
  insertChapterTranslationEntry,
  rewriteChapterTranslationText
} from '../chapter-translation-rewrite'

/**
 * 一份"真实形状"的合成文本（行号见右侧注释）。
 * 末尾带换行 ⇒ `split('\n')` 的最后一项是空串，用来证明**结尾换行没被动过**。
 */
const LINES = [
  '1,0', //  1
  '-', //  2
  '框内', //  3
  '框外', //  4
  '-', //  5
  '翻译：某人', //  6  ← parser 不解析的 credits：回写必须原样留着
  '校对：另一位', //  7
  '', //  8
  '', //  9
  '>>>>>>>>[01.png]<<<<<<<<', // 10
  '----------------[1]----------------[0.4950,0.6920,1]', // 11
  '第一句', // 12
  '第二行', // 13
  '', // 14
  '----------------[2]----------------[0.1040,0.8770,1]', // 15  ← 空译文
  '', // 16
  '', // 17
  '>>>>>>>>[02.png]<<<<<<<<', // 18
  '----------------[1]----------------[0.8330,0.6410,2]', // 19
  '另一句', // 20
  '' // 21  ← 末尾换行
]
const CONTENT = LINES.join('\n')

/** 把某几行换成别的，其余（含末尾那一项）原样 —— 这就是"期望的整份文件"。 */
function withLines(replacements: Record<number, string[] | undefined>): string {
  const next: string[] = []
  LINES.forEach((line, index) => {
    const replacement = replacements[index]
    if (replacement === undefined) next.push(line)
    else next.push(...replacement)
  })
  return next.join('\n')
}

/** 在某个 0 基位置**插入**几行（不是替换）——"新增框"的期望是"插入"，原行全部保留。 */
function withInsertion(at: number, added: string[]): string {
  return [...LINES.slice(0, at), ...added, ...LINES.slice(at)].join('\n')
}

function edit(
  patch: Partial<ChapterTranslationEdit> & Pick<ChapterTranslationEdit, 'imageName' | 'labelIndex'>
): ChapterTranslationEdit {
  return patch
}

describe('原地改行 · 改文本', () => {
  it('多行译文：除那两行，整份文件逐字节相同', () => {
    const result = rewriteChapterTranslationText(CONTENT, [
      edit({ imageName: '01.png', labelIndex: 1, text: '换过的甲\n换过的乙' })
    ])

    expect(result).toEqual({
      ok: true,
      text: withLines({ 11: ['换过的甲', '换过的乙'], 12: [] }),
      applied: 1
    })
  })

  it('这段文本在原文里是第 12–13 行 —— 改完拿行号回切，切到的就是新值', () => {
    const result = rewriteChapterTranslationText(CONTENT, [
      edit({ imageName: '01.png', labelIndex: 1, text: '甲\n乙' })
    ])
    if (!result.ok) throw new Error(result.reason)

    const { spans } = parseLabelPlusTextWithSpans(result.text)
    const target = spans.find((span) => span.imageName === '01.png' && span.labelIndex === 1)
    expect(target).toMatchObject({ headerLine: 11, contentStartLine: 12, contentEndLine: 13 })
    expect(result.text.split('\n').slice(11, 13)).toEqual(['甲', '乙'])
  })

  it('清空文本 = 把内容行删掉，分隔空行留着', () => {
    const result = rewriteChapterTranslationText(CONTENT, [
      edit({ imageName: '01.png', labelIndex: 1, text: '' })
    ])

    expect(result).toEqual({ ok: true, text: withLines({ 11: [], 12: [] }), applied: 1 })
  })

  it('空译文的条目：新文本**插在标签头后面**（分隔空行原样留着）', () => {
    const result = rewriteChapterTranslationText(CONTENT, [
      edit({ imageName: '01.png', labelIndex: 2, text: '补上的' })
    ])

    expect(result).toEqual({ ok: true, text: withLines({ 15: ['补上的', ''] }), applied: 1 })
  })

  it('窗口换行进来也认（\\r\\n 归一成 \\n，不把 \\r 写进文件）', () => {
    const result = rewriteChapterTranslationText(CONTENT, [
      edit({ imageName: '01.png', labelIndex: 1, text: '甲\r\n乙' })
    ])

    expect(result).toEqual({
      ok: true,
      text: withLines({ 11: ['甲', '乙'], 12: [] }),
      applied: 1
    })
  })

  it('改完再解析：值就是新的（自证闭环）', () => {
    const result = rewriteChapterTranslationText(CONTENT, [
      edit({ imageName: '01.png', labelIndex: 1, text: '甲\n乙' })
    ])
    if (!result.ok) throw new Error(result.reason)

    const { document } = parseLabelPlusTextWithSpans(result.text)
    expect(document.images[0].labels[0].text).toBe('甲\n乙')
    // 邻居一个都没被碰
    expect(document.images[0].labels[1].text).toBe('')
    expect(document.images[1].labels[0].text).toBe('另一句')
  })
})

describe('原地改行 · 改坐标', () => {
  it('沿用原本的小数位数（4 位仍 4 位）', () => {
    const result = rewriteChapterTranslationText(CONTENT, [
      edit({ imageName: '01.png', labelIndex: 1, position: { x: 0.5, y: 0.7777 } })
    ])

    expect(result).toEqual({
      ok: true,
      text: withLines({ 10: ['----------------[1]----------------[0.5000,0.7777,1]'] }),
      applied: 1
    })
  })

  it('原本位数不够时**补足**而不是四舍五入丢精度（2 位 → 4 位）', () => {
    const raw = ['>>>>>>>>[01.png]<<<<<<<<', '------[1]------[0.10,0.20,1]', '甲'].join('\n')
    const result = rewriteChapterTranslationText(raw, [
      edit({ imageName: '01.png', labelIndex: 1, position: { x: 0.1234, y: 0.5678 } })
    ])

    expect(result).toEqual({
      ok: true,
      text: ['>>>>>>>>[01.png]<<<<<<<<', '------[1]------[0.1234,0.5678,1]', '甲'].join('\n'),
      applied: 1
    })
  })

  it('坐标串里的多余字段原样保留（只换前三个）', () => {
    const raw = ['>>>>>>>>[01.png]<<<<<<<<', '------[1]------[0.1000,0.2000,1,宽,高]', '甲'].join(
      '\n'
    )
    const result = rewriteChapterTranslationText(raw, [
      edit({ imageName: '01.png', labelIndex: 1, position: { x: 0.3, y: 0.4 } })
    ])

    expect(result).toEqual({
      ok: true,
      text: ['>>>>>>>>[01.png]<<<<<<<<', '------[1]------[0.3000,0.4000,1,宽,高]', '甲'].join('\n'),
      applied: 1
    })
  })

  it('分隔符两边的空白照旧（不顺手"规范化"别人的文件）', () => {
    const raw = ['>>>>>>>>[01.png]<<<<<<<<', '------[1]------[0.1000, 0.2000, 1]', '甲'].join('\n')
    const result = rewriteChapterTranslationText(raw, [
      edit({ imageName: '01.png', labelIndex: 1, position: { x: 0.3, y: 0.4 } })
    ])

    expect(result).toEqual({
      ok: true,
      text: ['>>>>>>>>[01.png]<<<<<<<<', '------[1]------[0.3000, 0.4000, 1]', '甲'].join('\n'),
      applied: 1
    })
  })
})

describe('原地改行 · 改分组', () => {
  it('按**名字**解析成编号（框外 = 表里第二个 ⇒ 2）', () => {
    const result = rewriteChapterTranslationText(CONTENT, [
      edit({ imageName: '01.png', labelIndex: 1, groupName: '框外' })
    ])

    expect(result).toEqual({
      ok: true,
      text: withLines({ 10: ['----------------[1]----------------[0.4950,0.6920,2]'] }),
      applied: 1
    })
  })

  it('分组名不在头部那张表里 ⇒ 拒绝（不新建分组）', () => {
    const result = rewriteChapterTranslationText(CONTENT, [
      edit({ imageName: '01.png', labelIndex: 1, groupName: '旁白' })
    ])

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('不该成功')
    expect(result.reason).toContain('旁白')
  })

  it('三个字段一起改：一次改完，仍是"只动那两行"', () => {
    const result = rewriteChapterTranslationText(CONTENT, [
      edit({
        imageName: '01.png',
        labelIndex: 1,
        text: '新文本',
        position: { x: 1, y: 0.25 },
        groupName: '框外'
      })
    ])

    expect(result).toEqual({
      ok: true,
      text: withLines({
        10: ['----------------[1]----------------[1.0000,0.2500,2]'],
        11: ['新文本'],
        12: []
      }),
      applied: 1
    })
  })
})

describe('原地改行 · 保真（BOM / 换行风格 / credits）', () => {
  it('BOM 留着', () => {
    const result = rewriteChapterTranslationText(`\uFEFF${CONTENT}`, [
      edit({ imageName: '01.png', labelIndex: 1, text: '甲' })
    ])
    if (!result.ok) throw new Error(result.reason)

    expect(result.text.startsWith('\uFEFF')).toBe(true)
    expect(result.text).toBe(`\uFEFF${withLines({ 11: ['甲'], 12: [] })}`)
  })

  it('CRLF 文件：改完还是 CRLF，且其余行逐字节相同', () => {
    const raw = CONTENT.replace(/\n/g, '\r\n')
    const result = rewriteChapterTranslationText(raw, [
      edit({ imageName: '01.png', labelIndex: 1, text: '甲' })
    ])
    if (!result.ok) throw new Error(result.reason)

    expect(result.text).toBe(withLines({ 11: ['甲'], 12: [] }).replace(/\n/g, '\r\n'))
  })

  it('`翻译：` / `校对：` 这些 parser 不解析的头部内容原样留着', () => {
    const result = rewriteChapterTranslationText(CONTENT, [
      edit({ imageName: '02.png', labelIndex: 1, text: '甲' })
    ])
    if (!result.ok) throw new Error(result.reason)

    const lines = result.text.split('\n')
    expect(lines[5]).toBe('翻译：某人')
    expect(lines[6]).toBe('校对：另一位')
    // 而目标那一条确实改了
    expect(lines[19]).toBe('甲')
  })
})

describe('原地改行 · 拒绝清单（宁可拦住，也不写坏别人的文件）', () => {
  it('找不到那一条 ⇒ 拒绝并点名', () => {
    const result = rewriteChapterTranslationText(CONTENT, [
      edit({ imageName: '09.png', labelIndex: 3, text: '甲' })
    ])

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('不该成功')
    expect(result.reason).toContain('09.png')
    expect(result.reason).toContain('3')
  })

  it('译文里有独占一行、看起来像文件结构的行 ⇒ 拒绝（否则会把结构写坏）', () => {
    for (const bad of ['>>>>>>>>[03.png]<<<<<<<<', '------[9]------[0.1,0.2,1]']) {
      const result = rewriteChapterTranslationText(CONTENT, [
        edit({ imageName: '01.png', labelIndex: 1, text: `甲\n${bad}\n乙` })
      ])
      expect(result.ok).toBe(false)
      if (result.ok) throw new Error('不该成功')
      expect(result.reason).toContain('结构')
    }
  })

  it('换行符混用（既有 CRLF 又有 LF）⇒ 拒绝', () => {
    const mixed = CONTENT.replace('第二行\n', '第二行\r\n')
    const result = rewriteChapterTranslationText(mixed, [
      edit({ imageName: '01.png', labelIndex: 1, text: '甲' })
    ])

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('不该成功')
    expect(result.reason).toContain('换行')
  })

  it('坐标串少于三段 ⇒ 拒绝（形状不认识就不动）', () => {
    const raw = ['>>>>>>>>[01.png]<<<<<<<<', '------[1]------[0.1,0.2]', '甲'].join('\n')
    const result = rewriteChapterTranslationText(raw, [
      edit({ imageName: '01.png', labelIndex: 1, position: { x: 0.3, y: 0.4 } })
    ])

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('不该成功')
    expect(result.reason).toContain('坐标')
  })

  it('解析不了的文件 ⇒ 拒绝（一个字节都不写）', () => {
    const result = rewriteChapterTranslationText('这不是 LabelPlus 文本', [
      edit({ imageName: '01.png', labelIndex: 1, text: '甲' })
    ])

    expect(result.ok).toBe(false)
  })

  it('空编辑列表 ⇒ 拒绝（防御：没有要改的就别写盘）', () => {
    const result = rewriteChapterTranslationText(CONTENT, [])

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('不该成功')
    expect(result.reason).toContain('没有要改')
  })

  it('坐标越界 ⇒ 拒绝（正常拖拽不会越界，越界说明上游算错了）', () => {
    const result = rewriteChapterTranslationText(CONTENT, [
      edit({ imageName: '01.png', labelIndex: 1, position: { x: 1.5, y: 0.5 } })
    ])

    expect(result.ok).toBe(false)
  })
})

describe('原地改行 · 多条一起改', () => {
  it('两条同时改，两条都生效，其余逐字节不动', () => {
    const result = rewriteChapterTranslationText(CONTENT, [
      edit({ imageName: '01.png', labelIndex: 1, text: '甲' }),
      edit({ imageName: '02.png', labelIndex: 1, text: '乙\n丙' })
    ])

    expect(result).toEqual({
      ok: true,
      text: withLines({ 11: ['甲'], 12: [], 19: ['乙', '丙'] }),
      applied: 2
    })
  })

  it('同一条被写了两遍 ⇒ 拒绝（不猜谁赢）', () => {
    const result = rewriteChapterTranslationText(CONTENT, [
      edit({ imageName: '01.png', labelIndex: 1, text: '甲' }),
      edit({ imageName: '01.png', labelIndex: 1, text: '乙' })
    ])

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('不该成功')
    expect(result.reason).toContain('两遍')
  })

  it('一条合法一条非法 ⇒ 整份拒绝（不做"改一半"）', () => {
    const result = rewriteChapterTranslationText(CONTENT, [
      edit({ imageName: '01.png', labelIndex: 1, text: '甲' }),
      edit({ imageName: '01.png', labelIndex: 99, text: '乙' })
    ])

    expect(result.ok).toBe(false)
  })
})

/**
 * 「新增框」（第 5 批，2026-10-07）—— 在图片块**末尾**插入一条新译文。
 *
 * 与"改"的分工：改 = 找到那一条、替换它的行；插 = 找到那张图、在它末尾**推几行**。
 * 承诺不变：**除插进去的那几行，文件其余部分逐字节不变**。
 */
describe('原地改行 · 新增框（插入）', () => {
  function insert(patch: {
    imageName: string
    groupName: string
    position: { x: number; y: number }
    text?: string
  }) {
    return patch
  }

  it('插到 01.png 末尾：序号 = 该图最大序号 +1（2 → 3），其余字节逐字节不变，且能被读回', () => {
    const result = insertChapterTranslationEntry(
      CONTENT,
      insert({
        imageName: '01.png',
        groupName: '框内',
        position: { x: 0.5, y: 0.5 },
        text: '新增的句子'
      })
    )

    expect(result).toEqual({
      ok: true,
      text: withInsertion(15, [
        '----------------[3]----------------[0.5000,0.5000,1]',
        '新增的句子'
      ]),
      insertedIndex: 3
    })

    // 能被自己的 parser 读回：01.png 现在是 3 条，02.png 仍是 1 条
    if (!result.ok) throw new Error(result.reason)
    const { spans } = parseLabelPlusTextWithSpans(result.text)
    expect(spans.filter((span) => span.imageName === '01.png')).toHaveLength(3)
    expect(spans.filter((span) => span.imageName === '02.png')).toHaveLength(1)
    const added = spans.find((span) => span.imageName === '01.png' && span.labelIndex === 3)
    expect(added).toMatchObject({ headerLine: 16, contentStartLine: 17, contentEndLine: 17 })
  })

  it('插到 02.png：序号接**这一图**的末尾（1 → 2），不是全局递增（不是 4）', () => {
    const result = insertChapterTranslationEntry(
      CONTENT,
      insert({
        imageName: '02.png',
        groupName: '框外',
        position: { x: 0.5, y: 0.5 },
        text: '另一句新增'
      })
    )

    expect(result).toEqual({
      ok: true,
      text: withInsertion(20, [
        '----------------[2]----------------[0.5000,0.5000,2]',
        '另一句新增'
      ]),
      insertedIndex: 2
    })
  })

  it('空图块（这张图还没有任何条目）⇒ 序号从 1 起，插在图片标题行之后', () => {
    const empty = [
      '1,0', // 1
      '-', // 2
      '框内', // 3
      '框外', // 4
      '-', // 5
      '', // 6
      '>>>>>>>>[01.png]<<<<<<<<', // 7
      '', // 8
      '>>>>>>>>[02.png]<<<<<<<<', // 9
      '' // 10  ← 末尾换行
    ].join('\n')

    const result = insertChapterTranslationEntry(
      empty,
      insert({
        imageName: '01.png',
        groupName: '框内',
        position: { x: 0.25, y: 0.75 },
        text: '第一句'
      })
    )

    expect(result).toEqual({
      ok: true,
      text: [
        '1,0',
        '-',
        '框内',
        '框外',
        '-',
        '',
        '>>>>>>>>[01.png]<<<<<<<<',
        '----------------[1]----------------[0.2500,0.7500,1]',
        '第一句',
        '',
        '>>>>>>>>[02.png]<<<<<<<<',
        ''
      ].join('\n'),
      insertedIndex: 1
    })
  })

  it('不填文本 ⇒ 空条目（只有标签头，没有内容行）', () => {
    const result = insertChapterTranslationEntry(
      CONTENT,
      insert({ imageName: '02.png', groupName: '框外', position: { x: 0.5, y: 0.5 } })
    )

    expect(result).toEqual({
      ok: true,
      text: withInsertion(20, ['----------------[2]----------------[0.5000,0.5000,2]']),
      insertedIndex: 2
    })
  })

  it('分组名不在分组表 ⇒ 整份拒绝（不新建分组）', () => {
    const result = insertChapterTranslationEntry(
      CONTENT,
      insert({ imageName: '01.png', groupName: '旁白', position: { x: 0.5, y: 0.5 }, text: '甲' })
    )

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('不该成功')
    expect(result.reason).toContain('分组')
  })

  it('坐标越界 ⇒ 整份拒绝', () => {
    const result = insertChapterTranslationEntry(
      CONTENT,
      insert({ imageName: '01.png', groupName: '框内', position: { x: 1.2, y: 0.5 } })
    )

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('不该成功')
    expect(result.reason).toContain('坐标')
  })

  it('找不到这张图 ⇒ 拒绝（不猜、不新建图片块）', () => {
    const result = insertChapterTranslationEntry(
      CONTENT,
      insert({ imageName: '99.png', groupName: '框内', position: { x: 0.5, y: 0.5 } })
    )

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('不该成功')
    expect(result.reason).toContain('找不到')
  })
})

/**
 * 5b × 5a 的交叉网（第 5 批）：**从零新建出来的那份，必须能被自己的解析器读回来**，
 * 也必须能被"插入"（5a）接着往上添 —— 两个序列化器要是各写一套格式，这两条会当场红。
 */
describe('从零新建 · 能被自己的解析器读回，也能被插入接着添', () => {
  function buildWithFirstEntry(): string {
    const text = buildChapterTranslationWithEntry({
      pages: ['20.jpg', '21.jpg'],
      groups: ['框内', '框外'],
      imageName: '20.jpg',
      groupIndex: 1,
      position: { x: 0.5, y: 0.5 },
      text: '第一句'
    })
    if (text === null) throw new Error('不该是 null')
    return text
  }

  it('读回来：两页都在、目标页一条、分组与坐标逐字段对得上', () => {
    const document = parseLabelPlusContent(buildWithFirstEntry())

    expect(document.groups).toEqual(['框内', '框外'])
    expect(document.images.map((image) => image.fileName)).toEqual(['20.jpg', '21.jpg'])
    const target = document.images.find((image) => image.fileName === '20.jpg')
    expect(target?.labels).toHaveLength(1)
    expect(target?.labels[0]).toMatchObject({
      index: 1,
      group: '框内',
      text: '第一句',
      position: { unit: 'normalized', x: 0.5, y: 0.5 }
    })
    // 另一页仍是空块（没有条目）
    expect(document.images.find((image) => image.fileName === '21.jpg')?.labels).toHaveLength(0)
  })

  it('**接着添一条**：在新建出来的那份上插入 ⇒ 序号 2，且两页的条目都对', () => {
    const result = insertChapterTranslationEntry(buildWithFirstEntry(), {
      imageName: '20.jpg',
      groupName: '框外',
      position: { x: 0.2, y: 0.3 },
      text: '第二句'
    })
    if (!result.ok) throw new Error(result.reason)
    expect(result.insertedIndex).toBe(2)

    const document = parseLabelPlusContent(result.text)
    const target = document.images.find((image) => image.fileName === '20.jpg')
    expect(target?.labels.map((label) => [label.index, label.group, label.text])).toEqual([
      [1, '框内', '第一句'],
      [2, '框外', '第二句']
    ])
  })
})

/**
 * 「**删除一条译文**」（第 5 批 5e，2026-10-07）—— 用户拍板定稿的删除口径。
 *
 * 三条定稿全部在这里成为锁：
 * ① 只删这一条**自己的行区间**（标签头 + 内容行）；**分隔空行原样留着**；
 * ② 删掉第 N 条后，**同一张图里**序号 > N 的条目**标签头序号 -1**（不留空号）；
 * ③ 找不到那一张图 / 那一条 ⇒ **整份拒绝**，一个字节都不写。
 *
 * fixture 沿用本文件上面那份 21 行 / 两张图 / 01.png 两条（第二条是**空译文**）的合成文本：
 *
 * ```
 * 10  >>>>>>>>[01.png]<<<<<<<<
 * 11  ----------------[1]----------------[0.4950,0.6920,1]
 * 12  第一句
 * 13  第二行
 * 14  (空)                       ← 条目之间的分隔空行：删除**不碰它**
 * 15  ----------------[2]----------------[0.1040,0.8770,1]   ← 空译文
 * 16  (空)
 * 17  (空)
 * 18  >>>>>>>>[02.png]<<<<<<<<
 * 19  ----------------[1]----------------[0.8330,0.6410,2]
 * 20  另一句
 * ```
 */
describe('删除一条译文（5e）', () => {
  const del = (labelIndex: number) =>
    deleteChapterTranslationEntry(CONTENT, { imageName: '01.png', labelIndex })

  it('① 只删「标签头 + 内容行」那三行，**其余每一行逐字节相同**（含后面那个分隔空行）', () => {
    const result = del(1)
    if (!result.ok) throw new Error(result.reason)

    // 判据用**行内容**表达、不用魔法下标（本文件 1 基、数组 0 基，我在这里写错过一次）。
    const deleted = LINES.slice(10, 13)
    expect(deleted).toEqual([
      '----------------[1]----------------[0.4950,0.6920,1]',
      '第一句',
      '第二行'
    ])

    const out = result.text.split('\n')
    // ① 被删的那三行已经不在了
    expect(out).not.toContain('第一句')
    // ② 图片块保留、**分隔空行也保留**：标题行的下一行就是那个空行
    expect(out.slice(9, 13)).toEqual([
      '>>>>>>>>[01.png]<<<<<<<<',
      '',
      '----------------[1]----------------[0.1040,0.8770,1]',
      ''
    ])
    // ③ 其余行逐行相同：删后的行数 = 原行数 - 3
    expect(out.length).toBe(LINES.length - 3)
    // ④ 其余每一行（按序剔除被删的三行、并算上重排）都还在原位
    const remaining = out.filter((line) => line !== '')
    expect(remaining).toEqual([
      '1,0',
      '-',
      '框内',
      '框外',
      '-',
      '翻译：某人',
      '校对：另一位',
      '>>>>>>>>[01.png]<<<<<<<<',
      '----------------[1]----------------[0.1040,0.8770,1]',
      '>>>>>>>>[02.png]<<<<<<<<',
      '----------------[1]----------------[0.8330,0.6410,2]',
      '另一句'
    ])
  })

  it('② 同图后续条目序号 -1，且**只换那个数字**（短横线 / 坐标串 / 别的图一个字节不动）', () => {
    const result = del(1)
    if (!result.ok) throw new Error(result.reason)

    expect(result.deletedIndex).toBe(1)
    expect(result.renumbered).toEqual([2])
    // 原第 15 行（`[2]`）变成 `[1]`，坐标串与短横线原样
    expect(result.text).toContain('----------------[1]----------------[0.1040,0.8770,1]')
    // 另一张图（02.png）的那一条**不许**被牵动
    expect(result.text).toContain('----------------[1]----------------[0.8330,0.6410,2]')
    expect(result.text).toContain('另一句')
    // 头部 credits 与版本行照旧
    expect(result.text).toContain('翻译：某人')
    expect(result.text).toContain('校对：另一位')
  })

  it('空译文那条（只有标签头、没有内容行）⇒ 只少一行', () => {
    const result = del(2)
    if (!result.ok) throw new Error(result.reason)

    const expected = LINES.filter((_, index) => index !== 14).join('\n')
    expect(result.text).toBe(expected)
    expect(result.renumbered).toEqual([])
  })

  it('③ 找不到这张图 / 这张图里没有这一条 ⇒ 拒绝（一个字节都不写）', () => {
    expect(deleteChapterTranslationEntry(CONTENT, { imageName: '99.png', labelIndex: 1 }).ok).toBe(
      false
    )
    expect(deleteChapterTranslationEntry(CONTENT, { imageName: '02.png', labelIndex: 2 }).ok).toBe(
      false
    )
    expect(deleteChapterTranslationEntry(CONTENT, { imageName: '', labelIndex: 1 }).ok).toBe(false)
    expect(deleteChapterTranslationEntry(CONTENT, { imageName: '01.png', labelIndex: 0 }).ok).toBe(
      false
    )
  })

  it('删完再解析：这一条真的不在了，后续条目序号是连续的（自证闭环）', () => {
    const result = del(1)
    if (!result.ok) throw new Error(result.reason)

    const document = parseLabelPlusContent(result.text)
    const first = document.images.find((image) => image.fileName === '01.png')
    expect(first?.labels.map((label) => label.index)).toEqual([1])
    // 图片块**保留**（删到空图块也是允许的中间状态）
    const second = document.images.find((image) => image.fileName === '02.png')
    expect(second?.labels.map((label) => label.index)).toEqual([1])
  })
})
