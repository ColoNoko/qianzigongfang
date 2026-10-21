import {
  getCompositeCanvas,
  getLayerCanvas,
  initializeCanvas,
  readPsd,
  type Layer,
  type Psd
} from 'ag-psd'
import { decodePsdComposite } from '@shared/psd-composite'

const PSD_BITMAP_MEMORY_LIMIT = 512 * 1024 * 1024
const MAX_PSD_EDGE = 30_000
const MAX_PSD_LAYERS = 5_000
const TRANSPARENCY_SCAN_BYTES = 8 * 1024 * 1024

initializeCanvas(
  (width, height) => new OffscreenCanvas(width, height) as unknown as HTMLCanvasElement,
  (width, height) => new ImageData(width, height)
)

interface ParseMessage {
  type: 'parse'
  id: string
  buffer: ArrayBuffer
  raster?: boolean
  maxEdge?: number
  format?: 'jpg' | 'png' | 'webp'
  quality?: number
}

interface ResultMessage {
  type: 'result'
  id: string
  imageBitmap: ImageBitmap
}

interface ErrorMessage {
  type: 'error'
  id: string
  message: string
}

type IncomingMessage = ParseMessage

function canvasToBitmap(canvas: HTMLCanvasElement | OffscreenCanvas): ImageBitmap {
  const offscreen = canvas as OffscreenCanvas
  if (typeof offscreen.transferToImageBitmap === 'function') {
    return offscreen.transferToImageBitmap()
  }

  const copy = new OffscreenCanvas(canvas.width, canvas.height)
  const ctx = copy.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D context unavailable')
  ctx.drawImage(canvas as unknown as CanvasImageSource, 0, 0)
  return copy.transferToImageBitmap()
}

function isCanvasTransparent(canvas: HTMLCanvasElement | OffscreenCanvas): boolean {
  const ctx = canvas.getContext('2d') as
    CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null
  if (!ctx) return true
  const { width, height } = canvas
  if (width <= 0 || height <= 0) return true
  const rowsPerScan = Math.max(1, Math.floor(TRANSPARENCY_SCAN_BYTES / Math.max(4, width * 4)))
  for (let y = 0; y < height; y += rowsPerScan) {
    const scanHeight = Math.min(rowsPerScan, height - y)
    const { data } = ctx.getImageData(0, y, width, scanHeight)
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] !== 0) return false
    }
  }
  return true
}

function assertBitmapDimensions(width: number, height: number, label: string): void {
  if (!(width > 0) || !(height > 0)) throw new Error(`${label} has invalid dimensions`)
  if (width > MAX_PSD_EDGE || height > MAX_PSD_EDGE) {
    throw new Error(`${label} exceeds the ${MAX_PSD_EDGE}px edge limit`)
  }
  if (width * height * 4 > PSD_BITMAP_MEMORY_LIMIT) {
    throw new Error(`${label} exceeds the 512 MiB bitmap limit`)
  }
}

function validatePsdStructure(psd: Psd): void {
  assertBitmapDimensions(psd.width, psd.height, 'PSD canvas')
  if (psd.bitsPerChannel !== 8 && psd.bitsPerChannel !== 16) {
    throw new Error(`PSD bit depth ${psd.bitsPerChannel} is not supported for previews`)
  }
  let layerCount = 0
  const visit = (layer: Layer): void => {
    layerCount += 1
    if (layerCount > MAX_PSD_LAYERS) {
      throw new Error(`PSD exceeds the ${MAX_PSD_LAYERS}-layer limit`)
    }
    if (Array.isArray(layer.children)) {
      for (const child of layer.children) visit(child)
      return
    }
    const width = Math.max(0, (layer.right ?? 0) - (layer.left ?? 0))
    const height = Math.max(0, (layer.bottom ?? 0) - (layer.top ?? 0))
    if (width > 0 && height > 0)
      assertBitmapDimensions(width, height, `PSD layer ${layer.name ?? ''}`)
  }
  for (const layer of psd.children ?? []) visit(layer)
}

function drawLayer(ctx: OffscreenCanvasRenderingContext2D, layer: Layer): boolean {
  if (layer.hidden) return false

  const previousAlpha = ctx.globalAlpha
  ctx.globalAlpha = previousAlpha * normalizeOpacity(layer.opacity)

  if (Array.isArray(layer.children)) {
    let drewChild = false
    for (const child of [...layer.children].reverse()) {
      drewChild = drawLayer(ctx, child) || drewChild
    }
    ctx.globalAlpha = previousAlpha
    return drewChild
  }

  const layerCanvas = getLayerCanvas(layer)
  if (!layerCanvas) {
    ctx.globalAlpha = previousAlpha
    return false
  }

  ctx.drawImage(layerCanvas as unknown as CanvasImageSource, layer.left ?? 0, layer.top ?? 0)
  ctx.globalAlpha = previousAlpha
  return true
}

function normalizeOpacity(opacity: number | undefined): number {
  if (opacity === undefined) return 1
  if (!Number.isFinite(opacity)) return 1
  if (opacity > 1) return Math.max(0, Math.min(1, opacity / 255))
  return Math.max(0, Math.min(1, opacity))
}

function renderLayers(psd: Psd): OffscreenCanvas | null {
  if (!psd.children?.length) return null

  const canvas = new OffscreenCanvas(psd.width, psd.height)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D context unavailable')

  let drewLayer = false
  for (const layer of [...psd.children].reverse()) {
    drewLayer = drawLayer(ctx, layer) || drewLayer
  }
  return !drewLayer || isCanvasTransparent(canvas) ? null : canvas
}

function renderWithAgPsd(buffer: ArrayBuffer, compositeOnly = true): ImageBitmap {
  const psd = readPsd(buffer, {
    useRawData: true,
    skipLayerImageData: compositeOnly,
    useRawThumbnail: true,
    totalMemoryLimit: PSD_BITMAP_MEMORY_LIMIT,
    skipThumbnail: true,
    skipLinkedFilesData: true,
    logMissingFeatures: false,
    throwForMissingFeatures: false
  })

  validatePsdStructure(psd)
  const compositeCanvas = getCompositeCanvas(psd)
  if (compositeCanvas && !isCanvasTransparent(compositeCanvas)) {
    return canvasToBitmap(compositeCanvas)
  }
  if (compositeOnly) return renderWithAgPsd(buffer, false)
  const renderedLayers = renderLayers(psd)
  if (renderedLayers) return canvasToBitmap(renderedLayers)
  throw new Error('PSD has no renderable bitmap data')
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function renderCompositeFallback(buffer: ArrayBuffer): ImageBitmap {
  const decoded = decodePsdComposite(buffer)
  const canvas = new OffscreenCanvas(decoded.width, decoded.height)
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    throw new Error('Canvas 2D context unavailable')
  }

  const imageData = new ImageData(decoded.rgba, decoded.width, decoded.height)
  ctx.putImageData(imageData, 0, 0)
  if (isCanvasTransparent(canvas)) {
    throw new Error('Composite fallback rendered a fully transparent bitmap')
  }
  return canvas.transferToImageBitmap()
}

self.onmessage = async (event: MessageEvent<IncomingMessage>) => {
  const msg = event.data
  if (msg.type !== 'parse') return

  const { id, buffer } = msg

  try {
    let imageBitmap: ImageBitmap
    let agPsdError: unknown = null
    try {
      imageBitmap = msg.raster
        ? await createImageBitmap(new Blob([buffer]))
        : renderWithAgPsd(buffer)
    } catch (err) {
      if (msg.raster) throw err
      agPsdError = err
      try {
        imageBitmap = renderCompositeFallback(buffer)
      } catch (fallbackErr) {
        throw new Error(
          `ag-psd failed: ${errorMessage(agPsdError)}; composite fallback failed: ${errorMessage(fallbackErr)}`
        )
      }
    }
    if (imageBitmap.width * imageBitmap.height * 4 > PSD_BITMAP_MEMORY_LIMIT) {
      imageBitmap.close()
      throw new Error('图片超过解码内存限制')
    }
    if (msg.maxEdge || msg.format) {
      const scale = Math.min(
        1,
        (msg.maxEdge ?? Infinity) / Math.max(imageBitmap.width, imageBitmap.height)
      )
      const canvas = new OffscreenCanvas(
        Math.max(1, Math.round(imageBitmap.width * scale)),
        Math.max(1, Math.round(imageBitmap.height * scale))
      )
      const context = canvas.getContext('2d')
      if (!context) {
        imageBitmap.close()
        throw new Error('Canvas 2D context unavailable')
      }
      try {
        if (msg.format === 'jpg') {
          context.fillStyle = '#fff'
          context.fillRect(0, 0, canvas.width, canvas.height)
        }
        context.drawImage(imageBitmap, 0, 0, canvas.width, canvas.height)
      } finally {
        imageBitmap.close()
      }
      if (msg.format) {
        const mime = `image/${msg.format === 'jpg' ? 'jpeg' : msg.format}`
        const blob = await canvas.convertToBlob({ type: mime, quality: (msg.quality ?? 85) / 100 })
        if (blob.type !== mime) throw new Error('当前环境不支持该图片格式')
        const bytes = await blob.arrayBuffer()
        self.postMessage(
          { type: 'encoded', id, bytes, width: canvas.width, height: canvas.height },
          { transfer: [bytes] }
        )
        return
      }
      imageBitmap = canvas.transferToImageBitmap()
    }
    const result: ResultMessage = { type: 'result', id, imageBitmap }
    ;(self.postMessage as (msg: unknown, transfer: Transferable[]) => void)(result, [imageBitmap])
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const error: ErrorMessage = { type: 'error', id, message }
    self.postMessage(error)
  }
}
