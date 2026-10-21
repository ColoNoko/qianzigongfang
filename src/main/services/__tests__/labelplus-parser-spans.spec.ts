/**
 * LabelPlus 文本的**行号区间**（P2-a，2026-10-06）
 *
 * 为什么需要它：P2 的写回策略是**原地改行** —— 只替换"被改的那一条"所占的行，
 * 文件其余字节原样搬运。要做到这点，必须先知道**每一条的标签头在文件的第几行、
 * 它的文本内容占哪几行**。
 *
 * 行号口径（与 parser 内部一致）：**1 基**，针对**规范化后的文本**
 * （去掉 BOM、CRLF/CR 统一成 LF）。回写时按原始换行风格还原，见写回服务。
 *
 * ⚠️ 这份 fixture 是**合成的**（不抄任何真实译文、不含真实路径）——
 * 公开仓审计规则要求，也是仓库反复强调的"合成 fixture"。
 */
import { describe, expect, it } from 'vitest'
import {
  matchLabelPlusFileHeader,
  matchLabelPlusLabelHeader,
  parseLabelPlusTextWithSpans
} from '../labelplus-parser'

/**
 * 一份"真实形状"的合成文本：
 * · 头部有版本行、两条 `-` 夹着的分组表、以及**parser 不解析的 credits 行**（`翻译：` / `校对：`）
 * · 标签头是 **16 个短横线**（真实文件就是这个宽度；parser 的正则吃 6 个以上）
 * · 每条文本后面跟一个**空行**做分隔
 * · 第二条**没有内容行**（空译文）
 */
const LINES = [
  '1,0', // 1
  '-', // 2
  '框内', // 3
  '框外', // 4
  '-', // 5
  '翻译：某人', // 6  ← parser 不解析，但回写时一个字节都不许动
  '校对：另一位', // 7
  '', // 8
  '', // 9
  '>>>>>>>>[01.png]<<<<<<<<', // 10
  '----------------[1]----------------[0.4950,0.6920,1]', // 11
  '第一句', // 12
  '第二行', // 13
  '', // 14
  '----------------[2]----------------[0.1040,0.8770,1]', // 15
  '', // 16  ← 空译文
  '', // 17
  '>>>>>>>>[02.png]<<<<<<<<', // 18
  '----------------[1]----------------[0.8330,0.6410,2]', // 19
  '另一句' // 20
]

const CONTENT = LINES.join('\n')

describe('LabelPlus 文本 · 每条的行号区间', () => {
  it('三种形状各一条：多行文本 / 空译文 / 跨图片', () => {
    const { spans } = parseLabelPlusTextWithSpans(CONTENT)

    expect(spans).toEqual([
      {
        imageName: '01.png',
        labelIndex: 1,
        headerLine: 11,
        contentStartLine: 12,
        contentEndLine: 13
      },
      {
        imageName: '01.png',
        labelIndex: 2,
        headerLine: 15,
        contentStartLine: 0,
        contentEndLine: 0
      },
      {
        imageName: '02.png',
        labelIndex: 1,
        headerLine: 19,
        contentStartLine: 20,
        contentEndLine: 20
      }
    ])
  })

  it('行号指的是**规范化后**的行（去 BOM / CRLF 也按同一口径）', () => {
    const withBom = `\uFEFF${CONTENT}`
    const crlf = CONTENT.replace(/\n/g, '\r\n')

    const bomSpans = parseLabelPlusTextWithSpans(withBom).spans
    const crlfSpans = parseLabelPlusTextWithSpans(crlf).spans

    // 去 BOM 不改变行号；CRLF 统一成 LF 之后行号一致
    expect(bomSpans).toEqual(parseLabelPlusTextWithSpans(CONTENT).spans)
    expect(crlfSpans).toEqual(parseLabelPlusTextWithSpans(CONTENT).spans)
  })

  it('区间取回来就是那几行（自证：拿行号去切原文，切出来的必须是标签头与译文）', () => {
    const { spans } = parseLabelPlusTextWithSpans(CONTENT)
    const lines = CONTENT.split('\n')

    for (const span of spans) {
      // 标签头那一行必须真的长得像标签头
      expect(matchLabelPlusLabelHeader(lines[span.headerLine - 1])).not.toBeNull()
      if (span.contentStartLine === 0) continue
      const text = lines.slice(span.contentStartLine - 1, span.contentEndLine).join('\n')
      expect(text.trim().length).toBeGreaterThan(0)
    }

    // 具体到第一条：切出来就是它的两行译文
    expect(lines.slice(10, 13).join('\n')).toBe(
      ['----------------[1]----------------[0.4950,0.6920,1]', '第一句', '第二行'].join('\n')
    )
  })

  it('首尾空行**不算**内容区（那是分隔，回头要原样留着）', () => {
    const { spans } = parseLabelPlusTextWithSpans(CONTENT)
    const first = spans[0]
    const lines = CONTENT.split('\n')

    // 第 14 行是分隔空行 —— 内容区必须在它之前结束
    expect(lines[13]).toBe('')
    expect(first.contentEndLine).toBe(13)
    // 内容区里不该有空行开头/结尾
    expect(lines[first.contentStartLine - 1].trim()).not.toBe('')
    expect(lines[first.contentEndLine - 1].trim()).not.toBe('')
  })

  it('文本中间的空行算**内容**（多段译文不能被切掉）', () => {
    const withGap = [
      '>>>>>>>>[01.png]<<<<<<<<',
      '------[1]------[0.1,0.2,1]',
      '上段',
      '',
      '下段'
    ].join('\n')
    const { spans, document } = parseLabelPlusTextWithSpans(withGap)

    expect(spans[0]).toMatchObject({ contentStartLine: 3, contentEndLine: 5 })
    // parser 的既有口径：整块 trim，中间的空行留着
    expect(document.images[0].labels[0].text).toBe('上段\n\n下段')
  })

  it('解析结果本身与既有口径**一字不差**（这一刀只加信息，不改语义）', () => {
    const { document } = parseLabelPlusTextWithSpans(CONTENT)

    expect(document.groups).toEqual(['框内', '框外'])
    expect(document.images.map((image) => image.fileName)).toEqual(['01.png', '02.png'])
    expect(document.images[0].labels.map((label) => label.text)).toEqual(['第一句\n第二行', ''])
    expect(document.images[1].labels[0]).toMatchObject({
      index: 1,
      group: '框外',
      position: { unit: 'normalized', x: 0.833, y: 0.641 }
    })
  })
})

describe('LabelPlus 文本 · 两种行头各认各的（写回服务靠它定位，别各写一份正则）', () => {
  it('文件标题行：认 6 个以上的 >/<，取出图名', () => {
    expect(matchLabelPlusFileHeader('>>>>>>>>[01.png]<<<<<<<<')).toBe('01.png')
    expect(matchLabelPlusFileHeader('>>>>>>[ 02.jpg ]<<<<<<')).toBe('02.jpg')
    expect(matchLabelPlusFileHeader('>>>>>[太少]<<<<<')).toBeNull()
    expect(matchLabelPlusFileHeader('第一句')).toBeNull()
  })

  it('标签头：认 6 个以上的短横线，取出序号与坐标串', () => {
    expect(
      matchLabelPlusLabelHeader('----------------[7]----------------[0.4950,0.6920,1]')
    ).toEqual({
      index: 7,
      values: '0.4950,0.6920,1'
    })
    expect(matchLabelPlusLabelHeader('------[2]------[0.1,0.2,3]')).toEqual({
      index: 2,
      values: '0.1,0.2,3'
    })
    expect(matchLabelPlusLabelHeader('----- [3] ----- [0.1,0.2,1]')).toBeNull()
    expect(matchLabelPlusLabelHeader('第一句')).toBeNull()
  })
})
