// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { parseLabelPlusContent } from '../labelplus-parser'

describe('LabelPlus parser', () => {
  it('parses the official TXT format and preserves frame groups', () => {
    const document = parseLabelPlusContent(
      [
        '1,0',
        '-',
        '框内',
        '框外',
        '-',
        'comment',
        '>>>>>>>>[page-01.png]<<<<<<<<',
        '------[1]------[0.125,0.25,1]',
        '框内文字',
        '',
        '------[2]------[0.5,0.75,2]',
        '框外文字'
      ].join('\n'),
      'labels.txt'
    )

    expect(document.groups).toEqual(['框内', '框外'])
    expect(document.images).toHaveLength(1)
    expect(document.images[0].labels).toEqual([
      {
        index: 1,
        group: '框内',
        text: '框内文字',
        position: { unit: 'normalized', x: 0.125, y: 0.25 }
      },
      {
        index: 2,
        group: '框外',
        text: '框外文字',
        position: { unit: 'normalized', x: 0.5, y: 0.75 }
      }
    ])
  })

  it('parses JSON without evaluating executable content', () => {
    const document = parseLabelPlusContent(
      JSON.stringify({
        groups: ['框内', '框外'],
        images: {
          'page.png': [
            { x: 0.2, y: 0.3, group: '框内', contents: 'JSON 文本' },
            { x: 0.8, y: 0.7, group: '框外', contents: '第二条' }
          ]
        }
      }),
      'labels.json'
    )

    expect(document.images[0].labels.map((label) => label.group)).toEqual(['框内', '框外'])
    expect(document.images[0].labels[0].position).toEqual({
      unit: 'normalized',
      x: 0.2,
      y: 0.3
    })
  })

  it('rejects malformed coordinates', () => {
    expect(() =>
      parseLabelPlusContent(
        '1,0\n-\n框内\n-\n>>>>>>>>[page.png]<<<<<<<<\n------[1]------[oops,0,1]\ntext',
        'labels.txt'
      )
    ).toThrow('坐标无效')
  })
})
