import { initializeCanvas, readPsd, type Layer, type Psd } from 'ag-psd'
import { decodePsdComposite } from './psd-composite'

initializeCanvas(
  (width, height) => new OffscreenCanvas(width, height) as unknown as HTMLCanvasElement,
  (width, height) => new ImageData(width, height)
)

interface ParseMessage {
  type: 'parse'
  id: string
  buffer: ArrayBuffer
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
    | CanvasRenderingContext2D
    | OffscreenCanvasRenderingContext2D
    | null
  if (!ctx) return true
  const { width, height } = canvas
  if (width <= 0 || height <= 0) return true
  const { data } = ctx.getImageData(0, 0, width, height)
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] !== 0) return false
  }
  return true
}

function hasLayerCanvas(layer: Layer): boolean {
  if (layer.canvas) return true
  return Array.isArray(layer.children) && layer.children.some(hasLayerCanvas)
}

function drawLayer(ctx: OffscreenCanvasRenderingContext2D, layer: Layer): void {
  if (layer.hidden) return

  if (Array.isArray(layer.children)) {
    for (const child of [...layer.children].reverse()) {
      drawLayer(ctx, child)
    }
    return
  }

  if (!layer.canvas) return

  const previousAlpha = ctx.globalAlpha
  ctx.globalAlpha = previousAlpha * normalizeOpacity(layer.opacity)
  ctx.drawImage(
    layer.canvas as unknown as CanvasImageSource,
    layer.left ?? 0,
    layer.top ?? 0
  )
  ctx.globalAlpha = previousAlpha
}

function normalizeOpacity(opacity: number | undefined): number {
  if (opacity === undefined) return 1
  if (!Number.isFinite(opacity)) return 1
  if (opacity > 1) return Math.max(0, Math.min(1, opacity / 255))
  return Math.max(0, Math.min(1, opacity))
}

function renderLayers(psd: Psd): OffscreenCanvas | null {
  if (!psd.children?.some(hasLayerCanvas)) return null

  const canvas = new OffscreenCanvas(psd.width, psd.height)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D context unavailable')

  for (const layer of [...psd.children].reverse()) {
    drawLayer(ctx, layer)
  }
  return isCanvasTransparent(canvas) ? null : canvas
}

function renderWithAgPsd(buffer: ArrayBuffer): ImageBitmap {
  const psd = readPsd(buffer, {
    skipThumbnail: true,
    skipLinkedFilesData: true,
    logMissingFeatures: false,
    throwForMissingFeatures: false
  })

  if (psd.canvas && !isCanvasTransparent(psd.canvas)) return canvasToBitmap(psd.canvas)
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

self.onmessage = (event: MessageEvent<IncomingMessage>) => {
  const msg = event.data
  if (msg.type !== 'parse') return

  const { id, buffer } = msg

  try {
    let imageBitmap: ImageBitmap
    let agPsdError: unknown = null
    try {
      imageBitmap = renderWithAgPsd(buffer)
    } catch (err) {
      agPsdError = err
      try {
        imageBitmap = renderCompositeFallback(buffer)
      } catch (fallbackErr) {
        throw new Error(
          `ag-psd failed: ${errorMessage(agPsdError)}; composite fallback failed: ${errorMessage(fallbackErr)}`
        )
      }
    }
    const result: ResultMessage = { type: 'result', id, imageBitmap }
    ;(self.postMessage as (msg: unknown, transfer: Transferable[]) => void)(result, [imageBitmap])
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const error: ErrorMessage = { type: 'error', id, message }
    self.postMessage(error)
  }
}
