import type {
  LabelPlusGenerateOptions,
  LabelPlusMatchMode,
  StandardFontRef
} from '@shared/labelplus-import'
import { createDefaultLabelPlusGenerateOptions } from '@shared/labelplus-import'

export interface PersistedImportSettings {
  sourceDirectory: string
  outputDirectory: string
  matchMode: LabelPlusMatchMode
  forcedExtension: string
  autoImportProject: boolean
  options: LabelPlusGenerateOptions
  /** 「交给 Photoshop」那一块的动作集名。留空 = 只出图不跑动作。 */
  photoshopActionSet: string
  /** 分组名 → 动作名。空串 = 回落到分组名本身。 */
  photoshopGroupActions: Record<string, string>
  /** 分组名 → 方向选择。'inherit' = 跟随全场的文字方向。 */
  photoshopGroupDirections: Record<string, GroupDirectionChoice>
}

/** 分组级方向的三选一。'inherit' 不落进清单 —— 不写就是跟随 defaults。 */
export type GroupDirectionChoice = 'inherit' | 'horizontal' | 'vertical'

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function numberOr(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

export function stringOr(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback
}

export function booleanOr(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

/**
 * 从存档里读回"分组名 → 动作名"。只保留字符串值的项 ——
 * 存档是 JSON 落库的，历史版本或被手改过都可能塞进别的东西。
 */
export function stringRecordOr(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {}
  const result: Record<string, string> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'string') result[key] = entry
  }
  return result
}

/** 方向只认这三个值；存档里出现别的一律丢掉，而不是把脏值带进请求。 */
export function directionRecordOr(value: unknown): Record<string, GroupDirectionChoice> {
  const valid: GroupDirectionChoice[] = ['inherit', 'horizontal', 'vertical']
  if (!isRecord(value)) return {}
  const result: Record<string, GroupDirectionChoice> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (valid.includes(entry as GroupDirectionChoice)) result[key] = entry as GroupDirectionChoice
  }
  return result
}

export function mergeOptions(
  raw: unknown,
  fallbackFont: StandardFontRef
): LabelPlusGenerateOptions {
  const defaults = createDefaultLabelPlusGenerateOptions(fallbackFont)
  if (!isRecord(raw)) return defaults
  const rawStyle = isRecord(raw.textStyle) ? raw.textStyle : {}
  const rawFont = isRecord(rawStyle.font) ? rawStyle.font : {}
  const rawShadow = isRecord(rawStyle.shadow) ? rawStyle.shadow : {}
  const rawOffset = isRecord(raw.positionOffset) ? raw.positionOffset : {}
  const rawIndexOffset = isRecord(raw.labelIndexOffset) ? raw.labelIndexOffset : {}
  const rawOverlay = isRecord(raw.dialogOverlay) ? raw.dialogOverlay : {}
  const font: StandardFontRef = {
    id: stringOr(rawFont.id, defaults.textStyle.font.id),
    family: stringOr(rawFont.family, defaults.textStyle.font.family),
    style: stringOr(rawFont.style, defaults.textStyle.font.style),
    postScriptName: stringOr(rawFont.postScriptName, defaults.textStyle.font.postScriptName),
    ...(typeof rawFont.filePath === 'string' ? { filePath: rawFont.filePath } : {})
  }
  return {
    resolutionPpi: numberOr(raw.resolutionPpi, defaults.resolutionPpi),
    ignoreImagesWithoutLabels: booleanOr(
      raw.ignoreImagesWithoutLabels,
      defaults.ignoreImagesWithoutLabels
    ),
    createLayerGroups: booleanOr(raw.createLayerGroups, defaults.createLayerGroups),
    outputLabelIndex: booleanOr(raw.outputLabelIndex, defaults.outputLabelIndex),
    overwriteExisting: booleanOr(raw.overwriteExisting, defaults.overwriteExisting),
    textReplacementExpression: stringOr(
      raw.textReplacementExpression,
      defaults.textReplacementExpression
    ),
    textStyle: {
      font,
      // fontSizePt 是 2026-09-23 之前的键名 —— 不认它的话，旧存档里的字号会静默变回默认值。
      fontSizePx: numberOr(
        rawStyle.fontSizePx ?? rawStyle.fontSize ?? rawStyle.fontSizePt,
        defaults.textStyle.fontSizePx
      ),
      direction:
        (rawStyle.direction ?? rawStyle.orientation) === 'vertical' ? 'vertical' : 'horizontal',
      leadingPercent: numberOr(rawStyle.leadingPercent, defaults.textStyle.leadingPercent),
      alignment:
        rawStyle.alignment === 'center' || rawStyle.alignment === 'right'
          ? rawStyle.alignment
          : 'left',
      fillColor: stringOr(rawStyle.fillColor, defaults.textStyle.fillColor),
      strokeColor: stringOr(rawStyle.strokeColor, defaults.textStyle.strokeColor),
      strokeWidthPx: numberOr(rawStyle.strokeWidthPx, defaults.textStyle.strokeWidthPx),
      fauxBold: booleanOr(rawStyle.fauxBold ?? rawStyle.bold, defaults.textStyle.fauxBold),
      fauxItalic: booleanOr(rawStyle.fauxItalic ?? rawStyle.italic, defaults.textStyle.fauxItalic),
      // 旧存档里没有这俩字段 → 都用默认值 true。
      ligatures: booleanOr(rawStyle.ligatures, defaults.textStyle.ligatures),
      standardVerticalRoman: booleanOr(
        rawStyle.standardVerticalRoman,
        defaults.textStyle.standardVerticalRoman
      ),
      shadow: {
        enabled: booleanOr(rawShadow.enabled, defaults.textStyle.shadow.enabled),
        color: stringOr(rawShadow.color, defaults.textStyle.shadow.color),
        opacity: numberOr(rawShadow.opacity, defaults.textStyle.shadow.opacity),
        distancePx: numberOr(rawShadow.distancePx, defaults.textStyle.shadow.distancePx),
        blurPx: numberOr(rawShadow.blurPx, defaults.textStyle.shadow.blurPx),
        angleDeg: numberOr(rawShadow.angleDeg, defaults.textStyle.shadow.angleDeg)
      }
    },
    positionOffset: {
      unit: 'px',
      x: numberOr(rawOffset.x, 0),
      y: numberOr(rawOffset.y, 0)
    },
    labelIndexOffset: {
      unit: 'px',
      x: numberOr(rawIndexOffset.x, 0),
      y: numberOr(rawIndexOffset.y, 0)
    },
    dialogOverlay: {
      enabled: booleanOr(rawOverlay.enabled, defaults.dialogOverlay.enabled),
      groups: Array.isArray(rawOverlay.groups)
        ? rawOverlay.groups.filter((value): value is string => typeof value === 'string')
        : [],
      radiusXPx: numberOr(rawOverlay.radiusXPx, defaults.dialogOverlay.radiusXPx),
      radiusYPx: numberOr(rawOverlay.radiusYPx, defaults.dialogOverlay.radiusYPx),
      colorMode:
        rawOverlay.colorMode === 'white' || rawOverlay.colorMode === 'custom'
          ? rawOverlay.colorMode
          : 'sample',
      customColor: stringOr(rawOverlay.customColor, defaults.dialogOverlay.customColor)
    }
  }
}
