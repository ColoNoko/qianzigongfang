import { mkdir, stat } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { publishOutput } from './atomic-output'
import { basename, dirname, join, parse, resolve } from 'node:path'
import type {
  LabelPlusFileSelection,
  LabelPlusGenerateOptions,
  LabelPlusGenerateRequest,
  LabelPlusGenerateResult,
  LabelPlusGeneratedFile,
  LabelPlusImageEntry,
  LabelPlusImageMatch,
  LabelPlusPreviewMode,
  LabelPlusPreviewGenerateRequest,
  LabelPlusMatchPreview,
  LabelPlusMatchRequest,
  LabelPlusDocument,
  StandardFontRef,
  StandardTextStyle,
  TextAlignment,
  TextDirection
} from '@shared/labelplus-import'
import {
  LABELPLUS_IMPORT_API_VERSION,
  applyTextReplacementRules,
  clampFiniteNumber,
  createDefaultStandardFont,
  normalizedToPsdPosition,
  normalizeTextDirection,
  parseHexColor,
  parseTextReplacementExpression
} from '@shared/labelplus-import'
import { readLabelPlusFile } from './labelplus-parser'
import { listLabelPlusSourceFiles, matchLabelPlusImages } from './labelplus-matcher'
import {
  blendRasterOntoPixelData,
  clonePixelData,
  createLabelPlusTextRasterizer,
  createDialogOverlayRaster,
  decodeLabelPlusSourceImage,
  pixelDataToPngDataUrl,
  renderTextRaster,
  type LabelPlusTextRasterizer
} from './labelplus-raster'
import {
  serializeLabelPlusPsd,
  type PreparedRasterLayer,
  type PreparedTextLayer
} from './labelplus-psd'

function assertApiVersion(apiVersion: number): void {
  if (apiVersion !== LABELPLUS_IMPORT_API_VERSION) {
    throw new Error(`导入 API 版本不兼容：${apiVersion}`)
  }
}

function imageSummary(
  document: Awaited<ReturnType<typeof readLabelPlusFile>>
): LabelPlusFileSelection['images'] {
  return document.images.map((image) => {
    const groupCounts: Record<string, number> = {}
    for (const label of image.labels) groupCounts[label.group] = (groupCounts[label.group] ?? 0) + 1
    return { fileName: image.fileName, labelCount: image.labels.length, groupCounts }
  })
}

async function optionalDirectory(path: string): Promise<string> {
  try {
    const result = await stat(path)
    return result.isDirectory() ? path : ''
  } catch {
    return ''
  }
}

export async function createLabelPlusFileSelection(
  filePath: string
): Promise<LabelPlusFileSelection> {
  const absolutePath = resolve(filePath)
  const document = await readLabelPlusFile(absolutePath)
  const parent = dirname(absolutePath)
  const sourceCandidates = [join(parent, 'images'), join(parent, 'image'), parent]
  let suggestedSourceDirectory = ''
  for (const candidate of sourceCandidates) {
    suggestedSourceDirectory = await optionalDirectory(candidate)
    if (suggestedSourceDirectory) break
  }
  const suggestedOutputDirectory = join(parent, 'output')
  return {
    apiVersion: LABELPLUS_IMPORT_API_VERSION,
    filePath: absolutePath,
    fileName: basename(absolutePath),
    groups: document.groups,
    images: imageSummary(document),
    totalLabels: document.images.reduce((sum, image) => sum + image.labels.length, 0),
    warnings: document.warnings,
    suggestedSourceDirectory,
    suggestedOutputDirectory
  }
}

export async function previewLabelPlusImport(
  request: LabelPlusMatchRequest
): Promise<LabelPlusMatchPreview> {
  assertApiVersion(request.apiVersion)
  const document = await readLabelPlusFile(resolve(request.labelFilePath))
  const sourceDirectory = resolve(request.sourceDirectory)
  const sourceFiles = await listLabelPlusSourceFiles(sourceDirectory)
  const preview = matchLabelPlusImages(document, sourceFiles, request.match)
  return {
    ...preview,
    warnings: [...document.warnings, ...preview.warnings]
  }
}

/**
 * 把外部传进来的原始选项夹到安全区间。
 *
 * 刻意导出：交给 Photoshop 的「指令清单」必须和本地出图走**同一套**归一化，
 * 否则两条路会悄悄给出不一样的字体大小、行距或方向。
 */
export function normalizedOptions(options: LabelPlusGenerateOptions): LabelPlusGenerateOptions {
  const source = (options ?? {}) as Partial<LabelPlusGenerateOptions>
  const sourceStyle = (source.textStyle ?? {}) as Partial<StandardTextStyle>
  const sourceFont = (sourceStyle.font ?? {}) as Partial<StandardFontRef>
  const sourceShadow = sourceStyle.shadow ?? {
    enabled: false,
    color: '#000000',
    opacity: 0.5,
    distancePx: 0,
    blurPx: 0,
    angleDeg: 120
  }
  const sourcePositionOffset = source.positionOffset ?? { unit: 'px', x: 0, y: 0 }
  const sourceLabelIndexOffset = source.labelIndexOffset ?? { unit: 'px', x: 0, y: 0 }
  const sourceOverlay = source.dialogOverlay ?? {
    enabled: false,
    groups: [],
    radiusXPx: 24,
    radiusYPx: 24,
    colorMode: 'sample' as const,
    customColor: '#ffffff'
  }
  const direction: TextDirection = normalizeTextDirection(sourceStyle)
  const alignment: TextAlignment = ['left', 'center', 'right'].includes(
    sourceStyle.alignment as string
  )
    ? (sourceStyle.alignment as TextAlignment)
    : 'left'
  const family = String(sourceFont.family ?? '').trim() || 'Arial'
  const style = String(sourceFont.style ?? '').trim() || 'Regular'
  const textStyle: StandardTextStyle = {
    ...sourceStyle,
    font: {
      id: String(sourceFont.id ?? 'builtin-arial'),
      family,
      style,
      postScriptName:
        String(sourceFont.postScriptName ?? '').trim() ||
        `${family.replace(/[^A-Za-z0-9]+/g, '') || 'Arial'}MT`,
      ...(sourceFont.filePath ? { filePath: sourceFont.filePath } : {})
    },
    direction,
    // fontSizePt 是 2026-09-23 之前的名字，作为兼容别名继续接受（数值不用换算）。
    fontSizePx: clampFiniteNumber(
      Number(sourceStyle.fontSizePx ?? sourceStyle.fontSize ?? sourceStyle.fontSizePt ?? 24),
      1,
      720
    ),
    leadingPercent: clampFiniteNumber(Number(sourceStyle.leadingPercent ?? 120), 50, 500),
    alignment,
    strokeWidthPx: clampFiniteNumber(Number(sourceStyle.strokeWidthPx ?? 0), 0, 100),
    fillColor: String(sourceStyle.fillColor ?? '#000000'),
    strokeColor: String(sourceStyle.strokeColor ?? '#000000'),
    fauxBold: Boolean(sourceStyle.fauxBold ?? sourceStyle.bold),
    // 缺省为 true：PS 与 ag-psd 的默认都是开，旧存档里没有这个字段也要保持一致。
    ligatures: Boolean(sourceStyle.ligatures ?? true),
    standardVerticalRoman: Boolean(sourceStyle.standardVerticalRoman ?? true),
    fauxItalic: Boolean(sourceStyle.fauxItalic ?? sourceStyle.italic),
    shadow: {
      enabled: Boolean(sourceShadow.enabled),
      color: String(sourceShadow.color ?? '#000000'),
      opacity: clampFiniteNumber(Number(sourceShadow.opacity ?? 0.5), 0, 1),
      distancePx: clampFiniteNumber(Number(sourceShadow.distancePx ?? 0), 0, 500),
      blurPx: clampFiniteNumber(Number(sourceShadow.blurPx ?? 0), 0, 500),
      angleDeg: Number.isFinite(Number(sourceShadow.angleDeg)) ? Number(sourceShadow.angleDeg) : 120
    }
  }
  parseHexColor(textStyle.fillColor)
  parseHexColor(textStyle.strokeColor)
  parseHexColor(textStyle.shadow.color)
  if (sourceOverlay.colorMode === 'custom') parseHexColor(sourceOverlay.customColor || '#ffffff')
  return {
    ...source,
    resolutionPpi: clampFiniteNumber(Number(source.resolutionPpi ?? 300), 30, 1200),
    ignoreImagesWithoutLabels: Boolean(source.ignoreImagesWithoutLabels),
    createLayerGroups: source.createLayerGroups !== false,
    outputLabelIndex: Boolean(source.outputLabelIndex),
    overwriteExisting: Boolean(source.overwriteExisting),
    textReplacementExpression: String(source.textReplacementExpression ?? ''),
    textStyle,
    positionOffset: {
      unit: 'px',
      x: clampFiniteNumber(Number(sourcePositionOffset.x ?? 0), -100_000, 100_000),
      y: clampFiniteNumber(Number(sourcePositionOffset.y ?? 0), -100_000, 100_000)
    },
    labelIndexOffset: {
      unit: 'px',
      x: clampFiniteNumber(Number(sourceLabelIndexOffset.x ?? 0), -100_000, 100_000),
      y: clampFiniteNumber(Number(sourceLabelIndexOffset.y ?? 0), -100_000, 100_000)
    },
    dialogOverlay: {
      enabled: Boolean(sourceOverlay.enabled),
      groups: Array.isArray(sourceOverlay.groups) ? sourceOverlay.groups.map(String) : [],
      radiusXPx: clampFiniteNumber(Number(sourceOverlay.radiusXPx ?? 24), 1, 10_000),
      radiusYPx: clampFiniteNumber(Number(sourceOverlay.radiusYPx ?? 24), 1, 10_000),
      colorMode:
        sourceOverlay.colorMode === 'white' || sourceOverlay.colorMode === 'custom'
          ? sourceOverlay.colorMode
          : 'sample',
      customColor: String(sourceOverlay.customColor ?? '#ffffff')
    }
  }
}

export function safeOutputName(sourceFileName: string): string {
  const name = parse(sourceFileName)
    .name.split('')
    .map((character) => {
      const code = character.charCodeAt(0)
      return code < 32 || /[<>:"/\\|?*]/.test(character) ? '_' : character
    })
    .join('')
    .trim()
  return `${name || 'untitled'}.psd`
}

export interface LabelPlusPreviewContext {
  document: LabelPlusDocument
  rows: LabelPlusImageMatch[]
  options: LabelPlusGenerateOptions
  rules: ReturnType<typeof parseTextReplacementExpression>
  selectedGroups: Set<string>
  warnings: string[]
  previewOutputPaths: Record<string, string>
}

export async function prepareLabelPlusPreviewContext(
  request: LabelPlusGenerateRequest & { previewOutputPaths?: Record<string, string> }
): Promise<LabelPlusPreviewContext> {
  assertApiVersion(request.apiVersion)
  const document = await readLabelPlusFile(resolve(request.labelFilePath))
  const sourceFiles = await listLabelPlusSourceFiles(resolve(request.sourceDirectory))
  const preview = matchLabelPlusImages(document, sourceFiles, request.match)
  const options = normalizedOptions(request.options)
  const requestedGroups = Array.isArray(request.selectedGroups) ? request.selectedGroups : []
  const selectedGroups = new Set(requestedGroups.length > 0 ? requestedGroups : document.groups)
  const warnings = [...document.warnings, ...preview.warnings]
  if (normalizeTextDirection(request.options?.textStyle) === 'vertical') {
    warnings.push('竖排使用竖排预览；为避免 ag-psd 生成损坏 PSD，原生文字层安全回退为横排描述符')
  }
  return {
    document,
    rows: preview.rows.filter((row) => row.matched && row.sourcePath),
    options,
    rules: parseTextReplacementExpression(options.textReplacementExpression),
    selectedGroups,
    warnings,
    previewOutputPaths: { ...(request.previewOutputPaths ?? {}) }
  }
}

export async function renderLabelPlusPreviewPage(
  context: LabelPlusPreviewContext,
  index: number,
  mode: LabelPlusPreviewMode
): Promise<{
  index: number
  total: number
  labelImageName: string
  sourceFileName: string
  dataUrl: string
  warnings: string[]
}> {
  const safeIndex = Math.max(0, Math.min(context.rows.length - 1, Math.trunc(index)))
  const row = context.rows[safeIndex]
  if (!row?.sourcePath) throw new Error('预览页没有可用图源')
  const image = context.document.images.find((entry) => entry.fileName === row.labelImageName)
  if (!image) throw new Error(`找不到 ${row.labelImageName} 的文本记录`)
  const background = await decodeLabelPlusSourceImage(row.sourcePath)
  let dataUrl: string
  const warnings = [...context.warnings]
  if (mode === 'source') {
    dataUrl = pixelDataToPngDataUrl(background)
  } else {
    const outputPath = context.previewOutputPaths[row.labelImageName]
    if (outputPath) {
      try {
        // The preview button writes a real PSD. Decode its composite so the
        // preview window reflects the same flattened pixels Photoshop will
        // show, rather than a second in-memory approximation.
        dataUrl = pixelDataToPngDataUrl(await decodeLabelPlusSourceImage(outputPath))
        return {
          index: safeIndex,
          total: context.rows.length,
          labelImageName: row.labelImageName,
          sourceFileName: row.sourceFileName || row.labelImageName,
          dataUrl,
          warnings
        }
      } catch (error) {
        throw new Error(
          `临时 PSD 预览读取失败：${error instanceof Error ? error.message : String(error)}`
        )
      }
    }
    const rasterizer = await createLabelPlusTextRasterizer()
    try {
      const selected = await selectedLabels(
        image,
        context.selectedGroups,
        context.options,
        context.rules,
        background.width,
        background.height,
        rasterizer
      )
      const overlay = createDialogOverlayRaster(
        background,
        selected.overlayPoints,
        context.options.dialogOverlay
      )
      const composite = clonePixelData(background)
      if (overlay) blendRasterOntoPixelData(composite, overlay)
      for (const layer of selected.textLayers) {
        if (layer.raster) blendRasterOntoPixelData(composite, layer.raster)
      }
      dataUrl = pixelDataToPngDataUrl(composite)
      warnings.push(...selected.warnings)
    } finally {
      rasterizer.dispose()
    }
  }
  return {
    index: safeIndex,
    total: context.rows.length,
    labelImageName: row.labelImageName,
    sourceFileName: row.sourceFileName || row.labelImageName,
    dataUrl,
    warnings
  }
}

function defaultIndexFont(): StandardFontRef {
  return createDefaultStandardFont()
}

function indexStyle(style: StandardTextStyle): StandardTextStyle {
  return {
    ...style,
    font: defaultIndexFont(),
    fontSizePx: Math.min(12, style.fontSizePx),
    fillColor: '#ff0000',
    strokeColor: '#ffffff',
    strokeWidthPx: 0,
    shadow: { ...style.shadow, enabled: false }
  }
}

async function selectedLabels(
  image: LabelPlusImageEntry,
  selectedGroups: Set<string>,
  options: LabelPlusGenerateOptions,
  rules: ReturnType<typeof parseTextReplacementExpression>,
  width: number,
  height: number,
  rasterizer: LabelPlusTextRasterizer
): Promise<{
  textLayers: PreparedTextLayer[]
  overlayPoints: Array<{ x: number; y: number }>
  warnings: string[]
}> {
  const textLayers: PreparedTextLayer[] = []
  const overlayPoints: Array<{ x: number; y: number }> = []
  const warnings: string[] = []
  const overlayGroups = new Set(options.dialogOverlay.groups)
  const textStyle = options.textStyle

  for (const label of image.labels) {
    if (!selectedGroups.has(label.group)) continue
    const position = normalizedToPsdPosition(label.position, width, height, options.positionOffset)
    const text = applyTextReplacementRules(label.text, rules)
    let raster: PreparedRasterLayer | undefined
    try {
      raster = await renderTextRaster(text, position, textStyle, width, height, rasterizer)
      if (!raster && text.trim()) warnings.push(`第 ${label.index} 条文字预览没有生成像素`)
    } catch (error) {
      warnings.push(
        `第 ${label.index} 条文字预览生成失败：${error instanceof Error ? error.message : String(error)}`
      )
    }
    textLayers.push({
      name: text || `Label ${label.index}`,
      text,
      group: label.group,
      position,
      style: textStyle,
      raster
    })

    if (
      options.dialogOverlay.enabled &&
      (overlayGroups.size === 0 || overlayGroups.has(label.group))
    ) {
      overlayPoints.push({ x: position.x, y: position.y })
    }

    if (options.outputLabelIndex) {
      const indexPosition = normalizedToPsdPosition(
        label.position,
        width,
        height,
        options.labelIndexOffset
      )
      let indexRaster: PreparedRasterLayer | undefined
      try {
        indexRaster = await renderTextRaster(
          String(label.index),
          indexPosition,
          indexStyle(textStyle),
          width,
          height,
          rasterizer
        )
        if (!indexRaster) warnings.push(`第 ${label.index} 条编号预览没有生成像素`)
      } catch (error) {
        warnings.push(
          `第 ${label.index} 条编号预览生成失败：${error instanceof Error ? error.message : String(error)}`
        )
      }
      textLayers.push({
        name: `Label ${label.index}`,
        text: String(label.index),
        group: '_Label',
        position: indexPosition,
        style: indexStyle(textStyle),
        raster: indexRaster
      })
    }
  }
  return { textLayers, overlayPoints, warnings }
}

function skippedFile(
  row: { labelImageName: string; sourcePath: string | null },
  message: string
): LabelPlusGeneratedFile {
  return {
    labelImageName: row.labelImageName,
    sourcePath: row.sourcePath,
    outputPath: null,
    status: 'skipped',
    textLayerCount: 0,
    message,
    warnings: []
  }
}

export async function generateLabelPlusPsd(
  request: LabelPlusGenerateRequest
): Promise<LabelPlusGenerateResult> {
  assertApiVersion(request.apiVersion)
  const document = await readLabelPlusFile(resolve(request.labelFilePath))
  const sourceDirectory = resolve(request.sourceDirectory)
  const outputDirectory = resolve(request.outputDirectory)
  const sourceFiles = await listLabelPlusSourceFiles(sourceDirectory)
  const preview = matchLabelPlusImages(document, sourceFiles, request.match)
  const options = normalizedOptions(request.options)
  const rules = parseTextReplacementExpression(options.textReplacementExpression)
  const selectedImages = new Set(
    Array.isArray(request.selectedImageNames) ? request.selectedImageNames : []
  )
  const requestedGroups = Array.isArray(request.selectedGroups) ? request.selectedGroups : []
  const selectedGroups = new Set(requestedGroups.length > 0 ? requestedGroups : document.groups)
  await mkdir(outputDirectory, { recursive: true })

  const files: LabelPlusGeneratedFile[] = []
  const overallWarnings = [...document.warnings, ...preview.warnings]
  if (normalizeTextDirection(request.options?.textStyle) === 'vertical') {
    overallWarnings.push(
      '竖排使用竖排预览；为避免 ag-psd 生成损坏 PSD，原生文字层安全回退为横排描述符'
    )
  }

  const rasterizer = await createLabelPlusTextRasterizer()
  try {
    for (const row of preview.rows) {
      // 空数组 = **什么都没选**（不是"全选"）：2026-09-30 审查 critical。
      // 原来写的是 `selectedImages.size > 0 && !selectedImages.has(...)` —— size === 0 时
      // 判据永不成立，界面上的「清空」（已选 0 张）就让整份文本的每一张图都出图；
      // 勾了「覆盖已有 PSD」时直接覆盖用户没勾的文件。要全量，必须由界面显式
      // 「全选」把数组填满（Import.vue 的 selectAllImages）来表达。
      if (!selectedImages.has(row.labelImageName)) {
        files.push(skippedFile(row, '未选择'))
        continue
      }
      const sourceImage = document.images.find((image) => image.fileName === row.labelImageName)
      if (!sourceImage) {
        files.push(skippedFile(row, '文本记录不存在'))
        continue
      }
      if (options.ignoreImagesWithoutLabels && sourceImage.labels.length === 0) {
        files.push(skippedFile(row, '没有标签，已忽略'))
        continue
      }
      if (!row.matched || !row.sourcePath) {
        files.push(skippedFile(row, '未匹配到图源'))
        continue
      }

      const outputPath = join(
        outputDirectory,
        safeOutputName(row.sourceFileName ?? row.labelImageName)
      )
      try {
        // 不覆盖模式的"目标已存在"判定交给 publishOutput：创建即判定，
        // 没有"先 stat 再写"的竞争窗口（2026-10-05 从并行分支 T6 移植）。
        // 覆盖模式：临时文件 + fsync + 原子改名 —— 写一半失败不会截断上一份能用的 PSD。
        const background = await decodeLabelPlusSourceImage(row.sourcePath)
        const selected = await selectedLabels(
          sourceImage,
          selectedGroups,
          options,
          rules,
          background.width,
          background.height,
          rasterizer
        )
        const overlay = createDialogOverlayRaster(
          background,
          selected.overlayPoints,
          options.dialogOverlay
        )
        const composite = clonePixelData(background)
        if (overlay) blendRasterOntoPixelData(composite, overlay)
        for (const layer of selected.textLayers) {
          if (layer.raster) blendRasterOntoPixelData(composite, layer.raster)
        }

        const buffer = serializeLabelPlusPsd({
          width: background.width,
          height: background.height,
          resolutionPpi: options.resolutionPpi,
          background,
          composite,
          textLayers: selected.textLayers,
          groupOrder: [...requestedGroups, '_Label'],
          createLayerGroups: options.createLayerGroups,
          dialogOverlay: overlay
        })
        if (!(await publishOutput(outputPath, buffer, options.overwriteExisting))) {
          files.push({ ...skippedFile(row, '输出文件已存在，未覆盖'), outputPath })
          continue
        }
        files.push({
          labelImageName: row.labelImageName,
          sourcePath: row.sourcePath,
          outputPath,
          status: 'generated',
          textLayerCount: selected.textLayers.length,
          message: '已生成',
          warnings: selected.warnings
        })
        overallWarnings.push(...selected.warnings)
      } catch (error) {
        files.push({
          labelImageName: row.labelImageName,
          sourcePath: row.sourcePath,
          outputPath,
          status: 'failed',
          textLayerCount: 0,
          message: error instanceof Error ? error.message : String(error),
          warnings: []
        })
      }
      await new Promise<void>((resolveNext) => setImmediate(resolveNext))
    }
  } finally {
    rasterizer.dispose()
  }

  return {
    apiVersion: LABELPLUS_IMPORT_API_VERSION,
    generatedCount: files.filter((file) => file.status === 'generated').length,
    skippedCount: files.filter((file) => file.status === 'skipped').length,
    failedCount: files.filter((file) => file.status === 'failed').length,
    outputDirectory,
    files,
    warnings: overallWarnings
  }
}

/** Generate a disposable PSD set for the Import page preview button. */
export async function generateLabelPlusPreviewPsd(
  request: LabelPlusPreviewGenerateRequest,
  previewRoot: string
): Promise<LabelPlusGenerateResult> {
  const outputDirectory = join(resolve(previewRoot), randomUUID())
  return generateLabelPlusPsd({
    ...request,
    outputDirectory,
    options: {
      ...request.options,
      overwriteExisting: true
    }
  })
}
