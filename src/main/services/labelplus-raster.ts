import { readFile } from 'node:fs/promises'
import { extname } from 'node:path'
import { BrowserWindow, nativeImage } from 'electron'
import { deflateSync } from 'node:zlib'
import type { PixelData } from 'ag-psd'
import type {
  LabelPlusDialogOverlayOptions,
  PsdTextPosition,
  StandardTextStyle
} from '@shared/labelplus-import'
import { decodePsdComposite } from '@shared/psd-composite'
import { clampFiniteNumber, parseHexColor } from '@shared/labelplus-import'
import type { PreparedRasterLayer } from './labelplus-psd'

const MAX_PSD_DIMENSION = 30_000
const MAX_IMAGE_BYTES = 768 * 1024 * 1024

export type NativeBitmapOrder = 'rgba' | 'bgra'

export interface LabelPlusTextRasterizer {
  rasterizeSvg(dataUrl: string, width: number, height: number): Promise<Uint8ClampedArray | undefined>
  dispose(): void
}

const TEXT_RASTERIZER_HTML = `data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html>
<html>
  <head><meta charset="utf-8"></head>
  <body>
    <script>
      window.__labelPlusRasterizeSvg = async (dataUrl, width, height) => {
        if (document.fonts && document.fonts.ready) await document.fonts.ready
        const image = new Image()
        image.decoding = 'sync'
        image.src = dataUrl
        await new Promise((resolve, reject) => {
          image.onload = resolve
          image.onerror = () => reject(new Error('SVG image decode failed'))
        })
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const context = canvas.getContext('2d')
        if (!context) throw new Error('Canvas 2D context is unavailable')
        context.clearRect(0, 0, width, height)
        context.drawImage(image, 0, 0, width, height)
        return canvas.toDataURL('image/png')
      }
    </script>
  </body>
</html>`)}`

function assertImageSize(width: number, height: number): void {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error('无法读取图源尺寸')
  }
  if (width > MAX_PSD_DIMENSION || height > MAX_PSD_DIMENSION) {
    throw new Error(`图源超过 PSD 的 ${MAX_PSD_DIMENSION}px 尺寸限制`)
  }
  if (width * height * 4 > MAX_IMAGE_BYTES) throw new Error('图源解码后超过 768 MB 内存限制')
}

function unpremultiply(channel: number, alpha: number): number {
  if (alpha <= 0 || alpha >= 255) return channel
  return Math.min(255, Math.round((channel * 255) / alpha))
}

export function nativeBitmapToRgba(
  bitmap: Uint8Array,
  order: NativeBitmapOrder,
  shouldUnpremultiply = true
): Uint8ClampedArray {
  if (bitmap.length % 4 !== 0) throw new Error('原始位图字节数不是 4 的倍数')
  const output = new Uint8ClampedArray(bitmap.length)
  for (let offset = 0; offset < bitmap.length; offset += 4) {
    const alpha = bitmap[offset + 3]
    let red = order === 'bgra' ? bitmap[offset + 2] : bitmap[offset]
    let green = bitmap[offset + 1]
    let blue = order === 'bgra' ? bitmap[offset] : bitmap[offset + 2]
    if (shouldUnpremultiply) {
      red = unpremultiply(red, alpha)
      green = unpremultiply(green, alpha)
      blue = unpremultiply(blue, alpha)
    }
    output[offset] = red
    output[offset + 1] = green
    output[offset + 2] = blue
    output[offset + 3] = alpha
  }
  return output
}

function currentBitmapOrder(): NativeBitmapOrder {
  return process.platform === 'darwin' ? 'rgba' : 'bgra'
}

function nativeImageToRgba(
  image: ReturnType<typeof nativeImage.createFromDataURL>,
  width: number,
  height: number
): Uint8ClampedArray | undefined {
  if (image.isEmpty()) return undefined
  const size = image.getSize()
  const normalized =
    size.width === width && size.height === height
      ? image
      : image.resize({ width, height, quality: 'best' })
  if (normalized.isEmpty()) return undefined
  const bitmap = normalized.toBitmap({ scaleFactor: 1 })
  if (bitmap.length !== width * height * 4) return undefined
  return nativeBitmapToRgba(bitmap, currentBitmapOrder())
}

/**
 * Electron's nativeImage does not decode SVG data URLs on every supported
 * Windows runtime. Keep a hidden Chromium renderer per import operation so
 * the PSD composite can still contain the exact text preview pixels.
 */
export async function createLabelPlusTextRasterizer(): Promise<LabelPlusTextRasterizer> {
  const window = new BrowserWindow({
    width: 16,
    height: 16,
    show: false,
    skipTaskbar: true,
    autoHideMenuBar: true,
    webPreferences: {
      sandbox: true,
      nodeIntegration: false,
      contextIsolation: true
    }
  })
  let disposed = false
  try {
    await window.loadURL(TEXT_RASTERIZER_HTML)
  } catch (error) {
    if (!window.isDestroyed()) window.destroy()
    throw error
  }

  return {
    async rasterizeSvg(
      dataUrl: string,
      width: number,
      height: number
    ): Promise<Uint8ClampedArray | undefined> {
      if (disposed || window.isDestroyed()) throw new Error('文字预览渲染器已关闭')
      const pngDataUrl = await window.webContents.executeJavaScript(
        `window.__labelPlusRasterizeSvg(${JSON.stringify(dataUrl)}, ${width}, ${height})`,
        true
      )
      if (typeof pngDataUrl !== 'string' || !pngDataUrl.startsWith('data:image/png')) {
        throw new Error('文字预览渲染器没有返回 PNG')
      }
      return nativeImageToRgba(nativeImage.createFromDataURL(pngDataUrl), width, height)
    },
    dispose(): void {
      if (disposed) return
      disposed = true
      if (!window.isDestroyed()) window.destroy()
    }
  }
}

async function rasterizeSvg(
  svg: string,
  width: number,
  height: number,
  rasterizer?: LabelPlusTextRasterizer
): Promise<Uint8ClampedArray | undefined> {
  const dataUrl = `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`
  const nativePixels = nativeImageToRgba(nativeImage.createFromDataURL(dataUrl), width, height)
  if (nativePixels) return nativePixels
  return rasterizer?.rasterizeSvg(dataUrl, width, height)
}

export async function decodeLabelPlusSourceImage(filePath: string): Promise<PixelData> {
  if (extname(filePath).toLocaleLowerCase() === '.psd') {
    const input = await readFile(filePath)
    const arrayBuffer = input.buffer.slice(
      input.byteOffset,
      input.byteOffset + input.byteLength
    )
    const decoded = decodePsdComposite(arrayBuffer)
    assertImageSize(decoded.width, decoded.height)
    return {
      width: decoded.width,
      height: decoded.height,
      data: new Uint8ClampedArray(decoded.rgba)
    }
  }

  const image = nativeImage.createFromPath(filePath)
  if (image.isEmpty()) throw new Error(`Electron 无法解码 ${extname(filePath) || '该'} 图源`)
  const size = image.getSize()
  assertImageSize(size.width, size.height)
  const bitmap = image.toBitmap({ scaleFactor: 1 })
  if (bitmap.length !== size.width * size.height * 4) {
    throw new Error('图源位图尺寸与像素数据不一致')
  }
  return {
    width: size.width,
    height: size.height,
    data: nativeBitmapToRgba(bitmap, currentBitmapOrder())
  }
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function characterWidthEm(character: string): number {
  const codePoint = character.codePointAt(0) ?? 0
  if (/\s/u.test(character)) return 0.35
  if (
    (codePoint >= 0x2e80 && codePoint <= 0x9fff) ||
    (codePoint >= 0xac00 && codePoint <= 0xd7af) ||
    codePoint > 0xffff
  ) {
    return 1
  }
  if (/[A-Z0-9]/u.test(character)) return 0.64
  if (/[a-z]/u.test(character)) return 0.56
  return 0.45
}

function estimateLineWidth(text: string, fontSizePx: number): number {
  return Array.from(text).reduce((sum, character) => sum + characterWidthEm(character), 0) * fontSizePx
}

function trimRaster(layer: PreparedRasterLayer): PreparedRasterLayer | undefined {
  let minX = layer.width
  let minY = layer.height
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < layer.height; y += 1) {
    for (let x = 0; x < layer.width; x += 1) {
      const alpha = layer.data[(y * layer.width + x) * 4 + 3]
      if (alpha === 0) continue
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
    }
  }
  if (maxX < minX || maxY < minY) return undefined

  const width = maxX - minX + 1
  const height = maxY - minY + 1
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    const sourceStart = ((minY + y) * layer.width + minX) * 4
    data.set(layer.data.subarray(sourceStart, sourceStart + width * 4), y * width * 4)
  }
  return { left: layer.left + minX, top: layer.top + minY, width, height, data }
}

function clipRasterToDocument(
  layer: PreparedRasterLayer,
  documentWidth: number,
  documentHeight: number
): PreparedRasterLayer | undefined {
  const left = Math.max(0, layer.left)
  const top = Math.max(0, layer.top)
  const right = Math.min(documentWidth, layer.left + layer.width)
  const bottom = Math.min(documentHeight, layer.top + layer.height)
  if (right <= left || bottom <= top) return undefined
  if (left === layer.left && top === layer.top && right === layer.left + layer.width && bottom === layer.top + layer.height) {
    return layer
  }

  const width = right - left
  const height = bottom - top
  const sourceX = left - layer.left
  const sourceY = top - layer.top
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    const sourceStart = ((sourceY + y) * layer.width + sourceX) * 4
    data.set(layer.data.subarray(sourceStart, sourceStart + width * 4), y * width * 4)
  }
  return { left, top, width, height, data }
}

export async function renderHorizontalTextRaster(
  text: string,
  position: PsdTextPosition,
  style: StandardTextStyle,
  documentWidth: number,
  documentHeight: number,
  rasterizer?: LabelPlusTextRasterizer
): Promise<PreparedRasterLayer | undefined> {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  // 字号就是**像素**，不吃分辨率 —— 理由见 shared/labelplus-import.ts 的 fontSizePx 注释。
  const fontSizePx = Math.max(1, style.fontSizePx)
  const lineHeightPx = Math.max(fontSizePx, (fontSizePx * style.leadingPercent) / 100)
  const textWidth = Math.max(fontSizePx, ...lines.map((line) => estimateLineWidth(line || ' ', fontSizePx)))
  const shadowPadding = style.shadow.enabled
    ? style.shadow.distancePx + style.shadow.blurPx * 2
    : 0
  const padding = Math.ceil(Math.max(4, style.strokeWidthPx * 2 + shadowPadding + 2))
  const width = Math.max(1, Math.ceil(textWidth + padding * 2))
  const height = Math.max(1, Math.ceil(fontSizePx + (lines.length - 1) * lineHeightPx + padding * 2))

  let left = Math.floor(position.x - padding)
  if (style.alignment === 'center') left = Math.floor(position.x - textWidth / 2 - padding)
  if (style.alignment === 'right') left = Math.floor(position.x - textWidth - padding)
  const top = Math.floor(position.y - fontSizePx - padding)
  const localX =
    style.alignment === 'left'
      ? padding
      : style.alignment === 'center'
        ? width / 2
        : width - padding
  const anchor = style.alignment === 'left' ? 'start' : style.alignment === 'center' ? 'middle' : 'end'
  const weight = style.fauxBold || /bold|black|heavy/i.test(style.font.style) ? 700 : 400
  const fontStyle = style.fauxItalic || /italic|oblique/i.test(style.font.style) ? 'italic' : 'normal'
  const shadowRadians = (style.shadow.angleDeg * Math.PI) / 180
  const shadowDx = Math.cos(shadowRadians) * style.shadow.distancePx
  const shadowDy = Math.sin(shadowRadians) * style.shadow.distancePx
  const shadowFilter = style.shadow.enabled
    ? `<filter id="shadow" x="-50%" y="-50%" width="200%" height="200%"><feDropShadow dx="${shadowDx}" dy="${shadowDy}" stdDeviation="${Math.max(0, style.shadow.blurPx / 2)}" flood-color="${xmlEscape(style.shadow.color)}" flood-opacity="${clampFiniteNumber(style.shadow.opacity, 0, 1)}"/></filter>`
    : ''
  const filterAttribute = style.shadow.enabled ? ' filter="url(#shadow)"' : ''
  const tspans = lines
    .map(
      (line, index) =>
        `<tspan x="${localX}" dy="${index === 0 ? 0 : lineHeightPx}">${xmlEscape(line || ' ')}</tspan>`
    )
    .join('')
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><defs>${shadowFilter}</defs><text x="${localX}" y="${padding + fontSizePx}" text-anchor="${anchor}" font-family="${xmlEscape(style.font.family)}" font-size="${fontSizePx}" font-weight="${weight}" font-style="${fontStyle}" fill="${xmlEscape(style.fillColor)}" stroke="${xmlEscape(style.strokeColor)}" stroke-width="${Math.max(0, style.strokeWidthPx * 2)}" stroke-linejoin="round" paint-order="stroke fill"${filterAttribute}>${tspans}</text></svg>`
  const pixels = await rasterizeSvg(svg, width, height, rasterizer)
  if (!pixels) return undefined
  const raster = trimRaster({
    left,
    top,
    width,
    height,
    data: pixels
  })
  return raster ? clipRasterToDocument(raster, documentWidth, documentHeight) : undefined
}

/**
 * Render a lightweight vertical preview raster. The PSD text layer remains
 * native/editable; this raster only keeps the flattened composite preview in
 * sync while the PSD is being opened outside Photoshop.
 */
export async function renderVerticalTextRaster(
  text: string,
  position: PsdTextPosition,
  style: StandardTextStyle,
  documentWidth: number,
  documentHeight: number,
  rasterizer?: LabelPlusTextRasterizer
): Promise<PreparedRasterLayer | undefined> {
  const columns = text.replace(/\r\n?/g, '\n').split('\n').map((line) => Array.from(line || ' '))
  const fontSizePx = Math.max(1, style.fontSizePx)
  const columnSpacing = Math.max(fontSizePx, (fontSizePx * style.leadingPercent) / 100)
  const maxCharacters = Math.max(1, ...columns.map((column) => column.length))
  const shadowPadding = style.shadow.enabled
    ? style.shadow.distancePx + style.shadow.blurPx * 2
    : 0
  const padding = Math.ceil(Math.max(4, style.strokeWidthPx * 2 + shadowPadding + 2))
  const textWidth = Math.max(fontSizePx, columns.length * columnSpacing)
  const textHeight = Math.max(fontSizePx, maxCharacters * fontSizePx)
  const width = Math.max(1, Math.ceil(textWidth + padding * 2))
  const height = Math.max(1, Math.ceil(textHeight + padding * 2))

  // x/y continue to denote the first baseline. For vertical writing the
  // first column grows upward from the requested baseline and subsequent
  // columns flow toward the left (the usual Photoshop vertical-rl order).
  let left = Math.floor(position.x - textWidth - padding)
  if (style.alignment === 'center') left = Math.floor(position.x - textWidth / 2 - padding)
  if (style.alignment === 'right') left = Math.floor(position.x - padding)
  const top = Math.floor(position.y - fontSizePx - padding)
  const weight = style.fauxBold || /bold|black|heavy/i.test(style.font.style) ? 700 : 400
  const fontStyle = style.fauxItalic || /italic|oblique/i.test(style.font.style) ? 'italic' : 'normal'
  const shadowRadians = (style.shadow.angleDeg * Math.PI) / 180
  const shadowDx = Math.cos(shadowRadians) * style.shadow.distancePx
  const shadowDy = Math.sin(shadowRadians) * style.shadow.distancePx
  const shadowFilter = style.shadow.enabled
    ? `<filter id="shadow" x="-50%" y="-50%" width="200%" height="200%"><feDropShadow dx="${shadowDx}" dy="${shadowDy}" stdDeviation="${Math.max(0, style.shadow.blurPx / 2)}" flood-color="${xmlEscape(style.shadow.color)}" flood-opacity="${clampFiniteNumber(style.shadow.opacity, 0, 1)}"/></filter>`
    : ''
  const filterAttribute = style.shadow.enabled ? ' filter="url(#shadow)"' : ''
  const textRuns = columns
    .map((column, columnIndex) => {
      const x = width - padding - columnIndex * columnSpacing
      return column
        .map(
          (character, characterIndex) =>
            `<tspan x="${x}" y="${padding + (characterIndex + 1) * fontSizePx}">${xmlEscape(character)}</tspan>`
        )
        .join('')
    })
    .join('')
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><defs>${shadowFilter}</defs><text text-anchor="middle" font-family="${xmlEscape(style.font.family)}" font-size="${fontSizePx}" font-weight="${weight}" font-style="${fontStyle}" fill="${xmlEscape(style.fillColor)}" stroke="${xmlEscape(style.strokeColor)}" stroke-width="${Math.max(0, style.strokeWidthPx * 2)}" stroke-linejoin="round" paint-order="stroke fill"${filterAttribute}>${textRuns}</text></svg>`
  const pixels = await rasterizeSvg(svg, width, height, rasterizer)
  if (!pixels) return undefined
  const raster = trimRaster({
    left,
    top,
    width,
    height,
    data: pixels
  })
  return raster ? clipRasterToDocument(raster, documentWidth, documentHeight) : undefined
}

export async function renderTextRaster(
  text: string,
  position: PsdTextPosition,
  style: StandardTextStyle,
  documentWidth: number,
  documentHeight: number,
  rasterizer?: LabelPlusTextRasterizer
): Promise<PreparedRasterLayer | undefined> {
  return style.direction === 'vertical'
    ? await renderVerticalTextRaster(
        text,
        position,
        style,
        documentWidth,
        documentHeight,
        rasterizer
      )
    : await renderHorizontalTextRaster(
        text,
        position,
        style,
        documentWidth,
        documentHeight,
        rasterizer
      )
}

export function createDialogOverlayRaster(
  background: PixelData,
  points: Array<{ x: number; y: number }>,
  options: LabelPlusDialogOverlayOptions
): PreparedRasterLayer | undefined {
  if (!options.enabled || points.length === 0) return undefined
  const radiusX = Math.max(1, Math.round(options.radiusXPx))
  const radiusY = Math.max(1, Math.round(options.radiusYPx))
  let minX = background.width
  let minY = background.height
  let maxX = -1
  let maxY = -1
  for (const point of points) {
    minX = Math.min(minX, Math.floor(point.x - radiusX - 2))
    minY = Math.min(minY, Math.floor(point.y - radiusY - 2))
    maxX = Math.max(maxX, Math.ceil(point.x + radiusX + 2))
    maxY = Math.max(maxY, Math.ceil(point.y + radiusY + 2))
  }
  minX = Math.max(0, minX)
  minY = Math.max(0, minY)
  maxX = Math.min(background.width, maxX)
  maxY = Math.min(background.height, maxY)
  if (maxX <= minX || maxY <= minY) return undefined

  const width = maxX - minX
  const height = maxY - minY
  const data = new Uint8ClampedArray(width * height * 4)
  const custom =
    options.colorMode === 'custom'
      ? parseHexColor(options.customColor)
      : { r: 255, g: 255, b: 255 }

  for (const point of points) {
    const centerX = Math.round(point.x)
    const centerY = Math.round(point.y)
    const sampleX = Math.min(background.width - 1, Math.max(0, centerX))
    const sampleY = Math.min(background.height - 1, Math.max(0, centerY))
    const sampleOffset = (sampleY * background.width + sampleX) * 4
    const color =
      options.colorMode === 'sample'
        ? {
            r: Number(background.data[sampleOffset]),
            g: Number(background.data[sampleOffset + 1]),
            b: Number(background.data[sampleOffset + 2])
          }
        : custom
    const startX = Math.max(minX, centerX - radiusX - 2)
    const endX = Math.min(maxX - 1, centerX + radiusX + 2)
    const startY = Math.max(minY, centerY - radiusY - 2)
    const endY = Math.min(maxY - 1, centerY + radiusY + 2)
    for (let y = startY; y <= endY; y += 1) {
      for (let x = startX; x <= endX; x += 1) {
        const distance = Math.sqrt(
          ((x - centerX) * (x - centerX)) / (radiusX * radiusX) +
            ((y - centerY) * (y - centerY)) / (radiusY * radiusY)
        )
        if (distance > 1.03) continue
        const alpha = distance <= 0.97 ? 255 : Math.round(((1.03 - distance) / 0.06) * 255)
        const offset = ((y - minY) * width + (x - minX)) * 4
        if (alpha <= data[offset + 3]) continue
        data[offset] = color.r
        data[offset + 1] = color.g
        data[offset + 2] = color.b
        data[offset + 3] = alpha
      }
    }
  }
  return trimRaster({ left: minX, top: minY, width, height, data })
}

export function clonePixelData(pixelData: PixelData): PixelData {
  return {
    width: pixelData.width,
    height: pixelData.height,
    data: new Uint8ClampedArray(pixelData.data)
  }
}

export function blendRasterOntoPixelData(target: PixelData, layer: PreparedRasterLayer): void {
  for (let y = 0; y < layer.height; y += 1) {
    const targetY = layer.top + y
    if (targetY < 0 || targetY >= target.height) continue
    for (let x = 0; x < layer.width; x += 1) {
      const targetX = layer.left + x
      if (targetX < 0 || targetX >= target.width) continue
      const sourceOffset = (y * layer.width + x) * 4
      const sourceAlpha = layer.data[sourceOffset + 3] / 255
      if (sourceAlpha <= 0) continue
      const targetOffset = (targetY * target.width + targetX) * 4
      const targetAlpha = Number(target.data[targetOffset + 3]) / 255
      const outputAlpha = sourceAlpha + targetAlpha * (1 - sourceAlpha)
      if (outputAlpha <= 0) continue
      for (let channel = 0; channel < 3; channel += 1) {
        const sourceValue = layer.data[sourceOffset + channel]
        const targetValue = Number(target.data[targetOffset + channel])
        target.data[targetOffset + channel] = Math.round(
          (sourceValue * sourceAlpha + targetValue * targetAlpha * (1 - sourceAlpha)) /
            outputAlpha
        )
      }
      target.data[targetOffset + 3] = Math.round(outputAlpha * 255)
    }
  }
}

function crc32(buffer: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of buffer) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

function pngChunk(type: string, data: Uint8Array): Buffer {
  const typeBuffer = Buffer.from(type, 'ascii')
  const payload = Buffer.concat([typeBuffer, Buffer.from(data)])
  const output = Buffer.allocUnsafe(12 + data.byteLength)
  output.writeUInt32BE(data.byteLength, 0)
  typeBuffer.copy(output, 4)
  Buffer.from(data).copy(output, 8)
  output.writeUInt32BE(crc32(payload), 8 + data.byteLength)
  return output
}

/** Encode RGBA pixel data without pulling a native canvas into the main process. */
export function pixelDataToPngDataUrl(pixelData: PixelData): string {
  if (pixelData.width <= 0 || pixelData.height <= 0) throw new Error('预览图尺寸无效')
  const rowSize = pixelData.width * 4
  const scanlines = Buffer.allocUnsafe((rowSize + 1) * pixelData.height)
  const source = Buffer.from(pixelData.data)
  for (let row = 0; row < pixelData.height; row += 1) {
    const destinationOffset = row * (rowSize + 1)
    scanlines[destinationOffset] = 0
    source.copy(
      scanlines,
      destinationOffset + 1,
      row * rowSize,
      row * rowSize + rowSize
    )
  }

  const header = Buffer.allocUnsafe(13)
  header.writeUInt32BE(pixelData.width, 0)
  header.writeUInt32BE(pixelData.height, 4)
  header[8] = 8
  header[9] = 6
  header[10] = 0
  header[11] = 0
  header[12] = 0
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(scanlines)),
    pngChunk('IEND', new Uint8Array())
  ])
  return `data:image/png;base64,${png.toString('base64')}`
}
