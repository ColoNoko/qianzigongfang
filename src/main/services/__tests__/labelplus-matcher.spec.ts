// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { matchLabelPlusImages } from '../labelplus-matcher'
import type { LabelPlusDocument } from '@shared/labelplus-import'

const document: LabelPlusDocument = {
  sourcePath: 'labels.txt',
  version: { first: 1, last: 0 },
  groups: ['框内', '框外'],
  images: [
    {
      fileName: 'page-2.png',
      labels: [
        {
          index: 1,
          group: '框内',
          text: 'two',
          position: { unit: 'normalized', x: 0.1, y: 0.1 }
        }
      ]
    },
    {
      fileName: 'page-10.png',
      labels: []
    }
  ],
  warnings: []
}

describe('LabelPlus source matching', () => {
  it('matches by stem and honors a forced extension', () => {
    const result = matchLabelPlusImages(
      document,
      [
        { name: 'page-2.jpg', absPath: 'C:/images/page-2.jpg' },
        { name: 'page-2.png', absPath: 'C:/images/page-2.png' },
        { name: 'page-10.webp', absPath: 'C:/images/page-10.webp' }
      ],
      { mode: 'file-name', forcedExtension: '.jpg' }
    )

    expect(result.rows.map((row) => row.sourceFileName)).toEqual(['page-2.jpg', null])
    expect(result.matchedCount).toBe(1)
  })

  it('uses natural order for sequential matching and reports count differences', () => {
    const result = matchLabelPlusImages(
      document,
      [
        { name: '10.jpg', absPath: 'C:/images/10.jpg' },
        { name: '2.jpg', absPath: 'C:/images/2.jpg' }
      ],
      { mode: 'sequential', forcedExtension: '' }
    )

    expect(result.rows.map((row) => row.sourceFileName)).toEqual(['2.jpg', '10.jpg'])
    expect(result.warnings).toHaveLength(0)
    expect(result.rows[0].matched).toBe(true)
  })

  it('prefers a PSD source when the label stem has multiple extensions', () => {
    const result = matchLabelPlusImages(
      {
        ...document,
        images: [{ ...document.images[0], fileName: 'page-2.jpg' }]
      },
      [
        { name: 'page-2.png', absPath: 'C:/images/page-2.png' },
        { name: 'page-2.psd', absPath: 'C:/images/page-2.psd' }
      ],
      { mode: 'file-name', forcedExtension: '' }
    )
    expect(result.rows[0].sourceFileName).toBe('page-2.psd')
  })
})
