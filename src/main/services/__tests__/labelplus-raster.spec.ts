// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDialogOverlayRaster, decodeLabelPlusSourceImage, pixelDataToPngDataUrl } from '../labelplus-raster'
import { serializeLabelPlusPsd } from '../labelplus-psd'

vi.mock('electron', () => ({ nativeImage: {} }))

describe('LabelPlus raster preview encoding', () => {
  it('encodes RGBA pixels as a PNG data URL for the native preview window', () => {
    const dataUrl = pixelDataToPngDataUrl({
      width: 1,
      height: 1,
      data: new Uint8ClampedArray([0, 0, 0, 255])
    })
    const buffer = Buffer.from(dataUrl.slice('data:image/png;base64,'.length), 'base64')
    expect(dataUrl.startsWith('data:image/png;base64,')).toBe(true)
    expect(buffer.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    expect(buffer.includes(Buffer.from('IHDR'))).toBe(true)
  })

  it('does not validate an unused custom overlay color in sample mode', () => {
    expect(() =>
      createDialogOverlayRaster(
        {
          width: 8,
          height: 8,
          data: new Uint8ClampedArray(8 * 8 * 4).fill(255)
        },
        [{ x: 4, y: 4 }],
        {
          enabled: true,
          groups: [],
          radiusXPx: 2,
          radiusYPx: 2,
          colorMode: 'sample',
          customColor: 'not-a-color'
        }
      )
    ).not.toThrow()
  })

  it('decodes the composite of a generated PSD for output preview', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'labelplus-raster-'))
    const background = {
      width: 2,
      height: 1,
      data: new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255])
    }
    const composite = {
      width: 2,
      height: 1,
      data: new Uint8ClampedArray([0, 0, 255, 255, 255, 255, 0, 255])
    }
    const path = join(folder, 'preview.psd')
    try {
      await writeFile(
        path,
        serializeLabelPlusPsd({
          width: background.width,
          height: background.height,
          resolutionPpi: 300,
          background,
          composite,
          textLayers: [],
          groupOrder: [],
          createLayerGroups: true
        })
      )
      const decoded = await decodeLabelPlusSourceImage(path)
      expect(decoded.width).toBe(2)
      expect([...decoded.data]).toEqual([...composite.data])
    } finally {
      await rm(folder, { recursive: true, force: true })
    }
  })
})
