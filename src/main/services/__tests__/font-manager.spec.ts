// @vitest-environment node
import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn()
  }
}))

let classifyCmapCoverage: typeof import('../font-manager').classifyCmapCoverage

beforeAll(async () => {
  const fontManager = await import('../font-manager')
  classifyCmapCoverage = fontManager.classifyCmapCoverage
})

function makeFormat12Cmap(ranges: Array<[number, number]>): Buffer {
  const subtableOffset = 12
  const subtableLength = 16 + ranges.length * 12
  const cmap = Buffer.alloc(subtableOffset + subtableLength)
  cmap.writeUInt16BE(0, 0)
  cmap.writeUInt16BE(1, 2)
  cmap.writeUInt16BE(3, 4)
  cmap.writeUInt16BE(10, 6)
  cmap.writeUInt32BE(subtableOffset, 8)
  cmap.writeUInt16BE(12, subtableOffset)
  cmap.writeUInt16BE(0, subtableOffset + 2)
  cmap.writeUInt32BE(subtableLength, subtableOffset + 4)
  cmap.writeUInt32BE(0, subtableOffset + 8)
  cmap.writeUInt32BE(ranges.length, subtableOffset + 12)
  ranges.forEach(([start, end], index) => {
    const offset = subtableOffset + 16 + index * 12
    cmap.writeUInt32BE(start, offset)
    cmap.writeUInt32BE(end, offset + 4)
    cmap.writeUInt32BE(1, offset + 8)
  })
  return cmap
}

describe('font Unicode coverage classification', () => {
  it('assigns multiple language tags from a Unicode format 12 cmap', () => {
    const cmap = makeFormat12Cmap([
      [0x0020, 0x007e],
      [0x3040, 0x30ff],
      [0x4e00, 0x9fff],
      [0x1f600, 0x1f64f]
    ])

    expect(classifyCmapCoverage(cmap)).toEqual(['chinese', 'japanese', 'latin', 'symbol'])
  })

  it('returns other for malformed or unclassified cmap data', () => {
    expect(classifyCmapCoverage(Buffer.alloc(2))).toEqual(['other'])
    expect(classifyCmapCoverage(makeFormat12Cmap([[0x0800, 0x08ff]]))).toEqual(['other'])
  })
})
