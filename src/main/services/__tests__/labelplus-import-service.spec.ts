// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { inflateSync } from 'node:zlib'
import {
  createDefaultLabelPlusGenerateOptions,
  type LabelPlusGenerateOptions
} from '@shared/labelplus-import'
import {
  generateLabelPlusPsd,
  renderLabelPlusPreviewPage,
  type LabelPlusPreviewContext
} from '../labelplus-import-service'
import { decodeLabelPlusSourceImage } from '../labelplus-raster'
import { serializeLabelPlusPsd } from '../labelplus-psd'

const electronMock = vi.hoisted(() => {
  interface MockImage {
    isEmpty(): boolean
    getSize(): { width: number; height: number }
    resize(options: { width: number; height: number }): MockImage
    toBitmap(): Buffer
  }

  const emptyImage = (): MockImage => ({
    isEmpty: () => true,
    getSize: () => ({ width: 0, height: 0 }),
    resize: () => emptyImage(),
    toBitmap: () => Buffer.alloc(0)
  })

  const renderedImage = (width = 1, height = 1): MockImage => ({
    isEmpty: () => false,
    getSize: () => ({ width, height }),
    resize: (options) => renderedImage(options.width, options.height),
    toBitmap: () => {
      const bitmap = Buffer.alloc(width * height * 4)
      const x = Math.floor(width / 2)
      const y = Math.floor(height / 2)
      const offset = (y * width + x) * 4
      bitmap[offset + 3] = 255
      return bitmap
    }
  })

  const createFromDataURL = vi.fn((dataUrl: string) =>
    dataUrl.startsWith('data:image/svg+xml') ? emptyImage() : renderedImage()
  )
  const executeJavaScript = vi.fn().mockResolvedValue('data:image/png;base64,AAAA')
  const instances: Array<{ destroyed: boolean; destroy: ReturnType<typeof vi.fn> }> = []

  class BrowserWindow {
    destroyed = false
    webContents = { executeJavaScript }
    loadURL = vi.fn().mockResolvedValue(undefined)
    destroy = vi.fn(() => {
      this.destroyed = true
    })
    isDestroyed = vi.fn(() => this.destroyed)

    constructor() {
      instances.push(this)
    }
  }

  return {
    BrowserWindow,
    createFromDataURL,
    executeJavaScript,
    instances,
    reset(): void {
      createFromDataURL.mockClear()
      executeJavaScript.mockClear()
      executeJavaScript.mockResolvedValue('data:image/png;base64,AAAA')
      instances.splice(0)
    }
  }
})

vi.mock('electron', () => ({
  BrowserWindow: electronMock.BrowserWindow,
  nativeImage: { createFromDataURL: electronMock.createFromDataURL }
}))

function solidPixels(width: number, height: number, rgba: [number, number, number, number]) {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let offset = 0; offset < data.length; offset += 4) data.set(rgba, offset)
  return { width, height, data }
}

function decodeOwnPng(dataUrl: string): { width: number; height: number; data: Uint8Array } {
  const buffer = Buffer.from(dataUrl.slice('data:image/png;base64,'.length), 'base64')
  const idat: Buffer[] = []
  let width = 0
  let height = 0
  let offset = 8
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset)
    const type = buffer.toString('ascii', offset + 4, offset + 8)
    const payload = buffer.subarray(offset + 8, offset + 8 + length)
    if (type === 'IHDR') {
      width = payload.readUInt32BE(0)
      height = payload.readUInt32BE(4)
    } else if (type === 'IDAT') {
      idat.push(payload)
    }
    offset += 12 + length
    if (type === 'IEND') break
  }
  const scanlines = inflateSync(Buffer.concat(idat))
  const rowLength = width * 4
  const data = new Uint8Array(rowLength * height)
  for (let row = 0; row < height; row += 1) {
    expect(scanlines[row * (rowLength + 1)]).toBe(0)
    data.set(
      scanlines.subarray(row * (rowLength + 1) + 1, (row + 1) * (rowLength + 1)),
      row * rowLength
    )
  }
  return { width, height, data }
}

async function writeSolidPsd(
  path: string,
  background: ReturnType<typeof solidPixels>,
  composite = background
): Promise<void> {
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
}

describe('LabelPlus generated output preview', () => {
  beforeEach(() => electronMock.reset())

  it('writes browser-rasterized text into the generated PSD composite', async () => {
    const root = await mkdtemp(join(tmpdir(), 'labelplus-generate-'))
    const sourceDirectory = join(root, 'source')
    const outputDirectory = join(root, 'output')
    const labelFilePath = join(root, 'labels.json')
    const sourcePath = join(sourceDirectory, 'page.psd')
    await mkdir(sourceDirectory)
    const background = solidPixels(512, 512, [255, 255, 255, 255])
    try {
      await writeSolidPsd(sourcePath, background)
      await writeFile(
        labelFilePath,
        JSON.stringify({
          groups: ['框内'],
          images: {
            'page.psd': [{ x: 0.5, y: 0.5, group: '框内', contents: 'Hi' }]
          }
        }),
        'utf8'
      )
      const options: LabelPlusGenerateOptions = createDefaultLabelPlusGenerateOptions()
      options.overwriteExisting = true
      const result = await generateLabelPlusPsd({
        apiVersion: 1,
        labelFilePath,
        sourceDirectory,
        outputDirectory,
        match: { mode: 'file-name', forcedExtension: '' },
        selectedImageNames: ['page.psd'],
        selectedGroups: ['框内'],
        options
      })

      expect(result.failedCount).toBe(0)
      expect(result.generatedCount).toBe(1)
      const outputPath = result.files[0].outputPath
      expect(outputPath).toBeTruthy()
      const decoded = await decodeLabelPlusSourceImage(outputPath as string)
      const changedPixels = Array.from({ length: decoded.width * decoded.height }, (_, index) => {
        const offset = index * 4
        return decoded.data[offset] !== 255 || decoded.data[offset + 1] !== 255 || decoded.data[offset + 2] !== 255
      }).filter(Boolean)
      expect(changedPixels.length).toBeGreaterThan(0)
      expect(electronMock.executeJavaScript).toHaveBeenCalled()
      expect(electronMock.instances).toHaveLength(1)
      expect(electronMock.instances[0].destroy).toHaveBeenCalledTimes(1)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('reads the generated PSD composite instead of the source image for output mode', async () => {
    const root = await mkdtemp(join(tmpdir(), 'labelplus-preview-page-'))
    const sourcePath = join(root, 'source.psd')
    const outputPath = join(root, 'output.psd')
    const source = solidPixels(2, 1, [255, 0, 0, 255])
    const output = solidPixels(2, 1, [0, 0, 255, 255])
    try {
      await writeSolidPsd(sourcePath, source)
      await writeSolidPsd(outputPath, source, output)
      const context: LabelPlusPreviewContext = {
        document: {
          sourcePath: join(root, 'labels.json'),
          version: { first: 1, last: 0 },
          groups: ['框内'],
          images: [{ fileName: 'page.png', labels: [] }],
          warnings: []
        },
        rows: [
          {
            labelImageName: 'page.png',
            labelCount: 0,
            sourceFileName: 'source.psd',
            sourcePath,
            matched: true,
            message: 'matched'
          }
        ],
        options: createDefaultLabelPlusGenerateOptions(),
        rules: [],
        selectedGroups: new Set(['框内']),
        warnings: [],
        previewOutputPaths: { 'page.png': outputPath }
      }

      const page = await renderLabelPlusPreviewPage(context, 0, 'output')
      const decoded = decodeOwnPng(page.dataUrl)
      expect(decoded.width).toBe(output.width)
      expect(decoded.height).toBe(output.height)
      expect([...decoded.data]).toEqual([...output.data])
      expect(electronMock.instances).toHaveLength(0)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  /**
   * 2026-09-30 审查 critical：`selectedImageNames` 为空数组时的语义。
   *
   * 原判据是 `selectedImages.size > 0 && !selectedImages.has(name)` —— size === 0 时
   * 后半句永不成立，于是**空数组等于「全选」**。界面上「清空」（已选 0 张）因此会把整份
   * 文本的每一张图都出图；勾了「覆盖已有 PSD」时更是直接覆盖用户没勾的文件。
   *
   * 这里锁新语义：**空数组 = 什么都不选**。要全量，必须由界面显式「全选」把数组填满
   * （Import.vue 的 selectAllImages），不能靠"留空"表达。
   */
  it('selectedImageNames 为空数组时：什么都不生成（空 ≠ 全选）', async () => {
    const root = await mkdtemp(join(tmpdir(), 'labelplus-empty-selection-'))
    const sourceDirectory = join(root, 'source')
    const outputDirectory = join(root, 'output')
    const labelFilePath = join(root, 'labels.json')
    const sourcePath = join(sourceDirectory, 'page.psd')
    await mkdir(sourceDirectory)
    try {
      await writeSolidPsd(sourcePath, solidPixels(64, 64, [255, 255, 255, 255]))
      await writeFile(
        labelFilePath,
        JSON.stringify({
          groups: ['框内'],
          images: { 'page.psd': [{ x: 0.5, y: 0.5, group: '框内', contents: 'Hi' }] }
        }),
        'utf8'
      )
      const options: LabelPlusGenerateOptions = createDefaultLabelPlusGenerateOptions()
      options.overwriteExisting = true

      const result = await generateLabelPlusPsd({
        apiVersion: 1,
        labelFilePath,
        sourceDirectory,
        outputDirectory,
        match: { mode: 'file-name', forcedExtension: '' },
        selectedImageNames: [],
        selectedGroups: ['框内'],
        options
      })

      expect(result.generatedCount).toBe(0)
      expect(result.failedCount).toBe(0)
      expect(result.skippedCount).toBe(1)
      expect(result.files.filter((file) => file.status === 'generated')).toHaveLength(0)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
