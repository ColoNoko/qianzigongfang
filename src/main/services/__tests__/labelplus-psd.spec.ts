// @vitest-environment node
import { describe, expect, it, beforeAll } from 'vitest'
import { initializeCanvas, readPsd } from 'ag-psd'
import {
  buildLabelPlusPsd,
  serializeLabelPlusPsd,
  type BuildLabelPlusPsdInput,
  type PreparedTextLayer
} from '../labelplus-psd'
import { createDefaultTextStyle } from '@shared/labelplus-import'

function pixelData() {
  return { width: 8, height: 6, data: new Uint8ClampedArray(8 * 6 * 4).fill(255) }
}

function textLayer(group: string): PreparedTextLayer {
  const style = createDefaultTextStyle()
  return {
    name: '示例文字',
    text: '示例文字',
    group,
    position: { unit: 'px', anchor: 'baseline', x: 2, y: 3 },
    style
  }
}

function input(): BuildLabelPlusPsdInput {
  const background = pixelData()
  return {
    width: background.width,
    height: background.height,
    resolutionPpi: 300,
    background,
    composite: pixelData(),
    textLayers: [textLayer('框内'), textLayer('框外')],
    groupOrder: ['框内', '框外'],
    createLayerGroups: true
  }
}

describe('LabelPlus PSD writer', () => {
  beforeAll(() => {
    initializeCanvas(((width: number, height: number) => ({
      width,
      height,
      getContext: () => ({
        createImageData: (nextWidth: number, nextHeight: number) => ({
          width: nextWidth,
          height: nextHeight,
          data: new Uint8ClampedArray(nextWidth * nextHeight * 4),
          colorSpace: 'srgb' as const
        }),
        putImageData: () => undefined,
        getImageData: () => ({
          width,
          height,
          data: new Uint8ClampedArray(width * height * 4),
          colorSpace: 'srgb' as const
        })
      })
    })) as unknown as Parameters<typeof initializeCanvas>[0])
  })

  it('creates separate frame groups and native horizontal text descriptors', () => {
    const psd = buildLabelPlusPsd(input())
    const groups = psd.children?.filter((layer) => layer.children)
    expect(groups?.map((group) => group.name)).toEqual(['框内', '框外'])
    expect(psd.children?.map((layer) => layer.name)).toEqual(['原图片', '框内', '框外'])
    const firstText = groups?.[0]?.children?.[0]
    expect(firstText?.text?.orientation).toBe('horizontal')
    expect(firstText?.text?.transform).toEqual([1, 0, 0, 1, 2, 3])
    expect(firstText?.text?.style?.font?.name).toBe('ArialMT')
  })

  /**
   * 字号是**像素**，但 ag-psd 写进描述符的 `fontSize` 会被 PS 当"点"、按文档分辨率
   * （这份 PSD 声明的 `resolutionPpi`）解释。所以要按 72/ppi 折算，PS 打开时才得到
   * 与工坊预览一样的像素。
   *
   * 不折算的后果（2026-09-23 真机）：本地预览 75px、PS 里 18px，差 4 倍多。
   */
  it('字号按像素折算进描述符：ppi 越高，写进去的点数越小', () => {
    const at72 = input()
    at72.resolutionPpi = 72
    at72.textLayers[0].style = { ...at72.textLayers[0].style, fontSizePx: 72 }

    const at300 = input()
    at300.resolutionPpi = 300
    at300.textLayers[0].style = { ...at300.textLayers[0].style, fontSizePx: 72 }

    const fontSizeOf = (value: typeof at72): number | undefined =>
      buildLabelPlusPsd(value).children
        ?.flatMap((layer) => layer.children ?? [])
        .find((layer) => layer.text)?.text?.style?.fontSize

    // 72ppi 时 1pt == 1px，原样写。
    expect(fontSizeOf(at72)).toBeCloseTo(72, 5)
    // 300ppi 时要把 72px 折算成 17.28pt —— PS 才会渲染成 72px。
    expect(fontSizeOf(at300)).toBeCloseTo(72 * (72 / 300), 5)
  })

  it('自由连字写进 PSD 描述符，关掉也要如实写', () => {
    const readLigatures = (value: ReturnType<typeof input>): boolean | undefined =>
      buildLabelPlusPsd(value).children
        ?.flatMap((layer) => layer.children ?? [])
        .find((layer) => layer.text)?.text?.style?.ligatures

    // 默认是开的（跟随 PS 与 ag-psd 的默认）。
    expect(readLigatures(input())).toBe(true)

    const off = input()
    off.textLayers[0].style = { ...off.textLayers[0].style, ligatures: false }
    expect(readLigatures(off)).toBe(false)
  })

  /**
   * 标准垂直罗马对齐方式 = baselineDirection（1 开 / 2 关）—— 读两份只差这个开关的
   * PSD 差分出来的真值。这里**序列化之后再用 ag-psd 读回来**验，不看中间对象。
   */
  it('标准垂直罗马对齐写进描述符，横排不写', () => {
    const verticalOn = input()
    verticalOn.textLayers[0].style = {
      ...verticalOn.textLayers[0].style,
      direction: 'vertical',
      standardVerticalRoman: true
    }
    const verticalOff = input()
    verticalOff.textLayers[0].style = {
      ...verticalOff.textLayers[0].style,
      direction: 'vertical',
      standardVerticalRoman: false
    }
    const horizontal = input()
    horizontal.textLayers[0].style = {
      ...horizontal.textLayers[0].style,
      direction: 'horizontal'
    }

    const readBaseline = (value: typeof verticalOn): number | undefined => {
      const parsed = readPsd(serializeLabelPlusPsd(value), {
        useImageData: true,
        useRawData: true
      })
      return parsed.children
        ?.flatMap((layer) => layer.children ?? [])
        .find((layer) => layer.text)?.text?.style?.baselineDirection
    }

    expect(readBaseline(verticalOn)).toBe(1)
    expect(readBaseline(verticalOff)).toBe(2)
    // 横排：**一个字段都不写**。ag-psd 不显式设置时本来就不写它，
    // 于是 PS 用它自己的默认 —— 我们不去替它定横排该取什么值（没测过）。
    expect(readBaseline(horizontal)).toBeUndefined()
  })

  it('serializes a valid PSD buffer', () => {
    const buffer = serializeLabelPlusPsd(input())
    expect(buffer.subarray(0, 4).toString('ascii')).toBe('8BPS')
    expect(buffer.length).toBeGreaterThan(100)

    const parsed = readPsd(buffer, { useImageData: true, useRawData: true })
    expect(parsed.children?.map((layer) => layer.name)).toEqual(['原图片', '框内', '框外'])
    const textLayers = parsed.children
      ?.flatMap((group) => group.children ?? [])
      .filter((layer) => layer.text) ?? []
    // The initial writer intentionally leaves TextIndex and TySh bounds
    // absent. ag-psd serializes the descriptor in the same form as its own
    // simple text example; synthetic non-zero indexes/bounds were introduced
    // later and made Photoshop reject the layers.
    expect(textLayers.map((layer) => layer.text?.index)).toEqual([0, 0])
  })

  it('keeps a safe horizontal descriptor for vertical preview requests', () => {
    const vertical = input()
    vertical.textLayers[0].style = {
      ...vertical.textLayers[0].style,
      direction: 'vertical'
    }
    const psd = buildLabelPlusPsd(vertical)
    const insideGroup = psd.children?.find((layer) => layer.name === '框内')
    expect(insideGroup?.children?.[0]?.text?.orientation).toBe('horizontal')

    const parsed = readPsd(serializeLabelPlusPsd(vertical), { useImageData: true, useRawData: true })
    const parsedInside = parsed.children?.find((layer) => layer.name === '框内')
    expect(parsedInside?.children?.[0]?.text?.orientation).toBe('horizontal')
  })
})
