import { writePsdBuffer } from 'ag-psd'
import type { Layer, LayerEffectsInfo, PixelData, Psd } from 'ag-psd'
import type { PsdTextPosition, StandardTextStyle } from '@shared/labelplus-import'
import { orderLabelPlusGroups, parseHexColor } from '@shared/labelplus-import'

export interface PreparedRasterLayer {
  left: number
  top: number
  width: number
  height: number
  data: Uint8ClampedArray
}

export interface PreparedTextLayer {
  name: string
  text: string
  group: string
  position: PsdTextPosition
  style: StandardTextStyle
  raster?: PreparedRasterLayer
}

export interface BuildLabelPlusPsdInput {
  width: number
  height: number
  resolutionPpi: number
  background: PixelData
  composite: PixelData
  textLayers: PreparedTextLayer[]
  groupOrder: string[]
  createLayerGroups: boolean
  dialogOverlay?: PreparedRasterLayer
}

function layerName(value: string): string {
  const normalized = value.replace(/[\r\n\t]+/g, ' ').trim()
  if (!normalized) return '空文本'
  return normalized.length > 120 ? `${normalized.slice(0, 117)}...` : normalized
}

function textEffects(style: StandardTextStyle): LayerEffectsInfo | undefined {
  const effects: LayerEffectsInfo = {}
  if (style.strokeWidthPx > 0) {
    effects.stroke = [
      {
        present: true,
        showInDialog: true,
        enabled: true,
        size: { units: 'Pixels', value: style.strokeWidthPx },
        position: 'outside',
        fillType: 'color',
        blendMode: 'normal',
        opacity: 1,
        color: parseHexColor(style.strokeColor)
      }
    ]
  }
  if (style.shadow.enabled) {
    effects.dropShadow = [
      {
        present: true,
        showInDialog: true,
        enabled: true,
        size: { units: 'Pixels', value: style.shadow.blurPx },
        angle: style.shadow.angleDeg,
        distance: { units: 'Pixels', value: style.shadow.distancePx },
        color: parseHexColor(style.shadow.color),
        blendMode: 'multiply',
        opacity: style.shadow.opacity,
        useGlobalLight: false,
        antialiased: true
      }
    ]
  }
  return effects.stroke || effects.dropShadow ? effects : undefined
}

/**
 * `fontSizePx` 是**像素**，但 ag-psd 写进描述符的 `fontSize` 会被 Photoshop
 * 按**文档分辨率**当"点"来解释 —— 而这份 PSD 的分辨率是 `resolutionPpi`。
 * 所以要按 72/ppi 折算，PS 打开时才会得到与工坊预览**完全一样**的像素大小。
 *
 * （不做这一步就会出现：本地预览 75px、PS 里 18px —— 差 4 倍多。2026-09-23 真机发现。）
 */
function pxToDescriptorPoints(fontSizePx: number, resolutionPpi: number): number {
  const ppi = Number.isFinite(resolutionPpi) && resolutionPpi > 0 ? resolutionPpi : 72
  return (fontSizePx * 72) / ppi
}

function preparedTextToLayer(prepared: PreparedTextLayer, resolutionPpi: number): Layer {
  const fill = parseHexColor(prepared.style.fillColor)
  const stroke = parseHexColor(prepared.style.strokeColor)
  const raster = prepared.raster
  const layer: Layer = {
    name: layerName(prepared.name),
    blendMode: 'normal',
    opacity: 1,
    hidden: false,
    effects: textEffects(prepared.style),
    effectsOpen: false,
    text: {
      text: prepared.text.replace(/\r\n?/g, '\n'),
      transform: [1, 0, 0, 1, prepared.position.x, prepared.position.y],
      // Keep the original horizontal TySh descriptor. ag-psd 31.x documents
      // that writing `orientation: 'vertical'` can produce a damaged PSD
      // because Photoshop's second EngineData block is not fully supported.
      // Vertical requests still use the vertical raster preview, while the
      // native layer stays on the known-good horizontal descriptor.
      orientation: 'horizontal',
      antiAlias: 'smooth',
      gridding: 'none',
      shapeType: 'point',
      style: {
        font: { name: prepared.style.font.postScriptName },
        fontSize: pxToDescriptorPoints(prepared.style.fontSizePx, resolutionPpi),
        fauxBold: prepared.style.fauxBold,
        fauxItalic: prepared.style.fauxItalic,
        ligatures: prepared.style.ligatures,
        // 标准垂直罗马对齐方式 = baselineDirection（实测：1 开 / 2 关）。
        // 只在竖排里写：横排该取什么值没测过，不动它。
        ...(prepared.style.direction === 'vertical'
          ? { baselineDirection: prepared.style.standardVerticalRoman ? 1 : 2 }
          : {}),
        autoLeading: true,
        fillColor: fill,
        fillFlag: true,
        strokeColor: stroke,
        strokeFlag: prepared.style.strokeWidthPx > 0,
        outlineWidth: prepared.style.strokeWidthPx
      },
      paragraphStyle: {
        justification: prepared.style.alignment,
        autoLeading: prepared.style.leadingPercent / 100,
        everyLineComposer: false
      }
    }
  }

  if (raster && raster.width > 0 && raster.height > 0) {
    layer.left = raster.left
    layer.top = raster.top
    layer.right = raster.left + raster.width
    layer.bottom = raster.top + raster.height
    layer.imageData = {
      width: raster.width,
      height: raster.height,
      data: raster.data
    }
  }
  return layer
}

function orderedGroups(textLayers: PreparedTextLayer[], groupOrder: string[]): string[] {
  const requested = [
    ...groupOrder,
    ...textLayers.map((layer) => layer.group)
  ].filter((group) => textLayers.some((layer) => layer.group === group))
  return orderLabelPlusGroups(requested)
}

export function buildLabelPlusPsd(input: BuildLabelPlusPsdInput): Psd {
  const groups = orderedGroups(input.textLayers, input.groupOrder)
  const displayGroups: Layer[] = []
  if (input.createLayerGroups) {
    for (const group of groups) {
      displayGroups.push({
        name: group === '_Label' ? 'Label' : group,
        blendMode: 'pass through',
        opened: true,
        children: input.textLayers
          .filter((layer) => layer.group === group)
          .map((layer) => preparedTextToLayer(layer, input.resolutionPpi))
      })
    }
  } else {
    for (const group of groups) {
      displayGroups.push(
        ...input.textLayers
          .filter((layer) => layer.group === group)
          .map((layer) => preparedTextToLayer(layer, input.resolutionPpi))
      )
    }
  }

  // ag-psd's public `children` order is bottom-to-top. Keep the Photoshop
  // panel order as 框外 → 框内 → 原图片 by putting the background first and
  // reversing the logical top-level text order here.
  const children: Layer[] = [
    {
      name: '原图片',
      blendMode: 'normal',
      opacity: 1,
      left: 0,
      top: 0,
      right: input.width,
      bottom: input.height,
      imageData: input.background
    }
  ]

  if (input.dialogOverlay) {
    children.push({
      name: 'dialog-overlay',
      blendMode: 'normal',
      opacity: 1,
      left: input.dialogOverlay.left,
      top: input.dialogOverlay.top,
      right: input.dialogOverlay.left + input.dialogOverlay.width,
      bottom: input.dialogOverlay.top + input.dialogOverlay.height,
      imageData: {
        width: input.dialogOverlay.width,
        height: input.dialogOverlay.height,
        data: input.dialogOverlay.data
      }
    })
  }

  children.push(...displayGroups.reverse())

  return {
    width: input.width,
    height: input.height,
    children,
    imageData: input.composite,
    imageResources: {
      resolutionInfo: {
        horizontalResolution: input.resolutionPpi,
        horizontalResolutionUnit: 'PPI',
        widthUnit: 'Inches',
        verticalResolution: input.resolutionPpi,
        verticalResolutionUnit: 'PPI',
        heightUnit: 'Inches'
      }
    }
  }
}

export function serializeLabelPlusPsd(input: BuildLabelPlusPsdInput): Buffer {
  return writePsdBuffer(buildLabelPlusPsd(input), {
    // Preserve the initial writer behavior. Photoshop uses this flag to
    // rebuild the bitmap for newly-created/updated text descriptors instead
    // of retaining stale layer pixels.
    invalidateTextLayers: true,
    noBackground: true,
    logMissingFeatures: false
  })
}
