import type { TranslationCredits } from './translation-credits'
export const LABELPLUS_IMPORT_API_VERSION = 1 as const
export const LABELPLUS_IMPORT_SETTINGS_KEY = 'labelplus.import.settings'

export type LabelPlusImportApiVersion = typeof LABELPLUS_IMPORT_API_VERSION
export type LabelPlusMatchMode = 'file-name' | 'sequential'
export type TextAlignment = 'left' | 'center' | 'right'
export type LabelPlusInputKind = 'file' | 'directory' | 'zip'
export type LabelPlusPreviewMode = 'source' | 'output'
/**
 * Text direction accepted by the import API. Horizontal is written as a
 * native PSD descriptor; vertical is kept for the standardized preview API
 * and uses a safe horizontal native-layer fallback in the current ag-psd
 * writer.
 */
export type TextDirection = 'horizontal' | 'vertical'

/**
 * LabelPlus stores positions as document-relative values. Keeping the unit in
 * the payload prevents normalized coordinates from being confused with PSD
 * pixel coordinates at IPC boundaries.
 */
export interface NormalizedTextPosition {
  unit: 'normalized'
  x: number
  y: number
  /** Optional box dimensions for integrations that provide a text frame. */
  width?: number
  height?: number
}

/** PSD text transform coordinates use pixels and point to the first baseline. */
export interface PsdTextPosition {
  unit: 'px'
  anchor: 'baseline'
  x: number
  y: number
  width?: number
  height?: number
}

/**
 * Stable font reference shared by the font manager, renderer and PSD writer.
 * `postScriptName` is the name written into Photoshop text engine data.
 */
export interface StandardFontRef {
  id: string
  family: string
  style: string
  postScriptName: string
  filePath?: string
}

export interface StandardTextStyle {
  font: StandardFontRef
  /**
   * 字号，单位是**像素**（不是点）。
   *
   * 2026-09-23 真机发现：这里原来叫 `fontSizePt`，而且两条路各按自己的理解换算 ——
   * 本地预览按"300ppi 的文档"算（18pt → 75px），Photoshop 按原图真实分辨率算
   * （扫图通常是 72ppi，18pt → 18px），**同一个数字差 4 倍多**。
   *
   * 现在全链路统一成像素：本地栅格直接用、PS 侧写 `UnitValue(n, 'px')`、
   * 本地 PSD 的描述符按 72/ppi 折算回去。于是同一个数字在两条路上**像素级一致**，
   * 而且与文档分辨率无关。
   */
  fontSizePx: number
  /** Stable direction field used by raster preview and future PSD writers. */
  direction: TextDirection
  leadingPercent: number
  alignment: TextAlignment
  fillColor: string
  strokeColor: string
  strokeWidthPx: number
  fauxBold: boolean
  fauxItalic: boolean
  /**
   * 自由连字（对应 Photoshop 字符面板的「自由连字」）。
   *
   * 为什么单独有它：PS 新建文字层时**这个就是开的**（真机验过：从 PS 生成的 PSD 里
   * 读出来 `ligatures: true`），ag-psd 的默认也是 true。所以留成可选开关是为了
   * 让"关掉它"成为一种可表达的选择，而不是为了打开一个本来关着的东西。
   */
  ligatures: boolean
  /**
   * 标准垂直罗马对齐方式（PS 字符面板菜单里那一项）。
   *
   * 2026-09-23 用**实测**定的值（读了两份只差这一个开关的 PSD 做差分）：
   * 它落在描述符的 `baselineDirection` 上 —— **1 = 开，2 = 关**。
   * 工坊两条路原先产出的都是 2（关），所以竖排里的拉丁字母/数字会被转 90°。
   *
   * 只在**竖排**里写这个字段：横排该取什么值我们没测过，不去动它（保持 ag-psd 默认）。
   */
  standardVerticalRoman: boolean
  /** Compatibility aliases accepted from older integrations; canonical fields remain above. */
  fontSize?: number
  orientation?: TextDirection
  bold?: boolean
  italic?: boolean
  /**
   * 2026-09-23 之前的字段名（当时单位被当成"点"）。
   *
   * 保留它是为了**读得回旧存档**：老的设置里存的是 `fontSizePt: 18`，
   * 改名之后如果不认这个键，用户的字号会静默回落成默认值。
   * 数值本身不用换算 —— 老值 18 现在就是 18 像素（改单位的目的正是让两条路一致）。
   */
  fontSizePt?: number
  shadow: {
    enabled: boolean
    color: string
    opacity: number
    distancePx: number
    blurPx: number
    angleDeg: number
  }
}

/** Normalize the canonical direction and the legacy orientation alias together. */
export function normalizeTextDirection(
  style?: Partial<Pick<StandardTextStyle, 'direction' | 'orientation'>> | null
): TextDirection {
  return (style?.direction ?? style?.orientation) === 'vertical' ? 'vertical' : 'horizontal'
}

export interface LabelPlusLabel {
  index: number
  group: string
  text: string
  position: NormalizedTextPosition
}

export interface LabelPlusImageEntry {
  fileName: string
  labels: LabelPlusLabel[]
}

export interface LabelPlusDocument {
  credits?: TranslationCredits
  sourcePath: string
  version: {
    first: number
    last: number
  }
  groups: string[]
  images: LabelPlusImageEntry[]
  warnings: string[]
}

export interface LabelPlusImageSummary {
  fileName: string
  labelCount: number
  groupCounts: Record<string, number>
}

export interface LabelPlusFileSelection {
  apiVersion: LabelPlusImportApiVersion
  filePath: string
  fileName: string
  groups: string[]
  images: LabelPlusImageSummary[]
  totalLabels: number
  warnings: string[]
  suggestedSourceDirectory: string
  suggestedOutputDirectory: string
  /** Present when the input came from a dropped folder or ZIP bundle. */
  inputKind?: LabelPlusInputKind
  inputPath?: string
  inputRootDirectory?: string
  extractedDirectory?: string
}

export interface LabelPlusMatchOptions {
  mode: LabelPlusMatchMode
  forcedExtension: string
}

export interface LabelPlusMatchRequest {
  apiVersion: LabelPlusImportApiVersion
  labelFilePath: string
  sourceDirectory: string
  match: LabelPlusMatchOptions
}

export interface LabelPlusImageMatch {
  labelImageName: string
  labelCount: number
  sourceFileName: string | null
  sourcePath: string | null
  matched: boolean
  message: string
}

export interface LabelPlusMatchPreview {
  apiVersion: LabelPlusImportApiVersion
  rows: LabelPlusImageMatch[]
  matchedCount: number
  unmatchedCount: number
  sourceFileCount: number
  warnings: string[]
}

export interface LabelPlusDialogOverlayOptions {
  enabled: boolean
  groups: string[]
  radiusXPx: number
  radiusYPx: number
  colorMode: 'sample' | 'white' | 'custom'
  customColor: string
}

export interface LabelPlusGenerateOptions {
  resolutionPpi: number
  ignoreImagesWithoutLabels: boolean
  createLayerGroups: boolean
  outputLabelIndex: boolean
  overwriteExisting: boolean
  textReplacementExpression: string
  textStyle: StandardTextStyle
  positionOffset: {
    unit: 'px'
    x: number
    y: number
  }
  labelIndexOffset: {
    unit: 'px'
    x: number
    y: number
  }
  dialogOverlay: LabelPlusDialogOverlayOptions
}

export interface LabelPlusGenerateRequest extends LabelPlusMatchRequest {
  outputDirectory: string
  selectedImageNames: string[]
  selectedGroups: string[]
  options: LabelPlusGenerateOptions
}

/**
 * Generates PSDs in an application-managed temporary directory for the
 * matching preview. The main process chooses the actual directory, so the
 * renderer only supplies the same selection/style payload used for a normal
 * generation run.
 */
export interface LabelPlusPreviewGenerateRequest extends LabelPlusMatchRequest {
  selectedImageNames: string[]
  selectedGroups: string[]
  options: LabelPlusGenerateOptions
}

export type LabelPlusGeneratedFileStatus = 'generated' | 'skipped' | 'failed'

export interface LabelPlusGeneratedFile {
  labelImageName: string
  sourcePath: string | null
  outputPath: string | null
  status: LabelPlusGeneratedFileStatus
  textLayerCount: number
  message: string
  warnings: string[]
}

export interface LabelPlusGenerateResult {
  apiVersion: LabelPlusImportApiVersion
  generatedCount: number
  skippedCount: number
  failedCount: number
  outputDirectory: string
  files: LabelPlusGeneratedFile[]
  warnings: string[]
}

export interface LabelPlusPreviewOpenRequest extends LabelPlusGenerateRequest {
  mode: LabelPlusPreviewMode
  initialImageName: string
  /** Generated PSDs to use for output preview, keyed by LabelPlus image name. */
  previewOutputPaths?: Record<string, string>
}

export interface LabelPlusPreviewOpenResult {
  opened: boolean
  sessionId?: string
  message?: string
}

export interface LabelPlusPreviewSessionInfo {
  sessionId: string
  mode: LabelPlusPreviewMode
  title: string
  initialIndex: number
  items: Array<{
    labelImageName: string
    sourceFileName: string
  }>
}

export interface LabelPlusPreviewPage {
  index: number
  total: number
  labelImageName: string
  sourceFileName: string
  dataUrl: string
  warnings: string[]
}

export interface TextReplacementRule {
  from: string
  to: string
}

/** Canonical fallback font used when a platform font inventory is unavailable. */
export function createDefaultStandardFont(): StandardFontRef {
  return {
    id: 'builtin-arial',
    family: 'Arial',
    style: 'Regular',
    postScriptName: 'ArialMT'
  }
}

/** Keep renderer forms, persisted settings and IPC requests on one schema. */
export function createDefaultTextStyle(font = createDefaultStandardFont()): StandardTextStyle {
  return {
    font: { ...font },
    fontSizePx: 24,
    direction: 'horizontal',
    leadingPercent: 120,
    alignment: 'left',
    fillColor: '#000000',
    strokeColor: '#000000',
    strokeWidthPx: 0,
    fauxBold: false,
    fauxItalic: false,
    // PS 与 ag-psd 的默认都是开 —— 跟随它们，别自作聪明改成 false。
    ligatures: true,
    // 默认开：这正是用户要的行为（原先两条路都产出"关"，竖排里的英文数字会被转 90°）。
    standardVerticalRoman: true,
    shadow: {
      enabled: false,
      color: '#000000',
      opacity: 0.5,
      distancePx: 4,
      blurPx: 4,
      angleDeg: 120
    }
  }
}

export function labelPlusGroupKind(group: string): 'inside' | 'outside' | 'other' {
  if (/(框内|框里|inside|in[-_ ]?box)/iu.test(group)) return 'inside'
  if (/(框外|框外字|outside|out[-_ ]?box)/iu.test(group)) return 'outside'
  return 'other'
}

/** PSD layer order is top-to-bottom: outside text, inside text, then other groups. */
export function orderLabelPlusGroups(groups: string[]): string[] {
  const unique = [...new Set(groups)]
  const priority = (group: string): number => {
    if (group === '_Label') return -1
    const kind = labelPlusGroupKind(group)
    if (kind === 'outside') return 0
    if (kind === 'inside') return 1
    return 2
  }
  return unique
    .map((group, index) => ({ group, index, priority: priority(group) }))
    .sort((left, right) => left.priority - right.priority || left.index - right.index)
    .map(({ group }) => group)
}

export function createDefaultLabelPlusGenerateOptions(
  font = createDefaultStandardFont()
): LabelPlusGenerateOptions {
  return {
    resolutionPpi: 300,
    ignoreImagesWithoutLabels: false,
    createLayerGroups: true,
    outputLabelIndex: false,
    overwriteExisting: false,
    textReplacementExpression: '',
    textStyle: createDefaultTextStyle(font),
    positionOffset: { unit: 'px', x: 0, y: 0 },
    labelIndexOffset: { unit: 'px', x: 0, y: 0 },
    dialogOverlay: {
      enabled: false,
      groups: [],
      radiusXPx: 24,
      radiusYPx: 24,
      colorMode: 'sample',
      customColor: '#ffffff'
    }
  }
}

export function normalizeLabelPlusExtension(value: unknown): string {
  const trimmed = String(value ?? '').trim().toLocaleLowerCase()
  if (!trimmed || trimmed === 'auto') return ''
  return trimmed.startsWith('.') ? trimmed : `.${trimmed}`
}

export function normalizedToPsdPosition(
  position: NormalizedTextPosition,
  documentWidth: number,
  documentHeight: number,
  offset: { x: number; y: number } = { x: 0, y: 0 }
): PsdTextPosition {
  if (position.unit !== 'normalized') throw new Error('LabelPlus 坐标单位必须为 normalized')
  if (
    ![position.x, position.y, documentWidth, documentHeight, offset.x, offset.y].every(
      Number.isFinite
    ) ||
    (position.width !== undefined &&
      (!Number.isFinite(position.width) || position.width < 0)) ||
    (position.height !== undefined &&
      (!Number.isFinite(position.height) || position.height < 0))
  ) {
    throw new Error('LabelPlus 坐标包含非有限数值')
  }
  if (documentWidth <= 0 || documentHeight <= 0) throw new Error('PSD 文档尺寸必须大于 0')

  const width = position.width
  const height = position.height
  return {
    unit: 'px',
    anchor: 'baseline',
    x: position.x * documentWidth + offset.x,
    y: position.y * documentHeight + offset.y,
    ...(typeof width === 'number' && Number.isFinite(width)
      ? { width: width * documentWidth }
      : {}),
    ...(typeof height === 'number' && Number.isFinite(height)
      ? { height: height * documentHeight }
      : {})
  }
}

export function parseHexColor(value: string): { r: number; g: number; b: number } {
  const normalized = value.trim().replace(/^#/, '')
  const expanded =
    normalized.length === 3
      ? normalized
          .split('')
          .map((part) => `${part}${part}`)
          .join('')
      : normalized

  if (!/^[0-9a-fA-F]{6}$/.test(expanded)) throw new Error(`无效颜色：${value}`)
  return {
    r: Number.parseInt(expanded.slice(0, 2), 16),
    g: Number.parseInt(expanded.slice(2, 4), 16),
    b: Number.parseInt(expanded.slice(4, 6), 16)
  }
}

export function parseTextReplacementExpression(expression: string): TextReplacementRule[] {
  const trimmed = expression.trim()
  if (!trimmed) return []

  return trimmed
    .split('|')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const separator = part.indexOf('->')
      if (separator <= 0) throw new Error(`文本替换规则格式错误：${part}`)
      return {
        from: part.slice(0, separator),
        to: part.slice(separator + 2)
      }
    })
}

export function applyTextReplacementRules(text: string, rules: TextReplacementRule[]): string {
  let result = text
  for (const rule of rules) {
    if (!rule.from) continue
    result = result.split(rule.from).join(rule.to)
  }
  return result
}

export function clampFiniteNumber(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return minimum
  return Math.min(maximum, Math.max(minimum, value))
}
