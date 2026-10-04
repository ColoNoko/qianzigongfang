import { describe, expect, it } from 'vitest'
import {
  applyTextReplacementRules,
  createDefaultLabelPlusGenerateOptions,
  normalizedToPsdPosition,
  normalizeTextDirection,
  orderLabelPlusGroups,
  parseHexColor,
  parseTextReplacementExpression
} from '../labelplus-import'

describe('LabelPlus standard API helpers', () => {
  it('converts normalized text-box coordinates to px baseline coordinates', () => {
    expect(
      normalizedToPsdPosition(
        { unit: 'normalized', x: 0.25, y: 0.5, width: 0.2, height: 0.1 },
        1000,
        800,
        { x: 4, y: -2 }
      )
    ).toEqual({
      unit: 'px',
      anchor: 'baseline',
      x: 254,
      y: 398,
      width: 200,
      height: 80
    })
  })

  it('provides canonical font, direction and style defaults', () => {
    const options = createDefaultLabelPlusGenerateOptions()
    expect(options.textStyle).toMatchObject({
      direction: 'horizontal',
      fontSizePx: 24,
      fauxBold: false,
      fauxItalic: false,
      font: { family: 'Arial', postScriptName: 'ArialMT' }
    })
    expect(options.textStyle.fillColor).toBe('#000000')
  })

  it('normalizes the legacy vertical orientation alias for compatibility warnings', () => {
    expect(normalizeTextDirection({ orientation: 'vertical' })).toBe('vertical')
    expect(normalizeTextDirection({ direction: 'horizontal', orientation: 'vertical' })).toBe(
      'horizontal'
    )
  })

  it('orders PSD groups outside before inside while keeping other groups stable', () => {
    expect(orderLabelPlusGroups(['框内', '旁白', '框外', '_Label'])).toEqual([
      '_Label',
      '框外',
      '框内',
      '旁白'
    ])
  })

  it('parses colors and applies ordered replacement rules', () => {
    expect(parseHexColor('#abc')).toEqual({ r: 170, g: 187, b: 204 })
    const rules = parseTextReplacementExpression('！？->!?|……->...')
    expect(applyTextReplacementRules('！？……', rules)).toBe('!?...')
  })
})
